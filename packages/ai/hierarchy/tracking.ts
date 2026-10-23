import {
  BudgetExceeded,
  key,
  type Budget,
  type Evidence,
  type Json,
  type Ref,
} from "./contracts";
import type { Diagnosis, ModelRegistry } from "./registry";
import { DecisionHistory } from "./history";
import { DecisionSession } from "./session";
import {
  ExecutionState,
  ModelStateStore,
  type HierarchyState,
  type Intent,
  type Goal,
  type Tracking,
} from "./state";

/** Evidence matching is independent of particular model IDs and goal names. */
export class TrackingLedger {
  private execution: ExecutionState;
  private store: ModelStateStore;
  constructor(
    private state: HierarchyState,
    private registry: ModelRegistry,
    private budget: Budget,
    private analyzer: string,
  ) {
    this.execution = new ExecutionState(state);
    this.store = new ModelStateStore(state, registry, budget);
  }
  close(
    track: Tracking,
    reason: NonNullable<Tracking["close"]>["reason"],
    minute: number,
  ) {
    if (track.close) return;
    track.close = { reason, minute };
    for (const item of track.items)
      if (item.status === "open")
        item.status = reason === "capacity" ? "censored" : "unobserved";
    if (track.absorption?.status === "open" && reason !== "observed-complete")
      track.absorption.status = "unobserved";
    if (track.gain.status === "open")
      track.gain = {
        status: "unresolved",
        reason:
          reason === "observed-complete"
            ? "goal-complete-value-unmeasured"
            : reason,
      };
  }
  settlePlan(goal: Readonly<Goal>, minute: number) {
    const track = this.state.tracking.find(
      (t) => t.goal === goal.id && t.revision === goal.planRevision,
    );
    const outcome = this.execution.finishPlan(
      goal,
      track?.absorption?.status === "estimated",
    );
    if (
      track &&
      outcome.status === "completed" &&
      !track.absorption &&
      !track.items.some((i) => i.status === "open")
    )
      this.close(track, "observed-complete", minute);
    if (track && outcome.status === "abandoned")
      track.gain = { status: "unresolved", reason: outcome.reason };
    return outcome;
  }
  private matches(intent: Intent, e: Evidence, minute: number) {
    if (
      e.occurred > minute ||
      e.received > minute ||
      e.received < e.occurred ||
      e.started !== intent.submitted ||
      e.action !== intent.action ||
      e.elapsed !== e.occurred - e.started ||
      key(e.before) !== key(intent.before)
    )
      return false;
    if (e.phase === "superseded") return intent.status === "submitted";
    if (e.phase === "started")
      return (
        e.processId !== null &&
        (intent.event === null ||
          (intent.event === e.eventId && intent.process === e.processId))
      );
    return intent.process
      ? intent.process === e.processId && intent.event === e.eventId
      : e.processId === null;
  }
  receive(evidence: Evidence[], minute: number, session: DecisionSession) {
    // Evidence before deadlines, deterministic delivery order. A's exceptions propagate.
    const deliveries = [
      ...new Map(
        [...this.state.pendingEvidence, ...evidence].map((e) => [e.id, e]),
      ).values(),
    ];
    this.state.pendingEvidence = [];
    for (const e of deliveries.sort(
      (a, b) => a.received - b.received || a.id.localeCompare(b.id),
    )) {
      if (this.state.received.includes(e.id)) continue;
      const intent = this.state.intents.find((i) => i.id === e.intentId);
      if (!intent || !this.matches(intent, e, minute)) {
        new DecisionHistory(this.state).fail({
          minute,
          phase: "feedback",
          code: "insufficient-observation",
          detail: `unmatched:${e.id}`,
        });
        continue;
      }
      this.state.received.push(e.id);
      const tracks = this.state.tracking.filter(
        (t) =>
          t.items.some((i) => i.intent === intent.id) ||
          (t.goal === intent.goal && t.revision === intent.revision),
      );
      this.execution.receive(intent, e);
      if (e.phase === "started") continue;
      const localAllowed = ["completed", "failed", "interrupted"].includes(
        e.phase,
      );
      for (const track of tracks) {
        const items = track.items.filter((i) => i.intent === intent.id);
        if (
          track.close &&
          ["deadline", "capacity", "superseded"].includes(track.close.reason)
        ) {
          for (const item of items) item.status = "late";
          continue;
        }
        for (const item of items) {
          if (item.status !== "open") continue;
          if (!localAllowed) {
            item.status = "censored";
            continue;
          }
          const saved =
            item.snapshot === "unavailable" ? null : this.store.saved(item.ref);
          if (saved === null) {
            item.status = "unobserved";
            item.diagnostic = { reason: "snapshot-unavailable" };
            continue;
          }
          try {
            const diagnosis = session.invoke<unknown, Diagnosis>(
              this.analyzer,
              { ref: item.ref, evidence: e, saved },
            );
            item.actualInput = diagnosis.actualInput;
            item.observed = diagnosis.observed;
            item.diagnostic = diagnosis.diagnostic;
            item.status = "observed";
            this.state.feedback.push({
              kind: "prediction",
              model: item.ref.model,
              eventId: e.eventId,
              payload: diagnosis.diagnostic,
              applied: false,
              reason: "diagnosed",
            });
            if (diagnosis.update !== null)
              this.queue(item.ref.model, e.eventId, diagnosis.update);
          } catch (error) {
            if (!(error instanceof BudgetExceeded)) throw error;
            // Keep the evidence for later analysis instead of inventing a failure teacher.
            item.diagnostic = { reason: "budget" };
            this.state.received = this.state.received.filter(
              (id) => id !== e.id,
            );
            if (!this.state.pendingEvidence.some((p) => p.id === e.id))
              this.state.pendingEvidence.push(structuredClone(e));
          }
        }
        const goal = this.state.goals.find((g) => g.id === intent.goal)!;
        const stale =
          goal.planRevision !== intent.revision ||
          goal.status === "suspended" ||
          goal.status === "abandoned";
        const stalePolicy = track.policyRevision !== this.state.policyRevision;
        const reason =
          e.phase === "superseded"
            ? "external-command"
            : stale
              ? "superseded-by-revision"
              : stalePolicy
                ? "stale-policy"
                : e.phase;
        const child =
          this.state.delegations.find((d) => d.id === intent.delegation)
            ?.child ?? goal.parent;
        for (const target of new Set([child, goal.parent]))
          if (
            !this.state.feedback.some(
              (f) =>
                f.kind === "control" &&
                f.model === target &&
                f.eventId === e.eventId,
            )
          )
            this.state.feedback.push({
              kind: "control",
              model: target,
              eventId: e.eventId,
              payload: {
                goal: goal.id,
                revision: intent.revision,
                achieved: e.phase === "completed",
                phase: e.phase,
              },
              applied: false,
              reason,
            });
        if (
          !this.state.feedback.some(
            (f) =>
              f.kind === "responsibility" &&
              f.model === goal.parent &&
              f.eventId === e.eventId,
          )
        )
          this.state.feedback.push({
            kind: "responsibility",
            model: goal.parent,
            eventId: e.eventId,
            payload: { kind: "unknown", reason: "R02-not-adopted" },
            applied: false,
            reason: "unestimated",
          });
        // No policy learner is adopted in this connection prototype.
        if (stale || stalePolicy || e.phase === "superseded")
          track.gain = { status: "unresolved", reason };
        if (e.phase === "rejected") this.close(track, "world-rejected", minute);
        if (e.phase === "superseded") this.close(track, "superseded", minute);
        if (e.phase === "interrupted") {
          this.execution.suspend(goal, "self-interrupted");
          track.gain = { status: "unresolved", reason: "self-interrupted" };
        }
        if (e.action === "eat" && e.phase === "completed") this.meal(track);
      }
    }
    this.learn(session);
    for (const t of this.state.tracking)
      if (
        !t.close &&
        !t.absorption &&
        t.items.length &&
        !t.items.some((i) => i.status === "open") &&
        this.state.goals.find((g) => g.id === t.goal)?.status === "completed"
      )
        this.close(t, "observed-complete", minute);
    for (const t of this.state.tracking)
      if (!t.close && minute >= t.expires) this.close(t, "deadline", minute);
    this.limit(minute);
    this.store.trim();
  }
  private queue(model: string, event: string, input: Json) {
    if (
      !this.state.pendingLearning.some(
        (p) => p.model === model && p.event === event,
      ) &&
      !this.state.models[model].applied.includes(event)
    )
      this.state.pendingLearning.push({ model, event, input });
  }
  private learn(session: DecisionSession) {
    for (const item of [...this.state.pendingLearning]) {
      const learner = this.registry.get(item.model).definition.learner;
      if (!learner) continue;
      try {
        session.take("learningUpdates");
        const base = this.store.read(item.model);
        const next = this.registry
          .get(learner)
          .invoke(item.input, base.value, session.callsFor(learner)); // learner owns only target state
        this.store.apply(item.model, item.event, base.revision, next as Json);
        this.state.feedback
          .filter(
            (f) =>
              f.kind === "prediction" &&
              f.model === item.model &&
              f.eventId === item.event,
          )
          .forEach((f) => {
            f.applied = true;
            f.reason = "local-update";
          });
        this.state.pendingLearning = this.state.pendingLearning.filter(
          (p) => p !== item,
        );
      } catch (error) {
        if (error instanceof BudgetExceeded) break;
        throw error;
      }
    }
  }
  meal(track: Tracking) {
    if (!track.absorption)
      track.absorption = { status: "open", meals: 1, digesting: true };
    else {
      track.absorption.meals++;
      track.absorption.status = "ambiguous";
    }
  }
  digestion(digesting: boolean, minute: number) {
    const open = this.state.tracking.filter((t) => !t.close && t.absorption);
    for (const t of open) {
      const a = t.absorption!;
      if (open.length > 1) a.status = "ambiguous";
      if (a.status === "open" && a.digesting && !digesting) {
        a.status = "estimated";
        this.close(t, "observed-complete", minute);
      }
      a.digesting = digesting;
    }
  }
  limit(minute: number) {
    const open = this.state.tracking.filter((t) => !t.close);
    while (open.length > this.budget.openTracking)
      this.close(open.shift()!, "capacity", minute);
    const closed = this.state.tracking.filter((t) => t.close);
    const remove = new Set(
      closed
        .slice(0, Math.max(0, closed.length - this.budget.retainedTracking))
        .map((t) => t.id),
    );
    this.state.tracking = this.state.tracking.filter((t) => !remove.has(t.id));
    this.state.feedback = this.state.feedback.slice(
      -this.budget.retainedChoices,
    );
    new DecisionHistory(this.state).retain(
      this.budget.retainedChoices,
      this.budget.retainedFailures,
    );
    this.execution.retain(this.state.tracking);
    this.state.received = this.state.received.slice(-256);
    this.store.retainApplied(256);
  }
}
