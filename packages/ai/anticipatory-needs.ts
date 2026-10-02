import { loadMovement, travelExperienceKey } from "../sim/load-movement";
import type { VillageAttempt, VillageContext, VillageMemory, VillageModel } from "./autonomous-world";
import { beginFoodMarketVisit, foodMarketChoice, observeFoodMarketVisit } from "./food-market";
import { cultivationChoice, localFoodTransaction } from "./food-journeys";
import { actionObservation, effortForecast } from "./action-learning";
import { checkForagingMemory, forageDestination, rememberForaging, type ForagingMemory } from "./foraging-memory";

export type RunningEstimate = { count: number; mean: number; m2: number };
type Observation = { at: number; site: string; cold: number; energy: number; debt: number;
  sheltered: boolean; phase: "day" | "night"; temperature: number };
export type Experience = { from: Observation; to: Observation; action: string; salience: number; evidenceIds: string[] };
export type AnticipationMemory = {
  learning?: import("./action-learning").ActionLearningMemory;
  foraging?: ForagingMemory;
  predictions?: import("./prediction-ledger").PredictionLedger;
  last?: Observation; lastAction?: string; failedTravel?: boolean; experiences: Experience[];
  coldRates: Record<string, RunningEstimate>; temperatures: Record<string, RunningEstimate>; sleepRecovery: Record<string, RunningEstimate>; travelTimes: Record<string, RunningEstimate>;
  trip?: { at: number; from: string; to: string };
  goal?: { kind: "sleep" | "store" | "bake" | "sell" | "forage"; siteId: string; startedAt: number };
  cropPlan?: { plantId: string; siteId: string; cell: { x: number; y: number }; stage: "bare" | "tilled"; observedAt: number };
  sales: { visits: number; sales: number; failures: number; retryAt: number; offeredAt?: number };
  foodMarket?: { visitStartedAt?: number; retryAt: number; failures?: number;
    visit?: { purpose: "grain-sale" | "food-buy"; startedAt: number; arrivedAt?: number; fulfilled: boolean } };
  reasoning?: { reason: string; evidenceIds: string[]; leadHours: number; forecastCold: number;
    forecastDebt: number; uncertainty: number; candidates: { goal: string; cold: number; debt: number; cost: number }[] };
};
const freshMemory = (): AnticipationMemory => ({ experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
  sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 } });
const phase = (hour: number) => hour % 24 >= 9 && hour % 24 < 19 ? "day" as const : "night" as const;
export function updateEstimate(previous: RunningEstimate | undefined, value: number): RunningEstimate {
  const count = (previous?.count ?? 0) + 1, delta = value - (previous?.mean ?? 0);
  const mean = (previous?.mean ?? 0) + delta / count;
  return { count, mean, m2: (previous?.m2 ?? 0) + delta * (value - mean) };
}
const deviation = (estimate: RunningEstimate | undefined) => estimate && estimate.count > 1 ?
  Math.sqrt(estimate.m2 / (estimate.count - 1)) : 1;

/** A subjective forecast: learned local drift plus explicitly conservative initial beliefs. No world state access. */
export function forecastCold(memory: AnticipationMemory, cold: number, at: number, hours: number, sheltered: boolean) {
  let value = cold, peak = cold, uncertainty = 0;
  for (let offset = 1; offset <= Math.ceil(hours); offset++) {
    const key = `${sheltered ? "inside" : "outside"}:${phase(at + offset)}`;
    const estimate = memory.coldRates[key];
    const sensedWarm = memory.last && !memory.last.sheltered && memory.last.temperature >= 20 &&
      memory.last.phase === phase(at + offset);
    let rate = estimate?.mean ?? (sensedWarm ? 0 : sheltered ? -2 : phase(at + offset) === "night" ? 1.2 : -0.6);
    const temperature = memory.temperatures[String((at + offset) % 24)]?.mean ??
      (memory.last && !memory.last.sheltered && memory.last.phase === phase(at + offset) ? memory.last.temperature : undefined);
    // An observed cold location must not be made safe by averaging it with warm early-evening episodes.
    if (!sheltered && temperature !== undefined) {
      const sensedRate = temperature < 16 ? Math.ceil((16 - temperature) / 4) : -2;
      rate = Math.max(rate, sensedRate);
    }
    // Use observed variance and coverage; unseen conditions retain an explicit prior margin.
    const margin = estimate ? deviation(estimate) / Math.sqrt(estimate.count) : 0.4;
    uncertainty += margin;
    value = Math.max(0, value + rate + (sheltered ? 0 : margin * 0.25)); peak = Math.max(peak, value);
  }
  return { peak, uncertainty };
}
function learn(m: AnticipationMemory, c: VillageContext, at: number, evidenceIds: string[]) {
  const body = c.needs!;
  const current: Observation = { at, site: c.siteId, cold: c.cold, energy: c.energy,
    debt: body.sleepDebt, sheltered: body.sheltered, phase: phase(at), temperature: body.temperature };
  if (!body.sheltered) m.temperatures[String(at % 24)] =
    updateEstimate(m.temperatures[String(at % 24)], body.temperature);
  const last = m.last;
  if (last && at > last.at) {
    const elapsed = at - last.at;
    const salience = Math.max(current.cold, current.debt / 3, Math.abs(current.energy - last.energy),
      Math.abs(current.debt - last.debt));
    m.experiences.push({ from: last, to: current, action: m.lastAction ?? "wait", salience, evidenceIds });
    if (m.experiences.length > 24) {
      // Retain salient episodes and a separate recent tail; normal rates are also retained in aggregates.
      const recent = m.experiences.slice(-8);
      const memorable = m.experiences.slice(0, -8).sort((a, b) =>
        (b.salience / (1 + (at - b.to.at) / 240)) - (a.salience / (1 + (at - a.to.at) / 240))).slice(0, 16);
      m.experiences = [...memorable, ...recent].sort((a, b) => a.to.at - b.to.at);
    }
    // Do not attribute mixed locations or day/night intervals to one local temperature condition.
    if (m.lastAction === "sleep" && last.site === current.site) {
      const key = last.sheltered ? "inside" : "outside";
      m.sleepRecovery[key] = updateEstimate(m.sleepRecovery[key], Math.max(0, last.debt - current.debt) / elapsed);
    }
    if (last.site === current.site && last.sheltered === current.sheltered &&
      Array.from({ length: elapsed }, (_, i) => phase(last.at + i + 1)).every((p) => p === last.phase)) {
      const key = `${last.sheltered ? "inside" : "outside"}:${last.phase}`;
      m.coldRates[key] = updateEstimate(m.coldRates[key], (current.cold - last.cold) / elapsed);
    }
  }
  if (m.trip && c.siteId === m.trip.to && !c.activeAction) {
    const key = `${m.trip.from}>${m.trip.to}`;
    m.travelTimes[key] = updateEstimate(m.travelTimes[key], at - m.trip.at);
    delete m.trip;
  }
  m.last = current;
}
export function travelEstimate(m: AnticipationMemory, c: VillageContext, siteId: string, cell: { x: number; y: number }) {
  if (siteId === c.siteId) return { hours: 0, margin: 0 };
  const estimate = m.travelTimes[travelExperienceKey(c.siteId, siteId, c.carriedMass, !!c.bulkTransport)];
  const distance = Math.max(Math.abs(c.cell.x - cell.x), Math.abs(c.cell.y - cell.y));
  return { hours: Math.max(1, estimate?.mean ?? Math.ceil(distance * (c.bulkTransport ? 1 / loadMovement(c.carriedMass, c.bulkTransport).speedRatio : 1 + Math.floor(c.carriedMass / 20)) / 16)),
    margin: estimate ? deviation(estimate) : 1 };
}

/** Experience-based anticipation integrated with personal food reserves and locally observed work. */
export const anticipatoryNeedsVillageModel: VillageModel = { decide(input) {
  const c = input.knownContext, memory: VillageMemory = structuredClone(input.subjectiveState);
  if (!c.needs) throw Error("anticipatory personality requires a needs context");
  const m = memory.anticipation ??= freshMemory();
  if (c.foodJourneys) observeFoodMarketVisit(c, m, input.stimuli, input.at);
  if (c.experienceLearning) rememberForaging(m.foraging ??= { places: {} }, c, input.at);
  if (memory.day !== c.day) { memory.day = c.day; memory.done = []; }
  const evidenceIds = input.stimuli.flatMap((s) => s.causeEventIds);
  learn(m, c, input.at, evidenceIds);
  for (const stimulus of input.stimuli) {
    if (c.experienceLearning && stimulus.action === "gather_plant" && stimulus.experience &&
      ["completed", "failed", "rejected"].includes(stimulus.experience.phase) && m.goal?.kind === "forage") delete m.goal;
    if (c.foodJourneys && stimulus.action === "sow_plot" && stimulus.kind === "result") delete m.cropPlan;
    if (stimulus.saleRevenue !== undefined) {
      m.sales.sales++; m.sales.failures = 0; m.sales.retryAt = input.at; delete m.sales.offeredAt;
      if (m.goal?.kind === "sell") delete m.goal;
    }
    if (stimulus.kind === "result" && stimulus.success === false && stimulus.action === "travel") {
      delete m.trip; delete m.goal; m.failedTravel = true;
    }
  }
  if (c.activeAction) return { attempts: [], subjectiveUpdate: memory, wait: { at: input.at + 1 } };
  const body = c.needs, home = body.home;
  const trip = travelEstimate(m, c, home.siteId, home.cell);
  const horizon = Math.max(6, Math.ceil(trip.hours + trip.margin + 2));
  const continuing = forecastCold(m, c.cold, input.at, horizon, body.sheltered);
  const returning = forecastCold(m, c.cold, input.at, trip.hours + trip.margin, body.sheltered);
  const homeRecovery = m.sleepRecovery.inside?.mean ?? 2;
  const outdoorRecovery = m.sleepRecovery.outside?.mean ?? 1;
  const episodes = m.experiences.filter((e) => e.from.sheltered === body.sheltered && e.from.phase === phase(input.at))
    .sort((a, b) => Math.abs(a.from.debt - body.sleepDebt) + Math.abs(a.from.cold - c.cold) -
      Math.abs(b.from.debt - body.sleepDebt) - Math.abs(b.from.cold - c.cold)).slice(0, 3);
  m.reasoning = { reason: "", evidenceIds: [...new Set([...evidenceIds, ...episodes.flatMap((e) => e.evidenceIds)])],
    leadHours: trip.hours + trip.margin, forecastCold: continuing.peak, forecastDebt: body.sleepDebt + horizon,
    uncertainty: continuing.uncertainty, candidates: [
      { goal: "continue", cold: continuing.peak, debt: body.sleepDebt + horizon, cost: horizon },
      { goal: "home-and-sleep", cold: returning.peak, debt: Math.max(0, body.sleepDebt + trip.hours - 8 * homeRecovery), cost: trip.hours + 8 },
      { goal: "local-rest", cold: continuing.peak, debt: body.sleepDebt + 2, cost: 2 },
      { goal: "local-sleep", cold: forecastCold(m, c.cold, input.at, 8, body.sheltered).peak,
        debt: Math.max(0, body.sleepDebt - 8 * (body.sheltered ? homeRecovery : outdoorRecovery)), cost: 8 } ] };
  const choose = (attempt: VillageAttempt | undefined, reason: string) => {
    if (body.sheltered && attempt?.kind === "travel" && !(c.hunger > 0 && (c.edibleMeals ?? 0) === 0)) {
      const destination = attempt.siteId;
      const cell = c.visiblePlants.find((p) => p.siteId === destination)?.cell ?? m.predictions?.knownSites[destination];
      const target = c.foodJourneys && cell ? travelEstimate(m, c, destination, cell) : undefined;
      const hours = target ? target.hours + target.margin + 1 : 8;
      const leaving = forecastCold(m, c.cold, input.at, hours, false);
      m.reasoning!.candidates.push({ goal: "exposed-trip", cold: leaving.peak, debt: body.sleepDebt + hours, cost: hours });
      if (leaving.peak >= 8) {
        attempt = undefined; reason = "defer exposed trip; predicted cold exceeds reserve benefit";
        m.reasoning!.forecastCold = leaving.peak;
      }
    }
    if (c.bulkTransport && attempt?.kind === "travel") {
      const destination = attempt.siteId;
      const cell = destination === home.siteId ? home.cell : c.visiblePlants.find((p) => p.siteId === destination)?.cell ?? m.predictions?.knownSites[destination];
      if (cell) {
        const target = travelEstimate(m, c, destination, cell);
        const rate = c.experienceLearning ? Math.max(0, -effortForecast(m.learning, "travel", actionObservation(c)).rate) : loadMovement(c.carriedMass, c.bulkTransport).energyPerHour;
        const required = Math.min(c.bulkTransport.maxEnergy, (target.hours + target.margin) * rate + 1);
        if (c.energy < required) { attempt = { kind: "rest" }; reason = "recover energy for predicted loaded journey"; }
      }
    }
    if (c.foodJourneys && c.foodMarket?.bakingSkill === 0 && attempt?.kind === "travel" && attempt.siteId === "market") {
      beginFoodMarketVisit(m, c, input.at, reason === "carry harvested grain to sell for edible food" ? "grain-sale" : "food-buy");
    }
    if (c.foodJourneys && attempt?.kind === "buy_surplus" && c.foodMarket?.bakingSkill === 0) {
      beginFoodMarketVisit(m, c, input.at, "food-buy");
    }
    if (c.foodJourneys && attempt?.kind === "post_surplus_offer") {
      const lotId = attempt.lotId;
      if (c.ownFoodLots?.some((lot) => lot.id === lotId && lot.product === "grain")) beginFoodMarketVisit(m, c, input.at, "grain-sale");
    }
    m.reasoning!.reason = reason; m.lastAction = attempt?.kind ?? "wait";
    if (attempt?.kind === "travel") m.trip = { at: input.at, from: c.siteId, to: attempt.siteId };
    return { attempts: attempt ? [attempt] : [], subjectiveUpdate: memory, wait: { at: input.at + 1 } };
  };
  const travel = (siteId: string) => choose({ kind: "travel", siteId }, `continue ${m.goal?.kind ?? "food"} goal`);
  const meals = c.edibleMeals ?? 0;
  if (m.failedTravel) { delete m.failedTravel; return choose({ kind: "rest" }, "revise travel effort after actual exhaustion rejection"); }
  if (c.hunger > 0 && meals > 0) return choose({ kind: "eat" }, "eat personal edible reserve");
  if (c.foodJourneys) {
    const transaction = localFoodTransaction(c, m, input.actorId, input.at);
    if (transaction) return choose(transaction.attempt, transaction.reason);
  }
  // Maintain a selected sleep destination until sleeping, rather than oscillating to another task on arrival.
  if (m.goal?.kind === "sleep" && c.siteId === m.goal.siteId) {
    delete m.goal;
    return choose(body.sleepDebt >= 8 ? { kind: "sleep" } : undefined, "recover at selected shelter");
  }
  if (c.experienceLearning && c.hunger > 0 && meals === 0 && c.cold < 8 && body.sleepDebt < 24) {
    const local = c.visiblePlants.find((p) => p.siteId === c.siteId && ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
      p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1) && c.bulkTransport!.bagFreeMass >= (p.species === "herb" ? 2 : 1));
    if (local) {
      const quantity = Math.min(local.species === "herb" ? 2 : Math.min(3, local.available), c.bulkTransport!.bagFreeMass);
      const workRate = Math.max(0, -effortForecast(m.learning, "gather_plant", actionObservation(c)).rate);
      const homeRate = Math.max(0, -effortForecast(m.learning, "travel", { ...actionObservation(c), mass: c.carriedMass + quantity }).rate);
      const energy = quantity * workRate + (trip.hours + trip.margin) * homeRate + 2;
      m.reasoning!.candidates.push({ goal: "local-food-then-shelter", cold: forecastCold(m, c.cold, input.at, quantity + trip.hours, body.sheltered).peak,
        debt: body.sleepDebt + quantity + trip.hours, cost: quantity + trip.hours });
      if (c.energy >= energy) {
        m.goal = { kind: "forage", siteId: c.siteId, startedAt: input.at };
        return choose({ kind: "gather_plant", plantId: local.id, quantity }, "obtain local food while retaining effort to reach shelter");
      }
    }
  }
  const anticipate = !body.sheltered && continuing.peak >= 8 || body.sleepDebt + trip.hours + trip.margin >= 20;
  if (m.goal?.kind === "sleep" || anticipate) {
    // A distant home need not be worth the journey when the known local conditions are safe.
    if (!m.goal && !body.sheltered && trip.hours >= 4 && continuing.peak < 4 &&
      body.sleepDebt >= 16 && c.needs.temperature >= 18)
      return choose({ kind: "sleep" }, "safe local sleep outweighs distant shelter journey");
    m.goal ??= { kind: "sleep", siteId: home.siteId, startedAt: input.at };
    if (c.siteId === home.siteId) { delete m.goal; return choose({ kind: "sleep" }, "prevent predicted sleep deficit"); }
    const homeRate = c.experienceLearning ? Math.max(0, -effortForecast(m.learning, "travel", actionObservation(c)).rate) : c.bulkTransport ? loadMovement(c.carriedMass, c.bulkTransport).energyPerHour : 1 + Math.floor(c.carriedMass / 10);
    if (c.energy < Math.min(c.bulkTransport?.maxEnergy ?? Infinity, (trip.hours + trip.margin) * homeRate + 2)) return choose({ kind: "rest" }, "recover enough energy to reach shelter");
    return travel(home.siteId);
  }
  if (c.energy < 6) return choose({ kind: "rest" }, "recover activity fatigue without erasing sleep debt");
  if (c.bulkTransport && c.homeStorage) {
    const grain = c.ownFoodLots!.find((lot) => lot.product === "grain");
    if (grain && meals === 0 && (c.hunger > 0 || Math.max(body.mealHours, body.needClockHours ?? 0) >= 16)) {
      const store = c.grainStores!.find((store) => store.siteId === c.siteId && store.capacity - store.grain >= grain.quantity);
      if (store) return choose({ kind: "store_grain", lotId: grain.id, storeId: store.id }, "leave heavy grain at home before seeking edible food");
    }
    const storedGrain = c.homeStorage.items.find((lot) => lot.kind === "grain");
    if (!c.foodJourneys && c.ownFarm && meals > 0 && c.ownCash < (c.experienceLearning ? 8 : 4) && (c.grainCarried ?? 0) < c.bulkTransport.plantingReserve && storedGrain &&
      (!c.experienceLearning || c.visiblePlants.some((p) => p.ownerId === input.actorId && (p.stage === "tilled" || p.stage === "bare")))) {
      const quantity = Math.min(storedGrain.quantity, (c.experienceLearning ? 1 : c.bulkTransport.plantingReserve) - (c.grainCarried ?? 0), Math.floor(c.bulkTransport.bagFreeMass / c.bulkTransport.grainUnitMass));
      if (quantity > 0) return choose({ kind: "take_home", objectId: storedGrain.id, quantity }, "take grain reserve for sowing owned crops");
    }
  }
  if (c.homeStorage) {
    if (c.ownCash > 8) return choose({ kind: "store_home_cash", quantity: c.ownCash - 8 }, "leave excess cash in own home before carrying on");
    if (c.ownCash < (c.experienceLearning ? 8 : 4) && c.homeStorage.cash > 0) return choose({ kind: "take_home_cash", quantity: Math.min(8 - c.ownCash, c.homeStorage.cash) }, "take own stored cash for food purchases");
    const storedFood = c.homeStorage.items.find((lot) => !["grain", "seed", "wood"].includes(lot.kind));
    if (meals < 2 && storedFood) return choose({ kind: "take_home", objectId: storedFood.id,
      quantity: Math.min(storedFood.quantity, storedFood.kind === "herb" ? 2 : 1) }, "take edible reserve from own home");
    const excess = c.ownFoodLots?.find((lot) => (lot.product === "bread" || lot.species !== "grain") && !lot.offered && lot.quantity >= lot.mealQuantity);
    if (meals > 2 && excess) return choose({ kind: "store_home", objectId: excess.id,
      quantity: Math.min(excess.quantity, (meals - 2) * excess.mealQuantity) }, "leave surplus food in own home");
  }
  if (c.foodJourneys) {
    const cultivation = cultivationChoice(c, m, input.actorId);
    if (cultivation) return choose(cultivation.attempt, cultivation.reason);
  }
  if (c.experienceLearning && meals === 0 && (c.hunger > 0 || Math.max(body.mealHours, body.needClockHours ?? 0) >= 16)) {
    const local = c.visiblePlants.find((p) => p.siteId === c.siteId && ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
      p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1) && c.bulkTransport!.bagFreeMass >= (p.species === "herb" ? 2 : 1));
    if (local) {
      m.goal = { kind: "forage", siteId: c.siteId, startedAt: input.at };
      return choose({ kind: "gather_plant", plantId: local.id, quantity: Math.min(local.species === "herb" ? 2 : Math.min(3, local.available), c.bulkTransport!.bagFreeMass) },
        "collect immediately available food before another journey");
    }
  }
  if (c.experienceLearning && m.goal?.kind === "forage") {
    if (meals > 0) delete m.goal;
    else if (c.siteId !== m.goal.siteId) return travel(m.goal.siteId);
    else {
      const plant = c.visiblePlants.find((p) => p.siteId === c.siteId && p.stage === "ripe" &&
        p.available >= (p.species === "herb" ? 2 : 1));
      if (plant && (c.bulkTransport!.bagFreeMass >= (plant.species === "herb" ? 2 : 1))) {
        return choose({ kind: "gather_plant", plantId: plant.id, quantity: Math.min(plant.species === "herb" ? 2 : Math.min(3, plant.available), c.bulkTransport!.bagFreeMass) },
          "finish selected food gathering before reconsidering trade");
      }
      delete m.goal; // Actual arrival observation supersedes remembered availability.
    }
  }
  const urgentForaging = c.bulkTransport && meals === 0 && (c.hunger > 0 || Math.max(body.mealHours, body.needClockHours ?? 0) >= 16) &&
    !(c.foodMarket!.bakingSkill > 0 && (c.grainStores!.some((store) => (c.experienceLearning || store.siteId === c.siteId) && store.grain > 0) ||
      c.experienceLearning && c.ownCash >= c.foodMarket!.grainBatchPrice));
  if (c.foodMarket && !urgentForaging) {
    const market = foodMarketChoice(c, m, input.actorId, input.at);
    if (market) return choose(market.attempt, market.reason);
  }
  if (!c.foodMarket && (c.grainCarried ?? 0) > 0) {
    const lot = c.ownFoodLots!.find((lot) => lot.product === "grain")!;
    const stores = c.grainStores!.filter((store) => store.capacity - store.grain >= lot.quantity);
    const store = stores.find((store) => store.siteId === home.siteId) ?? stores[0];
    if (!store) return choose(undefined, "grain storage full; retain carried grain");
    m.goal = { kind: "store", siteId: store.siteId, startedAt: m.goal?.startedAt ?? input.at };
    if (c.siteId !== store.siteId) return travel(store.siteId);
    delete m.goal;
    return choose({ kind: "store_grain", lotId: lot.id, storeId: store.id }, "store physically carried raw grain");
  }
  const raw = c.grainStores!.reduce((n, s) => n + s.grain, 0);
  if (!c.foodMarket && meals < 2 && raw > 0 && (c.hunger > 0 || body.mealHours >= 12 || meals === 0)) {
    const store = c.grainStores!.find((store) => store.siteId === c.siteId && store.grain > 0) ??
      c.grainStores!.find((store) => store.grain > 0)!;
    m.goal = { kind: "bake", siteId: store.siteId, startedAt: m.goal?.startedAt ?? input.at };
    if (c.siteId !== store.siteId) return travel(store.siteId);
    delete m.goal;
    return choose({ kind: "bake_bread", lotId: store.lots[0].id }, "prepare edible reserve before next hunger");
  }
  const hungrySoon = meals === 0 && (c.hunger > 0 || Math.max(body.mealHours, body.needClockHours ?? 0) >= 16);
  if (hungrySoon) {
    const offer = c.visibleFoodOffers?.filter((o) => o.product !== "grain" && o.price <= c.ownCash && o.price <= 2)
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
    if (offer) return choose({ kind: "buy_surplus", offerId: offer.id }, "buy available food before hunger worsens");
    const wild = c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
      p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1) &&
      (c.bulkTransport?.bagFreeMass ?? Infinity) >= (p.species === "herb" ? 2 : 1) && p.cell)
      .sort((a, b) => Math.max(Math.abs(a.cell!.x - c.cell.x), Math.abs(a.cell!.y - c.cell.y)) -
        Math.max(Math.abs(b.cell!.x - c.cell.x), Math.abs(b.cell!.y - c.cell.y)) || a.id.localeCompare(b.id))[0];
    const ripe = c.visiblePlants.find((p) => p.ownerId === input.actorId && p.species === "grain" && p.stage === "ripe");
    if (!c.foodMarket && ripe && raw < 12) return choose(c.siteId === ripe.siteId ? { kind: "harvest_plot", plantId: ripe.id } :
      { kind: "travel", siteId: ripe.siteId! }, "obtain raw material for impending food need");
    if (wild && c.experienceLearning) m.goal = { kind: "forage", siteId: wild.siteId!, startedAt: input.at };
    if (wild) return choose(c.siteId === wild.siteId ? { kind: "gather_plant", plantId: wild.id,
      quantity: Math.min(wild.species === "herb" ? 2 : Math.min(3, wild.available), c.bulkTransport?.bagFreeMass ?? Infinity) } :
      { kind: "travel", siteId: wild.siteId! }, "gather locally observed food for impending hunger");
    if (c.experienceLearning && m.foraging) {
      const target = forageDestination(m.foraging, c, input.at);
      if (target) return choose({ kind: "travel", siteId: target.siteId }, target.reason);
    }
    if (c.siteId !== "grove") return choose({ kind: "travel", siteId: "grove" }, "revisit known food area; no visible food");
  }
  // A personal two-meal reserve is not surplus. Poor sales reduce visits, not create synthetic demand.
  if (m.goal?.kind === "sell" && c.siteId === "market" && m.sales.offeredAt !== undefined) {
    if (input.at - m.sales.offeredAt < 3) return choose(undefined, "wait briefly for an actual buyer");
    m.sales.failures++; m.sales.retryAt = input.at + Math.min(240, 24 * 2 ** Math.min(3, m.sales.failures));
    delete m.sales.offeredAt; delete m.goal;
  }
  if (meals > 2 && input.at >= m.sales.retryAt) {
    const lot = c.ownFoodLots!.find((lot) => lot.product !== "grain" && !lot.offered && lot.quantity >= lot.mealQuantity);
    if (lot) {
      m.goal = { kind: "sell", siteId: "market", startedAt: m.goal?.startedAt ?? input.at };
      if (c.siteId !== "market") return travel("market");
      m.sales.visits++; m.sales.offeredAt = input.at;
      return choose({ kind: "post_surplus_offer", lotId: lot.id, quantity: Math.min(lot.quantity,
        (meals - 2) * lot.mealQuantity), price: 1 }, "offer only food above personal reserve");
    }
  }
  if (c.ownFarm && (!c.bulkTransport || raw + (c.grainCarried ?? 0) < c.bulkTransport.grainYield) && (c.foodMarket ? c.ownCash < (c.experienceLearning ? 8 : 4) && (c.grainCarried ?? 0) <= (c.bulkTransport?.plantingReserve ?? 0) : raw + meals < 12)) {
    const crops = c.visiblePlants.filter((p) => p.ownerId === input.actorId && p.farmId === c.ownFarm!.id);
    const target = crops.find((p) => p.stage === "ripe") ?? crops.find((p) => p.stage === "tilled") ?? crops.find((p) => p.stage === "bare");
    if (c.foodJourneys && target?.cell && target.siteId && (target.stage === "bare" || target.stage === "tilled")) {
      m.cropPlan = { plantId: target.id, siteId: target.siteId, cell: { ...target.cell }, stage: target.stage, observedAt: input.at };
      const cultivation = cultivationChoice(c, m, input.actorId);
      if (cultivation) return choose(cultivation.attempt, cultivation.reason);
    }
    if (target?.stage === "tilled" && c.bulkTransport && (c.grainCarried ?? 0) === 0) {
      if (c.experienceLearning) {
        const stock = c.grainStores!.find((s) => s.grain > 0 && s.siteId === c.siteId) ?? c.grainStores!.find((s) => s.grain > 0);
        if (stock) return choose(c.siteId === stock.siteId ? { kind: "load_grain", lotId: stock.lots[0].id, quantity: 1 } :
          { kind: "travel", siteId: stock.siteId }, "retrieve one stored grain for observed tilled crop");
      }
      return choose(undefined, "sowing requires actual carried grain; retain tilled plot");
    }
    if (target) return choose(c.siteId !== target.siteId ? { kind: "travel", siteId: target.siteId! } :
      target.stage === "ripe" ? { kind: "harvest_plot", plantId: target.id } : target.stage === "tilled" ?
      { kind: "sow_plot", plantId: target.id } : { kind: "till_plot", plantId: target.id }, "work owned crop for bounded personal reserve");
    if (!c.ownFarm.plotIds.includes(c.siteId)) return choose({ kind: "travel", siteId: c.ownFarm.plotIds[0] }, "observe own crop growth");
  }
  return choose(undefined, "reserve sufficient or waiting for observed growth; no forced daily task");
} };

/** Validate saved subjective state without adding any knowledge of the world to it. */
export function checkAnticipationMemory(memory: AnticipationMemory, at: number) {
  if (memory.foraging) checkForagingMemory(memory.foraging, at);
  const estimates = [...Object.values(memory.coldRates), ...Object.values(memory.temperatures),
    ...Object.values(memory.sleepRecovery), ...Object.values(memory.travelTimes)];
  if (memory.experiences.length > 24 || estimates.some((e) => !Number.isSafeInteger(e.count) || e.count < 1 ||
    !Number.isFinite(e.mean) || !Number.isFinite(e.m2) || e.m2 < -1e-9) ||
    memory.experiences.some((e) => e.from.at >= e.to.at || e.to.at > at ||
      !Number.isFinite(e.salience) || e.salience < 0 || !Array.isArray(e.evidenceIds)) ||
    memory.last && memory.last.at > at || memory.trip && memory.trip.at > at ||
    memory.goal && memory.goal.startedAt > at ||
    [memory.sales.visits, memory.sales.sales, memory.sales.failures, memory.sales.retryAt]
      .some((n) => !Number.isSafeInteger(n) || n < 0)) throw Error("invalid anticipation memory");
  if (memory.cropPlan && (!Number.isSafeInteger(memory.cropPlan.observedAt) || memory.cropPlan.observedAt < 0 || memory.cropPlan.observedAt > at ||
    !["bare", "tilled"].includes(memory.cropPlan.stage) || !memory.cropPlan.plantId || !memory.cropPlan.siteId ||
    !Number.isSafeInteger(memory.cropPlan.cell.x) || !Number.isSafeInteger(memory.cropPlan.cell.y))) throw Error("invalid cultivation plan");
  const market = memory.foodMarket;
  if (market && (![market.retryAt, market.failures ?? 0, market.visitStartedAt ?? 0, market.visit?.startedAt ?? 0, market.visit?.arrivedAt ?? 0]
    .every((n) => Number.isSafeInteger(n) && n >= 0) || market.visit && (market.visit.startedAt > at ||
      market.visit.arrivedAt !== undefined && (market.visit.arrivedAt < market.visit.startedAt || market.visit.arrivedAt > at) ||
      !["grain-sale", "food-buy"].includes(market.visit.purpose) || typeof market.visit.fulfilled !== "boolean"))) throw Error("invalid food market memory");
  if (memory.reasoning && [memory.reasoning.leadHours, memory.reasoning.forecastCold, memory.reasoning.forecastDebt,
    memory.reasoning.uncertainty, ...memory.reasoning.candidates.flatMap((c) => [c.cold, c.debt, c.cost])]
    .some((n) => !Number.isFinite(n) || n < 0)) throw Error("invalid anticipation forecast");
}
