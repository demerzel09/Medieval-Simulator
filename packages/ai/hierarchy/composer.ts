import {
  BudgetExceeded,
  point,
  unknown,
  type Calls,
  type Estimate,
  type Forecast,
  type Json,
  type Plan,
  type Projected,
  type Segment,
  type Step,
} from "./contracts";
export type StepProposal = {
  attempt: { kind: string; args: { [key: string]: Json } } | null;
  duration: Estimate<number>;
  site: string | null;
  interrupts: boolean;
};
export type CompositionInput = { plan: Plan; start: Projected; context: Json };
export function sum(
  a: Estimate<number>,
  b: Estimate<number>,
): Estimate<number> {
  if (a.kind === "unknown" || b.kind === "unknown")
    return unknown(
      a.kind === "unknown"
        ? a.reason
        : b.kind === "unknown"
          ? b.reason
          : "missing-input",
    );
  if (a.kind === "branches" || b.kind === "branches")
    return unknown("branch-time");
  const low =
    (a.kind === "point" ? a.value : a.low) +
    (b.kind === "point" ? b.value : b.low);
  const high =
    (a.kind === "point" ? a.value : a.high) +
    (b.kind === "point" ? b.value : b.high);
  return low === high
    ? point(low)
    : {
        kind: "interval",
        low,
        high,
        support: { basis: "extrapolation", samples: 0, conditionKey: "sum" },
      };
}
/** Walks bounded hypothetical paths. Never advances the real world or modifies an input. */
export function compose(
  input: Readonly<CompositionInput>,
  calls: Calls,
  bodyModel: string,
  branchLimit: number,
  bodyContext: Json,
): Forecast {
  const { plan } = input;
  const result: Forecast = { segments: [], violations: [], unevaluated: [] };
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  const violate = (code: string) => {
    if (!result.violations.includes(code)) result.violations.push(code);
  };
  if (
    nodes.size !== plan.nodes.length ||
    !nodes.has(plan.entry) ||
    plan.edges.some((e) => !nodes.has(e.from) || !nodes.has(e.to))
  ) {
    violate("invalid-plan");
    return result;
  }
  if (
    plan.loops.some(
      (l) =>
        !Number.isSafeInteger(l.maxIterations) ||
        l.maxIterations < 1 ||
        l.steps.some((s) => !nodes.has(s)),
    )
  ) {
    violate("cycle-without-loop");
    return result;
  }
  let paths = 1;
  const walk = (
    id: string,
    state: Projected,
    path: string[],
    consumed: Set<string>,
    visits: Record<string, number>,
    stack: string[],
  ) => {
    const node = nodes.get(id)!;
    const count = (visits[id] ?? 0) + 1;
    if (count > 1) {
      const cycle = stack.slice(stack.lastIndexOf(id));
      const loop = plan.loops.find(
        (l) =>
          l.steps.length === cycle.length &&
          cycle.every(
            (s, n) => l.steps[(l.steps.indexOf(id) + n) % l.steps.length] === s,
          ),
      );
      if (!loop) {
        violate("cycle-without-loop");
        return;
      }
      if (count > Math.min(loop.maxIterations, calls.limit("iterations"))) {
        result.unevaluated.push({
          step: id,
          reason: count > calls.limit("iterations") ? "budget" : "loop-limit",
        });
        return;
      }
      calls.peak("iterations", count);
    }
    const before = structuredClone(state),
      after = structuredClone(state),
      used = new Set(consumed);
    const occupied = node.claims.filter(
      (c) => c.kind === "body" && c.mode === "hold",
    );
    if (occupied.length > 1 || (occupied.length && state.occupied))
      violate("body-conflict");
    for (const claim of node.claims) {
      if (!Number.isFinite(claim.quantity) || claim.quantity < 0) {
        violate("invalid-claim");
        continue;
      }
      const delta =
        claim.mode === "produce"
          ? claim.quantity
          : claim.mode === "consume"
            ? -claim.quantity
            : 0;
      if (claim.kind === "lot") {
        if (claim.mode === "consume" && used.has(claim.id))
          violate("duplicate-resource");
        if (claim.mode === "consume") used.add(claim.id);
        after.lots[claim.id] = (after.lots[claim.id] ?? 0) + delta;
        if (after.lots[claim.id] < 0) violate("insufficient-resource");
      }
      if (claim.kind === "cash") {
        after.cash += delta;
        if (after.cash < 0) violate("negative-cash");
      }
      if (claim.kind === "capacity" && claim.quantity > after.capacity)
        violate("capacity");
    }
    const startRef = calls.refs.length;
    let proposal: StepProposal = {
      attempt: node.attempt,
      duration: point(node.duration),
      site: null,
      interrupts: false,
    };
    try {
      if (node.kind === "delegate") {
        if (!node.model) {
          violate("missing-control");
          return;
        }
        proposal = calls.invoke(node.model, {
          context: input.context,
          request: node.request,
        });
      }
      after.minute = sum(before.minute, proposal.duration);
      if (proposal.site) after.site = proposal.site;
      // Only this path owns time and body projection. Children only return duration/effects.
      after.body = calls.invoke(bodyModel, {
        before: before.body,
        minutes: proposal.duration,
        activity: proposal.attempt?.kind ?? "wait",
        context: bodyContext,
      });
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error;
      result.unevaluated.push({ step: id, reason: "budget" });
      return;
    }
    const segment: Segment = {
      step: id,
      path: [...path],
      before,
      after,
      refs: structuredClone(calls.refs.slice(startRef)),
    };
    result.segments.push(segment);
    const edges = plan.edges
      .filter((e) => e.from === id)
      .sort((a, b) => a.on.localeCompare(b.on) || a.to.localeCompare(b.to));
    for (let n = 0; n < edges.length; n++) {
      const edge = edges[n];
      if (n > 0) paths++;
      if (paths > branchLimit) {
        result.unevaluated.push({ step: edge.to, reason: "budget" });
        continue;
      }
      calls.peak("branchesPerPlan", paths);
      if (edge.on === "unreached") {
        const missing = structuredClone(after);
        missing.minute = unknown("unreached-branch");
        for (const field of Object.keys(missing.body))
          missing.body[field] = unknown("unreached-branch");
        result.segments.push({
          step: edge.to,
          path: [...path, edge.on],
          before: structuredClone(missing),
          after: missing,
          refs: [],
        });
        continue;
      }
      walk(
        edge.to,
        after,
        [...path, edge.on],
        used,
        { ...visits, [id]: count },
        [...stack, id],
      );
    }
  };
  if (branchLimit < 1)
    result.unevaluated.push({ step: plan.entry, reason: "budget" });
  else {
    calls.peak("branchesPerPlan", 1);
    walk(plan.entry, structuredClone(input.start), [], new Set(), {}, []);
  }
  return result;
}
export const actionStep = (
  id: string,
  kind: string,
  duration: number,
): Step => ({
  id,
  kind: "attempt",
  model: null,
  request: null,
  attempt: { kind, args: {} },
  duration,
  claims: [{ kind: "body", id: "self", mode: "hold", quantity: 1 }],
});
