import { actionObservation, effortForecast } from "./action-learning";
import { forecastCold, travelEstimate, type AnticipationMemory } from "./anticipatory-needs";
import type { VillageAttempt, VillageContext } from "./autonomous-world";
import { forageDestination } from "./foraging-memory";
import { personalChoiceOrder } from "./personal-choice";

type FoodItem = { id: string; kind: string; quantity: number; expiresDay?: number };
export type FoodCandidate = {
  kind: "gather" | "home" | "buy" | "market" | "explore"; siteId: string; source: "observed" | "remembered" | "unconfirmed";
  foodHours: number; returnHours: number; meals: number; cold: number; debt: number; effort: number;
  feasible: boolean; exclusion?: "occupied" | "expiry" | "body"; score: number;
};
export type FoodPlanningMemory = {
  home?: { seenAt: number; items: FoodItem[] };
  evaluation?: { at: number; needAt: number; usableMeals: number; candidates: FoodCandidate[]; selected?: number };
};
const edible = (kind: string) => !["grain", "seed", "wood"].includes(kind);
const mealQuantity = (kind: string) => kind === "herb" ? 2 : 1;
// Daily spoilage occurs at hour 1 of expiresDay, before that hour's decision.
const expiresAt = (item: { expiresDay?: number }) => item.expiresDay === undefined ? Infinity : (item.expiresDay - 1) * 24 + 1;
export function foodNeedAt(c: VillageContext, at: number) {
  return c.hunger > 0 ? at : at + 24 - (c.needs!.needClockHours ?? c.needs!.mealHours % 24);
}
export function usableCarriedMeals(c: VillageContext, at: number) {
  return (c.ownFoodLots ?? []).filter((item) => item.product !== "grain" && expiresAt(item) > at)
    .reduce((n, item) => n + Math.floor(item.quantity / item.mealQuantity), 0);
}
export function unoccupiedWildPlants(c: VillageContext, actorId: string) {
  return c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
    !c.visiblePlantWork?.some((work) => work.actorId !== actorId && work.plantId === p.id));
}
export function observeHomeFood(c: VillageContext, m: AnticipationMemory, at: number) {
  const planning = m.foodPlanning ??= {};
  if (c.homeStorage) planning.home = { seenAt: at,
    items: c.homeStorage.items.filter((item) => edible(item.kind)).slice(0, 40).map((item) => ({ ...item })) };
}
export function prepareFoodJourney(c: VillageContext, at: number) {
  if (!c.homeStorage || foodNeedAt(c, at) - at > 16 || usableCarriedMeals(c, foodNeedAt(c, at)) > 0) return;
  const cargo = c.carriedInventory?.find((item) => !item.edible && item.mass > 0 &&
    !(item.kind === "grain" && c.foodMarket!.bakingSkill > 0));
  if (!cargo) return;
  if (cargo.kind === "grain") {
    const store = c.grainStores!.find((s) => s.siteId === c.siteId && s.capacity - s.grain >= cargo.quantity);
    if (store) return { attempt: { kind: "store_grain", lotId: cargo.id, storeId: store.id } as VillageAttempt,
      reason: "store unnecessary cargo before seeking edible food" };
  }
  if ((c.homeStorage.freeMass ?? 0) >= cargo.mass) return {
    attempt: { kind: "store_home", objectId: cargo.id, quantity: cargo.quantity } as VillageAttempt,
    reason: "store unnecessary cargo before seeking edible food" };
}
export function mealShelterChoice(c: VillageContext, m: AnticipationMemory, at: number) {
  if (c.needs!.sheltered || (c.edibleMeals ?? 0) === 0 || c.needs!.temperature >= 16) return;
  const home = c.needs!.home, trip = travelEstimate(m, c, home.siteId, home.cell);
  const cold = forecastCold(m, c.cold, at, 1 + trip.hours + trip.margin, false);
  const effort = Math.max(0, -effortForecast(m.learning, "travel", { ...actionObservation(c), sheltered: false }).rate);
  if (cold.peak >= 8 && c.energy >= (trip.hours + trip.margin) * effort + 2) return {
    attempt: { kind: "travel", siteId: home.siteId } as VillageAttempt,
    reason: "carry edible food to shelter before another exposed meal decision" };
}

/** Bounded, explicit food → shelter forecasts. Scores are initial policy, not learned action values. */
export function foodPlanningChoice(c: VillageContext, m: AnticipationMemory, actorId: string, at: number) {
  const body = c.needs!, home = body.home, planning = m.foodPlanning ??= {};
  const needAt = foodNeedAt(c, at), usable = usableCarriedMeals(c, needAt);
  if (usable > 0) { delete planning.evaluation; return; }
  const candidates: { forecast: FoodCandidate; attempt: VillageAttempt; goal?: string; reason: string }[] = [];
  const add = (kind: FoodCandidate["kind"], siteId: string, cell: { x: number; y: number }, quantity: number,
    meals: number, workHours: number, attempt: VillageAttempt, source: FoodCandidate["source"], reason: string,
    exclusion?: FoodCandidate["exclusion"], goal?: string) => {
    const outward = travelEstimate(m, c, siteId, cell);
    const toHours = outward.hours + outward.margin;
    const foodHours = toHours + workHours + 1;
    const loaded = { ...c, siteId, cell, carriedMass: c.carriedMass + quantity,
      needs: { ...body, sheltered: siteId === home.siteId } };
    const inward = travelEstimate(m, loaded, home.siteId, home.cell);
    const returnHours = inward.hours + inward.margin;
    const hours = foodHours + returnHours;
    const exposure = forecastCold(m, c.cold, at, siteId === home.siteId ? toHours : hours,
      siteId === home.siteId && c.siteId === home.siteId);
    const cold = exposure.peak;
    const travelRate = Math.max(0, -effortForecast(m.learning, "travel", { ...actionObservation(c), sheltered: false }).rate);
    const workRate = Math.max(0, -effortForecast(m.learning, kind === "gather" ? "gather_plant" : "travel", actionObservation(loaded)).rate);
    const returnRate = Math.max(0, -effortForecast(m.learning, "travel", { ...actionObservation(loaded), sheltered: false }).rate);
    const effort = toHours * travelRate + (kind === "gather" ? workHours * workRate : 0) + returnHours * returnRate;
    const debt = body.sleepDebt + hours;
    exclusion ??= cold >= 8 || debt >= (c.hunger > 0 ? 24 : 20) || effort + 2 > c.energy ? "body" : undefined;
    // Compare the cost per usable meal: choosing one nearby herb meal every time can
    // crowd out a small berry reserve and consume every working window in food searches.
    const score = (Math.max(0, foodHours - (needAt - at)) * 4 + hours + effort * 0.25 + cold * 0.5 + debt * 0.1) / Math.max(1, meals) +
      (source === "remembered" ? 2 : source === "unconfirmed" ? 8 : 0) - (m.goal?.kind === "forage" && m.goal.siteId === siteId ? 0.5 : 0) +
      personalChoiceOrder(actorId, siteId) * 0.05;
    candidates.push({ forecast: { kind, siteId, source, foodHours, returnHours, meals, cold, debt, effort,
      feasible: exclusion === undefined, ...(exclusion ? { exclusion } : {}), score }, attempt, goal, reason });
  };
  const wild = c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
    p.stage === "ripe" && p.cell && p.siteId && p.available >= mealQuantity(p.species));
  const occupied = (id: string) => c.visiblePlantWork?.some((work) => work.actorId !== actorId && work.plantId === id) ? 1 : 0;
  wild.sort((a, b) => occupied(a.id) - occupied(b.id) || Math.max(Math.abs(a.cell!.x - c.cell.x), Math.abs(a.cell!.y - c.cell.y)) -
    Math.max(Math.abs(b.cell!.x - c.cell.x), Math.abs(b.cell!.y - c.cell.y)) || a.id.localeCompare(b.id));
  for (const plant of wild.slice(0, 5)) {
    const perMeal = mealQuantity(plant.species);
    let quantity = Math.floor(Math.min(plant.available, c.bulkTransport!.bagFreeMass, perMeal * 3) / perMeal) * perMeal;
    if (!quantity) continue;
    const occupied = c.visiblePlantWork?.some((work) => work.actorId !== actorId && work.plantId === plant.id);
    for (; quantity >= perMeal; quantity -= perMeal) {
      add("gather", plant.siteId!, plant.cell!, quantity, quantity / perMeal, quantity,
        c.siteId === plant.siteId ? { kind: "gather_plant", plantId: plant.id, quantity } : { kind: "travel", siteId: plant.siteId! },
        "observed", "obtain food before sleep using an observed unoccupied plant", occupied ? "occupied" : undefined, plant.siteId);
      if (candidates.at(-1)!.forecast.feasible || occupied || quantity === perMeal) break;
      candidates.pop(); // Reduce the batch using the same frozen body/effort estimate.
    }
  }
  const homeFood = c.homeStorage?.items ?? planning.home?.items ?? [];
  for (const item of homeFood) {
    if (!edible(item.kind) || item.quantity < mealQuantity(item.kind) || c.bulkTransport!.bagFreeMass < mealQuantity(item.kind)) continue;
    const trip = travelEstimate(m, c, home.siteId, home.cell);
    if (expiresAt(item) <= Math.max(needAt, at + trip.hours + trip.margin + 2)) continue;
    add("home", home.siteId, home.cell, mealQuantity(item.kind), 1, 1,
      c.siteId === home.siteId ? { kind: "take_home", objectId: item.id, quantity: mealQuantity(item.kind) } : { kind: "travel", siteId: home.siteId },
      c.homeStorage ? "observed" : "remembered", "retrieve remembered edible home reserve before sleep");
    break;
  }
  const offer = c.visibleFoodOffers?.filter((offer) => offer.sellerId !== actorId && offer.product !== "grain" &&
    offer.price <= c.ownCash && offer.quantity <= c.bulkTransport!.bagFreeMass && expiresAt(offer) > Math.max(needAt, at + 2))
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
  if (offer) add("buy", c.siteId, c.cell, offer.quantity, Math.floor(offer.quantity / mealQuantity(offer.species)), 1,
    { kind: "buy_surplus", offerId: offer.id }, "observed", "buy observed food before the next sleep and meal deadline");
  const market = m.predictions?.knownSites.market;
  if (!offer && market && c.siteId !== "market" && c.foodMarket!.bakingSkill === 0 && c.ownCash >= c.foodMarket!.breadPrice &&
    (at >= (m.foodMarket?.retryAt ?? 0) || m.foodMarket?.retryPurpose === "grain-sale")) {
    add("market", "market", market, 1, 0, 2, { kind: "travel", siteId: "market" }, "unconfirmed",
      "check known market for food; current offers are unconfirmed");
  }
  // A remembered destination still consumes exposure and waking time. Otherwise the fallback
  // can leave shelter every cold hour, reject gathering on arrival, and immediately set out again.
  if (m.foraging && !candidates.some((p) => p.forecast.feasible && p.forecast.source === "observed")) {
    const occupiedSites = new Set(c.visiblePlantWork?.filter((w) => w.actorId !== actorId)
      .flatMap((w) => c.visiblePlants.filter((p) => p.id === w.plantId).map((p) => p.siteId)));
    const places = Object.fromEntries(Object.entries(m.foraging.places).filter(([, p]) => !occupiedSites.has(p.siteId)));
    const target = forageDestination({ places }, c, at, actorId);
    const place = target && Object.values(places).find((p) => p.siteId === target.siteId);
    if (target && place) add("explore", place.siteId, { x: place.x, y: place.y }, 0, 0, 2,
      { kind: "travel", siteId: place.siteId }, "remembered", target.reason);
  }
  const times = candidates.filter((p) => p.forecast.feasible).map((p) => p.forecast.foodHours + p.forecast.returnHours);
  const shortest = times.length ? Math.min(...times) : 4;
  // Compare with a sleep interval as well as acquisition: waiting until hunger can miss the working window.
  if (needAt - at > 8 + shortest) { delete planning.evaluation; return; }
  // A baker's available ingredient has its own existing production chain.
  if (c.foodMarket!.bakingSkill > 0 && (c.grainStores!.some((s) => s.grain > 0) ||
    c.visibleFoodOffers?.some((offer) => offer.product === "grain" && offer.price <= c.ownCash))) { delete planning.evaluation; return; }
  planning.evaluation = { at, needAt, usableMeals: usable, candidates: candidates.slice(0, 8).map((p) => p.forecast) };
  const selected = candidates.filter((p) => p.forecast.feasible && p.forecast.kind !== "explore").sort((a, b) => a.forecast.score - b.forecast.score ||
    a.forecast.siteId.localeCompare(b.forecast.siteId))[0];
  if (selected) {
    planning.evaluation.selected = candidates.indexOf(selected);
    if (selected.goal) m.goal = { kind: "forage", siteId: selected.goal, startedAt: m.goal?.startedAt ?? at };
    return { attempt: selected.attempt, reason: selected.reason };
  }
  // Exploration checks a place and promises no meal. Keep existing cultivation/trade goals
  // ahead of this fallback; a viable check must not displace the baker's procurement work.
  if (candidates.some((p) => p.forecast.kind === "explore" && p.forecast.feasible)) return;
  const knownBodyConstraint = candidates.some((p) => p.forecast.source !== "unconfirmed" && p.forecast.exclusion === "body");
  if (body.sheltered && knownBodyConstraint && body.sleepDebt >= 8) return { attempt: { kind: "sleep" } as VillageAttempt,
    reason: "sleep before a food journey that would exceed the available working window" };
  if (body.sheltered && knownBodyConstraint && candidates.some((p) => p.forecast.effort + 2 > c.energy)) return {
    attempt: { kind: "rest" } as VillageAttempt, reason: "recover effort before a known food acquisition journey" };
  if (body.sheltered && knownBodyConstraint) return {
    reason: "wait in shelter for a safer food acquisition window" };
  if (!body.sheltered && knownBodyConstraint) {
    const trip = travelEstimate(m, c, home.siteId, home.cell);
    const effort = Math.max(0, -effortForecast(m.learning, "travel", actionObservation(c)).rate);
    return { attempt: c.energy < (trip.hours + trip.margin) * effort + 2 ? { kind: "rest" } as VillageAttempt :
      { kind: "travel", siteId: home.siteId } as VillageAttempt,
      reason: "recover or return to shelter before an unsafe food acquisition journey" };
  }
}

export function checkFoodPlanning(memory: FoodPlanningMemory, at: number) {
  const e = memory.evaluation;
  if (memory.home && (!Number.isSafeInteger(memory.home.seenAt) || memory.home.seenAt < 0 || memory.home.seenAt > at ||
    memory.home.items.length > 40 || memory.home.items.some((i) => !i.id || !edible(i.kind) || !Number.isSafeInteger(i.quantity) || i.quantity < 1 ||
      i.expiresDay !== undefined && (!Number.isSafeInteger(i.expiresDay) || i.expiresDay < 1))) ||
    e && (!Number.isSafeInteger(e.at) || e.at < 0 || e.at > at || !Number.isFinite(e.needAt) || e.needAt < e.at || e.candidates.length > 8 ||
      e.selected !== undefined && (!Number.isSafeInteger(e.selected) || !e.candidates[e.selected]?.feasible) ||
      [e.usableMeals, ...e.candidates.flatMap((p) => [p.foodHours, p.returnHours, p.meals, p.cold, p.debt, p.effort, p.score])]
        .some((n) => !Number.isFinite(n) || n < 0))) throw Error("invalid food planning memory");
}
