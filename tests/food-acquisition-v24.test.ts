import { expect, it } from "vitest";
import { foodAcquisition90V1, mortality90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageId, VillageModel } from "../packages/ai/autonomous-world";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { acquisitionCandidates, acquisitionChoice, bindAcquisitionAttempt, observeAcquisition } from "../packages/ai/food-acquisition";
import { effortDecision } from "../packages/ai/effort-choice";
import { actionObservation } from "../packages/ai/action-learning";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";
import { VillageStatusReplay } from "../apps/web/village-status-replay";
import { inspectVillageFoodSupply } from "../packages/sim/village-food-audit";
const idle: VillageModel = { decide(i) { return { attempts: [], wait: { at: i.at + 1 }, subjectiveUpdate: i.subjectiveState }; } };
function personal() {
  const w = newVillageWorld(240924, mortality90V1); advanceVillageWorld(w, 12, learningNeedsVillageModel);
  const d = w.decisions.find((d) => d.actorId === "F" && d.hour === 12)!;
  const c = structuredClone(d.knownContext), memory = structuredClone(d.response.subjectiveUpdate!), m = memory.anticipation!;
  Object.assign(c, { foodAcquisition: true, siteId: "market", cell: { x: 5, y: 12 }, energy: 26, cold: 0, hunger: 1,
    carriedMass: 0, edibleMeals: 0, grainCarried: 0, ownFoodLots: [], carriedInventory: [], ownGroundItems: [],
    activeAction: undefined, homeStorage: undefined, ownCash: 0, visiblePlants: [], visibleFoodOffers: [], grainStores: [], fieldGrainStores: [] });
  c.knownLandmarks = { market: c.cell, grove: { x: 7, y: 12 } };
  c.needs = { ...c.needs!, sheltered: false, temperature: 22, home: { siteId: "home_F", cell: { x: 6, y: 12 } },
    sleep: { ...c.needs!.sleep!, minute: 720, sleepiness: 0, ownSleeps: [{ from: 300, to: 660 }] } };
  c.bulkTransport = { ...c.bulkTransport!, bagFreeMass: 20 };
  c.effortBody = { ...c.effortBody!, fatigue: 0, nutritionNeed: .2, loadDiscomfort: 0, digesting: false };
  delete m.effort!.acquisition; delete m.effort!.goal; delete m.effort!.pending; delete m.effort!.trade.offer; delete m.cropPlan;
  m.effort!.trade.retryAt = 0; m.travelTimes = {}; m.foraging = { places: {} }; m.foodPlanning = {};
  m.sleep!.pressure = .1; m.sleep!.retryAt = 0; m.last = { at: 12, site: "market", cold: 0, energy: 26, debt: 0, sheltered: false, phase: "day", temperature: 22 };
  m.coldRates = {}; m.temperatures = {};
  observeAcquisition(c, m, [], 12);
  return { c, memory, m };
}
const bread = { id: "real-bread-offer", sellerId: "S" as const, product: "bread" as const, species: "grain", quantity: 1, price: 1, expiresDay: 4 };
function command(w: VillageWorld, actorId: VillageId, attempt: VillageAttempt) {
  queueVillageCommand(w, { id: `${actorId}:${w.hour}`, actorId, at: w.hour + 1, attempt });
  advanceVillageWorld(w, 1, idle);
  while (w.people[actorId].activeProcessId) advanceVillageWorld(w, 1, idle);
}

it("compares depleted gathering, stored-grain sale and purchase with no carried meals", () => {
  const { c, memory, m } = personal();
  c.visibleFoodOffers = [bread]; c.visiblePlants = [{ id: "depleted", species: "herb", stage: "regrowing", available: 0, siteId: "grove", cell: { x: 7, y: 12 } }];
  c.grainStores = [{ id: "stock", siteId: "market", grain: 20, capacity: 64, lots: [{ id: "grain", quantity: 20 }] }];
  observeAcquisition(c, m, [], 12);
  const response = effortDecision(c, memory, "F", 12, []), a = m.effort!.acquisition!;
  expect(response.attempts[0]).toMatchObject({ kind: "load_grain", lotId: "grain" });
  expect(a.candidates.some((p) => p.kind === "gather" && p.exclusion === "not-ripe")).toBe(true);
  expect(a.candidates.some((p) => p.kind === "buy" && p.exclusion === "cash")).toBe(true);
  expect(a.candidates.some((p) => p.kind === "sale" && p.feasible)).toBe(true);
  const selected = a.candidates.find((p) => p.id === a.selected)!;
  expect(selected.absorbedAt).toBe(selected.eatAt + 2); expect(selected.eatAt).toBeGreaterThan(selected.acquiredAt);
  expect(selected.hours).toBeGreaterThanOrEqual(selected.absorbedAt - 12);
  expect(selected.probability).toBeLessThan(1); expect(selected.fallback).toContain("unsold");
});

it("uses existing cash directly and favors nearby low effort gathering over an uncertain market trip", () => {
  const { c, memory, m } = personal(); c.ownCash = 1; c.visibleFoodOffers = [bread];
  expect(effortDecision(c, memory, "F", 12, []).attempts[0]).toEqual({ kind: "buy_surplus", offerId: bread.id });
  delete m.effort!.acquisition!.plan;
  c.siteId = "grove"; c.cell = { x: 7, y: 12 }; c.visibleFoodOffers = [];
  c.visiblePlants = [{ id: "berries", species: "wild_berry", stage: "ripe", available: 3, siteId: c.siteId, cell: c.cell }];
  const choice = effortDecision(c, memory, "F", 12, []);
  expect(choice.attempts[0]).toMatchObject({ kind: "gather_plant", plantId: "berries" });
  expect(m.effort!.acquisition!.candidates.some((p) => p.kind === "buy" && p.source === "remembered")).toBe(true);
});

it("treats remote offers as uncertain and refuses stale, occupied, over-capacity and late-absorption food", () => {
  const { c, m } = personal(); c.ownCash = 1; c.visibleFoodOffers = [bread]; observeAcquisition(c, m, [], 12);
  c.siteId = "grove"; c.visibleFoodOffers = [];
  const remembered = acquisitionCandidates(c, m, "F", 12).find((p) => p.kind === "buy")!;
  expect(remembered.source).toBe("remembered"); expect(remembered.probability).toBeLessThan(1);
  expect(remembered.attempt).toEqual({ kind: "travel", siteId: "market" });
  c.visiblePlants = [{ id: "herbs", species: "herb", stage: "ripe", available: 4, siteId: c.siteId, cell: c.cell }];
  c.visiblePlantWork = [{ actorId: "B1", plantId: "herbs", quantity: 2 }];
  expect(acquisitionCandidates(c, m, "F", 12).filter((p) => p.kind === "gather").every((p) => p.exclusion === "occupied")).toBe(true);
  c.visiblePlantWork = []; c.bulkTransport!.bagFreeMass = 1;
  expect(acquisitionCandidates(c, m, "F", 12).find((p) => p.kind === "gather")!.exclusion).toBe("capacity");
  c.bulkTransport!.bagFreeMass = 20; c.effortBody!.nutritionNeed = .95;
  expect(acquisitionCandidates(c, m, "F", 12).find((p) => p.kind === "gather")!.exclusion).toBe("body-or-absorption-deadline");
  c.siteId = "market"; c.visibleFoodOffers = [{ ...bread, expiresDay: 1 }];
  expect(acquisitionCandidates(c, m, "F", 12).find((p) => p.kind === "buy")!.exclusion).toBe("no-local-food-offer");
});

it("keeps depleted exploration independent of market retry and stops travel at the personal deadline", () => {
  const { c, m } = personal(); c.knownLandmarks!.orchard = { x: 6, y: 12 };
  const explore = acquisitionChoice(c, m, "F", 12)!;
  expect(m.effort!.acquisition!.plan!.kind).toBe("explore");
  const destination = (explore.attempt as { kind: "travel"; siteId: string }).siteId;
  c.siteId = destination; c.cell = c.knownLandmarks![destination];
  acquisitionChoice(c, m, "F", 13);
  expect(m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("depleted");
  expect(m.effort!.acquisition!.retryAt).toBe(0);
  const p = personal(); p.c.ownCash = 1; p.c.visibleFoodOffers = [bread]; observeAcquisition(p.c, p.m, [], 12);
  p.c.siteId = "grove"; p.c.visibleFoodOffers = []; acquisitionChoice(p.c, p.m, "F", 12);
  const deadline = p.m.effort!.acquisition!.plan!.deadline; p.c.activeAction = "travel";
  const stopped = effortDecision(p.c, p.memory, "F", deadline, []);
  expect(stopped.attempts).toEqual([{ kind: "interrupt_action" }]);
  expect(p.m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("timeout");
});

it("records no buyer separately from no food and censors fatigue or shelter interruptions", () => {
  const { c, memory, m } = personal(); c.visibleFoodOffers = [bread];
  m.effort!.trade.successes = 9;
  c.grainStores = [{ id: "stock", siteId: "market", grain: 20, capacity: 64, lots: [{ id: "grain", quantity: 20 }] }];
  const choice = acquisitionChoice(c, m, "F", 12)!; expect(choice.attempt!.kind).toBe("load_grain");
  c.ownFoodLots = [{ id: "cargo", product: "grain", species: "grain", quantity: 3, mealQuantity: 1, offered: false }];
  c.grainCarried = 3;
  const post = acquisitionChoice(c, m, "F", 13)!; expect(post.attempt!.kind).toBe("post_surplus_offer");
  m.effort!.trade.offer = { id: "offer", at: 13, deadline: 15 };
  const withdraw = acquisitionChoice(c, m, "F", 15)!;
  expect(withdraw.attempt).toEqual({ kind: "withdraw_surplus_offer", offerId: "offer" });
  expect(m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("no-buyer"); expect(m.effort!.trade.failures).toBe(1);
  const q = personal(); q.c.ownCash = 1; q.c.visibleFoodOffers = [bread]; observeAcquisition(q.c, q.m, [], 12);
  q.c.siteId = "grove"; q.c.visibleFoodOffers = [];
  acquisitionChoice(q.c, q.m, "F", 12); q.c.siteId = "market";
  acquisitionChoice(q.c, q.m, "F", 13); acquisitionChoice(q.c, q.m, "F", 15);
  expect(q.m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("no-food");
  expect(q.m.effort!.acquisition!.market.failures).toBe(1);
  const f = personal(); f.c.ownCash = 1; f.c.visibleFoodOffers = [bread]; observeAcquisition(f.c, f.m, [], 12); f.c.siteId = "grove"; f.c.visibleFoodOffers = [];
  acquisitionChoice(f.c, f.m, "F", 12); f.c.effortBody!.fatigue = .6;
  effortDecision(f.c, f.memory, "F", 13, []);
  expect(f.m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("fatigue");
  expect(f.m.effort!.acquisition!.market.failures).toBe(0);
  const h = personal(); h.c.ownCash = 1; h.c.visibleFoodOffers = [bread]; observeAcquisition(h.c, h.m, [], 12); h.c.siteId = "grove"; h.c.visibleFoodOffers = []; acquisitionChoice(h.c, h.m, "F", 12);
  h.c.cold = 6; effortDecision(h.c, h.memory, "F", 13, []);
  expect(h.m.effort!.acquisition!.outcomes.at(-1)!.outcome).toBe("shelter");
});

it("updates purchasing belief only from the matching delivered outcome and preserves a completed sale before buying", () => {
  const { c, m } = personal(); c.ownCash = 1; c.visibleFoodOffers = [bread];
  acquisitionChoice(c, m, "F", 12); const action: VillageAttempt = { kind: "buy_surplus", offerId: bread.id };
  bindAcquisitionAttempt(m, action, "purchase-prediction", 12);
  const outcome = { id: "result", kind: "result" as const, action: "buy_surplus" as const, occurredAt: 12, receivedAt: 13, causeEventIds: ["physical-trade"],
    experience: { phase: "completed" as const, predictionId: "purchase-prediction", startedAt: 12, elapsedHours: 0, attemptEventId: "attempt", before: actionObservation(c), after: actionObservation(c) } };
  observeAcquisition(c, m, [outcome], 12); expect(m.effort!.acquisition!.market.successes).toBe(0);
  observeAcquisition(c, m, [{ ...outcome, experience: { ...outcome.experience, predictionId: "unrelated" } }], 13);
  expect(m.effort!.acquisition!.market.successes).toBe(0);
  observeAcquisition(c, m, [outcome], 13); expect(m.effort!.acquisition!.market.successes).toBe(1);
  expect(m.effort!.acquisition!.outcomes.at(-1)).toMatchObject({ outcome: "acquired", evidenceIds: ["physical-trade"] });
  const sale = personal(); sale.c.visibleFoodOffers = [bread];
  sale.m.effort!.trade.successes = 9;
  sale.c.grainStores = [{ id: "stock", siteId: "market", grain: 20, capacity: 64, lots: [{ id: "stored", quantity: 20 }] }];
  acquisitionChoice(sale.c, sale.m, "F", 12);
  sale.c.ownFoodLots = [{ id: "loaded", product: "grain", species: "grain", quantity: 3, mealQuantity: 1, offered: false }];
  acquisitionChoice(sale.c, sale.m, "F", 13);
  observeAcquisition(sale.c, sale.m, [{ id: "post-result", kind: "result", occurredAt: 13, receivedAt: 14,
    causeEventIds: ["posted"], offerChange: { id: "own-offer", valid: true } }], 14);
  observeAcquisition(sale.c, sale.m, [{ id: "sale-result", kind: "result", occurredAt: 14, receivedAt: 15,
    causeEventIds: ["sold"], trade: { offerId: "own-offer", offeredAt: 13, soldAt: 14, quantity: 1, revenue: 1 } }], 15);
  expect(sale.m.effort!.acquisition!.plan).toMatchObject({ sold: true, stage: "buy" });
  sale.c.ownCash = 1;
  expect(acquisitionChoice(sale.c, sale.m, "F", 15)!.attempt).toEqual({ kind: "buy_surplus", offerId: bread.id });
  expect(sale.m.effort!.acquisition!.market.successes).toBe(0);
});

it("includes a remote owned stock with zero meals and retains sowing grain as a separate lot", () => {
  const { c, m } = personal(); c.siteId = "home_F"; c.cell = c.needs!.home.cell;
  c.visibleFoodOffers = []; m.effort!.acquisition!.market = { successes: 8, failures: 0, seenAt: 11, offers: [bread] };
  c.grainStores = [{ id: "field", siteId: "grain_plot", grain: 20, capacity: 64, lots: [{ id: "stored", quantity: 20 }] }];
  c.fieldGrainStores = [{ id: "field", siteId: "grain_plot", cell: { x: 7, y: 12 }, grain: 20, lots: [{ id: "stored", quantity: 20 }] }];
  const candidates = acquisitionCandidates(c, m, "F", 12);
  expect(candidates.some((p) => p.kind === "sale" && p.lotId === "stored" && p.attempt?.kind === "travel" && p.attempt.siteId === "grain_plot")).toBe(true);
  c.siteId = "market"; c.cell = c.knownLandmarks!.market; c.visibleFoodOffers = [bread];
  c.grainStores![0].siteId = "market";
  c.ownFoodLots = [{ id: "sowing", product: "grain", species: "grain", quantity: 1, mealQuantity: 1, offered: false }];
  c.grainCarried = 1;
  m.cropPlan = { plantId: "grain_plot", siteId: "grain_plot", cell: { x: 7, y: 12 }, stage: "tilled", observedAt: 12 };
  m.effort!.trade.successes = 9;
  acquisitionChoice(c, m, "F", 12); expect(m.effort!.acquisition!.plan!.stage).toBe("source");
  expect(acquisitionChoice(c, m, "F", 13)!.attempt).toMatchObject({ kind: "load_grain", lotId: "stored" });
});

it("physically buys and eats bread after selling stored grain with no edible reserve, conserving material and money", () => {
  const w = newVillageWorld(240924, foodAcquisition90V1);
  command(w, "B1", { kind: "travel", siteId: "grain_plot_5" });
  command(w, "B1", { kind: "harvest_plot", plantId: "grain_plot_5" });
  const field = Object.values(w.physical.objects).find((o) => o.ownerId === "B1" && o.parentId === "granary_field_grain_plot_5" && w.foodLots[o.id]?.species === "grain")!;
  expect(field.quantity).toBe(20);
  command(w, "B1", { kind: "load_grain", lotId: field.id, quantity: 3 });
  command(w, "B1", { kind: "travel", siteId: "market" });
  const cargo = Object.values(w.physical.objects).find((o) => o.ownerId === "B1" && o.parentId === "bag_B1" && o.id !== "grain_seed_initial_B1")!;
  command(w, "B1", { kind: "post_surplus_offer", lotId: cargo.id, quantity: 3, price: 2 });
  const rawOffer = Object.values(w.foodOffers!).find((o) => o.lotId === cargo.id)!;
  command(w, "S", { kind: "buy_surplus", offerId: rawOffer.id });
  command(w, "S", { kind: "bake_bread", lotId: cargo.id });
  const loaf = Object.keys(w.foodLots).find((id) => w.foodLots[id].product === "bread")!;
  command(w, "S", { kind: "post_surplus_offer", lotId: loaf, quantity: 1, price: 1 });
  // Initialize the tested farmer's personal forecasts from actual observations; others remain idle.
  const farmer: VillageModel = { decide(i) { return i.actorId === "B1" ? learningNeedsVillageModel.decide(i) : idle.decide(i); } };
  advanceVillageWorld(w, 6, farmer);
  expect(w.events.some((e) => e.kind === "surplus_sold" && e.data.product === "bread" && e.actors[1] === "B1")).toBe(true);
  expect(w.events.some((e) => e.kind === "ate" && e.data.product === "bread" && e.actors[0] === "B1")).toBe(true);
  expect(w.people.B1.effort!.absorbed).toBeGreaterThan(0);
  expect(w.people.B1.memory.anticipation!.effort!.acquisition!.market.successes).toBe(1);
  expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0)).toBe(26);
  checkVillageWorld(w);
});

it("records zero-food mortality without synthetic nutrition and stops the dead person's decisions", () => {
  const initial = structuredClone(newVillageWorld(240924, foodAcquisition90V1).initialLand);
  for (const p of Object.values(initial.plants)) if (p.species !== "grain") { p.stage = "regrowing"; p.ageHours = 0; }
  const w = newVillageWorld(240924, foodAcquisition90V1, undefined, initial);
  expect(inspectVillageFoodSupply(w).readyNutrition).toBe(0);
  expect(inspectVillageFoodSupply(w).rawGrain.storedQuantity).toBe(12);
  advanceVillageWorld(w, 66, learningNeedsVillageModel);
  expect(Object.values(w.people).every((p) => !!p.death)).toBe(true);
  expect(w.eatenFood).toBe(0); expect(w.decisions.length).toBeGreaterThan(0); expect(w.bakedBread).toBe(0);
  for (const d of w.decisions) expect(d.hour * 60).toBeLessThan(w.people[d.actorId].death!.atMinute);
  const saved = structuredClone(w.people.B1.effort); advanceVillageWorld(w, 24, learningNeedsVillageModel);
  expect(w.people.B1.effort).toEqual(saved); checkVillageWorld(w);
});

it("recomputes every ten-day decision, resumes and replays v24 while projecting physical inventory and mortality", () => {
  const w = newVillageWorld(240924, foodAcquisition90V1); advanceVillageWorld(w, 120, learningNeedsVillageModel);
  const saved = loadVillageWorld(saveVillageWorld(w)); advanceVillageWorld(w, 120, learningNeedsVillageModel); advanceVillageWorld(saved, 120, learningNeedsVillageModel);
  expect(villageHash(saved)).toBe(villageHash(w));
  for (const d of w.decisions) {
    expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour, knownContext: d.knownContext, subjectiveState: d.subjectiveBefore, stimuli: d.stimuli })).toEqual(d.response);
    expect(d.hour * 60).toBeLessThan(w.people[d.actorId].death?.atMinute ?? Infinity);
    expect(d.knownContext.effortBody).not.toHaveProperty("reserve");
  }
  const projection = new VillageStatusReplay(w.fixture);
  for (const event of w.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const actual = JSON.parse(String(event.data.status)), prior = projection.statuses[event.actors[0] as "F"]!;
      for (const k of ["carried", "home", "market", "field", "ground"] as const) expect(prior[k], event.id).toEqual(actual[k]);
      expect(prior.body.effort, event.id).toEqual(actual.body.effort);
    }
    projection.apply(event);
  }
  const r = captureVillageRecording(w); expect(r.rulesetId).toBe("autonomous-village-food-acquisition-v24");
  expect(villageHash(replayVillageRecording(r))).toBe(villageHash(w));
}, 120000);
