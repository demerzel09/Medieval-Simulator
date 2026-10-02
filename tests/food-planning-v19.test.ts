import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { foodPlanning90V1 } from "../fixtures/land-economy-wide";
import type { VillageContext, VillageMemory, VillageModel } from "../packages/ai/autonomous-world";
import { checkAnticipationMemory, forecastCold, type AnticipationMemory } from "../packages/ai/anticipatory-needs";
import { foodNeedAt, foodPlanningChoice, mealShelterChoice, observeHomeFood, prepareFoodJourney, usableCarriedMeals } from "../packages/ai/food-planning";
import { beginFoodMarketVisit, observeFoodMarketVisit } from "../packages/ai/food-market";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

const fresh = (): AnticipationMemory => ({ experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
  sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 } });
const berry = { id: "berry", species: "wild_berry", stage: "ripe", available: 6, siteId: "berry", cell: { x: 33, y: 7 } };
function context() {
  let c: VillageContext | undefined;
  advanceVillageWorld(newVillageWorld(240924, foodPlanning90V1), 1, { decide(i) {
    if (i.actorId === "F") c = structuredClone(i.knownContext);
    return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } };
  } });
  Object.assign(c!, { siteId: "home_F", cell: c!.needs!.home.cell, energy: 26, cold: 0, hunger: 0,
    edibleMeals: 0, ownFoodLots: [], carriedInventory: [], carriedMass: 0, ownCash: 0,
    visiblePlants: [berry], visiblePlantWork: [], visibleFoodOffers: [], grainCarried: 0,
    homeStorage: { cash: 0, freeMass: 40, items: [] } });
  c!.needs = { ...c!.needs!, sleepDebt: 4, mealHours: 12, needClockHours: 12, sheltered: true, temperature: 32 };
  return c!;
}
function decide(c: VillageContext, m: AnticipationMemory, at = 12) {
  const state: VillageMemory = { day: c.day, done: [], beliefs: { foodBid: 1, foodRetail: 1, carrierFee: 1, woodPrice: 1 }, anticipation: m };
  return learningNeedsVillageModel.decide({ actorId: "F", at, knownContext: c, subjectiveState: state, stimuli: [] });
}

describe("food deadlines, observable competition and short journeys v19", () => {
  it("obtains food before hunger when sleeping first would use the acquisition window", () => {
    const c = context(), m = fresh();
    expect(foodNeedAt(c, 12)).toBe(24);
    const response = decide(c, m);
    expect(response.attempts[0]).toMatchObject({ kind: "travel", siteId: "berry" });
    expect(response.subjectiveUpdate!.anticipation!.foodPlanning!.evaluation).toMatchObject({ needAt: 24, usableMeals: 0, selected: 0 });
    const arrived = { ...c, siteId: "berry", cell: berry.cell, homeStorage: undefined, needs: { ...c.needs!, sheltered: false, sleepDebt: 5 } };
    expect(decide(arrived, response.subjectiveUpdate!.anticipation!, 13).attempts[0]).toMatchObject({ kind: "gather_plant", plantId: "berry", quantity: 3 });
  });
  it("avoids visible concurrent harvesting without treating the plant as physically depleted", () => {
    const c = context(), m = fresh();
    c.visiblePlants.push({ ...berry, id: "other", siteId: "other", cell: { x: 32, y: 7 } });
    c.visiblePlantWork = [{ actorId: "B1", plantId: "berry", quantity: 2 }];
    const result = foodPlanningChoice(c, m, "F", 12)!;
    expect(result.attempt).toMatchObject({ kind: "travel", siteId: "other" });
    expect(m.foodPlanning!.evaluation!.candidates.find((p) => p.siteId === "berry")).toMatchObject({ feasible: false, exclusion: "occupied" });
    expect(c.visiblePlants[0].available).toBe(6);
    c.visiblePlantWork = []; const reconsidered = fresh(); foodPlanningChoice(c, reconsidered, "F", 12);
    expect(reconsidered.foodPlanning!.evaluation!.candidates.find((p) => p.siteId === "berry")).toMatchObject({ feasible: true });
  });
  it("compares usable meal yield so repeated single-meal trips do not always defeat a small safe reserve", () => {
    const c = context(), m = fresh(); c.hunger = 1;
    c.visiblePlants.push({ id: "near-herb", species: "herb", stage: "ripe", available: 3,
      siteId: "near-herb", cell: { x: c.cell.x, y: c.cell.y + 1 } });
    expect(foodPlanningChoice(c, m, "F", 12)!.attempt).toMatchObject({ kind: "travel", siteId: "berry" });
    const selected = m.foodPlanning!.evaluation!.candidates[m.foodPlanning!.evaluation!.selected!];
    expect(selected).toMatchObject({ meals: 3, feasible: true });
    c.needs!.sleepDebt = 22;
    expect(foodPlanningChoice(c, fresh(), "F", 12)!.attempt).toEqual({ kind: "sleep" });
  });
  it("uses a reproducible individual order for equivalent food cells rather than sending everyone to one tie winner", () => {
    const c = context(); c.visiblePlants = [berry, { ...berry, id: "equal", siteId: "equal" }];
    const actors = ["S", "F", "C", "B1", "B2"];
    const choices = actors.map((id) => foodPlanningChoice(c, fresh(), id, 12)!.attempt);
    expect(new Set(choices.map((a) => a?.kind === "travel" ? a.siteId : undefined)).size).toBeGreaterThan(1);
    expect(actors.map((id) => foodPlanningChoice(c, fresh(), id, 12)!.attempt)).toEqual(choices);
  });
  it("does not count food that will spoil before demand, or raw grain, as a usable reserve", () => {
    const c = context();
    c.ownFoodLots = [{ id: "bread", species: "grain", product: "bread", quantity: 1, mealQuantity: 1, offered: false, expiresDay: 2 },
      { id: "raw", species: "grain", product: "grain", quantity: 20, mealQuantity: 1, offered: false }];
    c.edibleMeals = 1; c.needs!.needClockHours = 4;
    expect(usableCarriedMeals(c, 24)).toBe(1); expect(usableCarriedMeals(c, 25)).toBe(0);
    expect(foodNeedAt(c, 12)).toBe(32);
    c.needs!.needClockHours = 12; c.ownFoodLots![0].expiresDay = 1;
    expect(foodPlanningChoice(c, fresh(), "F", 12)!.attempt).toMatchObject({ kind: "travel" });
  });
  it("remembers only observed home food, discards expired expectations and rechecks arrival", () => {
    const c = context(), m = fresh(); c.homeStorage!.items = [{ id: "stored-bread", kind: "bread", quantity: 2, expiresDay: 4 }];
    observeHomeFood(c, m, 10);
    c.siteId = "berry"; c.cell = berry.cell; c.homeStorage = undefined; c.visiblePlants = [];
    c.needs!.sheltered = false;
    expect(foodPlanningChoice(c, m, "F", 12)!.attempt).toMatchObject({ kind: "travel", siteId: "home_F" });
    expect(m.foodPlanning!.evaluation!.candidates[0].source).toBe("remembered");
    m.foodPlanning!.home!.items[0].expiresDay = 1;
    expect(foodPlanningChoice(c, m, "F", 12)).toBeUndefined();
    c.siteId = "home_F"; c.homeStorage = { cash: 0, items: [] }; observeHomeFood(c, m, 13);
    expect(m.foodPlanning!.home!.items).toEqual([]); checkAnticipationMemory(m, 13);
  });
  it("sleeps before setting out when the whole food journey would exceed the waking window", () => {
    const c = context(), m = fresh(); c.needs!.sleepDebt = 17;
    expect(foodPlanningChoice(c, m, "F", 12)!.attempt).toEqual({ kind: "sleep" });
    expect(m.foodPlanning!.evaluation!.candidates[0]).toMatchObject({ feasible: false, exclusion: "body" });
    c.needs!.sleepDebt = 2; c.ownFoodLots = [{ id: "good", quantity: 1, species: "wild_berry", mealQuantity: 1, offered: false, expiresDay: 4 }];
    expect(foodPlanningChoice(c, m, "F", 12)).toBeUndefined();
  });
  it("distinguishes an unsuccessful grain sale from a later attempt to obtain food", () => {
    const c = context(), m = fresh(); c.siteId = "market"; beginFoodMarketVisit(m, c, 10, "grain-sale");
    c.siteId = "home_F"; observeFoodMarketVisit(c, m, [], 11);
    expect(m.foodMarket).toMatchObject({ retryAt: 35, retryPurpose: "grain-sale" });
    c.ownCash = 2; c.visiblePlants = []; m.predictions = { version: 1, nextId: 1, pending: [], recent: [], knownSites: { market: { x: 28, y: 6 } },
      totals: { predicted: 0, completed: 0, excluded: 0, scored: 0, absoluteError: 0, signedError: 0, squaredError: 0 } };
    expect(foodPlanningChoice(c, m, "F", 12)!.attempt).toMatchObject({ kind: "travel", siteId: "market" });
    expect(m.foodPlanning!.evaluation!.candidates[0]).toMatchObject({ source: "unconfirmed", meals: 0 });
    m.foodMarket!.retryPurpose = "food-buy"; expect(foodPlanningChoice(c, m, "F", 12)).toBeUndefined();
  });
  it("compares an exposed meal decision with taking the same food to shelter", () => {
    const c = context(); c.siteId = "berry"; c.cell = berry.cell; c.edibleMeals = 2; c.hunger = 1; c.cold = 7;
    c.needs!.sheltered = false; c.needs!.temperature = 9;
    expect(mealShelterChoice(c, fresh(), 4)!.attempt).toMatchObject({ kind: "travel", siteId: "home_F" });
    c.needs!.temperature = 22; expect(mealShelterChoice(c, fresh(), 12)).toBeUndefined();
  });
  it("does not interpret recovery at the body's lower bound as a slow recovery rate", () => {
    const c = context(), m = fresh(); c.edibleMeals = 1;
    c.ownFoodLots = [{ id: "meal", species: "wild_berry", quantity: 1, mealQuantity: 1, offered: false }];
    m.last = { at: 4, site: "home_F", cold: 4, energy: 20, debt: 8, sheltered: true, phase: "night", temperature: 20 };
    m.lastAction = "sleep"; c.needs!.sleepDebt = 0; c.cold = 0;
    const next = decide(c, m, 12).subjectiveUpdate!.anticipation!;
    expect(next.sleepRecovery).toEqual({}); expect(next.coldRates).toEqual({});
  });
  it("does not treat the baker's money as an already available ingredient", () => {
    const c = context(); c.foodMarket!.bakingSkill = 1; c.ownCash = 8; c.grainStores = [];
    expect(foodPlanningChoice(c, fresh(), "F", 12)!.attempt).toMatchObject({ kind: "travel", siteId: "berry" });
    c.visibleFoodOffers = [{ id: "actual-grain", sellerId: "B1", product: "grain", species: "grain", quantity: 5, price: 2 }];
    expect(foodPlanningChoice(c, fresh(), "F", 12)).toBeUndefined();
  });
  it("keeps cold-air experience out of warm-air forecasts rather than learning a false daytime drift", () => {
    const m = fresh(); m.foodPlanning = {};
    m.coldRates["outside:day:cool"] = { count: 10, mean: 2, m2: 0 };
    for (let at = 13; at <= 16; at++) m.temperatures[String(at)] = { count: 10, mean: 22, m2: 0 };
    expect(forecastCold(m, 0, 12, 4, false).peak).toBe(0);
    for (let at = 13; at <= 16; at++) m.temperatures[String(at)].mean = 9;
    expect(forecastCold(m, 0, 12, 4, false).peak).toBeGreaterThanOrEqual(8);
  });
  it("propagates uncertainty through recovery instead of adding all past uncertainty to the final cold", () => {
    const m = fresh(); m.foodPlanning = {};
    m.coldRates["outside:day:warm"] = { count: 1, mean: -2, m2: 0 };
    for (let at = 13; at <= 18; at++) m.temperatures[String(at)] = { count: 1, mean: 22, m2: 0 };
    const forecast = forecastCold(m, 0, 12, 6, false);
    expect(forecast.uncertainty).toBe(6); expect(forecast.peak).toBe(0);
    const c = context(); expect(foodPlanningChoice(c, m, "F", 12)!.attempt).toMatchObject({ kind: "travel", siteId: "berry" });
  });
  it("stores unneeded cargo before an edible-food journey instead of waiting forever on its loaded effort", () => {
    const c = context(); c.carriedInventory = [{ id: "heavy-grain", kind: "grain", quantity: 4, mass: 8, edible: false }];
    c.carriedMass = 12;
    c.grainStores = [{ id: "home-granary", siteId: c.siteId, grain: 0, capacity: 64, lots: [] }];
    expect(prepareFoodJourney(c, 12)!.attempt).toEqual({ kind: "store_grain", lotId: "heavy-grain", storeId: "home-granary" });
    expect(decide(c, fresh(), 12).attempts[0]).toMatchObject({ kind: "store_grain" });
    c.foodMarket!.bakingSkill = 1; expect(prepareFoodJourney(c, 12)).toBeUndefined();
    c.foodMarket!.bakingSkill = 0;
    c.carriedInventory = [{ id: "other-cargo", kind: "wood", quantity: 4, mass: 4, edible: false }];
    expect(prepareFoodJourney(c, 12)!.attempt).toMatchObject({ kind: "store_home", objectId: "other-cargo" });
  });
  it("does not let an unsafe unconfirmed market check suppress personally remembered food exploration", () => {
    const c = context(), m = fresh(); c.ownCash = 2; c.visiblePlants = []; c.needs!.sleepDebt = 16;
    m.predictions = { version: 1, nextId: 1, pending: [], recent: [], knownSites: { market: { x: 1, y: 1 } },
      totals: { predicted: 0, completed: 0, excluded: 0, scored: 0, absoluteError: 0, signedError: 0, squaredError: 0 } };
    expect(foodPlanningChoice(c, m, "F", 12)).toBeUndefined();
    expect(m.foodPlanning!.evaluation!.candidates[0]).toMatchObject({ source: "unconfirmed", feasible: false });
  });
  it("waits for a viable remembered-food journey instead of repeating cold departures from shelter", () => {
    const c = context(), m = fresh(); c.visiblePlants = []; c.hunger = 3; c.cold = 4;
    c.needs!.sleepDebt = 3; c.needs!.temperature = 20;
    m.foraging = { places: { berry: { siteId: "berry", x: 33, y: 7, seenAt: 1, available: 6, ripe: true, checkAt: 1 } } };
    m.foodPlanning = {};
    for (let h = 0; h < 24; h++) m.temperatures[String(h)] = { count: 2, mean: h >= 9 && h < 19 ? 22 : 9, m2: 0 };
    const night = decide(c, m, 3);
    expect(night.attempts).toEqual([]);
    expect(night.subjectiveUpdate!.anticipation!.foodPlanning!.evaluation!.candidates[0]).toMatchObject({
      kind: "explore", source: "remembered", meals: 0, feasible: false, exclusion: "body" });
    c.cold = 0;
    const day = decide(c, night.subjectiveUpdate!.anticipation!, 12);
    expect(day.attempts[0]).toMatchObject({ kind: "travel", siteId: "berry" });
  });
  it("exposes only gathering work within observation range and home contents only while at home", () => {
    const w = newVillageWorld(240924, foodPlanning90V1);
    const choices: VillageContext[] = [];
    const idle: VillageModel = { decide(i) {
      if (i.actorId === "F") choices.push(structuredClone(i.knownContext));
      return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } };
    } };
    queueVillageCommand(w, { id: "C-go", actorId: "C", at: 1, attempt: { kind: "travel", siteId: "berry_patch_1" } });
    queueVillageCommand(w, { id: "F-home", actorId: "F", at: 1, attempt: { kind: "travel", siteId: "home_F" } });
    queueVillageCommand(w, { id: "C-gather", actorId: "C", at: 2, attempt: { kind: "gather_plant", plantId: "wild_berry", quantity: 3 } });
    advanceVillageWorld(w, 3, idle);
    expect(Object.values(w.processes).some((p) => p.actorId === "C" && p.kind === "gather_plant")).toBe(true);
    expect(choices.at(-1)!.visiblePlantWork).toEqual([]);
    const near = newVillageWorld(240924, foodPlanning90V1);
    queueVillageCommand(near, { id: "F-go", actorId: "F", at: 1, attempt: { kind: "travel", siteId: "berry_patch_1" } });
    queueVillageCommand(near, { id: "C-go", actorId: "C", at: 1, attempt: { kind: "travel", siteId: "berry_patch_1" } });
    queueVillageCommand(near, { id: "C-gather", actorId: "C", at: 2, attempt: { kind: "gather_plant", plantId: "wild_berry", quantity: 3 } });
    advanceVillageWorld(near, 3, idle);
    expect(choices.at(-1)!.visiblePlantWork).toContainEqual({ actorId: "C", plantId: "wild_berry", quantity: 3 });
    expect(choices.at(-1)!.homeStorage).toBeUndefined();
  });
  it("recomputes every decision and preserves planning through a save and resume", () => {
    const w = newVillageWorld(240924, foodPlanning90V1);
    advanceVillageWorld(w, 120, learningNeedsVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 120, learningNeedsVillageModel); advanceVillageWorld(resumed, 120, learningNeedsVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
    for (const d of w.decisions) expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
      knownContext: d.knownContext, subjectiveState: d.subjectiveBefore, stimuli: d.stimuli })).toEqual(d.response);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  }, 120000);
  it("replays 90 days with conserved food and money and actual individual meals", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-food-planning-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(w.fixture.foodPlanning).toBe(true);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0)).toBe(26);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) expect(w.people[id].meals).toBe(90);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      const times = w.events.filter((e) => e.kind === "ate" && e.actors.includes(id)).map((e) => e.hour);
      expect(Math.max(...times.slice(1).map((at, index) => at - times[index]))).toBeLessThan(60);
    }
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
  }, 240000);
});
