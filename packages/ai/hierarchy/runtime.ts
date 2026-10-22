import {
  BudgetExceeded,
  defaultBudget,
  json,
  point,
  type Budget,
  type Composition,
  type Evidence,
  type Forecast,
  type Json,
  type Offer,
  type Projected,
  type Step,
} from "./contracts";
import type { StepProposal } from "./composer";
import { ModelRegistry } from "./registry";
import { DecisionSession } from "./session";
import {
  checkHierarchyState,
  ExecutionState,
  type Choice,
  type Goal,
  type HierarchyState,
} from "./state";
import { TrackingLedger } from "./tracking";

export type RuntimeInput = {
  actor: string;
  minute: number;
  context: Json;
  observation: Json;
  projected: Projected;
  evidence: Evidence[];
  digesting: boolean;
};
export type RuntimeResult = {
  state: HierarchyState;
  attempt: {
    kind: string;
    args: { [key: string]: Json };
    intentId: string;
  } | null;
  wakeMinute: number;
};
export class HierarchyRuntime {
  readonly composition: Composition;
  constructor(
    readonly registry: ModelRegistry,
    composition: Composition,
    private validateAttempt: (
      attempt: NonNullable<RuntimeResult["attempt"]>,
    ) => void = () => {},
  ) {
    this.composition = registry.compile(composition);
  }
  decide(
    input: RuntimeInput,
    previous: HierarchyState,
    budget: Budget = defaultBudget,
  ): RuntimeResult {
    if (input.actor !== previous.actor || !Number.isSafeInteger(input.minute))
      throw Error("contract-violation: actor/time");
    checkHierarchyState(previous, this.registry, this.composition.version);
    const committed = structuredClone(previous),
      feedbackSession = new DecisionSession(
        this.registry,
        committed,
        budget,
        this.composition,
      );
    const ledger = new TrackingLedger(
      committed,
      this.registry,
      budget,
      this.composition.analyzer,
    );
    ledger.receive(input.evidence, input.minute, feedbackSession);
    ledger.digestion(input.digesting, input.minute);
    const working = structuredClone(committed),
      execution = new ExecutionState(working),
      session = new DecisionSession(
        this.registry,
        working,
        budget,
        this.composition,
      );
    Object.assign(session.meter.usage, feedbackSession.usage());
    let phase = "plan";
    const candidates: Choice["candidates"] = [];
    try {
      session.take("iterations");
      let goal = working.goals.find((g) => g.status === "executing");
      if (goal && input.minute >= goal.deadline) {
        goal.status = "expired";
        goal = undefined;
      }
      let step: Step | null = null;
      if (goal) {
        step = this.nextStep(working, goal);
        if (!step || step.kind === "observe") {
          const track = working.tracking.find(
            (t) => t.goal === goal!.id && t.revision === goal!.planRevision,
          );
          if (
            goal.completion === "absorption" &&
            track?.absorption?.status !== "estimated"
          )
            return this.finish(
              input,
              working,
              budget,
              session,
              candidates,
              null,
              "await-observation",
            );
          const last = working.intents
            .filter(
              (i) => i.goal === goal!.id && i.revision === goal!.planRevision,
            )
            .at(-1);
          goal.status =
            last && last.status !== "completed" ? "abandoned" : "completed";
          if (
            track &&
            goal.status === "completed" &&
            !track.absorption &&
            !track.items.some((i) => i.status === "open")
          )
            new TrackingLedger(
              working,
              this.registry,
              budget,
              this.composition.analyzer,
            ).close(track, "observed-complete", input.minute);
          if (track && goal.status === "abandoned")
            track.gain = {
              status: "unresolved",
              reason: last?.status ?? "missing-observation",
            };
          goal = undefined;
        }
      }
      if (!goal) {
        const offers: Offer[] = [];
        for (const parent of [...this.composition.root].sort()) {
          try {
            const proposed = session.invoke<unknown, Offer[]>(parent, {
              context: input.context,
              minute: input.minute,
            });
            if (proposed.some((p) => p.parent !== parent))
              throw Error("contract-violation: proposal owner");
            session.take("proposals", Math.max(0, proposed.length - 1));
            offers.push(...proposed);
          } catch (error) {
            if (!(error instanceof BudgetExceeded)) throw error;
            candidates.push({
              id: parent,
              score: null,
              violations: [],
              unevaluated: ["budget"],
            });
          }
        }
        const scored: { offer: Offer; forecast: Forecast; score: number }[] =
          [];
        for (const offer of offers.sort((a, b) => a.id.localeCompare(b.id))) {
          const forecast = session.invoke<unknown, Forecast>(
            this.composition.composer,
            {
              plan: offer.plan,
              start: input.projected,
              context: input.context,
            },
          );
          const score =
            forecast.violations.length || forecast.unevaluated.length
              ? null
              : session.invoke<unknown, number | null>(
                  this.composition.evaluator,
                  { offer, forecast },
                );
          candidates.push({
            id: offer.id,
            score,
            violations: forecast.violations,
            unevaluated: forecast.unevaluated.map((u) => u.reason),
          });
          if (score !== null) scored.push({ offer, forecast, score });
        }
        phase = "select";
        if (!scored.length)
          return this.fallback(
            input,
            committed,
            budget,
            session,
            candidates,
            candidates.some((c) => c.unevaluated.includes("budget"))
              ? "budget-exhausted"
              : "insufficient-observation",
            "no evaluated candidate",
          );
        const selectedId = session.invoke<unknown, string>(
          this.composition.selector,
          {
            candidates: scored.map(({ offer, score }) => ({
              id: offer.id,
              score,
            })),
          },
        );
        const selected = scored.find(
          (candidate) => candidate.offer.id === selectedId,
        );
        if (!selected)
          throw Error(
            "contract-violation: selection outside evaluated candidates",
          );
        const suspended = working.goals.find(
          (g) =>
            g.status === "suspended" &&
            g.parent === selected.offer.parent &&
            g.target === selected.offer.target,
        );
        if (suspended) {
          execution.revise(
            suspended,
            selected.offer.plan,
            input.minute,
            "resume",
          );
          goal = suspended;
        } else {
          const other = working.goals.find((g) => g.status === "suspended");
          goal = other
            ? execution.switchParent(other, selected.offer, input.minute)
            : execution.adopt(selected.offer, input.minute);
        }
        step = this.nextStep(working, goal);
      }
      phase = "respond";
      if (!step || step.kind === "observe")
        return this.fallback(
          input,
          committed,
          budget,
          session,
          candidates,
          "insufficient-observation",
          "observation boundary",
        );
      const active = working.intents.find(
        (i) =>
          i.goal === goal!.id &&
          i.revision === goal!.planRevision &&
          i.step === step!.id &&
          ["submitted", "started"].includes(i.status),
      );
      const proposal: StepProposal =
        step.kind === "delegate"
          ? session.invoke(step.model!, {
              context: input.context,
              request: step.request,
            })
          : {
              attempt: step.attempt,
              duration: point(step.duration),
              site: null,
              interrupts: false,
            };
      if (active && !proposal.interrupts)
        return this.finish(
          input,
          working,
          budget,
          session,
          candidates,
          null,
          "continue",
        );
      if (!proposal.attempt)
        return this.finish(
          input,
          working,
          budget,
          session,
          candidates,
          null,
          "observe",
        );
      const start = session.refs.length;
      const single = {
        id: "executed-step",
        goalId: goal!.id,
        revision: goal!.planRevision,
        entry: step.id,
        nodes: [step],
        edges: [],
        loops: [],
      };
      session.invoke(this.composition.composer, {
        plan: single,
        start: input.projected,
        context: input.context,
      });
      const refs = session.refs.slice(start);
      const intent = execution.submit(
        goal!,
        step.id,
        step.model
          ? (this.composition.aliases[step.model]?.model ?? step.model)
          : goal!.parent,
        proposal.attempt,
        input.observation,
        refs,
        input.minute,
      );
      return this.finish(
        input,
        working,
        budget,
        session,
        candidates,
        { ...proposal.attempt, intentId: intent.id },
        intent.id,
      );
    } catch (error) {
      return this.fallback(
        input,
        committed,
        budget,
        session,
        candidates,
        error instanceof BudgetExceeded
          ? "budget-exhausted"
          : String(error).includes("model-mismatch")
            ? "model-mismatch"
            : String(error).includes("contract-violation")
              ? "contract-violation"
              : "exception",
        `${phase}:${String(error)}`,
      );
    }
  }
  private nextStep(state: HierarchyState, goal: Goal): Step | null {
    const plan = state.plans.find(
      (p) => p.id === goal.plan && p.revision === goal.planRevision,
    )!;
    let id = plan.entry,
      offset = 0;
    const intents = state.intents.filter(
      (i) => i.goal === goal.id && i.revision === goal.planRevision,
    );
    for (let guard = 0; guard <= intents.length; guard++) {
      const node = plan.nodes.find((n) => n.id === id);
      if (!node) return null;
      const index = intents.findIndex(
        (i, n) =>
          n >= offset &&
          i.step === id &&
          ["completed", "failed", "rejected", "interrupted"].includes(i.status),
      );
      if (index < 0) return node;
      const edge = plan.edges.find(
        (e) => e.from === id && e.on === intents[index].status,
      );
      if (!edge) return null;
      offset = index + 1;
      id = edge.to;
    }
    throw Error("contract-violation: execution loop");
  }
  private finish(
    input: RuntimeInput,
    state: HierarchyState,
    budget: Budget,
    session: DecisionSession,
    candidates: Choice["candidates"],
    attempt: RuntimeResult["attempt"],
    chosen: string,
  ): RuntimeResult {
    if (attempt) this.validateAttempt(attempt);
    const e = new ExecutionState(state);
    state.choices.push({
      id: e.id("choice"),
      minute: input.minute,
      source: "policy",
      chosen,
      candidates,
      basis: "temporary-goal-v1",
      policyRevision: state.policyRevision,
      modelRevisions: Object.fromEntries(
        Object.entries(state.models).map(([id, m]) => [id, m.revision]),
      ),
      rngDraws: 0,
      usage: session.usage(),
      exhausted: candidates.some((c) => c.unevaluated.includes("budget")),
    });
    new TrackingLedger(
      state,
      this.registry,
      budget,
      this.composition.analyzer,
    ).limit(input.minute);
    checkHierarchyState(state, this.registry, this.composition.version);
    return { state, attempt, wakeMinute: input.minute + 60 };
  }
  private fallback(
    input: RuntimeInput,
    state: HierarchyState,
    budget: Budget,
    session: DecisionSession,
    candidates: Choice["candidates"],
    code: string,
    detail: string,
  ): RuntimeResult {
    state.failures.push({
      minute: input.minute,
      phase: detail.includes(":") ? detail.split(":")[0] : "plan",
      code,
      detail,
    });
    const noForecast = {
      refs: [],
      peak: () => {},
      limit: () => 0,
      take: () => {
        throw Error("contract-violation: fallback forecast");
      },
      invoke: () => {
        throw Error("contract-violation: fallback dependency");
      },
    };
    const attempt = this.registry
      .get(this.composition.fallback)
      .invoke(
        { context: input.context },
        state.models[this.composition.fallback].value,
        noForecast,
      ) as StepProposal["attempt"];
    const result = this.finish(
      input,
      state,
      budget,
      session,
      candidates,
      attempt ? { ...attempt, intentId: "" } : null,
      "fallback",
    );
    state.choices[state.choices.length - 1].source = "fallback";
    state.choices[state.choices.length - 1].exhausted =
      code === "budget-exhausted" ||
      candidates.some((c) => c.unevaluated.includes("budget"));
    return result;
  }
}
