import type { VillageAttempt, VillageContext, VillageMemory, VillageModel } from "./autonomous-world";
import { foodMarketChoice } from "./food-market";

export type RunningEstimate = { count: number; mean: number; m2: number };
type Observation = { at: number; site: string; cold: number; energy: number; debt: number;
  sheltered: boolean; phase: "day" | "night"; temperature: number };
export type Experience = { from: Observation; to: Observation; action: string; salience: number; evidenceIds: string[] };
export type AnticipationMemory = {
  predictions?: import("./prediction-ledger").PredictionLedger;
  last?: Observation; lastAction?: string; failedTravel?: boolean; experiences: Experience[];
  coldRates: Record<string, RunningEstimate>; temperatures: Record<string, RunningEstimate>; sleepRecovery: Record<string, RunningEstimate>; travelTimes: Record<string, RunningEstimate>;
  trip?: { at: number; from: string; to: string };
  goal?: { kind: "sleep" | "store" | "bake" | "sell"; siteId: string; startedAt: number };
  sales: { visits: number; sales: number; failures: number; retryAt: number; offeredAt?: number };
  foodMarket?: { visitStartedAt?: number; retryAt: number };
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
function travelEstimate(m: AnticipationMemory, c: VillageContext, siteId: string, cell: { x: number; y: number }) {
  if (siteId === c.siteId) return { hours: 0, margin: 0 };
  const estimate = m.travelTimes[`${c.siteId}>${siteId}`];
  const distance = Math.max(Math.abs(c.cell.x - cell.x), Math.abs(c.cell.y - cell.y));
  return { hours: Math.max(1, estimate?.mean ?? Math.ceil(distance * (1 + Math.floor(c.carriedMass / 20)) / 16)),
    margin: estimate ? deviation(estimate) : 1 };
}

/** Experience-based anticipation integrated with personal food reserves and locally observed work. */
export const anticipatoryNeedsVillageModel: VillageModel = { decide(input) {
  const c = input.knownContext, memory: VillageMemory = structuredClone(input.subjectiveState);
  if (!c.needs) throw Error("anticipatory personality requires a needs context");
  const m = memory.anticipation ??= freshMemory();
  if (memory.day !== c.day) { memory.day = c.day; memory.done = []; }
  const evidenceIds = input.stimuli.flatMap((s) => s.causeEventIds);
  learn(m, c, input.at, evidenceIds);
  for (const stimulus of input.stimuli) {
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
      const leaving = forecastCold(m, c.cold, input.at, 8, false);
      m.reasoning!.candidates.push({ goal: "exposed-trip", cold: leaving.peak, debt: body.sleepDebt + 8, cost: 8 });
      if (leaving.peak >= 8) {
        attempt = undefined; reason = "defer exposed trip; predicted cold exceeds reserve benefit";
        m.reasoning!.forecastCold = leaving.peak;
      }
    }
    m.reasoning!.reason = reason; m.lastAction = attempt?.kind ?? "wait";
    if (attempt?.kind === "travel") m.trip = { at: input.at, from: c.siteId, to: attempt.siteId };
    return { attempts: attempt ? [attempt] : [], subjectiveUpdate: memory, wait: { at: input.at + 1 } };
  };
  const travel = (siteId: string) => choose({ kind: "travel", siteId }, `continue ${m.goal?.kind ?? "food"} goal`);
  const meals = c.edibleMeals ?? 0;
  if (m.failedTravel) { delete m.failedTravel; return choose({ kind: "rest" }, "revise travel effort after actual exhaustion rejection"); }
  if (c.hunger > 0 && meals > 0) return choose({ kind: "eat" }, "eat personal edible reserve");
  // Maintain a selected sleep destination until sleeping, rather than oscillating to another task on arrival.
  if (m.goal?.kind === "sleep" && c.siteId === m.goal.siteId) {
    delete m.goal;
    return choose(body.sleepDebt >= 8 ? { kind: "sleep" } : undefined, "recover at selected shelter");
  }
  const anticipate = !body.sheltered && continuing.peak >= 8 || body.sleepDebt + trip.hours + trip.margin >= 20;
  if (m.goal?.kind === "sleep" || anticipate) {
    // A distant home need not be worth the journey when the known local conditions are safe.
    if (!m.goal && !body.sheltered && trip.hours >= 4 && continuing.peak < 4 &&
      body.sleepDebt >= 16 && c.needs.temperature >= 18)
      return choose({ kind: "sleep" }, "safe local sleep outweighs distant shelter journey");
    m.goal ??= { kind: "sleep", siteId: home.siteId, startedAt: input.at };
    if (c.siteId === home.siteId) { delete m.goal; return choose({ kind: "sleep" }, "prevent predicted sleep deficit"); }
    if (c.energy < (trip.hours + trip.margin) * (1 + Math.floor(c.carriedMass / 10)) + 2) return choose({ kind: "rest" }, "recover enough energy to reach shelter");
    return travel(home.siteId);
  }
  if (c.energy < 6) return choose({ kind: "rest" }, "recover activity fatigue without erasing sleep debt");
  if (c.foodMarket) {
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
  const hungrySoon = meals === 0 && (c.hunger > 0 || body.mealHours >= 16);
  if (hungrySoon) {
    const offer = c.visibleFoodOffers?.filter((o) => o.product !== "grain" && o.price <= c.ownCash && o.price <= 2)
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
    if (offer) return choose({ kind: "buy_surplus", offerId: offer.id }, "buy available food before hunger worsens");
    const wild = c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
      p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1) && p.cell)
      .sort((a, b) => Math.max(Math.abs(a.cell!.x - c.cell.x), Math.abs(a.cell!.y - c.cell.y)) -
        Math.max(Math.abs(b.cell!.x - c.cell.x), Math.abs(b.cell!.y - c.cell.y)) || a.id.localeCompare(b.id))[0];
    const ripe = c.visiblePlants.find((p) => p.ownerId === input.actorId && p.species === "grain" && p.stage === "ripe");
    if (!c.foodMarket && ripe && raw < 12) return choose(c.siteId === ripe.siteId ? { kind: "harvest_plot", plantId: ripe.id } :
      { kind: "travel", siteId: ripe.siteId! }, "obtain raw material for impending food need");
    if (wild) return choose(c.siteId === wild.siteId ? { kind: "gather_plant", plantId: wild.id,
      quantity: wild.species === "herb" ? 2 : Math.min(3, wild.available) } :
      { kind: "travel", siteId: wild.siteId! }, "gather locally observed food for impending hunger");
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
  if (c.ownFarm && (c.foodMarket ? c.ownCash < 4 && (c.grainCarried ?? 0) === 0 : raw + meals < 12)) {
    const crops = c.visiblePlants.filter((p) => p.ownerId === input.actorId && p.farmId === c.ownFarm!.id);
    const target = crops.find((p) => p.stage === "ripe") ?? crops.find((p) => p.stage === "tilled") ?? crops.find((p) => p.stage === "bare");
    if (target) return choose(c.siteId !== target.siteId ? { kind: "travel", siteId: target.siteId! } :
      target.stage === "ripe" ? { kind: "harvest_plot", plantId: target.id } : target.stage === "tilled" ?
      { kind: "sow_plot", plantId: target.id } : { kind: "till_plot", plantId: target.id }, "work owned crop for bounded personal reserve");
    if (!c.ownFarm.plotIds.includes(c.siteId)) return choose({ kind: "travel", siteId: c.ownFarm.plotIds[0] }, "observe own crop growth");
  }
  return choose(undefined, "reserve sufficient or waiting for observed growth; no forced daily task");
} };

/** Validate saved subjective state without adding any knowledge of the world to it. */
export function checkAnticipationMemory(memory: AnticipationMemory, at: number) {
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
  if (memory.reasoning && [memory.reasoning.leadHours, memory.reasoning.forecastCold, memory.reasoning.forecastDebt,
    memory.reasoning.uncertainty, ...memory.reasoning.candidates.flatMap((c) => [c.cold, c.debt, c.cost])]
    .some((n) => !Number.isFinite(n) || n < 0)) throw Error("invalid anticipation forecast");
}
