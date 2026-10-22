import { z } from "zod";
import { jsonValue, planSchema, refSchema, evidenceSchema } from "./schemas";
import {
  frozen,
  json,
  key,
  type Budget,
  type CloseReason,
  type Evidence,
  type Feedback,
  type Json,
  type Offer,
  type Plan,
  type Ref,
} from "./contracts";
import type { ModelRegistry } from "./registry";

export type ModelState = { revision: number; value: Json; applied: string[] };
export type Goal = {
  id: string;
  revision: number;
  parent: string;
  purpose: string;
  target: string;
  deadline: number;
  completion: "arrival" | "absorption";
  status: "executing" | "suspended" | "completed" | "abandoned" | "expired";
  plan: string;
  planRevision: number;
};
export type Intent = {
  id: string;
  goal: string;
  plan: string;
  revision: number;
  step: string;
  delegation: string;
  action: string;
  args: { [key: string]: Json };
  submitted: number;
  before: Json;
  status:
    | "submitted"
    | "started"
    | "completed"
    | "failed"
    | "rejected"
    | "interrupted"
    | "superseded"
    | "withdrawn";
  process: string | null;
  event: string | null;
  refs: Ref[];
  source: "policy" | "external-command";
};
export type TrackingItem = {
  intent: string;
  ref: Ref;
  status:
    | "open"
    | "observed"
    | "estimated"
    | "ambiguous"
    | "unobserved"
    | "censored"
    | "late";
  snapshot: "live" | "stored" | "unavailable";
  actualInput: Json | null;
  observed: Json | null;
  diagnostic: Json | null;
};
export type Tracking = {
  id: string;
  goal: string;
  revision: number;
  opened: number;
  expires: number;
  policyRevision: number;
  items: TrackingItem[];
  close: { reason: CloseReason; minute: number } | null;
  gain: { status: "open" | "unresolved" | "observed"; reason: string };
  absorption: {
    status: "open" | "estimated" | "ambiguous" | "unobserved";
    meals: number;
    digesting: boolean;
  } | null;
};
export type Choice = {
  id: string;
  minute: number;
  source: "policy" | "fallback" | "external-command";
  chosen: string;
  candidates: {
    id: string;
    score: number | null;
    violations: string[];
    unevaluated: string[];
  }[];
  basis: "temporary-goal-v1";
  policyRevision: number;
  modelRevisions: Record<string, number>;
  rngDraws: number;
  usage: Record<string, number>;
  exhausted: boolean;
};
export type HierarchyState = {
  version: 1;
  registryVersion: string;
  compositionVersion: string;
  actor: string;
  models: Record<string, ModelState>;
  goals: Goal[];
  plans: Plan[];
  intents: Intent[];
  delegations: {
    id: string;
    goal: string;
    revision: number;
    parent: string;
    child: string;
    intent: string;
    status: "active" | "completed" | "failed" | "withdrawn" | "expired";
  }[];
  tracking: Tracking[];
  choices: Choice[];
  feedback: Feedback[];
  snapshots: { model: string; revision: number; value: Json }[];
  failures: { minute: number; phase: string; code: string; detail: string }[];
  rng: { algorithm: "xorshift32"; state: number; draws: number };
  nextId: number;
  policyRevision: number;
  received: string[];
  pendingEvidence: Evidence[];
  pendingLearning: { model: string; event: string; input: Json }[];
};
const count = z.number().int().nonnegative(),
  id = z.string().min(1),
  strings = z.array(z.string());
const hierarchySchema = z
  .object({
    version: z.literal(1),
    registryVersion: id,
    compositionVersion: id,
    actor: id,
    nextId: z.number().int().positive(),
    policyRevision: count,
    models: z.record(
      z
        .object({ revision: count, value: jsonValue, applied: strings })
        .strict(),
    ),
    goals: z.array(
      z
        .object({
          id,
          revision: z.number().int().positive(),
          parent: id,
          purpose: z.string(),
          target: z.string(),
          deadline: count,
          completion: z.enum(["arrival", "absorption"]),
          status: z.enum([
            "executing",
            "suspended",
            "completed",
            "abandoned",
            "expired",
          ]),
          plan: id,
          planRevision: z.number().int().positive(),
        })
        .strict(),
    ),
    plans: z.array(planSchema),
    intents: z.array(
      z
        .object({
          id,
          goal: id,
          plan: id,
          revision: z.number().int().positive(),
          step: id,
          delegation: id,
          action: id,
          args: z.record(jsonValue),
          submitted: count,
          before: jsonValue,
          status: z.enum([
            "submitted",
            "started",
            "completed",
            "failed",
            "rejected",
            "interrupted",
            "superseded",
            "withdrawn",
          ]),
          process: id.nullable(),
          event: id.nullable(),
          refs: z.array(refSchema),
          source: z.enum(["policy", "external-command"]),
        })
        .strict(),
    ),
    delegations: z.array(
      z
        .object({
          id,
          goal: id,
          revision: z.number().int().positive(),
          parent: id,
          child: id,
          intent: id,
          status: z.enum([
            "active",
            "completed",
            "failed",
            "withdrawn",
            "expired",
          ]),
        })
        .strict(),
    ),
    tracking: z.array(
      z
        .object({
          id,
          goal: id,
          revision: z.number().int().positive(),
          opened: count,
          expires: count,
          policyRevision: count,
          items: z.array(
            z
              .object({
                intent: id,
                ref: refSchema,
                status: z.enum([
                  "open",
                  "observed",
                  "estimated",
                  "ambiguous",
                  "unobserved",
                  "censored",
                  "late",
                ]),
                snapshot: z.enum(["live", "stored", "unavailable"]),
                actualInput: jsonValue.nullable(),
                observed: jsonValue.nullable(),
                diagnostic: jsonValue.nullable(),
              })
              .strict(),
          ),
          close: z
            .object({
              reason: z.enum([
                "observed-complete",
                "deadline",
                "self-interrupted",
                "world-rejected",
                "superseded",
                "capacity",
              ]),
              minute: count,
            })
            .strict()
            .nullable(),
          gain: z
            .object({
              status: z.enum(["open", "unresolved", "observed"]),
              reason: z.string(),
            })
            .strict(),
          absorption: z
            .object({
              status: z.enum(["open", "estimated", "ambiguous", "unobserved"]),
              meals: count,
              digesting: z.boolean(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    choices: z.array(
      z
        .object({
          id,
          minute: count,
          source: z.enum(["policy", "fallback", "external-command"]),
          chosen: z.string(),
          candidates: z.array(
            z
              .object({
                id: z.string(),
                score: z.number().finite().nullable(),
                violations: strings,
                unevaluated: strings,
              })
              .strict(),
          ),
          basis: z.literal("temporary-goal-v1"),
          policyRevision: count,
          modelRevisions: z.record(count),
          rngDraws: count,
          usage: z.record(count),
          exhausted: z.boolean(),
        })
        .strict(),
    ),
    feedback: z.array(
      z
        .object({
          kind: z.enum(["prediction", "control", "responsibility"]),
          model: id,
          eventId: id,
          payload: jsonValue,
          applied: z.boolean(),
          reason: z.string(),
        })
        .strict(),
    ),
    snapshots: z.array(
      z.object({ model: id, revision: count, value: jsonValue }).strict(),
    ),
    failures: z.array(
      z
        .object({
          minute: count,
          phase: z.string(),
          code: z.string(),
          detail: z.string(),
        })
        .strict(),
    ),
    rng: z
      .object({
        algorithm: z.literal("xorshift32"),
        state: z.number().int().positive().max(0xffffffff),
        draws: count,
      })
      .strict(),
    received: strings,
    pendingEvidence: z.array(evidenceSchema),
    pendingLearning: z.array(
      z.object({ model: id, event: id, input: jsonValue }).strict(),
    ),
  })
  .strict();
export function newHierarchyState(
  actor: string,
  seed: number,
  registry: ModelRegistry,
  compositionVersion: string,
): HierarchyState {
  let state = seed >>> 0;
  for (const char of actor)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return {
    version: 1,
    registryVersion: registry.version,
    compositionVersion,
    actor,
    models: Object.fromEntries(
      registry
        .definitions()
        .map((d) => [
          d.id,
          { revision: 0, value: structuredClone(d.initial), applied: [] },
        ]),
    ),
    goals: [],
    plans: [],
    intents: [],
    delegations: [],
    tracking: [],
    choices: [],
    feedback: [],
    snapshots: [],
    failures: [],
    rng: { algorithm: "xorshift32", state: state || 1, draws: 0 },
    nextId: 1,
    policyRevision: 0,
    received: [],
    pendingEvidence: [],
    pendingLearning: [],
  };
}
export function checkHierarchyState(
  state: HierarchyState,
  registry: ModelRegistry,
  compositionVersion: string,
) {
  json(state);
  hierarchySchema.parse(state);
  if (
    state.version !== 1 ||
    state.registryVersion !== registry.version ||
    state.compositionVersion !== compositionVersion
  )
    throw Error("model-mismatch: saved hierarchy version");
  if (
    !Number.isSafeInteger(state.nextId) ||
    state.nextId < 1 ||
    !state.actor ||
    state.rng.algorithm !== "xorshift32" ||
    !Number.isSafeInteger(state.rng.state) ||
    state.rng.state < 1 ||
    state.rng.state > 0xffffffff ||
    !Number.isSafeInteger(state.rng.draws) ||
    state.rng.draws < 0
  )
    throw Error("contract-violation: hierarchy identity");
  if (
    key(Object.keys(state.models).sort()) !==
    key(
      registry
        .definitions()
        .map((d) => d.id)
        .sort(),
    )
  )
    throw Error("model-mismatch: saved models");
  for (const [id, m] of Object.entries(state.models)) {
    registry.get(id).check(m.value);
    if (
      !Number.isSafeInteger(m.revision) ||
      m.revision < 0 ||
      new Set(m.applied).size !== m.applied.length
    )
      throw Error("contract-violation: revision");
  }
  for (const collection of [
    state.goals,
    state.intents,
    state.delegations,
    state.tracking,
    state.choices,
  ])
    if (new Set(collection.map((v) => v.id)).size !== collection.length)
      throw Error("contract-violation: duplicate identity");
  for (const goal of state.goals) {
    registry.get(goal.parent);
    if (
      !state.plans.some(
        (p) =>
          p.id === goal.plan &&
          p.revision === goal.planRevision &&
          p.goalId === goal.id,
      )
    )
      throw Error("contract-violation: goal plan");
  }
  for (const snapshot of state.snapshots)
    registry.get(snapshot.model).check(snapshot.value);
  for (const intent of state.intents) {
    if (
      !state.goals.some((g) => g.id === intent.goal) ||
      !state.plans.some(
        (p) => p.id === intent.plan && p.revision === intent.revision,
      ) ||
      !state.delegations.some((d) => d.id === intent.delegation)
    )
      throw Error("contract-violation: dangling intent");
  }
  for (const track of state.tracking)
    for (const item of track.items) {
      if (!state.intents.some((i) => i.id === item.intent))
        throw Error("contract-violation: dangling tracking");
      registry.get(item.ref.model);
      if (item.ref.revision > state.models[item.ref.model].revision)
        throw Error("stale-state-revision");
      if (
        item.status === "open" &&
        item.snapshot === "stored" &&
        !state.snapshots.some(
          (s) => s.model === item.ref.model && s.revision === item.ref.revision,
        )
      )
        throw Error("contract-violation: missing snapshot");
    }
}
export class ModelStateStore {
  constructor(
    private state: HierarchyState,
    private registry: ModelRegistry,
    private budget: Budget,
  ) {}
  read(id: string) {
    return frozen(this.state.models[id]);
  }
  saved(ref: Ref): Json | null {
    const current = this.state.models[ref.model];
    return structuredClone(
      current.revision === ref.revision
        ? current.value
        : (this.state.snapshots.find(
            (s) => s.model === ref.model && s.revision === ref.revision,
          )?.value ?? null),
    );
  }
  apply(id: string, event: string, next: Json) {
    const current = this.state.models[id];
    if (current.applied.includes(event)) return false;
    if (!this.registry.get(id).definition.learner)
      throw Error("contract-violation: fixed model update");
    this.registry.get(id).check(next);
    const refs = this.state.tracking
      .flatMap((t) => t.items)
      .filter(
        (i) =>
          i.status === "open" &&
          i.ref.model === id &&
          i.ref.revision === current.revision,
      );
    if (
      refs.length &&
      !this.state.snapshots.some(
        (s) => s.model === id && s.revision === current.revision,
      )
    ) {
      this.state.snapshots.push({
        model: id,
        revision: current.revision,
        value: structuredClone(current.value),
      });
      refs.forEach((i) => (i.snapshot = "stored"));
    }
    current.value = structuredClone(next);
    current.revision++;
    current.applied.push(event);
    this.trim();
    return true;
  }
  trim() {
    const open = this.state.tracking
      .flatMap((t) => t.items)
      .filter((i) => i.status === "open");
    this.state.snapshots = this.state.snapshots.filter((s) =>
      open.some(
        (i) => i.ref.model === s.model && i.ref.revision === s.revision,
      ),
    );
    while (this.state.snapshots.length > this.budget.retainedSnapshots) {
      const old = this.state.snapshots.shift()!;
      open
        .filter(
          (i) => i.ref.model === old.model && i.ref.revision === old.revision,
        )
        .forEach((i) => (i.snapshot = "unavailable"));
    }
  }
}
/** Owns transitions, not world processes or learning parameters. */
export class ExecutionState {
  constructor(readonly state: HierarchyState) {}
  id(kind: string) {
    return `${this.state.actor}:${kind}:${this.state.nextId++}`;
  }
  adopt(offer: Offer, minute: number): Goal {
    const goal: Goal = {
      id: this.id("goal"),
      revision: 1,
      parent: offer.parent,
      purpose: offer.purpose,
      target: offer.target,
      deadline: offer.deadline,
      completion: offer.completion,
      status: "executing",
      plan: this.id("plan"),
      planRevision: 1,
    };
    this.state.goals.push(goal);
    this.state.plans.push({
      ...structuredClone(offer.plan),
      id: goal.plan,
      goalId: goal.id,
      revision: 1,
    });
    this.track(goal, minute);
    return goal;
  }
  track(goal: Goal, minute: number) {
    const t: Tracking = {
      id: this.id("tracking"),
      goal: goal.id,
      revision: goal.planRevision,
      opened: minute,
      expires: goal.deadline,
      policyRevision: this.state.policyRevision,
      items: [],
      close: null,
      gain: { status: "open", reason: "" },
      absorption: null,
    };
    this.state.tracking.push(t);
    return t;
  }
  revise(
    goal: Goal,
    plan: Plan,
    minute: number,
    reason: "interruption" | "quantity-change" | "resume",
    evidence: string[] = [],
  ) {
    for (const t of this.state.tracking.filter(
      (t) => t.goal === goal.id && t.revision === goal.planRevision,
    )) {
      t.gain = { status: "unresolved", reason: "superseded-by-revision" };
      if (reason === "quantity-change")
        for (const item of t.items)
          if (
            this.state.intents.find((i) => i.id === item.intent)?.status ===
            "submitted"
          )
            item.status = "censored";
    }
    for (const i of this.state.intents.filter(
      (i) => i.goal === goal.id && i.status === "submitted",
    )) {
      i.status = "withdrawn";
      this.delegation(i, "withdrawn");
    }
    goal.planRevision++;
    goal.status = "executing";
    this.state.plans.push({
      ...structuredClone(plan),
      id: goal.plan,
      goalId: goal.id,
      revision: goal.planRevision,
      revisionCause: { kind: reason, minute, evidence: [...evidence] },
    });
    this.track(goal, minute);
  }
  suspend(goal: Goal, reason = "parent-switch") {
    goal.status = "suspended";
    this.state.tracking
      .filter((t) => t.goal === goal.id && !t.close)
      .forEach((t) => (t.gain = { status: "unresolved", reason }));
  }
  switchParent(goal: Goal, offer: Offer, minute: number) {
    this.suspend(goal);
    goal.status = "abandoned";
    return this.adopt(offer, minute);
  }
  submit(
    goal: Goal,
    step: string,
    child: string,
    attempt: { kind: string; args: { [key: string]: Json } },
    before: Json,
    refs: Ref[],
    minute: number,
  ) {
    const intent: Intent = {
      id: this.id("intent"),
      goal: goal.id,
      plan: goal.plan,
      revision: goal.planRevision,
      step,
      delegation: this.id("delegation"),
      action: attempt.kind,
      args: structuredClone(attempt.args),
      before: structuredClone(before),
      submitted: minute,
      status: "submitted",
      process: null,
      event: null,
      refs: structuredClone(refs),
      source: "policy",
    };
    this.state.intents.push(intent);
    this.state.delegations.push({
      id: intent.delegation,
      goal: goal.id,
      revision: goal.planRevision,
      parent: goal.parent,
      child,
      intent: intent.id,
      status: "active",
    });
    const track = this.state.tracking.find(
      (t) => t.goal === goal.id && t.revision === goal.planRevision,
    )!;
    for (const ref of refs)
      track.items.push({
        intent: intent.id,
        ref: structuredClone(ref),
        status: "open",
        snapshot: "live",
        actualInput: null,
        observed: null,
        diagnostic: null,
      });
    return intent;
  }
  delegation(intent: Intent, status: "completed" | "failed" | "withdrawn") {
    const d = this.state.delegations.find((d) => d.id === intent.delegation);
    if (d) d.status = status;
  }
  receive(intent: Intent, e: Evidence) {
    if (e.phase === "started") {
      if (intent.status === "submitted") {
        intent.status = "started";
        intent.process = e.processId;
        intent.event = e.eventId;
      }
      return;
    }
    if (!["submitted", "started", "withdrawn"].includes(intent.status)) return;
    intent.status = e.phase;
    this.delegation(
      intent,
      e.phase === "completed"
        ? "completed"
        : e.phase === "superseded"
          ? "withdrawn"
          : "failed",
    );
    if (e.phase === "superseded") {
      intent.source = "external-command";
      this.state.choices
        .filter((c) => c.chosen === intent.id)
        .forEach((c) => (c.source = "external-command"));
    }
  }
}
