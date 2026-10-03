import type { VillageAttempt, VillageContext, VillageMemory, VillageResponse, VillageStimulus } from "./autonomous-world";
import { forecastCold, travelEstimate, type AnticipationMemory } from "./anticipatory-needs";
import { forageDestination } from "./foraging-memory";
import { canPlanSleep, forecastSleep } from "./sleep-forecast";
import { unoccupiedWildPlants } from "./food-planning";
import { personalChoiceOrder } from "./personal-choice";
import { cultivationChoice } from "./food-journeys";

type Rate = { count: number; mean: number };
export type EffortCandidate = { goal: string; hours: number; benefit: number; cost: number; value: number;
  feasible: boolean; reason: string; probability?: number; fatigue: number; cold: number };
export type EffortMemory = { version: 1; models: Record<string, Rate>; matched: number; excluded: number;
  errors: number; last?: { expected: number; actual: number; error: number; evidenceIds: string[] };
  pending?: { id: string; key: string; action: string; at: number; fatigue: number; prior: number; rate: number; processId?: string; attemptEventId?: string };
  trade: { successes: number; failures: number; censored: number; retryAt: number;
    offer?: { id: string; at: number; deadline: number; expired?: boolean } };
  goal?: { kind: "sale" | "return"; startedAt: number; deadline: number; quantity: number };
  explored?: Record<string, number>; candidates: EffortCandidate[]; selected?: string };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const average = (old: Rate | undefined, v: number): Rate => ({ count: (old?.count ?? 0) + 1,
  mean: (old?.mean ?? 0) + (v - (old?.mean ?? 0)) / ((old?.count ?? 0) + 1) });
const key = (action: string, c: VillageContext) => `${action}:load${Math.floor(c.carriedMass / 4)}:need${c.effortBody!.nutritionNeed >= .75 ? 1 : 0}:cold${c.cold >= 8 ? 1 : 0}`;
// Subjective initial beliefs, in felt-fatigue/hour. No private physiological coefficients are consulted.
const prior = (action: string, mass: number) => action === "rest" || action === "sleep" ? -.07 + mass * .003 :
  action === "travel" ? .04 * (1 + mass / 8) : .04;
const rate = (m: EffortMemory, action: string, c: VillageContext) =>
  c.effortBody!.learningEnabled && (m.models[key(action, c)]?.count ?? 0) >= 2 ? m.models[key(action, c)].mean : prior(action, c.carriedMass);
export function newEffortMemory(): EffortMemory {
  return { version: 1, models: {}, matched: 0, excluded: 0, errors: 0,
    trade: { successes: 0, failures: 0, censored: 0, retryAt: 0 }, candidates: [] };
}
export function beginEffortPrediction(m: EffortMemory, c: VillageContext, action: VillageAttempt, id: string, at: number) {
  if (m.pending) m.excluded++;
  m.pending = { id, key: key(action.kind, c), action: action.kind, at, fatigue: c.effortBody!.fatigue,
    prior: prior(action.kind, c.carriedMass), rate: rate(m, action.kind, c) };
}
/** Match personal delivered execution, including completed portions of stopped work. */
export function observeEffort(m: EffortMemory, c: VillageContext, stimuli: VillageStimulus[], at: number) {
  for (const s of stimuli) {
    const e = s.experience, p = m.pending;
    if (p && e?.predictionId === p.id && e.startedAt === p.at && s.action === p.action &&
      e.before.fatigue === p.fatigue && s.occurredAt <= at && s.receivedAt <= at && s.receivedAt >= s.occurredAt) {
      if (e.phase === "started") { p.processId = e.processId; p.attemptEventId = e.attemptEventId; continue; }
      if (e.processId && (e.processId !== p.processId || e.attemptEventId !== p.attemptEventId) || !e.processId && p.processId) continue;
      if (["completed", "interrupted", "failed"].includes(e.phase) && e.after.fatigue !== undefined &&
        e.elapsedHours > 0 && e.elapsedHours === s.occurredAt - p.at) {
        const expected = clamp(p.fatigue + p.rate * e.elapsedHours), actual = e.after.fatigue;
        m.last = { expected, actual, error: actual - expected, evidenceIds: [...s.causeEventIds] };
        m.errors += Math.abs(actual - expected); m.matched++;
        if (c.effortBody!.learningEnabled && actual > 0 && actual < 1 &&
          (!["rest", "sleep"].includes(p.action) || (e.before.nutritionNeed! >= .75) === (e.after.nutritionNeed! >= .75))) {
          m.models[p.key] = average(m.models[p.key], (actual - p.fatigue) / e.elapsedHours);
          if (Object.keys(m.models).length > 24) delete m.models[Object.keys(m.models)[0]];
        }
      } else m.excluded++;
      delete m.pending;
    }
    const offer = m.trade.offer;
    if (offer && s.trade?.offerId === offer.id) {
      if (c.effortBody!.learningEnabled) m.trade.successes++;
      delete m.trade.offer; delete m.goal;
    } else if (offer && s.offerChange?.id === offer.id && !s.offerChange.valid) {
      if (!offer.expired) m.trade.censored++;
      delete m.trade.offer;
    }
    if (s.offerChange?.valid) m.trade.offer = { id: s.offerChange.id, at: s.occurredAt, deadline: s.occurredAt + 2 };
  }
  if (m.pending && at > m.pending.at + 48) { m.excluded++; delete m.pending; }
}

/** A finite comparison, with cash valuable only through food still needed by this person. */
export function evaluateJourney(c: VillageContext, m: AnticipationMemory, quantity: number, at: number): EffortCandidate {
  const e = m.effort!, market = c.knownLandmarks!.market, home = c.needs!.home;
  const mass = c.carriedMass + quantity * c.bulkTransport!.grainUnitMass;
  const out = travelEstimate(m, { ...c, carriedMass: mass }, "market", market);
  const probability = c.effortBody!.learningEnabled ? (e.trade.successes + 1) / (e.trade.successes + e.trade.failures + 2) : .5;
  const returnLoaded = travelEstimate(m, { ...c, cell: market, siteId: "market", carriedMass: mass }, home.siteId, home.cell);
  const returnLight = travelEstimate(m, { ...c, cell: market, siteId: "market", carriedMass: c.carriedMass }, home.siteId, home.cell);
  const wait = 2, hours = 1 + out.hours + out.margin + wait + 2 + Math.max(returnLoaded.hours + returnLoaded.margin, returnLight.hours + returnLight.margin);
  const effort = rate(e, "travel", { ...c, carriedMass: mass });
  const fatigue = clamp(c.effortBody!.fatigue + effort * (out.hours + out.margin + (1 - probability) * returnLoaded.hours) +
    rate(e, "travel", c) * probability * returnLight.hours + wait * mass * .003);
  const cold = forecastCold(m, c.cold, at, hours, false).peak;
  const price = Math.max(1, Math.ceil(c.foodMarket!.grainBatchPrice * quantity / c.foodMarket!.grainBatchQuantity));
  // Money and the food it may buy are counted once as an instrumental benefit.
  const usefulCash = Math.min(price, Math.max(0, 8 - c.ownCash));
  const benefit = 5 * usefulCash * probability * Math.exp(-.04 * (out.hours + wait));
  const cost = 6 * Math.max(0, fatigue - c.effortBody!.fatigue) + .12 * hours + .6 * mass / 20 * (out.hours + wait);
  const sleep = forecastSleep(c, m.sleep!, out.hours + out.margin + wait + 2).peak;
  const feasible = fatigue < .92 && cold < 8 && sleep < .88 && (c.edibleMeals ?? 0) > 0;
  return { goal: `sell-grain-${quantity}`, hours, benefit, cost, value: benefit - cost, feasible,
    probability, fatigue, cold, reason: feasible ? "loaded outward, bounded sale wait, food purchase and unsold return included" : "insufficient food, recovery or shelter margin for complete journey" };
}

export function effortDecision(c: VillageContext, memory: VillageMemory, actorId: string, at: number, stimuli: VillageStimulus[]): VillageResponse {
  const m = memory.anticipation!, e = m.effort ??= newEffortMemory(), b = c.effortBody!;
  observeEffort(e, c, stimuli, at); e.candidates = [];
  const home = c.needs!.home, food = c.edibleMeals ?? 0, raw = c.grainCarried ?? 0;
  const grain = c.ownFoodLots?.find((l) => l.product === "grain" && !l.offered);
  const homeTrip = travelEstimate(m, c, home.siteId, home.cell);
  const risk = forecastCold(m, c.cold, at, homeTrip.hours + homeTrip.margin + 2, false).peak;
  const finish = (action: VillageAttempt | undefined, reason: string) => {
    if (action && !c.activeAction && ["travel", "gather_plant", "till_plot", "sow_plot", "harvest_plot", "bake_bread"].includes(action.kind)) {
      const needed = action.kind === "travel" ? (() => { const point = m.predictions?.knownSites[action.siteId] ?? c.knownLandmarks?.[action.siteId];
        return (point ? travelEstimate(m, c, action.siteId, point).hours : 2) * (1 + Math.ceil(c.carriedMass / 8)); })() :
        action.kind === "gather_plant" ? action.quantity : ["till_plot", "harvest_plot"].includes(action.kind) ? c.farmingSkills.grain >= 2 ? 1 : 2 : action.kind === "bake_bread" ? 2 : 1;
      if (c.energy < needed) { action = b.nutritionNeed >= .9 && !b.digesting ? undefined : { kind: "rest" }; reason = b.nutritionNeed >= .9 && !b.digesting ? "insufficient nutritional supply for observed work; waiting for a possible food opportunity" : "recover before undertaking effort beyond current activity capacity"; }
    }
    e.selected = reason; m.lastAction = c.activeAction ?? action?.kind ?? "wait";
    m.reasoning = { reason, evidenceIds: stimuli.flatMap((s) => s.causeEventIds), leadHours: homeTrip.hours + homeTrip.margin,
      forecastCold: risk, forecastDebt: 0, uncertainty: homeTrip.margin,
      candidates: e.candidates.map((p) => ({ goal: p.goal, cost: p.cost, cold: p.cold, debt: 0 })) };
    return { attempts: action ? [action] : [], subjectiveUpdate: memory, wait: { at: at + 1 } };
  };
  const unload = (): VillageAttempt | undefined => {
    const carried = c.carriedInventory?.filter((i) => !i.edible || i.mass > 4)
      .sort((a, d) => Number(a.edible) - Number(d.edible) || d.mass - a.mass)[0];
    if (!carried) return;
    const offered = c.ownFoodLots?.find((l) => l.id === carried.id)?.offered;
    if (offered && e.trade.offer) return { kind: "withdraw_surplus_offer", offerId: e.trade.offer.id };
    const store = c.grainStores?.find((s) => s.siteId === c.siteId && s.capacity - s.grain >= carried.quantity);
    if (carried.kind === "grain" && store) return { kind: "store_grain", lotId: carried.id, storeId: store.id };
    if (c.needs!.sheltered && (c.homeStorage?.freeMass ?? 0) >= carried.mass) return { kind: "store_home", objectId: carried.id, quantity: carried.quantity };
    return { kind: "set_down", objectId: carried.id, quantity: carried.edible ? Math.max(1, carried.quantity - (carried.kind === "herb" ? 4 : 2)) : carried.quantity };
  };
  if (c.activeAction) {
    if (c.activeAction === "sleep") return finish(undefined, "continue actual sleep; no new work while asleep");
    if (e.goal && at >= e.goal.deadline && c.activeAction === "travel") {
      delete e.goal; return finish({ kind: "interrupt_action" }, "purpose deadline expired; stop rather than continue unbounded effort");
    }
    if (c.cold >= 10 || b.fatigue >= .86 || c.needs!.sleep!.sleepiness >= .92 ||
      c.activeAction !== "rest" && c.hunger > 0 && food > 0 && b.nutritionNeed > .55)
      return finish({ kind: "interrupt_action" }, "stop at safe hourly boundary; retain actual progress and relieve discomfort");
    return finish(undefined, "continue bounded work while observed discomfort remains tolerable");
  }
  if (c.hunger > 0 && food > 0) return finish({ kind: "eat" }, "relieve current hunger with actual edible food; absorption follows later");
  if (food < 2) {
    const ground = c.ownGroundItems?.find((l) => !["grain", "seed", "wood"].includes(l.kind) && l.quantity >= (l.kind === "herb" ? 2 : 1));
    if (ground) return finish({ kind: "take_ground", objectId: ground.id, quantity: ground.kind === "herb" ? 2 : 1 }, "retrieve a small edible amount from own locally observed ground reserve");
  }
  if (c.homeStorage && food < 2) {
    const stored = c.homeStorage.items.find((l) => !["grain", "seed", "wood"].includes(l.kind) && (l.expiresDay ?? Infinity) > c.day);
    if (stored) return finish({ kind: "take_home", objectId: stored.id, quantity: Math.min(stored.quantity, stored.kind === "herb" ? 2 : 1) }, "retrieve actual edible home reserve");
  }
  if (c.siteId === "market" && food < 2) {
    const offer = c.visibleFoodOffers?.filter((o) => o.product !== "grain" && o.price <= c.ownCash && o.quantity <= c.bulkTransport!.bagFreeMass)
      .sort((a, d) => a.price - d.price)[0];
    if (offer) return finish({ kind: "buy_surplus", offerId: offer.id }, "buy locally observed food; cash is a means to nutrition");
  }
  if ((b.loadDiscomfort >= .65 && !e.goal || b.fatigue >= .65 && c.carriedMass > 4) && unload()) {
    delete e.goal; return finish(unload(), "put down heavy cargo now; spent nutrition and accumulated fatigue remain");
  }
  if (c.needs!.sheltered && canPlanSleep(c, m.sleep!, at)) return finish({ kind: "sleep" }, "sleep when actually ready; nutrition is still consumed during sleep");
  if (b.nutritionNeed >= .9 && !b.digesting && c.energy < 1)
    return finish(undefined, "insufficient nutritional supply for observed work; waiting for a possible food opportunity");
  const immediatePlant = unoccupiedWildPlants(c, actorId).find((p) => p.siteId === c.siteId && p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1));
  if (immediatePlant && food < 2 && c.cold < 8 && b.fatigue < .8)
    return finish({ kind: "gather_plant", plantId: immediatePlant.id, quantity: immediatePlant.species === "herb" ? 2 : Math.min(3, immediatePlant.available, 3 - food) }, "gather immediately available food before a shelter journey");
  if (!c.needs!.sheltered && (c.cold >= 6 || risk >= 8 || c.needs!.sleep!.sleepiness >= .72)) {
    if (c.energy < homeTrip.hours * (1 + c.carriedMass / 8) + 1) return finish(unload() ?? { kind: "rest" }, "reduce load and recover before shelter journey");
    if (e.trade.offer) return finish({ kind: "withdraw_surplus_offer", offerId: e.trade.offer.id }, "withdraw offer before necessary shelter; do not infer absent demand");
    delete e.goal; return finish({ kind: "travel", siteId: home.siteId }, "return before forecast cold or sleepiness becomes severe");
  }
  if (b.fatigue >= .55) return finish(unload() ?? { kind: "rest" }, "recover independent activity fatigue before further work");
  if (c.siteId === "market") {
    const purchase = c.visibleFoodOffers?.filter((o) => o.product !== "grain" && o.price <= c.ownCash && o.quantity <= c.bulkTransport!.bagFreeMass)
      .sort((a, d) => a.price - d.price)[0];
    if (food < 2 && purchase) return finish({ kind: "buy_surplus", offerId: purchase.id }, "buy locally observed food; cash is a means to nutrition");
    if (e.trade.offer) {
      if (at >= e.trade.offer.deadline) {
        if (!e.trade.offer.expired) { e.trade.offer.expired = true; if (b.learningEnabled) e.trade.failures++; e.trade.retryAt = at + 24; }
        return finish({ kind: "withdraw_surplus_offer", offerId: e.trade.offer.id }, "bounded valid offer wait expired; withdraw and store unsold cargo");
      }
      return finish(undefined, "wait within agreed personal tolerance for a valid sale opportunity");
    }
    if (e.goal?.kind === "sale" && raw > 0 && at < e.goal.deadline && at >= e.trade.retryAt && grain) {
      return finish({ kind: "post_surplus_offer", lotId: grain.id, quantity: grain.quantity,
        price: Math.max(1, Math.ceil(c.foodMarket!.grainBatchPrice * grain.quantity / c.foodMarket!.grainBatchQuantity)) }, "offer actual cargo for bounded sale then food purchase and return");
    }
    if (raw > 0 && c.foodMarket!.bakingSkill === 0) {
      const put = unload(); if (put) { delete e.goal; return finish(put, "store unsold grain at market before further food search"); }
    }
    if (c.foodMarket!.bakingSkill > 0) {
      const bread = c.ownFoodLots?.find((l) => l.product === "bread" && !l.offered && l.quantity >= 1);
      if (bread && food > 2) return finish({ kind: "post_surplus_offer", lotId: bread.id, quantity: 1, price: c.foodMarket!.breadPrice }, "offer bread surplus while retaining personal food");
      const stored = c.grainStores?.find((s) => s.siteId === c.siteId && s.grain > 0);
      if (stored && food < 5) return finish({ kind: "bake_bread", lotId: stored.lots[0].id }, "process stored grain into edible bread");
      const ingredient = c.visibleFoodOffers?.filter((o) => o.product === "grain" && o.price <= c.ownCash).sort((a, d) => a.price - d.price)[0];
      if (ingredient && (stored?.grain ?? 0) < 6) return finish({ kind: "buy_surplus", offerId: ingredient.id }, "buy observed grain for bread production");
    }
  }
  if (e.goal && at >= e.goal.deadline) delete e.goal;
  if (e.goal?.kind === "sale" && raw > 0) return finish({ kind: "travel", siteId: "market" }, "continue finite sale purpose while burden remains tolerable");
  if (raw > 0 && !m.cropPlan && c.foodMarket!.bakingSkill === 0) {
    const put = unload(); if (put) return finish(put, "store unplanned grain instead of carrying it without a purpose");
  }
  if (food < 2) {
    if (c.needs!.sheltered && forecastCold(m, c.cold, at, 4, false).peak >= 8 && c.hunger < 2)
      return finish(undefined, "wait for safer temperature before an exposed food search");
    const plants = unoccupiedWildPlants(c, actorId).filter((p) => p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1))
      .sort((a, d) => {
        const score = (p: typeof a) => { const quantity = p.species === "herb" ? 2 : Math.min(3, p.available);
          const trip = travelEstimate(m, c, p.siteId!, p.cell!);
          return (trip.hours + quantity + 1) / (p.species === "herb" ? 1 : quantity) + personalChoiceOrder(actorId, p.siteId!) * .05; };
        return score(a) - score(d) || a.id.localeCompare(d.id);
      });
    const target = plants[0];
    if (target) return finish(c.siteId === target.siteId ? { kind: "gather_plant", plantId: target.id, quantity: target.species === "herb" ? 2 : Math.min(3, target.available, 3 - food) } :
      { kind: "travel", siteId: target.siteId! }, "obtain a small edible reserve from an observed unoccupied plant");
    const place = forageDestination(m.foraging!, c, at, actorId);
    if (place) return finish({ kind: "travel", siteId: place.siteId }, place.reason);
    const explored = e.explored ??= {}; if (!c.siteId.startsWith("transit_")) explored[c.siteId] = at;
    const destination = Object.entries(c.knownLandmarks!).filter(([id]) => id !== c.siteId && id !== "market" && (explored[id] === undefined || at - explored[id] >= 12))
      .sort(([a, pa], [d, pd]) => (explored[a] ?? -100) - (explored[d] ?? -100) ||
        Math.max(Math.abs(pa.x - c.cell.x), Math.abs(pa.y - c.cell.y)) - Math.max(Math.abs(pd.x - c.cell.x), Math.abs(pd.y - c.cell.y)) ||
        personalChoiceOrder(actorId, a) - personalChoiceOrder(actorId, d))[0];
    if (destination) return finish({ kind: "travel", siteId: destination[0] }, "explore a known landmark; learn food availability only on local observation");
  }
  const localStock = c.grainStores?.find((s) => s.siteId === c.siteId && s.grain > c.bulkTransport!.plantingReserve);
  if (localStock && c.ownCash < 8 && food > 0 && at >= e.trade.retryAt && !m.cropPlan) {
    e.candidates = Array.from({ length: Math.min(5, localStock.lots[0].quantity, localStock.grain - c.bulkTransport!.plantingReserve,
      Math.floor(c.bulkTransport!.bagFreeMass / c.bulkTransport!.grainUnitMass)) }, (_, i) => evaluateJourney(c, m, i + 1, at));
    const best = e.candidates.filter((p) => p.feasible && p.value > 0).sort((a, d) => d.value - a.value)[0];
    if (best) {
      const quantity = Number(best.goal.split("-").at(-1));
      e.goal = { kind: "sale", quantity, startedAt: at, deadline: at + Math.ceil(best.hours) };
      return finish({ kind: "load_grain", lotId: localStock.lots[0].id, quantity: Math.min(quantity, localStock.lots[0].quantity) }, "accept bounded effort for useful food purchasing power after comparing complete journeys");
    }
  }
  if (c.ownFarm && food >= 2 && c.ownCash < 8 && at >= e.trade.retryAt && !m.cropPlan) {
    const stock = c.fieldGrainStores?.filter((s) => s.grain > c.bulkTransport!.plantingReserve && s.siteId !== c.siteId)
      .sort((a, d) => travelEstimate(m, c, a.siteId, a.cell).hours - travelEstimate(m, c, d.siteId, d.cell).hours)[0];
    if (stock && c.hourOfDay >= 8 && c.hourOfDay < 13 && b.fatigue < .35) {
      const journey = travelEstimate(m, c, stock.siteId, stock.cell);
      if (forecastCold(m, c.cold, at, journey.hours + 2, false).peak < 8)
        return finish({ kind: "travel", siteId: stock.siteId }, "visit own stored surplus during a safe window; compare complete sale journey before loading");
    }
  }
  if (c.ownFarm && food > 0) {
    const stored = (c.grainStores ?? []).reduce((n, s) => n + s.grain, 0);
    if (m.cropPlan) { const choice = cultivationChoice(c, m, actorId); if (choice) return finish(choice.attempt, choice.reason); }
    const crop = c.visiblePlants.find((p) => p.ownerId === actorId && p.species === "grain" && ["bare", "tilled", "ripe"].includes(p.stage));
    if (crop && stored < 40) {
      if (["bare", "tilled"].includes(crop.stage)) {
        m.cropPlan = { plantId: crop.id, siteId: crop.siteId!, cell: crop.cell!, stage: crop.stage as "bare" | "tilled", observedAt: at };
        const choice = cultivationChoice(c, m, actorId); if (choice) return finish(choice.attempt, choice.reason);
      } else return finish(c.siteId === crop.siteId ? { kind: "harvest_plot", plantId: crop.id } : { kind: "travel", siteId: crop.siteId! }, "harvest owned crop into physical field storage");
    }
    if (stored < 40 && !c.ownFarm.plotIds.includes(c.siteId)) {
      const site = c.ownFarm.plotIds[at % c.ownFarm.plotIds.length];
      if (site !== c.siteId) return finish({ kind: "travel", siteId: site }, "reobserve owned crop before committing to work");
    }
  }
  if (c.foodMarket!.bakingSkill > 0 && food > 0 && c.siteId !== "market" && c.hourOfDay >= 8 && c.hourOfDay < 17)
    return finish({ kind: "travel", siteId: "market" }, "return to known bakery while retaining food and recovery margin");
  if (c.needs!.sheltered && raw === 0 && food > 0 && c.hourOfDay >= 19) return finish(undefined, "wait at shelter with food reserve until sleep readiness");
  if (!c.needs!.sheltered && (c.hourOfDay >= 19 || b.fatigue > .3)) return finish({ kind: "travel", siteId: home.siteId }, "choose low effort shelter and recovery with reserve sufficient");
  return finish(undefined, "no observed useful task outweighs its present effort");
}

export function checkEffortMemory(m: EffortMemory, at: number) {
  if (m.version !== 1 || Object.keys(m.models).length > 24 || m.candidates.length > 5 ||
    [m.matched, m.excluded, m.trade.successes, m.trade.failures, m.trade.censored, m.trade.retryAt].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isFinite(m.errors) || m.errors < 0 || Object.values(m.models).some((v) => !Number.isSafeInteger(v.count) || v.count < 1 || !Number.isFinite(v.mean)) ||
    m.pending && (m.pending.at > at || ![m.pending.fatigue, m.pending.rate, m.pending.prior].every(Number.isFinite)) ||
    m.goal && (m.goal.startedAt > at || m.goal.deadline <= m.goal.startedAt) ||
    m.trade.offer && (m.trade.offer.at > at || m.trade.offer.deadline <= m.trade.offer.at) ||
    m.candidates.some((v) => ![v.hours, v.benefit, v.cost, v.value, v.fatigue, v.cold].every(Number.isFinite))) throw Error("invalid effort memory");
}
