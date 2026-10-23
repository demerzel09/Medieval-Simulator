/** v25 connection prototype. Values cross persistence boundaries; services do not. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export function json(value: unknown): asserts value is Json {
  const seen = new Set<object>();
  function visit(v: unknown): void {
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v !== "object" || v === null || seen.has(v))
      throw Error("contract-violation: non-JSON state");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
      throw Error("contract-violation: non-plain state");
    seen.add(v);
    for (const item of Object.values(v)) visit(item);
    seen.delete(v);
  }
  visit(value);
}
export function frozen<T>(value: T): Readonly<T> {
  const copy = structuredClone(value);
  function freeze(v: unknown) {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  }
  freeze(copy);
  return copy;
}
export function key(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(key).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${key(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export type Support = {
  basis: "prior" | "experience" | "extrapolation";
  samples: number;
  conditionKey: string;
};
export type Estimate<T> =
  | { kind: "point"; value: T; support: Support }
  | { kind: "interval"; low: T; high: T; support: Support }
  | {
      kind: "branches";
      branches: { id: string; probability: Estimate<number>; value: T }[];
    }
  | { kind: "unknown"; reason: string };
export const point = <T>(
  value: T,
  conditionKey = "prototype-prior",
  samples = 0,
): Estimate<T> => ({
  kind: "point",
  value,
  support: { basis: samples ? "experience" : "prior", samples, conditionKey },
});
export const unknown = <T>(reason: string): Estimate<T> => ({
  kind: "unknown",
  reason,
});
export type Ref = {
  model: string;
  revision: number;
  input: Json;
  output: Json;
};
export type Role =
  | "forward"
  | "control"
  | "composer"
  | "evaluator"
  | "selector"
  | "analyzer"
  | "learner"
  | "fallback";
export type Port = {
  name: string;
  quantity: string;
  unit: string;
  timing: "observed" | "predicted";
  body?: true;
};
export type Definition = {
  id: string;
  role: Role;
  projection: string;
  /** Nested invocation capabilities; omitted means no model calls. */
  calls?: { target: string; role: Role; contract: string }[];
  inputs: Port[];
  outputs: Port[];
  initial: Json;
  contract: string;
  learner: string | null;
  cost: number;
};
export type Edge = {
  from: string;
  output: string;
  to: string;
  input: string;
  phase: number;
  nextPhase?: number;
};
export type Composition = {
  version: string;
  registryVersion: string;
  root: string[];
  composer: string;
  evaluator: string;
  evaluationBasis?: "temporary-goal-v1" | "temporary-recovery-v2";
  selector: string;
  analyzer: string;
  fallback: string;
  aliases: Record<string, { model: string; contract: string }>;
  edges: Edge[];
};
export type Codec<T> = { parse(value: unknown): T };
export type Calls = {
  invoke<I, O>(id: string, input: I): O;
  readonly refs: readonly Ref[];
  take(kind: Work, amount?: number): void;
  limit(kind: Work): number;
  peak(kind: Work, value: number): void;
};
export interface ForwardModel<I, O, S> {
  predict(input: Readonly<I>, state: Readonly<S>, calls: Calls): O;
}
export interface ControlModel<I, O, S> {
  propose(input: Readonly<I>, state: Readonly<S>, calls: Calls): O;
}
export interface Learner<I, S> {
  update(input: Readonly<I>, state: Readonly<S>): S;
}
export type Work =
  | "proposals"
  | "forecasts"
  | "branchesPerPlan"
  | "compositionDepth"
  | "iterations"
  | "analyses"
  | "learningUpdates";
export type Budget = Record<Work, number> & {
  openGoals: number;
  openTracking: number;
  retainedTracking: number;
  retainedChoices: number;
  retainedSnapshots: number;
  retainedFailures: number;
};
export const defaultBudget: Budget = {
  proposals: 32,
  forecasts: 96,
  branchesPerPlan: 8,
  compositionDepth: 4,
  iterations: 2,
  analyses: 16,
  learningUpdates: 32,
  openGoals: 1,
  openTracking: 6,
  retainedTracking: 24,
  retainedChoices: 48,
  retainedSnapshots: 8,
  retainedFailures: 8,
};
export class BudgetExceeded extends Error {
  constructor(readonly work: Work) {
    super(`budget-exhausted:${work}`);
  }
}
export class Meter {
  readonly usage: Record<Work, number> = {
    proposals: 0,
    forecasts: 0,
    branchesPerPlan: 0,
    compositionDepth: 0,
    iterations: 0,
    analyses: 0,
    learningUpdates: 0,
  };
  constructor(readonly limit: Budget) {
    for (const n of Object.values(limit))
      if (!Number.isSafeInteger(n) || n < 0)
        throw Error("contract-violation: budget");
    if (
      limit.openGoals < 1 ||
      limit.openTracking < limit.openGoals ||
      limit.retainedChoices < 1
    )
      throw Error("contract-violation: retention");
  }
  take(kind: Work, amount = 1) {
    if (this.usage[kind] + amount > this.limit[kind])
      throw new BudgetExceeded(kind);
    this.usage[kind] += amount;
  }
  peak(kind: Work, n: number) {
    if (n > this.limit[kind]) throw new BudgetExceeded(kind);
    this.usage[kind] = Math.max(this.usage[kind], n);
  }
  depth(n: number) {
    if (n > this.limit.compositionDepth)
      throw new BudgetExceeded("compositionDepth");
    this.usage.compositionDepth = Math.max(this.usage.compositionDepth, n);
  }
}
export type Claim = {
  kind: "lot" | "cash" | "body" | "capacity";
  id: string;
  mode: "consume" | "hold" | "produce";
  quantity: number;
};
export type Step = {
  id: string;
  kind: "delegate" | "attempt" | "observe";
  model: string | null;
  request: Json;
  attempt: { kind: string; args: { [key: string]: Json } } | null;
  duration: number;
  claims: Claim[];
};
export type Plan = {
  id: string;
  goalId: string;
  revision: number;
  revisionCause?: { kind: string; minute: number; evidence: string[] };
  entry: string;
  nodes: Step[];
  edges: { from: string; to: string; on: string }[];
  loops: { steps: string[]; maxIterations: number }[];
};
export type Offer = {
  id: string;
  parent: string;
  purpose: string;
  target: string;
  deadline: number;
  plan: Plan;
  basis: "temporary-goal-v1" | "temporary-recovery-v2";
  priority: number;
  completion: "arrival" | "absorption";
};
export type Projected = {
  minute: Estimate<number>;
  site: string;
  cash: number;
  lots: Record<string, number>;
  capacity: number;
  occupied: string | null;
  body: Record<string, Estimate<number | boolean>>;
};
export type Segment = {
  step: string;
  path: string[];
  before: Projected;
  after: Projected;
  refs: Ref[];
};
export type Forecast = {
  segments: Segment[];
  violations: string[];
  unevaluated: { step: string; reason: string }[];
};
export type Evidence = {
  id: string;
  intentId: string;
  eventId: string;
  processId: string | null;
  action: string;
  occurred: number;
  received: number;
  started: number;
  elapsed: number;
  phase:
    | "started"
    | "completed"
    | "failed"
    | "rejected"
    | "interrupted"
    | "superseded";
  before: Json;
  after: Json;
};
export type CloseReason =
  | "observed-complete"
  | "deadline"
  | "self-interrupted"
  | "world-rejected"
  | "superseded"
  | "capacity";
export type Feedback = {
  kind: "prediction" | "control" | "responsibility";
  model: string;
  eventId: string;
  payload: Json;
  applied: boolean;
  reason: string;
};
