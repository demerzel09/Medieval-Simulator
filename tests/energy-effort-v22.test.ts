import { describe, expect, it } from "vitest";
import { energyEffort90V1, offerIntegrity90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageModel } from "../packages/ai/autonomous-world";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { beginEffortPrediction, effortDecision, evaluateJourney, newEffortMemory, observeEffort } from "../packages/ai/effort-choice";
import { actionObservation } from "../packages/ai/action-learning";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { advanceEffortQuarter, checkEffortBody, defaultEffortConfig as config, effortEnergy, effortSensation, exertEffort, ingestEffort, newEffortBody } from "../packages/sim/effort-body";
import { physicalTransaction, siteOf, totalMass } from "../packages/sim/physical";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";
import { VillageStatusReplay } from "../apps/web/village-status-replay";
import { villagePersonStatus } from "../packages/sim/village-status";
import { defaultSleepConfig, newSleepBody, sleepSignal } from "../packages/sim/sleep-body";
const idle: VillageModel = { decide(i) { return { attempts: [], wait: { at: i.at + 1 }, subjectiveUpdate: i.subjectiveState }; } };
function action(w: VillageWorld, attempt: VillageAttempt) {
  queueVillageCommand(w, { id: `test-${w.hour}`, actorId: "F", at: w.hour + 1, attempt });
  advanceVillageWorld(w, 1, idle);
  while (w.people.F.activeProcessId) advanceVillageWorld(w, 1, idle);
}
describe("nutrition, activity fatigue and current burden", () => {
  it("accounts delayed real intake, basal/work consumption and overflow without rest creating nutrition", () => {
    const b = newEffortBody(config, 13, 26), initial = b.reserve;
    exertEffort(b, config, 3); expect(b.reserve).toBeLessThan(initial);
    const exhausted = b.fatigue; ingestEffort(b, config, 0, 36000, "ate");
    advanceEffortQuarter(b, config, 15, "rest", 0, 0, 1);
    expect(b.absorbed).toBe(0); expect(b.fatigue).toBeLessThan(exhausted);
    for (let minute = 30; minute <= 120; minute += 15) advanceEffortQuarter(b, config, minute, "rest", 0, 0, 1);
    expect(b.absorbed).toBe(36000); checkEffortBody(b, config, 120);
    ingestEffort(b, config, 120, 96000, "large-meal");
    for (let minute = 135; minute <= 240; minute += 15) advanceEffortQuarter(b, config, minute, "sleep", 0, 0, 1);
    expect(b.lost).toBeGreaterThan(0); checkEffortBody(b, config, 240);
  });
  it("unloading immediately removes load discomfort without undoing work, and low supply limits recovery", () => {
    const b = newEffortBody(config, 26, 26); exertEffort(b, config, 4);
    const state = structuredClone(b), loaded = effortSensation(b, config, 16), empty = effortSensation(b, config, 0);
    expect(loaded.loadDiscomfort).toBeGreaterThan(empty.loadDiscomfort); expect(b).toEqual(state);
    b.consumed += b.reserve; b.reserve = 0;
    const fatigue = b.fatigue; advanceEffortQuarter(b, config, 15, "sleep", 0, 0, 1);
    expect(b.fatigue).toBe(fatigue); expect(effortEnergy(b, config, 26)).toBe(0); checkEffortBody(b, config, 15);
    const sleep = newSleepBody(defaultSleepConfig);
    expect(sleepSignal(sleep, defaultSleepConfig, 0, 26, 0).fatigue).toBe(0);
    expect(sleepSignal(sleep, defaultSleepConfig, 0, 26, .9).sleepiness).toBeGreaterThan(sleepSignal(sleep, defaultSleepConfig, 0, 26, 0).sleepiness);
  });
});
it("uses designated unoffered sowing grain and invalidates stored offers with physical evidence", () => {
  const w = newVillageWorld(240924, offerIntegrity90V1), old = "grain_seed_initial_F";
  const out = physicalTransaction(w.physical, { actorId: "F", ownerIds: [] }, (t) => t.split(old, "sowing-grain", 1, "initial"));
  expect(out.ok).toBe(true); if (!out.ok) throw Error(out.reason);
  w.physical = out.state; w.foodLots["sowing-grain"] = { ...w.foodLots[old] };
  action(w, { kind: "travel", siteId: "market" }); action(w, { kind: "post_surplus_offer", lotId: old, quantity: 3, price: 2 });
  const offer = Object.values(w.foodOffers!)[0];
  action(w, { kind: "travel", siteId: "grain_plot_3" }); action(w, { kind: "till_plot", plantId: "grain_plot_3" });
  action(w, { kind: "sow_plot", plantId: "grain_plot_3", lotId: "sowing-grain" });
  expect(w.physical.objects[old].quantity).toBe(3); expect(w.physical.objects["sowing-grain"]).toBeUndefined();
  expect(offer.cancelledEventId).toBeUndefined();
  action(w, { kind: "store_grain", lotId: old, storeId: "granary_field_grain_plot_3" });
  expect(offer.cancelledEventId).toBeTruthy(); expect(w.events.find((e) => e.id === offer.cancelledEventId)!.causes).toContain(offer.postedEventId);
  checkVillageWorld(w);
});
it("stops loaded travel at its actual cell, sets cargo down and saves ownership exactly", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  queueVillageCommand(w, { id: "travel", actorId: "F", at: 1, attempt: { kind: "travel", siteId: "meadow" } });
  advanceVillageWorld(w, 1, idle);
  queueVillageCommand(w, { id: "stop", actorId: "F", at: 2, attempt: { kind: "interrupt_action" } });
  advanceVillageWorld(w, 1, idle);
  const stopped = structuredClone(w.people.F.cell), reserve = w.people.F.effort!.reserve, fatigue = w.people.F.effort!.fatigue;
  expect(w.people.F.activeProcessId).toBeUndefined(); expect(w.events.some((e) => e.kind === "process_interrupted")).toBe(true);
  expect(stopped).not.toEqual(w.grid.sites.meadow);
  action(w, { kind: "set_down", objectId: "grain_seed_initial_F", quantity: 4 });
  expect(w.people.F.cell).toEqual(stopped); expect(totalMass(w.physical, "F")).toBe(0);
  expect(w.people.F.effort!.reserve).toBeLessThan(reserve); expect(w.people.F.effort!.fatigue).toBeGreaterThanOrEqual(fatigue);
  expect(villagePersonStatus(w, "F").ground!.items[0].quantity).toBe(4);
  const saved = loadVillageWorld(saveVillageWorld(w));
  action(w, { kind: "take_ground", objectId: "grain_seed_initial_F", quantity: 2 });
  action(saved, { kind: "take_ground", objectId: "grain_seed_initial_F", quantity: 2 });
  expect(villageHash(saved)).toBe(villageHash(w)); expect(totalMass(w.physical, "F")).toBe(4);
  const projection = new VillageStatusReplay(w.fixture);
  for (const event of w.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const actual = JSON.parse(String(event.data.status));
      expect(projection.statuses[event.actors[0] as keyof typeof projection.statuses]!.ground).toEqual(actual.ground);
    }
    projection.apply(event);
  }
  const atHome = newVillageWorld(240924, energyEffort90V1);
  action(atHome, { kind: "travel", siteId: "home_F" });
  action(atHome, { kind: "set_down", objectId: "grain_seed_initial_F", quantity: 4 });
  expect(siteOf(atHome.physical, "F")).toBe("home_F");
  expect(villagePersonStatus(atHome, "F").body.sheltered).toBe(true);
  action(atHome, { kind: "take_ground", objectId: "grain_seed_initial_F", quantity: 2 });
  expect(totalMass(atHome.physical, "F")).toBe(4); expect(siteOf(atHome.physical, "F")).toBe("home_F");
});
it("compares complete journeys and distinguishes matched physical error from censored trade", () => {
  const w = newVillageWorld(240924, energyEffort90V1); advanceVillageWorld(w, 12, learningNeedsVillageModel);
  const d = w.decisions.find((d) => d.actorId === "F" && d.hour === 12)!;
  const c = structuredClone(d.knownContext), m = structuredClone(d.response.subjectiveUpdate!.anticipation!);
  Object.assign(c, { carriedMass: 0, ownCash: 0, edibleMeals: 2, cold: 0, cell: c.knownLandmarks!.market, siteId: "market" });
  c.effortBody!.fatigue = .1; c.needs!.sleep!.sleepiness = 0;
  const light = evaluateJourney(c, m, 1, 12), heavy = evaluateJourney({ ...c, carriedMass: 8 }, m, 1, 12);
  expect(heavy.cost).toBeGreaterThan(light.cost); expect(light.hours).toBeGreaterThan(2);
  expect(light.value).toBeGreaterThan(0);
  const unneeded = evaluateJourney({ ...c, ownCash: 8 }, m, 1, 12);
  expect(unneeded.benefit).toBe(0); expect(unneeded.value).toBeLessThan(0);
  expect(evaluateJourney(c, m, 3, 12).benefit).toBeGreaterThan(light.benefit);
  m.effort!.trade.successes = 9; expect(evaluateJourney(c, m, 1, 12).benefit).toBeGreaterThan(light.benefit);
  const stockContext = structuredClone(c), stockMemory = structuredClone(d.response.subjectiveUpdate!);
  Object.assign(stockContext, { edibleMeals: 3, hunger: 0, energy: 26, grainCarried: 0, activeAction: undefined,
    grainStores: [{ id: "own-stock", siteId: "market", grain: 8, capacity: 128,
      lots: [{ id: "small-lot", quantity: 1 }, { id: "large-lot", quantity: 7 }] }] });
  delete stockMemory.anticipation!.cropPlan; delete stockMemory.anticipation!.effort!.goal;
  const load = effortDecision(stockContext, stockMemory, "F", 12, []).attempts[0];
  expect(load).toEqual({ kind: "load_grain", lotId: "small-lot", quantity: 1 });
  expect(stockMemory.anticipation!.effort!.goal!.quantity).toBe(1);
  const e = newEffortMemory(), a: VillageAttempt = { kind: "travel", siteId: "market" };
  beginEffortPrediction(e, c, a, "p", 12);
  const before = actionObservation(c), after = { ...before, fatigue: .22 };
  observeEffort(e, c, [{ id: "own", kind: "result", action: "travel", occurredAt: 14, receivedAt: 14, causeEventIds: ["work"],
    experience: { phase: "interrupted", predictionId: "p", attemptEventId: "attempt", startedAt: 12, elapsedHours: 2, before, after } }], 14);
  expect(e.matched).toBe(1); expect(e.last!.error).toBeCloseTo(.04); expect(e.models[`travel:load0:need${c.effortBody!.nutritionNeed >= .75 ? 1 : 0}:cold0`].count).toBe(1);
  e.trade.offer = { id: "valid", at: 14, deadline: 16 };
  observeEffort(e, c, [{ id: "withdraw", kind: "result", occurredAt: 15, receivedAt: 15, causeEventIds: ["stored"], offerChange: { id: "valid", valid: false } }], 15);
  expect(e.trade.censored).toBe(1); expect(e.trade.failures).toBe(0);
  const untrained = newEffortMemory(), disabled = { ...c, effortBody: { ...c.effortBody!, learningEnabled: false } };
  beginEffortPrediction(untrained, disabled, a, "off", 15);
  observeEffort(untrained, disabled, [{ id: "own-off", kind: "result", action: "travel", occurredAt: 17, receivedAt: 17, causeEventIds: ["work-off"],
    experience: { phase: "completed", predictionId: "off", attemptEventId: "off-attempt", startedAt: 15, elapsedHours: 2, before, after } }], 17);
  expect(untrained.matched).toBe(1); expect(untrained.models).toEqual({});
});
it("allows immediate unloading and required sleep despite inadequate nutritional work supply", () => {
  const w = newVillageWorld(240924, energyEffort90V1); advanceVillageWorld(w, 12, learningNeedsVillageModel);
  const d = w.decisions.find((d) => d.actorId === "F" && d.hour === 12)!;
  const c = structuredClone(d.knownContext), memory = structuredClone(d.response.subjectiveUpdate!);
  Object.assign(c, { activeAction: undefined, carriedMass: 8, energy: 0, edibleMeals: 0, hunger: 3,
    carriedInventory: [{ id: "heavy-grain", kind: "grain", quantity: 4, mass: 8, edible: false }],
    ownFoodLots: [{ id: "heavy-grain", product: "grain", species: "grain", quantity: 4, mealQuantity: 1, offered: false }],
    ownGroundItems: [], homeStorage: undefined, siteId: "market" });
  Object.assign(c.effortBody!, { fatigue: .8, nutritionNeed: 1, digesting: false, loadDiscomfort: .7 });
  c.needs!.sheltered = false; delete memory.anticipation!.effort!.goal;
  expect(effortDecision(c, memory, "F", 12, []).attempts[0].kind).toMatch(/store_grain|set_down/);
  c.carriedInventory = []; c.ownFoodLots = []; c.carriedMass = 0; c.effortBody!.loadDiscomfort = 0;
  c.needs!.sheltered = true; c.needs!.sleep!.sleepiness = .95; memory.anticipation!.sleep!.retryAt = 0;
  expect(effortDecision(c, memory, "F", 12, []).attempts).toEqual([{ kind: "sleep" }]);
});
it("resumes a meal still awaiting absorption without duplicating nutrition or its cause", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  while (!w.people.F.effort!.digestion.length && w.hour < 72) advanceVillageWorld(w, 1, learningNeedsVillageModel);
  expect(w.people.F.effort!.digestion).toHaveLength(1);
  const cause = w.people.F.effort!.digestion[0].causeId;
  expect(w.events.find((e) => e.id === cause)!.kind).toBe("ate");
  const saved = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 3, learningNeedsVillageModel); advanceVillageWorld(saved, 3, learningNeedsVillageModel);
  expect(villageHash(saved)).toBe(villageHash(w));
  expect(w.people.F.effort!.absorbed).toBeGreaterThan(0);
});
it("recomputes decisions, conserves physical nutrition and projects inventory before checkpoints on resumed runs", () => {
  const w = newVillageWorld(240924, energyEffort90V1); advanceVillageWorld(w, 72, learningNeedsVillageModel);
  const saved = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 48, learningNeedsVillageModel); advanceVillageWorld(saved, 48, learningNeedsVillageModel);
  expect(villageHash(saved)).toBe(villageHash(w));
  for (const d of w.decisions) expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
    knownContext: d.knownContext, subjectiveState: d.subjectiveBefore, stimuli: d.stimuli })).toEqual(d.response);
  const projection = new VillageStatusReplay(w.fixture);
  for (const event of w.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const actual = JSON.parse(String(event.data.status)), previous = projection.statuses[event.actors[0] as keyof typeof projection.statuses]!;
      for (const k of ["carried", "home", "market", "field"] as const) expect(previous[k], `${event.id} ${k}`).toEqual(actual[k]);
      expect(previous.body.effort).toEqual(actual.body.effort);
    }
    projection.apply(event);
  }
  expect(w.decisions.every((d) => !("reserve" in d.knownContext.effortBody!))).toBe(true);
  expect(Object.values(w.people).every((p) => p.meals > 0)).toBe(true);
  expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
}, 120000);
