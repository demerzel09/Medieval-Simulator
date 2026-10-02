import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { experienceLearning90V1 } from "../fixtures/land-economy-wide";
import { actionCondition, actionObservation, beginActionPrediction, checkActionLearning, effortForecast,
  newActionLearning, receiveActionOutcomes, type ActionPrediction } from "../packages/ai/action-learning";
import type { VillageAttempt, VillageContext, VillageModel, VillageStimulus } from "../packages/ai/autonomous-world";
import type { AnticipationMemory } from "../packages/ai/anticipatory-needs";
import { foodMarketChoice } from "../packages/ai/food-market";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { newPredictionLedger } from "../packages/ai/prediction-ledger";
import { forageDestination, rememberForaging } from "../packages/ai/foraging-memory";
import { advanceVillageWorld, newVillageWorld, loadVillageWorld, saveVillageWorld, villageHash, queueVillageCommand } from "../packages/sim/autonomous-world";
import { advanceNeedsBody } from "../packages/sim/needs-body";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function context(): VillageContext {
  let c: VillageContext | undefined;
  advanceVillageWorld(newVillageWorld(240924, experienceLearning90V1), 1, { decide(i) {
    if (i.actorId === "F") c = structuredClone(i.knownContext); return idle.decide(i);
  } });
  return c!;
}
function evidence(p: ActionPrediction, phase: "started" | "completed" | "failed", hours: number, energy: number): VillageStimulus {
  return { id: `${p.id}:${phase}`, kind: "result", action: p.action, occurredAt: p.madeAt + hours, receivedAt: p.madeAt + hours,
    success: phase !== "failed", causeEventIds: [`event:${p.id}:${phase}`], experience: { phase, predictionId: p.id,
      processId: `process:${p.id}`, attemptEventId: `attempt:${p.id}`, startedAt: p.madeAt, elapsedHours: hours,
      before: structuredClone(p.before), after: { ...p.before, energy } } };
}
describe("matched action experience v17", () => {
  it("keeps actual time since eating independent of the periodic food requirement", () => {
    const body = { sleepDebt: 0, mealHours: 18, needClockHours: 18, exposureHours: 0, sleptHours: 0 };
    let mealsDue = 0;
    for (let i = 0; i < 54; i++) if (advanceNeedsBody(body, 0, 26, 26, 22, 16, undefined, true).mealDue) mealsDue++;
    expect(body.mealHours).toBe(72); expect(body.needClockHours).toBe(0); expect(mealsDue).toBe(3);
    body.mealHours = 0;
    for (let i = 0; i < 23; i++) expect(advanceNeedsBody(body, 0, 26, 26, 22, 16, undefined, true).mealDue).toBe(false);
    expect(body.mealHours).toBe(23);
    expect(advanceNeedsBody(body, 0, 26, 26, 22, 16, undefined, true).mealDue).toBe(true);
  });
  it("matches frozen predictions, ignores other processes, duplicates and future deliveries, and learns failed effort without arrival duration", () => {
    const c = context(); c.energy = 26;
    const m = newActionLearning(), action: VillageAttempt = { kind: "travel", siteId: "market" };
    const p = beginActionPrediction(m, "F", 10, c, action, 2);
    receiveActionOutcomes(m, [evidence(p, "started", 0, 26)], 10);
    const terminal = evidence(p, "failed", 3, 5);
    const wrong = structuredClone(terminal); wrong.experience!.processId = "another process";
    receiveActionOutcomes(m, [wrong, { ...terminal, receivedAt: 16 }], 13);
    expect(m.pending).toHaveLength(1);
    receiveActionOutcomes(m, [terminal, terminal], 13);
    expect(m.totals.matched).toBe(1); expect(m.recent[0].energyChange).toBe(-21);
    expect(m.models[p.key].energyRate?.mean).toBe(-7);
    expect(m.models[p.key].completedHours).toBeUndefined();
    expect(m.recent[0].prediction.priorRate).toBe(p.priorRate);
    checkActionLearning(m, 13);
  });
  it("compares prior and experience forecasts before acting, changes feasible loading, and shares effort across item kinds", () => {
    const c = context(); Object.assign(c, { siteId: "grain_plot_1", cell: { x: 0, y: 0 }, ownCash: 0, edibleMeals: 1,
      grainCarried: 0, carriedMass: 4, ownFoodLots: [], fieldGrainStores: [{ id: "stock", siteId: "grain_plot_1", cell: { x: 0, y: 0 }, grain: 20, lots: [{ id: "lot", quantity: 20 }] }],
      grainStores: [{ id: "stock", siteId: "grain_plot_1", grain: 20, capacity: 64, lots: [{ id: "lot", quantity: 20 }] }], energy: 26, cold: 0 });
    c.needs = { ...c.needs!, sheltered: false, sleepDebt: 10 }; c.bulkTransport = { ...c.bulkTransport!, bagFreeMass: 16 };
    const learning = newActionLearning();
    const m: AnticipationMemory = { learning, predictions: { ...newPredictionLedger(), knownSites: { market: { x: 25, y: 0 } } },
      foodMarket: { retryAt: 0 }, experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
      sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 } };
    const initial = foodMarketChoice(c, m, "F", 50)!.attempt;
    expect(initial).toMatchObject({ kind: "load_grain", quantity: 5 });
    const loaded = { ...c, carriedMass: 14 };
    for (const at of [10, 20, 30]) {
      const p = beginActionPrediction(learning, "F", at, loaded, { kind: "travel", siteId: "market" }, 2);
      receiveActionOutcomes(learning, [evidence(p, "started", 0, 26), evidence(p, "completed", 2, 16)], at + 2);
    }
    expect(effortForecast(learning, "travel", actionObservation(loaded)).selected).toBe("experience");
    expect(foodMarketChoice(c, m, "F", 50)!.attempt).toMatchObject({ kind: "load_grain", quantity: 3 });
    const wood = { ...loaded, carriedInventory: [{ id: "wood", kind: "wood", quantity: 14, mass: 14, edible: false }] };
    expect(actionCondition("travel", actionObservation(wood))).toBe(actionCondition("travel", actionObservation(loaded)));
    checkActionLearning(learning, 50);
  });
  it("keeps planting-only stock in storage and does not load for a cold deferred sale", () => {
    const c = context(); c.siteId = c.needs!.home.siteId; c.ownCash = 0; c.edibleMeals = 1; c.grainCarried = 0; c.ownFoodLots = [];
    c.needs = { ...c.needs!, sheltered: true };
    c.grainStores = [{ id: "home", siteId: c.siteId, capacity: 64, grain: 4, lots: [{ id: "reserve", quantity: 4 }] }];
    const m = { coldRates: {}, temperatures: {}, foodMarket: { retryAt: 0 } } as AnticipationMemory;
    expect(foodMarketChoice(c, m, "F", 16)?.attempt).toBeUndefined();
    c.grainStores[0].grain = 20; c.grainStores[0].lots[0].quantity = 20;
    expect(foodMarketChoice(c, m, "F", 24)?.attempt).toBeUndefined();
  });
  it("finishes gathering on arrival before another trade goal and only revisits personally observed plant cells", () => {
    const c = context(); Object.assign(c, { siteId: "known-herb", hunger: 1, energy: 26, cold: 0, carriedMass: 0,
      edibleMeals: 0, ownCash: 8, ownFoodLots: [], grainCarried: 0, grainStores: [], ownFarm: undefined,
      visiblePlants: [{ id: "herb", siteId: "known-herb", cell: c.cell, species: "herb", stage: "ripe", available: 2 }] });
    c.needs = { ...c.needs!, temperature: 22, sheltered: false, sleepDebt: 0, mealHours: 30 };
    c.foodMarket = { ...c.foodMarket!, bakingSkill: 1 };
    const memory: AnticipationMemory = { experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
      sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 }, goal: { kind: "forage", siteId: c.siteId, startedAt: 15 } };
    const response = learningNeedsVillageModel.decide({ actorId: "F", at: 16, stimuli: [], knownContext: c,
      subjectiveState: { day: 1, done: [], beliefs: { foodBid: 1, foodRetail: 1, woodPrice: 1, carrierFee: 1 }, anticipation: memory } });
    expect(response.attempts[0]).toMatchObject({ kind: "gather_plant", plantId: "herb", quantity: 2 });
    const foraging = { places: {} }; rememberForaging(foraging, c, 16);
    const next = { ...c, siteId: "other", visiblePlants: [] };
    const destination = forageDestination(foraging, next, 40)!;
    expect(destination.siteId).toBe("known-herb"); expect(Object.keys(foraging.places)).toEqual(["herb"]);
    expect(forageDestination({ places: {} }, next, 40)).toBeUndefined();
  });
  it("records immediate physical effects at zero elapsed time and resets the meal clock on real eating", () => {
    const w = newVillageWorld(240924, experienceLearning90V1);
    advanceVillageWorld(w, 24, learningNeedsVillageModel);
    const eat = w.decisions.find((d) => d.chosen?.kind === "eat")!;
    expect(eat).toBeDefined();
    const eating = w.decisions.flatMap((d) => d.stimuli).find((s) => s.experience?.predictionId === eat.chosen!.experienceId && s.experience?.phase === "completed")!;
    expect(eating.experience).toMatchObject({ elapsedHours: 0 });
    expect(eating.experience!.after.hunger).toBe(eating.experience!.before.hunger - 1);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      const lastEat = w.events.filter((e) => e.kind === "ate" && e.actors[0] === id).at(-1);
      if (lastEat) expect(w.people[id].needs!.mealHours).toBe(w.hour - lastEat.hour);
    }
  });
  it("closes replaced and unobserved predictions without fabricating results, and accepts a delayed bound completion", () => {
    const c = context(), m = newActionLearning();
    const p = beginActionPrediction(m, "F", 10, c, { kind: "travel", siteId: "market" }, 2);
    receiveActionOutcomes(m, [evidence(p, "started", 0, c.energy)], 10);
    const terminal = { ...evidence(p, "completed", 2, c.energy - 4), receivedAt: 65 };
    receiveActionOutcomes(m, [terminal], 65);
    expect(m.recent[0].status).toBe("completed"); expect(m.recent[0].at).toBe(12);
    const replaced = beginActionPrediction(m, "F", 66, c, { kind: "eat" }, 0);
    const s: VillageStimulus = { id: "replace", kind: "result", action: "eat", success: false, causeEventIds: ["replace-event"],
      occurredAt: 66, receivedAt: 67, experience: { phase: "superseded", predictionId: replaced.id, attemptEventId: "replace-attempt", startedAt: 66,
        elapsedHours: 0, before: replaced.before, after: replaced.before } };
    receiveActionOutcomes(m, [s], 67);
    beginActionPrediction(m, "F", 68, c, { kind: "rest" }, 2);
    receiveActionOutcomes(m, [], 116);
    expect(m.totals).toMatchObject({ predicted: 3, matched: 1, excluded: 2 });
    expect(m.recent.at(-1)!.energyChange).toBeUndefined(); checkActionLearning(m, 116);
  });
  it("records actual sleep interruption and external command replacement without learning a completed sleep or journey", () => {
    const w = newVillageWorld(240924, experienceLearning90V1);
    queueVillageCommand(w, { id: "sleep", actorId: "B1", at: 1, attempt: { kind: "sleep" } });
    queueVillageCommand(w, { id: "wake", actorId: "B1", at: 3, attempt: { kind: "wake_up" } });
    queueVillageCommand(w, { id: "replace", actorId: "F", at: 1, attempt: { kind: "rest" } });
    advanceVillageWorld(w, 5, learningNeedsVillageModel);
    const interruption = w.decisions.flatMap((d) => d.stimuli).find((s) => s.experience?.phase === "interrupted")!;
    expect(interruption.action).toBe("sleep"); expect(interruption.experience!.elapsedHours).toBe(2);
    expect(w.people.F.memory.anticipation!.learning!.recent.some((o) => o.status === "superseded")).toBe(true);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  });
  it("recalculates decisions and preserves pending predictions across save/resume and world replay", () => {
    const w = newVillageWorld(240924, experienceLearning90V1);
    advanceVillageWorld(w, 117, learningNeedsVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 123, learningNeedsVillageModel); advanceVillageWorld(resumed, 123, learningNeedsVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
    for (const d of w.decisions) expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
      stimuli: structuredClone(d.stimuli), knownContext: structuredClone(d.knownContext), subjectiveState: structuredClone(d.subjectiveBefore) })).toEqual(d.response);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
    expect(w.people.F.memory.anticipation!.learning!.totals.matched).toBeGreaterThan(0);
  }, 120000);
  it("replays the ninety day archive with five actual food histories, conserved assets and learned forecasts", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-experience-learning-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(r.rulesetId).toBe("autonomous-village-experience-learning-v17"); expect(villageHash(w)).toBe(r.finalStateHash);
    let learned = 0;
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      expect(w.people[id]).toMatchObject({ meals: 90, hunger: 0, fuelUsed: 0 });
      const lastMeal = w.events.filter((e) => e.kind === "ate" && e.actors[0] === id).at(-1)!;
      expect(w.people[id].needs!.mealHours).toBe(w.hour - lastMeal.hour);
      const m = w.people[id].memory.anticipation!.learning!;
      expect(m.totals.matched).toBeGreaterThan(0); expect(Object.keys(m.models).length).toBeLessThanOrEqual(16);
      for (const d of w.decisions.filter((d) => d.actorId === id && d.chosen?.experienceId)) if (
        d.response.subjectiveUpdate!.anticipation!.learning!.pending.find((p) => p.id === d.chosen!.experienceId)?.selected === "experience") learned++;
    }
    expect(learned).toBeGreaterThan(0);
    expect(w.events.filter((e) => e.kind === "process_failed" && e.data.action === "travel")).toHaveLength(0);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    const harvestOutcome = w.decisions.flatMap((d) => d.stimuli).find((s) => s.action === "harvest_plot" && s.experience?.phase === "completed")!;
    expect(harvestOutcome.experience!.after.raw - harvestOutcome.experience!.before.raw).toBe(20);
  }, 240000);
});
