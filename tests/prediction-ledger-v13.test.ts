import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { predictionLedger90V1 } from "../fixtures/land-economy-wide";
import { beginTravelPrediction, checkPredictionLedger, newPredictionLedger, receiveTravelOutcomes,
  rememberTravelSites, type PredictionLedger } from "../packages/ai/prediction-ledger";
import { trackedNeedsVillageModel } from "../packages/ai/tracked-needs";
import type { TravelExecution, VillageContext, VillageModel, VillageStimulus } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand,
  saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function context() {
  const w = newVillageWorld(240924, predictionLedger90V1);
  advanceVillageWorld(w, 1, idle);
  return structuredClone(w.decisions.find((d) => d.actorId === "B1")!.knownContext);
}
function setup() {
  const c = context(), ledger = newPredictionLedger();
  rememberTravelSites(ledger, c);
  const p = beginTravelPrediction(ledger, "B1", 1, c, "home_B2", { count: 4, mean: 2, m2: 0 }, ["observation"]);
  return { c, ledger, p };
}
function evidence(ledger: PredictionLedger, phase: TravelExecution["phase"], occurredAt: number,
  receivedAt = occurredAt, overrides: Partial<TravelExecution> = {}): VillageStimulus {
  const p = ledger.pending[0];
  return { id: `${phase}:${occurredAt}`, kind: "result", occurredAt, receivedAt,
    action: "travel", success: phase === "started" || phase === "completed", causeEventIds: [`event:${phase}`],
    travel: { phase, predictionId: p.id, destinationId: p.to, processId: "process:1",
      attemptEventId: "decision:1", startedAt: 1, elapsedHours: occurredAt - 1, ...overrides } };
}

describe("pre-action travel prediction ledger v13", () => {
  it("scores the frozen forecast against elapsed time at occurrence, excluding delivery delay and duplicate receipts", () => {
    const { ledger, p } = setup();
    const start = evidence(ledger, "started", 1);
    const finish = evidence(ledger, "completed", 4, 12);
    expect(receiveTravelOutcomes(ledger, [start], 2)).toEqual([]);
    receiveTravelOutcomes(ledger, [{ ...start, travel: { ...start.travel!, attemptEventId: "conflicting-start" } }], 2);
    expect(ledger.pending[0].attemptEventId).toBe("decision:1");
    expect(receiveTravelOutcomes(ledger, [finish], 11)).toEqual([]);
    const outcomes = receiveTravelOutcomes(ledger, [finish], 12);
    expect(outcomes[0]).toMatchObject({ prediction: { expectedHours: 2, estimateCount: 4 },
      occurredAt: 4, receivedAt: 12, actualHours: 3, errorHours: 1 });
    expect(receiveTravelOutcomes(ledger, [start, finish, finish], 13)).toEqual([]);
    expect(ledger.totals).toMatchObject({ predicted: 1, completed: 1, scored: 1, absoluteError: 1 });
    expect(p.expectedHours).toBe(2);
    checkPredictionLedger(ledger, 13);
  });
  it.each(["failed", "redirected", "rejected", "superseded"] as const)("excludes %s from completed duration learning", (phase) => {
    const { ledger } = setup();
    receiveTravelOutcomes(ledger, [evidence(ledger, "started", 1)], 2);
    const result = evidence(ledger, phase, 3, 4, phase === "redirected" ? { destinationId: "market" } : {});
    const outcomes = receiveTravelOutcomes(ledger, [result], 4);
    expect(outcomes[0]).toMatchObject({ status: phase });
    expect(outcomes[0].actualHours).toBeUndefined();
    expect(outcomes[0].errorHours).toBeUndefined();
    expect(ledger.totals).toMatchObject({ completed: 0, scored: 0, excluded: 1 });
    checkPredictionLedger(ledger, 4);
  });
  it("rejects wrong execution, target and elapsed interval without fabricating a zero result", () => {
    const { ledger } = setup();
    receiveTravelOutcomes(ledger, [evidence(ledger, "started", 1)], 2);
    for (const overrides of [{ processId: "unrelated" }, { destinationId: "market" },
      { startedAt: 2 }, { attemptEventId: "other" }, { elapsedHours: 0 }]) {
      expect(receiveTravelOutcomes(ledger, [evidence(ledger, "completed", 4, 4, overrides)], 4)).toEqual([]);
    }
    expect(ledger.pending).toHaveLength(1);
    const expired = receiveTravelOutcomes(ledger, [], 49);
    expect(expired[0]).toMatchObject({ status: "unobserved", exclusionReason: "outcome deadline passed" });
    expect(ledger.totals.scored).toBe(0);
  });
  it("can close an overdue prediction with valid delayed evidence before expiring it", () => {
    const { ledger } = setup();
    const start = evidence(ledger, "started", 1, 60), finish = evidence(ledger, "completed", 4, 60);
    expect(receiveTravelOutcomes(ledger, [start, finish], 60)[0].actualHours).toBe(3);
    expect(ledger.totals.excluded).toBe(0);
  });
  it("leaves unknown endpoints unestimated and bounds pending and detailed history", () => {
    const c = context(), ledger = newPredictionLedger();
    rememberTravelSites(ledger, c);
    expect(ledger.knownSites).not.toHaveProperty("home_B2");
    for (let n = 0; n < 50; n++) beginTravelPrediction(ledger, "B1", 1, c, "unobserved-place", undefined, []);
    expect(ledger.pending).toHaveLength(16); expect(ledger.recent).toHaveLength(24);
    expect(ledger.pending[0].expectedHours).toBeUndefined();
    expect(ledger.pending[0].source).toBe("unknown-destination");
    checkPredictionLedger(ledger, 1);
    const corrupt = structuredClone(ledger); corrupt.totals.predicted++;
    expect(() => checkPredictionLedger(corrupt, 1)).toThrow("invalid prediction ledger");
  });
  it("does not infer completion from current location and updates once from matching delivered evidence", () => {
    const { ledger, c } = setup();
    const w = newVillageWorld(240924, predictionLedger90V1);
    advanceVillageWorld(w, 1, trackedNeedsVillageModel);
    const state = structuredClone(w.people.B1.memory);
    state.anticipation!.predictions = ledger;
    delete state.anticipation!.trip;
    const start = evidence(ledger, "started", 1);
    const finish = evidence(ledger, "completed", 4, 8);
    c.siteId = "home_B2"; c.edibleMeals = 2;
    c.grainStores!.forEach((s) => s.grain = 12);
    const first = trackedNeedsVillageModel.decide({ actorId: "B1", at: 4, stimuli: [start], subjectiveState: state, knownContext: c });
    expect(first.subjectiveUpdate!.anticipation!.travelTimes["home_B1>home_B2"]).toBeUndefined();
    const second = trackedNeedsVillageModel.decide({ actorId: "B1", at: 8, stimuli: [finish],
      subjectiveState: first.subjectiveUpdate!, knownContext: c });
    expect(second.subjectiveUpdate!.anticipation!.travelTimes["home_B1>home_B2"]).toMatchObject({ count: 1, mean: 3 });
    const third = trackedNeedsVillageModel.decide({ actorId: "B1", at: 9, stimuli: [finish],
      subjectiveState: second.subjectiveUpdate!, knownContext: c });
    expect(third.subjectiveUpdate!.anticipation!.travelTimes["home_B1>home_B2"].count).toBe(1);
    expect(state.anticipation!.predictions!.pending[0].processId).toBeUndefined();
  });
  it("links real accepted, rejected and redirected processes, with command overrides closed explicitly", () => {
    const scripted: VillageModel = { decide(i) {
      const state = structuredClone(i.subjectiveState);
      const initialized = trackedNeedsVillageModel.decide({ ...i, subjectiveState: state }).subjectiveUpdate!;
      // A controlled travel fixture uses the same ledger and real world results.
      const m = initialized.anticipation!, ledger = m.predictions!;
      if (i.actorId !== "B1" || i.at !== 1) return { attempts: [], subjectiveUpdate: initialized, wait: { at: i.at + 1 } };
      const p = beginTravelPrediction(ledger, i.actorId, i.at, i.knownContext, "home_F", undefined, []);
      return { attempts: [{ kind: "travel", siteId: "home_F", predictionId: p.id }],
        subjectiveUpdate: initialized, wait: { at: i.at + 1 } };
    } };
    const accepted = newVillageWorld(240924, predictionLedger90V1);
    advanceVillageWorld(accepted, 1, scripted);
    const saved = loadVillageWorld(saveVillageWorld(accepted));
    advanceVillageWorld(accepted, 4, scripted); advanceVillageWorld(saved, 4, scripted);
    expect(villageHash(saved)).toBe(villageHash(accepted));
    expect(accepted.people.B1.memory.anticipation!.predictions!.recent.some((o) => o.status === "completed" &&
      o.prediction.processId && o.actualHours! >= 1)).toBe(true);
    const failed = newVillageWorld(240924, predictionLedger90V1);
    advanceVillageWorld(failed, 1, scripted);
    failed.people.B1.energy = 0;
    advanceVillageWorld(failed, 3, scripted);
    expect(failed.people.B1.memory.anticipation!.predictions!.recent.some((o) => o.status === "failed")).toBe(true);
    expect(failed.people.B1.memory.anticipation!.travelTimes["home_B1>home_F"]).toBeUndefined();
    const redirected = newVillageWorld(240924, predictionLedger90V1);
    queueVillageCommand(redirected, { id: "redirect", actorId: "B1", at: 2,
      attempt: { kind: "redirect_travel", siteId: "market" } });
    advanceVillageWorld(redirected, 7, scripted);
    expect(redirected.people.B1.memory.anticipation!.predictions!.recent.some((o) => o.status === "redirected")).toBe(true);
    expect(redirected.people.B1.memory.anticipation!.travelTimes["home_B1>home_F"]).toBeUndefined();
    const rejected = newVillageWorld(240924, predictionLedger90V1);
    rejected.people.B1.energy = 0;
    advanceVillageWorld(rejected, 3, scripted);
    expect(rejected.people.B1.memory.anticipation!.predictions!.recent.some((o) => o.status === "rejected")).toBe(true);
    const overridden = newVillageWorld(240924, predictionLedger90V1);
    queueVillageCommand(overridden, { id: "override", actorId: "B1", at: 1, attempt: { kind: "rest" } });
    advanceVillageWorld(overridden, 5, scripted);
    expect(overridden.people.B1.memory.anticipation!.predictions!.recent.some((o) => o.status === "superseded")).toBe(true);
  });
  it("recomputes recorded personality responses and replays the world across a save during normal food activity", () => {
    const w = newVillageWorld(240924, predictionLedger90V1);
    advanceVillageWorld(w, 3 * 24 + 1, trackedNeedsVillageModel);
    const restored = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 4 * 24, trackedNeedsVillageModel);
    advanceVillageWorld(restored, 4 * 24, trackedNeedsVillageModel);
    expect(villageHash(restored)).toBe(villageHash(w));
    const recording = captureVillageRecording(w);
    expect(recording.rulesetId).toBe("autonomous-village-prediction-ledger-v13");
    expect(villageHash(replayVillageRecording(recording))).toBe(villageHash(w));
    for (const d of recording.decisions) expect(trackedNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
      stimuli: d.stimuli, knownContext: d.knownContext, subjectiveState: d.subjectiveBefore })).toEqual(d.response);
    for (const person of Object.values(w.people)) {
      expect(person.meals).toBeGreaterThanOrEqual(7);
      const ledger = person.memory.anticipation!.predictions!;
      expect(ledger.totals.completed).toBeGreaterThan(0);
      expect(ledger.totals.scored).toBeGreaterThan(0);
      checkPredictionLedger(ledger, w.hour);
    }
  }, 120000);
  it("replays the v13 archive with daily food and conserved, matched travel observations", () => {
    const recording = JSON.parse(gunzipSync(readFileSync(
      "fixtures/recordings/autonomous-village-predictions-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(recording.rulesetId).toBe("autonomous-village-prediction-ledger-v13");
    const meals = w.events.filter((e) => e.kind === "ate");
    for (const person of Object.values(w.people)) {
      for (let day = 1; day <= 90; day++) expect(meals.some((e) => e.day === day && e.actors.includes(person.id))).toBe(true);
      const ledger = person.memory.anticipation!.predictions!;
      expect(ledger.totals.completed).toBeGreaterThan(0);
      expect(ledger.totals.excluded).toBe(0);
      expect(ledger.pending).toEqual([]);
      const estimates = Object.values(person.memory.anticipation!.travelTimes);
      expect(estimates.reduce((sum, e) => sum + e.count, 0)).toBe(ledger.totals.completed);
      expect(ledger.totals.predicted).toBe(ledger.totals.completed);
    }
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain")
      .every((e) => e.data.product === "bread")).toBe(true);
  }, 240000);
});
