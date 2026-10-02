import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { foodJourneys90V1 } from "../fixtures/land-economy-wide";
import { checkAnticipationMemory, type AnticipationMemory } from "../packages/ai/anticipatory-needs";
import type { VillageContext, VillageMemory, VillageModel, VillageStimulus } from "../packages/ai/autonomous-world";
import { cultivationChoice, localFoodTransaction } from "../packages/ai/food-journeys";
import { beginFoodMarketVisit, foodMarketChoice, observeFoodMarketVisit } from "../packages/ai/food-market";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

const fresh = (): AnticipationMemory => ({ experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
  sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 } });
function context() {
  let c: VillageContext | undefined;
  const idle: VillageModel = { decide(i) {
    if (i.actorId === "F") c = structuredClone(i.knownContext);
    return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } };
  } };
  advanceVillageWorld(newVillageWorld(240924, foodJourneys90V1), 1, idle);
  Object.assign(c!, { siteId: "home_F", cell: c!.needs!.home.cell, energy: 26, cold: 0, hunger: 0,
    edibleMeals: 2, grainCarried: 1, carriedMass: 2, ownCash: 4,
    ownFoodLots: [{ id: "sowing-grain", quantity: 1, species: "grain", product: "grain", mealQuantity: 1, offered: false }],
    visibleFoodOffers: [] });
  c!.needs = { ...c!.needs!, sleepDebt: 0, mealHours: 1, needClockHours: 1, sheltered: true, temperature: 32 };
  return c!;
}
function decide(c: VillageContext, m: AnticipationMemory, at = 12) {
  const state: VillageMemory = { day: c.day, done: [], beliefs: { foodBid: 1, foodRetail: 1, carrierFee: 1, woodPrice: 1 }, anticipation: m };
  return learningNeedsVillageModel.decide({ actorId: "F", at, knownContext: c, subjectiveState: state, stimuli: [] });
}
const crop = { id: "grain_plot", siteId: "grain_plot", cell: { x: 33, y: 7 }, ownerId: "F" as const,
  farmId: "farm_F", species: "grain", stage: "tilled", available: 0 };

describe("food journeys and market interruptions v18", () => {
  it("takes sowing grain to the selected crop instead of treating it as sale surplus", () => {
    const c = context(), m = fresh();
    c.visiblePlants = [crop]; c.grainStores = [{ id: "store", siteId: "home_F", capacity: 64, grain: 20, lots: [{ id: "stored", quantity: 20 }] }];
    m.cropPlan = { plantId: crop.id, siteId: crop.siteId, cell: crop.cell, stage: "tilled", observedAt: 10 };
    const response = decide(c, m);
    expect(response.attempts[0]).toMatchObject({ kind: "travel", siteId: crop.siteId });
    const arrived = { ...c, siteId: crop.siteId, cell: crop.cell, homeStorage: undefined, needs: { ...c.needs!, sheltered: false, temperature: 22 } };
    expect(decide(arrived, response.subjectiveUpdate!.anticipation!, 13).attempts[0]).toMatchObject({ kind: "sow_plot", plantId: crop.id });
    c.grainCarried = 0; c.ownFoodLots = [];
    expect(decide(c, m).attempts[0]).toMatchObject({ kind: "load_grain", lotId: "stored", quantity: 1 });
  });
  it("rechecks remembered crops on arrival and allows food urgency to interrupt cultivation", () => {
    const c = context(), m = fresh();
    m.cropPlan = { plantId: crop.id, siteId: crop.siteId, cell: crop.cell, stage: "tilled", observedAt: 10 };
    c.visiblePlants = [];
    expect(cultivationChoice(c, m, "F")!.attempt).toMatchObject({ kind: "travel", siteId: crop.siteId });
    c.edibleMeals = 0; c.hunger = 1;
    expect(cultivationChoice(c, m, "F")).toBeUndefined(); expect(m.cropPlan).toBeDefined();
    c.siteId = crop.siteId; c.visiblePlants = [{ ...crop, stage: "growing" }];
    expect(cultivationChoice(c, m, "F")).toBeUndefined(); expect(m.cropPlan).toBeUndefined();
  });
  it("retains unsold visits through shelter departures and increases the retry interval", () => {
    const c = context(), m = fresh(); c.siteId = "market"; c.ownFoodLots![0].offered = true;
    beginFoodMarketVisit(m, c, 100, "grain-sale");
    observeFoodMarketVisit(c, m, [], 102);
    expect(m.foodMarket!.visit!.arrivedAt).toBe(100);
    c.siteId = "transit_F";
    observeFoodMarketVisit(c, m, [], 103);
    expect(m.foodMarket).toMatchObject({ failures: 1, retryAt: 127 });
    expect(m.foodMarket!.visit).toBeUndefined();
    c.grainStores = [{ id: "store", siteId: "home_F", capacity: 64, grain: 20, lots: [] }];
    expect(foodMarketChoice(c, m, "F", 104)).toBeUndefined();
    c.siteId = "market"; beginFoodMarketVisit(m, c, 128, "grain-sale");
    c.siteId = "home_F"; observeFoodMarketVisit(c, m, [], 130);
    expect(m.foodMarket).toMatchObject({ failures: 2, retryAt: 178 });
    checkAnticipationMemory(m, 130);
  });
  it("resets failed visits only after a delivered real sale, ignoring future results", () => {
    const c = context(), m = fresh(); c.siteId = "market";
    m.foodMarket = { retryAt: 100, failures: 3 };
    beginFoodMarketVisit(m, c, 100, "grain-sale");
    const sale: VillageStimulus = { id: "sale", kind: "result", action: "post_surplus_offer", success: true,
      saleRevenue: 2, occurredAt: 101, receivedAt: 102, causeEventIds: ["sale-event"] };
    observeFoodMarketVisit(c, m, [sale], 101); expect(m.foodMarket!.visit!.fulfilled).toBe(false);
    c.siteId = "transit_F"; observeFoodMarketVisit(c, m, [sale], 102);
    expect(m.foodMarket).toMatchObject({ failures: 0, retryAt: 102 });
  });
  it("keeps the baker's separate ingredient waiting clock outside the farmer visit policy", () => {
    const c = context(), m = fresh(); c.foodMarket!.bakingSkill = 1;
    c.grainCarried = 0; c.ownFoodLots = []; c.grainStores = []; c.edibleMeals = 0;
    c.siteId = "market";
    expect(foodMarketChoice(c, m, "F", 100)!.reason).toBe("wait briefly for observed baking ingredients");
    expect(m.foodMarket!.visitStartedAt).toBe(100);
    c.siteId = "home_F";
    foodMarketChoice(c, m, "F", 101);
    expect(m.foodMarket!.visitStartedAt).toBeUndefined(); expect(m.foodMarket!.visit).toBeUndefined();
    c.siteId = "market";
    expect(foodMarketChoice(c, m, "F", 104)!.reason).toBe("wait briefly for observed baking ingredients");
    expect(m.foodMarket!.visitStartedAt).toBe(104);
  });
  it("buys observed bread before preventive shelter return when the extra decision hour is safe", () => {
    const c = context(); c.siteId = "market"; c.cell = { x: 4, y: 12 }; c.edibleMeals = 0;
    c.visibleFoodOffers = [{ id: "bread", sellerId: "S", product: "bread", species: "grain", quantity: 1, price: 1 }];
    c.needs = { ...c.needs!, home: { siteId: "home_F", cell: { x: 5, y: 12 } }, sleepDebt: 14, sheltered: false, temperature: 8 };
    const m = fresh(); m.goal = { kind: "sleep", siteId: "home_F", startedAt: 21 };
    expect(decide(c, m, 22).attempts[0]).toMatchObject({ kind: "buy_surplus", offerId: "bread" });
    c.needs.sleepDebt = 18;
    expect(decide(c, m, 22).attempts[0]).toMatchObject({ kind: "travel", siteId: "home_F" });
    c.cold = 8;
    expect(localFoodTransaction(c, m, "F", 22)).toBeUndefined();
    c.cold = 0; c.needs.sleepDebt = 0;
    expect(localFoodTransaction(c, m, "S", 12)).toBeUndefined();
    c.edibleMeals = 2; expect(localFoodTransaction(c, m, "F", 12)).toBeUndefined();
  });
  it("uses the known journey horizon for departure and does not count a deferred proposal as a visit", () => {
    const c = context(), m = fresh(); c.visiblePlants = [crop];
    m.cropPlan = { plantId: crop.id, siteId: crop.siteId, cell: crop.cell, stage: "tilled", observedAt: 16 };
    expect(decide(c, m, 17).attempts[0]).toMatchObject({ kind: "travel", siteId: crop.siteId });
    c.edibleMeals = 1; c.grainCarried = 0; c.ownFoodLots = []; c.ownFarm = undefined; c.visiblePlants = []; delete m.cropPlan;
    const response = decide(c, m, 17);
    expect(response.attempts).toHaveLength(0); expect(response.subjectiveUpdate!.anticipation!.foodMarket!.visit).toBeUndefined();
  });
  it("offers transported surplus before preventive return without offering the grain reserved for sowing", () => {
    const c = context(), m = fresh(); c.siteId = "market"; c.cell = { x: 4, y: 12 }; c.grainCarried = 5;
    c.ownFoodLots![0].quantity = 5;
    c.needs = { ...c.needs!, home: { siteId: "home_F", cell: { x: 5, y: 12 } }, sleepDebt: 14, sheltered: false, temperature: 8 };
    c.grainStores = [{ id: "home", siteId: "home_F", grain: 20, capacity: 64, lots: [] }];
    m.goal = { kind: "sleep", siteId: "home_F", startedAt: 21 };
    expect(decide(c, m, 22).attempts[0]).toMatchObject({ kind: "post_surplus_offer", lotId: "sowing-grain", quantity: 5 });
    m.cropPlan = { plantId: crop.id, siteId: crop.siteId, cell: crop.cell, stage: "tilled", observedAt: 21 };
    expect(localFoodTransaction(c, m, "F", 22)!.attempt).toMatchObject({ kind: "post_surplus_offer", quantity: 4 });
    c.needs.sleepDebt = 18;
    expect(decide(c, m, 22).attempts[0]).toMatchObject({ kind: "travel", siteId: "home_F" });
  });
  it("preserves the crop and visit memory across save/resume and deterministically replays the world", () => {
    const w = newVillageWorld(240924, foodJourneys90V1);
    advanceVillageWorld(w, 117, learningNeedsVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 123, learningNeedsVillageModel); advanceVillageWorld(resumed, 123, learningNeedsVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
    for (const d of w.decisions) expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
      stimuli: structuredClone(d.stimuli), knownContext: structuredClone(d.knownContext), subjectiveState: structuredClone(d.subjectiveBefore) })).toEqual(d.response);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  }, 120000);
  it("replays the ninety day archive with actual trades, inedible grain and conserved money", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-food-journeys-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(r.rulesetId).toBe("autonomous-village-food-journeys-v18"); expect(villageHash(w)).toBe(r.finalStateHash);
    const trades = w.events.filter((e) => e.kind === "surplus_sold");
    expect(trades.some((e) => e.data.product === "grain" && e.actors[0] === "F")).toBe(true);
    expect(trades.some((e) => e.data.product === "bread" && e.actors[1] === "F")).toBe(true);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0)).toBe(26);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) expect(w.people[id].meals).toBe(90);
  }, 240000);
});
