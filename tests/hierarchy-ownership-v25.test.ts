import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { z } from "zod";
import { actionStep } from "../packages/ai/hierarchy/composer";
import {
  defaultBudget,
  type Offer,
  type Ref,
} from "../packages/ai/hierarchy/contracts";
import {
  createPrototypeRegistry,
  prototypeComposition,
} from "../packages/ai/hierarchy/models";
import { DecisionSession } from "../packages/ai/hierarchy/session";
import {
  ExecutionState,
  ModelStateStore,
  newHierarchyState,
} from "../packages/ai/hierarchy/state";
import { TrackingLedger } from "../packages/ai/hierarchy/tracking";
import { hierarchyVillageModel } from "../packages/ai/hierarchy/village-adapter";
import { decodeVillageDocument } from "../packages/sim/shared-village-json";
import {
  replayVillageRecording,
  type VillageRecording,
} from "../packages/sim/village-recording";
import { villageHash } from "../packages/sim/autonomous-world";

function setup(completion: Offer["completion"] = "arrival") {
  const registry = createPrototypeRegistry();
  registry.compile(prototypeComposition);
  const state = newHierarchyState(
    "F",
    240924,
    registry,
    prototypeComposition.version,
  );
  const execution = new ExecutionState(state);
  const offer: Offer = {
    id: "local-recovery",
    parent: "recovery-parent@1",
    purpose: "recovery",
    target: "home",
    deadline: 600,
    priority: 0,
    basis: "temporary-goal-v1",
    completion,
    plan: {
      id: "proposed",
      goalId: "proposed",
      revision: 1,
      entry: "rest",
      nodes: [
        actionStep("rest", "rest", 120),
        {
          id: "observe",
          kind: "observe",
          model: null,
          request: null,
          attempt: null,
          duration: 0,
          claims: [],
        },
      ],
      edges: [{ from: "rest", to: "observe", on: "completed" }],
      loops: [],
    },
  };
  const goal = execution.adopt(offer, 0);
  const ledger = new TrackingLedger(
    state,
    registry,
    defaultBudget,
    prototypeComposition.analyzer,
  );
  return { state, registry, execution, offer, goal, ledger };
}

it("returns detached frozen goals, steps and intents while the owner can still advance them", () => {
  const f = setup();
  const step = f.execution.nextStep(f.goal)!;
  expect(Reflect.set(f.goal, "status", "completed")).toBe(false);
  expect(Reflect.set(step.attempt!.args, "injected", true)).toBe(false);
  const intent = f.execution.submit(
    f.goal,
    "rest",
    f.goal.parent,
    step.attempt!,
    {},
    [],
    0,
  );
  expect(Reflect.set(intent.args, "injected", true)).toBe(false);
  expect(f.state.intents[0].args).toEqual({});
  f.execution.suspend(f.goal);
  expect(f.goal.status).toBe("executing"); // A snapshot is not a live writable reference.
  expect(f.execution.readGoal(f.goal.id).status).toBe("suspended");
  expect(f.execution.current(0)).toBeUndefined();
  f.execution.receive(intent, {
    id: "external",
    intentId: intent.id,
    eventId: "external-event",
    processId: null,
    action: "rest",
    occurred: 0,
    received: 0,
    started: 0,
    elapsed: 0,
    phase: "superseded",
    before: {},
    after: {},
  });
  expect(f.execution.readIntent(intent.id).status).toBe("superseded");
  expect(f.execution.readIntent(intent.id).source).toBe("external-command");
  expect(intent.status).toBe("submitted");
});

it("rejects stale goal revisions before submitting or revising another plan", () => {
  const f = setup();
  const revised = f.execution.revise(
    f.goal,
    f.offer.plan,
    1,
    "quantity-change",
  );
  const before = JSON.stringify(f.state);
  expect(() =>
    f.execution.submit(
      f.goal,
      "rest",
      f.goal.parent,
      { kind: "rest", args: {} },
      {},
      [],
      1,
    ),
  ).toThrow("stale goal revision");
  expect(() => f.execution.revise(f.goal, f.offer.plan, 2, "resume")).toThrow(
    "stale goal revision",
  );
  expect(() =>
    f.execution.suspend({ ...revised, id: "another-person:goal" }),
  ).toThrow("stale goal revision");
  expect(JSON.stringify(f.state)).toBe(before);
  expect(f.execution.nextStep(revised)?.id).toBe("rest");
});

it("rejects stale learning after JSON restart without losing the newer update or duplicating an experience", () => {
  const f = setup();
  const store = new ModelStateStore(f.state, f.registry, defaultBudget);
  const base = store.read("body-forward@1");
  expect(Reflect.set(base.value as object, "samples", {})).toBe(false);
  expect(
    store.apply("body-forward@1", "event:first", base.revision, {
      samples: { rest: { count: 1, mean: 2 } },
    }),
  ).toBe(true);
  const restored = JSON.parse(JSON.stringify(f.state));
  const resumed = new ModelStateStore(restored, f.registry, defaultBudget);
  const before = JSON.stringify(restored);
  expect(() =>
    resumed.apply("body-forward@1", "event:second", base.revision, {
      samples: {},
    }),
  ).toThrow("stale model revision");
  expect(
    resumed.apply("body-forward@1", "event:first", base.revision, {
      samples: {},
    }),
  ).toBe(false);
  expect(JSON.stringify(restored)).toBe(before);
  expect(
    resumed.apply(
      "body-forward@1",
      "event:second",
      resumed.read("body-forward@1").revision,
      { samples: {} },
    ),
  ).toBe(true);
  expect(restored.models["body-forward@1"].revision).toBe(2);
  expect(() => resumed.apply("food-parent@1", "event:fixed", 0, {})).toThrow(
    "fixed model update",
  );
});

it("keeps execution completion separate from delayed absorption and unmeasured parent gain", () => {
  const f = setup("absorption");
  expect(() => f.ledger.settlePlan(f.goal, 0)).toThrow("unfinished plan");
  expect(f.execution.readGoal(f.goal.id).status).toBe("executing");
  const intent = f.execution.submit(
    f.goal,
    "rest",
    f.goal.parent,
    { kind: "rest", args: {} },
    {},
    [],
    0,
  );
  // Synthetic observed process completion; this does not assert a successful meal.
  f.execution.receive(intent, {
    id: "result",
    intentId: intent.id,
    eventId: "event",
    processId: null,
    action: "rest",
    occurred: 120,
    received: 120,
    started: 0,
    elapsed: 120,
    phase: "completed",
    before: {},
    after: {},
  });
  expect(f.ledger.settlePlan(f.goal, 120).status).toBe("waiting");
  expect(f.state.tracking[0].close).toBeNull();
  f.ledger.meal(f.state.tracking[0]);
  f.ledger.digestion(false, 180);
  expect(f.ledger.settlePlan(f.goal, 180).status).toBe("completed");
  expect(f.state.tracking[0].gain).toEqual({
    status: "unresolved",
    reason: "goal-complete-value-unmeasured",
  });
});

it("expires goals and records rejected plans without manufacturing a numerical failure teacher", () => {
  const f = setup();
  const intent = f.execution.submit(
    f.goal,
    "rest",
    f.goal.parent,
    { kind: "rest", args: {} },
    {},
    [],
    0,
  );
  f.execution.receive(intent, {
    id: "rejection",
    intentId: intent.id,
    eventId: "event",
    processId: null,
    action: "rest",
    occurred: 0,
    received: 0,
    started: 0,
    elapsed: 0,
    phase: "rejected",
    before: {},
    after: {},
  });
  expect(f.ledger.settlePlan(f.goal, 0)).toEqual({
    status: "abandoned",
    reason: "rejected",
  });
  expect(f.state.tracking[0].gain).toEqual({
    status: "unresolved",
    reason: "rejected",
  });
  const next = f.execution.select(f.offer, 1);
  expect(f.execution.current(600)).toBeUndefined();
  expect(f.execution.readGoal(next.id).status).toBe("expired");
  const before = JSON.stringify(f.state);
  expect(() => f.execution.revise(next, f.offer.plan, 601, "resume")).toThrow(
    "terminal goal",
  );
  expect(() => f.execution.suspend(next)).toThrow("terminal goal");
  expect(JSON.stringify(f.state)).toBe(before);

  expect(() =>
    f.execution.submit(
      next,
      "rest",
      next.parent,
      { kind: "rest", args: {} },
      {},
      [],
      601,
    ),
  ).toThrow("inactive goal");
});

it("exposes a frozen model call interface without leaking the session, registry or mutable provenance", () => {
  const registry = createPrototypeRegistry();
  registry.add(
    {
      id: "inspect-calls@1",
      role: "evaluator",
      contract: "inspect",
      projection: "subjective-v1",
      inputs: [],
      outputs: [],
      initial: {},
      learner: null,
      cost: 1,
    },
    z.object({}),
    z.boolean(),
    z.object({}),
    (_input, _state, calls) => {
      expect(Object.keys(calls).sort()).toEqual([
        "invoke",
        "limit",
        "peak",
        "refs",
        "take",
      ]);
      expect("state" in calls || "registry" in calls || "meter" in calls).toBe(
        false,
      );
      expect(Object.isFrozen(calls)).toBe(true);
      expect(() => (calls.refs as Ref[]).push({} as Ref)).toThrow();
      return true;
    },
  );
  registry.compile(prototypeComposition);
  const state = newHierarchyState(
    "F",
    1,
    registry,
    prototypeComposition.version,
  );
  const session = new DecisionSession(
    registry,
    state,
    defaultBudget,
    prototypeComposition,
  );
  const before = JSON.stringify(state);
  expect(session.invoke("inspect-calls@1", {})).toBe(true);
  expect(session.refs).toEqual([]);
  expect(JSON.stringify(state)).toBe(before);
});

it("recomputes every bundled recovery response and preserves the 90-day state hash", () => {
  const record = decodeVillageDocument<VillageRecording>(
    JSON.parse(
      gunzipSync(
        readFileSync(
          "fixtures/recordings/autonomous-village-hierarchy-recovery-90.v2.json.gz",
        ),
      ).toString(),
    ),
    true,
  );
  expect(record.decisions).toHaveLength(217);
  for (const d of record.decisions) {
    const result = hierarchyVillageModel.decide({
      actorId: d.actorId,
      at: d.hour,
      knownContext: d.knownContext,
      stimuli: d.stimuli,
      subjectiveState: d.subjectiveBefore,
    });
    expect(JSON.stringify(result), d.eventId).toBe(JSON.stringify(d.response));
  }
  expect(villageHash(replayVillageRecording(record))).toBe("ea16d99e");
}, 30000);
