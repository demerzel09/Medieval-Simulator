import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defaultBudget,
  key,
  point,
  type Composition,
  type Definition,
  type Evidence,
  type Forecast,
  type Json,
  type Offer,
  type Plan,
} from "../packages/ai/hierarchy/contracts";
import { actionStep } from "../packages/ai/hierarchy/composer";
import {
  createPrototypeRegistry,
  prototypeComposition,
  registerParent,
  type PrototypeContext,
} from "../packages/ai/hierarchy/models";
import {
  HierarchyRuntime,
  type RuntimeInput,
} from "../packages/ai/hierarchy/runtime";
import { DecisionSession } from "../packages/ai/hierarchy/session";
import {
  checkHierarchyState,
  ExecutionState,
  ModelStateStore,
  newHierarchyState,
} from "../packages/ai/hierarchy/state";
import { TrackingLedger } from "../packages/ai/hierarchy/tracking";
import { hierarchyV25 } from "../fixtures/hierarchy-v25";
import { hierarchyVillageModel } from "../packages/ai/hierarchy/village-adapter";
import {
  advanceVillageWorld,
  checkVillageWorld,
  loadVillageWorld,
  newVillageWorld,
  queueVillageCommand,
  saveVillageWorld,
  villageHash,
} from "../packages/sim/autonomous-world";
import {
  captureVillageRecording,
  replayVillageRecording,
} from "../packages/sim/village-recording";

function setup(
  composition: Composition = structuredClone(prototypeComposition),
) {
  const registry = createPrototypeRegistry(),
    runtime = new HierarchyRuntime(registry, composition);
  const state = newHierarchyState("F", 240924, registry, composition.version);
  const context: PrototypeContext = {
    site: "a",
    cell: { x: 0, y: 0 },
    home: { id: "b", cell: { x: 16, y: 0 } },
    sheltered: false,
    body: {
      fatigue01: 0.2,
      energy: 20,
      nutritionNeed01: 0.2,
      sleepiness01: 0.1,
      cold: 1,
      digesting: false,
    },
    mass: 0,
    maxEnergy: 26,
    hunger: 0,
    meals: 0,
    cash: 2,
    active: null,
    destinations: [
      { id: "b", cell: { x: 16, y: 0 }, kind: "recovery" },
      { id: "b", cell: { x: 16, y: 0 }, kind: "food" },
    ],
  };
  const observation = {
    fatigue: 0.2,
    energy: 20,
    nutritionNeed: 0.2,
    sleepiness: 0.1,
    cold: 1,
  };
  const input: RuntimeInput = {
    actor: "F",
    minute: 60,
    context,
    observation,
    evidence: [],
    digesting: false,
    projected: {
      minute: point(60),
      site: "a",
      cash: 2,
      lots: { grain: 1 },
      capacity: 20,
      occupied: null,
      body: Object.fromEntries(
        Object.entries(context.body).map(([k, v]) => [k, point(v)]),
      ),
    },
  };
  const session = () =>
    new DecisionSession(registry, state, defaultBudget, composition);
  return { registry, runtime, state, context, input, session };
}
function evidence(
  intent: ReturnType<ExecutionState["submit"]>,
  phase: Evidence["phase"],
  elapsed = 120,
): Evidence {
  return {
    id: `${intent.id}:${phase}`,
    intentId: intent.id,
    eventId: `event:${intent.id}`,
    processId: "process",
    action: intent.action,
    occurred: intent.submitted + (phase === "started" ? 0 : elapsed),
    received: intent.submitted + (phase === "started" ? 60 : elapsed + 60),
    started: intent.submitted,
    elapsed: phase === "started" ? 0 : elapsed,
    phase,
    before: structuredClone(intent.before),
    after: {
      fatigue: 0.38,
      energy: 17,
      nutritionNeed: 0.22,
      sleepiness: 0.15,
      cold: 2,
    },
  };
}
function plan(): Plan {
  return {
    id: "proposal",
    goalId: "proposal",
    revision: 1,
    entry: "move",
    nodes: [
      {
        id: "move",
        kind: "delegate",
        model: "$travel",
        request: { to: "b", cell: { x: 16, y: 0 }, deadline: 900 },
        attempt: null,
        duration: 0,
        claims: [],
      },
    ],
    edges: [],
    loops: [],
  };
}
function offer(parent = "food-parent@1"): Offer {
  return {
    id: parent,
    parent,
    purpose: "test",
    target: "b",
    deadline: 900,
    basis: "temporary-goal-v1",
    completion: "arrival",
    priority: 1,
    plan: plan(),
  };
}
function pending(f = setup()) {
  const ex = new ExecutionState(f.state),
    goal = ex.adopt(offer(), 60),
    s = f.session();
  const forecast = s.invoke<unknown, Forecast>("compose@1", {
    plan: plan(),
    start: f.input.projected,
    context: f.context,
  });
  const intent = ex.submit(
    goal,
    "move",
    "travel-control@1",
    { kind: "travel", args: { siteId: "b" } },
    f.input.observation,
    forecast.segments[0].refs,
    60,
  );
  const ledger = new TrackingLedger(
    f.state,
    f.registry,
    defaultBudget,
    prototypeComposition.analyzer,
  );
  ledger.receive([evidence(intent, "started")], 120, f.session());
  return { ...f, ex, goal, intent, ledger };
}

it("1 registration: rejects incompatible wiring and permits independent replacement and an additional parent", () => {
  const r = createPrototypeRegistry();
  const before = r.fingerprint("travel-forward@1");
  registerParent(r, "third-parent@1", "food");
  const c = structuredClone(prototypeComposition);
  c.root.push("third-parent@1");
  expect(() => r.compile(c)).not.toThrow();
  expect(r.fingerprint("travel-forward@1")).toBe(before);
  const third = setup();
  const thirdResult = new HierarchyRuntime(r, c).decide(
    third.input,
    newHierarchyState("F", 1, r, c.version),
  );
  expect(
    thirdResult.state.choices
      .at(-1)
      ?.candidates.some((candidate) => candidate.id.includes("third-parent@1")),
  ).toBe(true);
  expect(thirdResult.attempt?.kind).toBe("travel");
  for (const issue of ["unit", "timing", "body", "cycle"] as const) {
    const registry = createPrototypeRegistry();
    const composition = structuredClone(prototypeComposition);
    const port = {
      name: "in",
      quantity: "fatigue01",
      unit: issue === "unit" ? "minute" : "fatigue01",
      timing:
        issue === "timing" ? ("observed" as const) : ("predicted" as const),
    };
    registry.add(
      {
        id: "sink@1",
        role: issue === "body" ? "control" : "composer",
        projection: "subjective-v1",
        contract: "test",
        inputs: [port],
        outputs: [port],
        initial: {},
        learner: null,
        cost: 1,
      },
      z.unknown(),
      z.unknown(),
      z.object({}),
      () => ({}),
    );
    composition.edges.push({
      from: "body-forward@1",
      output: "fatigue01",
      to: "sink@1",
      input: "in",
      phase: 1,
    });
    if (issue === "cycle")
      composition.edges.push({
        from: "sink@1",
        output: "in",
        to: "sink@1",
        input: "in",
        phase: 1,
      });
    expect(() => registry.compile(composition)).toThrow(
      issue === "unit"
        ? "unit-mismatch"
        : issue === "timing"
          ? "timing-mismatch"
          : issue === "body"
            ? "body-port-outside-composer"
            : "cycle-without-loop",
    );
  }
  const registry = createPrototypeRegistry();
  expect(() =>
    registry.add(
      {
        id: "bad@1",
        role: "forward",
        projection: "hidden-world",
        contract: "test",
        inputs: [],
        outputs: [],
        initial: {},
        learner: null,
        cost: 1,
      },
      z.unknown(),
      z.unknown(),
      z.object({}),
      () => ({}),
    ),
  ).toThrow("missing-projection");
  registry.forward(
    {
      id: "alternative@1",
      role: "forward",
      projection: "subjective-v1",
      contract: "duration-v1",
      inputs: [],
      outputs: [],
      initial: {},
      learner: null,
      cost: 1,
    },
    z.unknown(),
    z.unknown(),
    z.object({}),
    { predict: () => point(180) },
  );
  const replacement = structuredClone(prototypeComposition);
  replacement.aliases["$travel-prediction"].model = "alternative@1";
  registry.control(
    {
      id: "alternative-control@1",
      role: "control",
      projection: "subjective-v1",
      contract: "travel-control-v1",
      inputs: [],
      outputs: [],
      initial: {},
      learner: null,
      cost: 1,
    },
    z.unknown(),
    z.unknown(),
    z.object({}),
    {
      propose: () => ({
        attempt: { kind: "travel", args: { siteId: "alternate" } },
        duration: point(90),
        site: "alternate",
        interrupts: false,
      }),
    },
  );
  registry.compile(replacement);
  const f = setup(),
    state = newHierarchyState("F", 1, registry, replacement.version),
    session = new DecisionSession(registry, state, defaultBudget, replacement);
  expect(
    session.invoke<any, any>("$travel", {
      context: f.context,
      request: { to: "b", cell: { x: 16, y: 0 }, deadline: 900 },
    }).duration.value,
  ).toBe(180);
  expect(() =>
    session.invoke("$travel", { context: f.context, request: { to: 5 } }),
  ).toThrow();
  const controlReplacement = structuredClone(replacement);
  controlReplacement.aliases["$travel"].model = "alternative-control@1";
  registry.compile(controlReplacement);
  const alternateSession = new DecisionSession(
    registry,
    state,
    defaultBudget,
    controlReplacement,
  );
  expect(
    alternateSession.invoke<any, any>("$travel", {}).attempt.args.siteId,
  ).toBe("alternate");
  expect(
    alternateSession.invoke<any, any>("$travel-prediction", {}).value,
  ).toBe(180);
});

it("2 plans: rejects duplicate lots, negative cash and overlapping body use, retaining distinct choice exclusions", () => {
  const f = setup();
  const invalidPlans: Plan[] = [];
  const base = (): Plan => ({
    id: "p",
    goalId: "g",
    revision: 1,
    entry: "a",
    nodes: [actionStep("a", "rest", 60), actionStep("b", "rest", 60)],
    edges: [{ from: "a", to: "b", on: "completed" }],
    loops: [],
  });
  const duplicate = base();
  for (const n of duplicate.nodes)
    n.claims = [{ kind: "lot", id: "grain", mode: "consume", quantity: 0.5 }];
  invalidPlans.push(duplicate);
  const cash = base();
  cash.nodes[0].claims = [
    { kind: "cash", id: "cash", mode: "consume", quantity: 3 },
  ];
  invalidPlans.push(cash);
  const body = base();
  body.nodes[0].claims.push({
    kind: "body",
    id: "sleep",
    mode: "hold",
    quantity: 1,
  });
  invalidPlans.push(body);
  const codes = ["duplicate-resource", "negative-cash", "body-conflict"];
  invalidPlans.forEach((p, i) =>
    expect(
      f
        .session()
        .invoke<
          unknown,
          Forecast
        >("compose@1", { plan: p, start: f.input.projected, context: f.context })
        .violations,
    ).toContain(codes[i]),
  );
  const cycle = base();
  cycle.edges.push({ from: "b", to: "a", on: "completed" });
  expect(
    f
      .session()
      .invoke<
        unknown,
        Forecast
      >("compose@1", { plan: cycle, start: f.input.projected, context: f.context })
      .violations,
  ).toContain("cycle-without-loop");
  cycle.loops = [{ steps: ["a", "b"], maxIterations: 2 }];
  expect(
    f
      .session()
      .invoke<
        unknown,
        Forecast
      >("compose@1", { plan: cycle, start: f.input.projected, context: f.context })
      .segments,
  ).toHaveLength(4);
  const registry = createPrototypeRegistry();
  registry.control(
    {
      id: "bad-plans@1",
      role: "control",
      projection: "subjective-v1",
      contract: "test",
      inputs: [],
      outputs: [],
      initial: {},
      learner: null,
      cost: 1,
    },
    z.unknown(),
    z.unknown(),
    z.object({}),
    {
      propose: () =>
        invalidPlans.map((p, i) => ({
          ...offer("bad-plans@1"),
          id: `bad${i}`,
          plan: p,
        })),
    },
  );
  const c = { ...structuredClone(prototypeComposition), root: ["bad-plans@1"] },
    runtime = new HierarchyRuntime(registry, c),
    state = newHierarchyState("F", 1, registry, c.version);
  const result = runtime.decide(f.input, state);
  expect(result.state.choices.at(-1)?.source).toBe("fallback");
  codes.forEach((code, i) =>
    expect(result.state.choices.at(-1)?.candidates[i].violations).toContain(
      code,
    ),
  );
});

it("3 composition: shares calls and learning, preserves branch states, and diagnoses input propagation with saved models", () => {
  const f = pending();
  const s = f.session();
  const original = key(f.state);
  const input = { plan: plan(), start: f.input.projected, context: f.context };
  for (const parent of ["food-parent@1", "recovery-parent@1"]) {
    const proposals = s.invoke<unknown, Offer[]>(parent, {
      context: f.context,
      minute: 60,
    });
    s.invoke("compose@1", { ...input, plan: proposals[0].plan });
  }
  const count = s.usage().forecasts;
  s.invoke("compose@1", input);
  expect(s.usage().forecasts).toBe(count);
  expect(count).toBe(3);
  expect(key(f.state)).toBe(original);
  const branch = plan();
  branch.nodes.push(
    {
      ...actionStep("sold", "rest", 0),
      claims: [{ kind: "cash", id: "cash", mode: "produce", quantity: 3 }],
    },
    actionStep("unsold", "rest", 0),
    actionStep("never", "rest", 0),
  );
  branch.edges = [
    { from: "move", to: "sold", on: "completed" },
    { from: "move", to: "unsold", on: "failed" },
    { from: "move", to: "never", on: "unreached" },
  ];
  const out = f
    .session()
    .invoke<unknown, Forecast>("compose@1", { ...input, plan: branch });
  expect(out.segments.find((s) => s.step === "sold")?.after.cash).toBe(5);
  expect(out.segments.find((s) => s.step === "unsold")?.after.cash).toBe(2);
  expect(out.segments.find((s) => s.step === "never")?.after.minute).toEqual({
    kind: "unknown",
    reason: "unreached-branch",
  });
  const event = evidence(f.intent, "completed");
  f.ledger.receive([event, event], 240, f.session());
  expect(f.state.models["travel-forward@1"].revision).toBe(1);
  expect(f.state.models["body-forward@1"].revision).toBe(1);
  const body = f.state.tracking[0].items.find(
    (i) => i.ref.model === "body-forward@1",
  )!;
  expect((body.diagnostic as any).fatigue01).toEqual({
    total: expect.closeTo(0.14),
    local: expect.closeTo(0.1),
    upstream: expect.closeTo(0.04),
  });
  expect((body.actualInput as any).minutes.value).toBe(120);
  expect((body.ref.input as any).minutes.value).toBe(60);
  f.ledger.receive([event], 300, f.session());
  expect(f.state.models["body-forward@1"].revision).toBe(1);
});

it("4 state machine: interrupts and resumes without misrouting, closes an old child after parent switch, and censors external control", () => {
  const f = pending();
  const cold = {
    ...f.context,
    active: "travel",
    body: { ...f.context.body, cold: 8 },
  };
  expect(
    f
      .session()
      .invoke<
        any,
        any
      >("$travel", { context: cold, request: plan().nodes[0].request }).attempt
      .kind,
  ).toBe("interrupt_action");
  const event = evidence(f.intent, "interrupted");
  f.ledger.receive([event], 240, f.session());
  expect(f.goal.status).toBe("suspended");
  expect(f.state.models["travel-forward@1"].revision).toBe(0);
  expect(f.state.models["body-forward@1"].revision).toBe(1);
  f.ex.revise(f.goal, plan(), 300, "resume");
  expect(f.goal.planRevision).toBe(2);
  expect(f.goal.revision).toBe(1);
  const shelter = { ...plan(), id: "shelter" };
  f.ex.revise(f.goal, shelter, 360, "interruption");
  const shelterIntent = f.ex.submit(
    f.goal,
    "move",
    "$travel",
    { kind: "travel", args: { siteId: "home" } },
    f.input.observation,
    [],
    360,
  );
  f.ledger.receive(
    [
      evidence(shelterIntent, "started"),
      evidence(shelterIntent, "completed", 60),
    ],
    480,
    f.session(),
  );
  f.ex.revise(f.goal, plan(), 540, "resume");
  expect(f.goal.planRevision).toBe(4);
  expect(f.goal.revision).toBe(1);
  expect(f.state.tracking[0].gain.reason).toBe("superseded-by-revision");
  expect(f.state.tracking.at(-1)?.gain.status).toBe("open");
  const predictedFailure = pending();
  predictedFailure.ledger.receive(
    [evidence(predictedFailure.intent, "failed", 60)],
    180,
    predictedFailure.session(),
  );
  expect(
    (
      predictedFailure.state.feedback.find(
        (f) => f.kind === "prediction" && f.model === "travel-forward@1",
      )?.payload as any
    ).total,
  ).toBe(0);
  expect(
    (
      predictedFailure.state.feedback.find((f) => f.kind === "control")
        ?.payload as any
    ).achieved,
  ).toBe(false);
  const switched = pending();
  switched.ex.switchParent(switched.goal, offer("recovery-parent@1"), 150);
  switched.ledger.receive(
    [evidence(switched.intent, "completed")],
    240,
    switched.session(),
  );
  expect(switched.state.models["travel-forward@1"].revision).toBe(1);
  expect(
    switched.state.feedback.find((f) => f.kind === "control")?.reason,
  ).toBe("superseded-by-revision");
  const replaced = setup();
  const ex = new ExecutionState(replaced.state),
    g = ex.adopt(offer(), 60);
  const i = ex.submit(
    g,
    "move",
    "$travel",
    { kind: "travel", args: { siteId: "b" } },
    replaced.input.observation,
    [],
    60,
  );
  const external = { ...evidence(i, "superseded", 0), processId: null };
  new TrackingLedger(
    replaced.state,
    replaced.registry,
    defaultBudget,
    prototypeComposition.analyzer,
  ).receive([external], 120, replaced.session());
  expect(i.status).toBe("superseded");
  expect(
    replaced.state.feedback
      .filter((f) => f.kind === "control")
      .every((f) => !f.applied && f.reason === "external-command"),
  ).toBe(true);
  expect(replaced.state.tracking[0].close?.reason).toBe("superseded");
  const stale = pending();
  stale.state.policyRevision++;
  stale.ledger.receive(
    [evidence(stale.intent, "completed")],
    240,
    stale.session(),
  );
  expect(stale.state.tracking[0].gain.reason).toBe("stale-policy");
  expect(
    stale.state.feedback.some(
      (f) => f.kind === "control" && f.model === "travel-control@1",
    ),
  ).toBe(true);
});

it("5 observation tracking: preserves missing meals, delayed absorption, ambiguous absorption and late evidence across JSON restart", () => {
  const f = pending();
  const t = f.state.tracking[0];
  t.expires = 180;
  f.ledger.receive([], 180, f.session());
  expect(t.close?.reason).toBe("deadline");
  expect(t.items.every((i) => i.status === "unobserved")).toBe(true);
  const restored = JSON.parse(JSON.stringify(f.state));
  const ledger = new TrackingLedger(
    restored,
    f.registry,
    defaultBudget,
    prototypeComposition.analyzer,
  );
  ledger.receive(
    [evidence(f.intent, "completed")],
    240,
    new DecisionSession(
      f.registry,
      restored,
      defaultBudget,
      prototypeComposition,
    ),
  );
  expect(
    restored.tracking[0].items.every((i: any) => i.status === "late"),
  ).toBe(true);
  expect(restored.models["travel-forward@1"].revision).toBe(0);
  const waiting = pending();
  waiting.ledger.meal(waiting.state.tracking[0]);
  waiting.ex.suspend(waiting.goal, "self-interrupted");
  expect(waiting.state.tracking[0].close).toBeNull();
  const saved = JSON.parse(JSON.stringify(waiting.state));
  new TrackingLedger(
    saved,
    waiting.registry,
    defaultBudget,
    prototypeComposition.analyzer,
  ).digestion(false, 240);
  expect(saved.tracking[0].absorption.status).toBe("estimated");
  expect(saved.tracking[0].gain.status).toBe("unresolved");
  waiting.ledger.meal(waiting.state.tracking[0]);
  waiting.ledger.digestion(false, 240);
  expect(waiting.state.tracking[0].absorption?.status).toBe("ambiguous");
  const acquired = pending();
  acquired.goal.completion = "absorption";
  const acquisition = acquired.ex.submit(
    acquired.goal,
    "take",
    "atomic-control",
    { kind: "take_home", args: {} },
    acquired.input.observation,
    [],
    180,
  );
  acquired.ledger.receive(
    [{ ...evidence(acquisition, "completed", 0), processId: null }],
    240,
    acquired.session(),
  );
  expect(acquired.state.tracking[0].close).toBeNull();
  expect(acquired.state.tracking[0].gain.status).toBe("open");
  acquired.ledger.close(acquired.state.tracking[0], "deadline", 900);
  const capacity = pending();
  capacity.ex.adopt(offer("recovery-parent@1"), 120);
  new TrackingLedger(
    capacity.state,
    capacity.registry,
    { ...defaultBudget, openTracking: 1 },
    prototypeComposition.analyzer,
  ).limit(180);
  expect(capacity.state.tracking[0].close?.reason).toBe("capacity");
  expect(
    capacity.state.tracking[0].items.every((i) => i.status === "censored"),
  ).toBe(true);
  capacity.ledger.close(capacity.state.tracking[1], "self-interrupted", 240);
  expect(capacity.state.tracking[1].close?.reason).toBe("self-interrupted");
  expect(acquired.state.tracking[0].absorption).toBeNull();
  expect(acquired.state.tracking[0].gain.status).toBe("unresolved");
  const rejected = pending();
  const submitted = rejected.ex.submit(
    rejected.goal,
    "move",
    "travel-control@1",
    { kind: "travel", args: { siteId: "missing" } },
    rejected.input.observation,
    [],
    120,
  );
  rejected.ledger.receive(
    [{ ...evidence(submitted, "rejected", 0), processId: null }],
    180,
    rejected.session(),
  );
  expect(rejected.state.tracking[0].close?.reason).toBe("world-rejected");
  expect(rejected.state.models["body-forward@1"].revision).toBe(0);
});

it("6 persistence: resumes open predictions and snapshots, recomputes all world decisions, replays new rules and isolates actors", () => {
  const f = pending();
  const store = new ModelStateStore(f.state, f.registry, defaultBudget);
  store.apply("body-forward@1", "other-observation", { samples: {} });
  expect(f.state.snapshots).toHaveLength(1);
  const saved = JSON.parse(JSON.stringify(f.state));
  checkHierarchyState(saved, f.registry, prototypeComposition.version);
  f.ledger.receive([evidence(f.intent, "completed")], 240, f.session());
  new TrackingLedger(
    saved,
    f.registry,
    defaultBudget,
    prototypeComposition.analyzer,
  ).receive(
    [evidence(f.intent, "completed")],
    240,
    new DecisionSession(f.registry, saved, defaultBudget, prototypeComposition),
  );
  expect(saved).toEqual(f.state);
  expect(() =>
    checkHierarchyState(
      { ...saved, registryVersion: "wrong" },
      f.registry,
      prototypeComposition.version,
    ),
  ).toThrow("model-mismatch");
  expect(() =>
    checkHierarchyState(
      { ...saved, nextId: NaN },
      f.registry,
      prototypeComposition.version,
    ),
  ).toThrow("non-JSON");
  const w = newVillageWorld(240924, hierarchyV25);
  advanceVillageWorld(w, 4, hierarchyVillageModel);
  expect(w.people.S.memory.hierarchy).not.toBe(w.people.C.memory.hierarchy);
  const resumed = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 20, hierarchyVillageModel);
  advanceVillageWorld(resumed, 20, hierarchyVillageModel);
  expect(villageHash(resumed)).toBe(villageHash(w));
  for (const d of w.decisions)
    expect(
      hierarchyVillageModel.decide({
        actorId: d.actorId,
        at: d.hour,
        stimuli: d.stimuli,
        knownContext: d.knownContext,
        subjectiveState: d.subjectiveBefore,
      }),
    ).toEqual(d.response);
  const recording = captureVillageRecording(w);
  expect(recording.rulesetId).toBe("autonomous-village-hierarchy-v25");
  expect(villageHash(replayVillageRecording(recording))).toBe(villageHash(w));
  checkVillageWorld(w);
  expect(
    w.decisions.some(
      (d) =>
        (d.response.subjectiveUpdate?.hierarchy?.models["travel-forward@1"]
          .revision ?? 0) > 0,
    ),
  ).toBe(true);
}, 120000);

it("7 budgets: limits proposals, forecasts, branches, depth and analysis; keeps unknown and deterministically rolls back to fallback", () => {
  const f = setup();
  for (const work of [
    "proposals",
    "forecasts",
    "branchesPerPlan",
    "compositionDepth",
  ] as const) {
    const budget = { ...defaultBudget, [work]: 0 },
      a = f.runtime.decide(f.input, f.state, budget),
      b = f.runtime.decide(f.input, f.state, budget);
    expect(a).toEqual(b);
    expect(a.state.choices.at(-1)?.source).toBe("fallback");
    expect(a.state.failures.at(-1)?.code).toBe("budget-exhausted");
    expect(a.state.goals).toHaveLength(0);
    expect(a.state.rng).toEqual(f.state.rng);
    expect(
      a.state.choices.at(-1)?.candidates.every((c) => c.score === null),
    ).toBe(true);
  }
  const limited = pending();
  const budget = { ...defaultBudget, analyses: 0 };
  new TrackingLedger(
    limited.state,
    limited.registry,
    budget,
    prototypeComposition.analyzer,
  ).receive(
    [evidence(limited.intent, "completed")],
    240,
    new DecisionSession(
      limited.registry,
      limited.state,
      budget,
      prototypeComposition,
    ),
  );
  expect(limited.state.models["body-forward@1"].revision).toBe(0);
  expect(limited.state.pendingEvidence).toHaveLength(1);
  limited.ledger.receive([], 300, limited.session());
  expect(limited.state.models["body-forward@1"].revision).toBe(1);
  const complete = pending();
  const input = {
    ...complete.input,
    minute: 240,
    evidence: [evidence(complete.intent, "completed")],
  };
  const result = complete.runtime.decide(input, complete.state, {
    ...defaultBudget,
    forecasts: 0,
  });
  expect(result.state.models["body-forward@1"].revision).toBe(1);
  expect(result.state.choices.at(-1)?.source).toBe("fallback");
  const invalidResponse = new HierarchyRuntime(
    complete.registry,
    prototypeComposition,
    (attempt) => {
      if (attempt.kind === "travel")
        throw Error("contract-violation: unavailable world action");
    },
  ).decide(input, complete.state);
  expect(invalidResponse.state.models["body-forward@1"].revision).toBe(1);
  expect(invalidResponse.state.choices.at(-1)?.source).toBe("fallback");
  expect(invalidResponse.state.failures.at(-1)?.phase).toBe("respond");
  expect(invalidResponse.state.intents).toHaveLength(
    complete.state.intents.length,
  );
});
