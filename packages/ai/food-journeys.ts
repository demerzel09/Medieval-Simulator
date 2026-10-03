import { forecastSleep } from "./sleep-forecast";
import { forecastCold, travelEstimate, type AnticipationMemory } from "./anticipatory-needs";
import { actionObservation, effortForecast } from "./action-learning";
import type { VillageAttempt, VillageContext } from "./autonomous-world";

type Choice = { attempt?: VillageAttempt; reason: string };

/** Compare one local transaction plus the return journey; urgent shelter still takes precedence. */
export function localFoodTransaction(c: VillageContext, m: AnticipationMemory, actorId: string, at: number): Choice | undefined {
  if (c.siteId !== "market" || c.foodMarket!.bakingSkill > 0 || c.cold >= 8) return;
  const offer = c.visibleFoodOffers?.filter((o) => o.sellerId !== actorId && o.product !== "grain" &&
    o.price <= c.ownCash && o.quantity <= c.bulkTransport!.bagFreeMass)
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
  const purchase = (c.edibleMeals ?? 0) < 2 ? offer : undefined;
  const rawStored = c.grainStores!.reduce((n, store) => n + store.grain, 0);
  const reserve = Math.max(m.cropPlan ? 1 : 0, c.bulkTransport!.plantingReserve - rawStored);
  const grain = c.ownFoodLots!.find((lot) => lot.product === "grain" && !lot.offered && lot.quantity > 0);
  const quantity = grain ? Math.min(c.foodMarket!.grainBatchQuantity, grain.quantity, (c.grainCarried ?? 0) - reserve) : 0;
  const sale = grain && quantity > 0 && c.ownCash < 8 && at >= (m.foodMarket?.retryAt ?? 0);
  if (!purchase && !sale) return;
  const loaded = { ...c, carriedMass: c.carriedMass + (purchase?.quantity ?? 0) };
  const home = c.needs!.home;
  const trip = travelEstimate(m, loaded, home.siteId, home.cell);
  // An atomic purchase still defers the next personal decision by one world hour.
  const hours = 1 + trip.hours + trip.margin;
  const cold = forecastCold(m, c.cold, at, hours, false).peak;
  const effort = Math.max(0, -effortForecast(m.learning, "travel", actionObservation(loaded)).rate);
  if (cold >= 8 || (c.sleepRegulation ? forecastSleep(loaded, m.sleep!, hours).peak >= .85 : c.needs!.sleepDebt + hours >= 20) || c.energy < (trip.hours + trip.margin) * effort + 2) return;
  m.reasoning?.candidates.push({ goal: purchase ? "buy-food-then-shelter" : "offer-grain-then-shelter", cold, debt: c.sleepRegulation ? 0 : c.needs!.sleepDebt + hours, ...(c.sleepRegulation ? { sleepiness: forecastSleep(loaded, m.sleep!, hours).peak } : {}), cost: hours });
  return purchase ? { attempt: { kind: "buy_surplus", offerId: purchase.id }, reason: "buy locally observed food while retaining a safe shelter journey" } :
    { attempt: { kind: "post_surplus_offer", lotId: grain!.id, quantity,
      price: Math.max(1, Math.ceil(c.foodMarket!.grainBatchPrice * quantity / c.foodMarket!.grainBatchQuantity)) },
      reason: "offer carried sale grain while retaining a safe shelter journey" };
}

/** A remembered crop is a destination to re-observe, never proof that remote work is still available. */
export function cultivationChoice(c: VillageContext, m: AnticipationMemory, actorId: string): Choice | undefined {
  const plan = m.cropPlan;
  if (!plan) return;
  if (!c.ownFarm?.plotIds.includes(plan.plantId)) { delete m.cropPlan; return; }
  const observed = c.visiblePlants.find((p) => p.id === plan.plantId);
  if (observed) {
    if (observed.ownerId !== actorId || !["bare", "tilled"].includes(observed.stage)) { delete m.cropPlan; return; }
    plan.stage = observed.stage as "bare" | "tilled";
  } else if (c.siteId === plan.siteId) { delete m.cropPlan; return; }
  const needsFood = (c.edibleMeals ?? 0) === 0 && (c.hunger > 0 || Math.max(c.needs!.mealHours, c.needs!.needClockHours ?? 0) >= 16);
  if (needsFood) return;
  if (plan.stage === "bare") return { attempt: c.siteId === plan.siteId ? { kind: "till_plot", plantId: plan.plantId } :
    { kind: "travel", siteId: plan.siteId }, reason: "prepare selected owned crop before loading sowing grain" };
  const grain = c.ownFoodLots!.find((lot) => lot.product === "grain" && lot.quantity > 0 && !lot.offered);
  if (grain) return { attempt: c.siteId === plan.siteId ? { kind: "sow_plot", plantId: plan.plantId, ...(c.offerIntegrity ? { lotId: grain.id } : {}) } :
    { kind: "travel", siteId: plan.siteId }, reason: "carry reserved grain to selected crop, then sow" };
  const store = c.grainStores!.find((s) => s.siteId === c.siteId && s.grain > 0) ?? c.grainStores!.find((s) => s.grain > 0);
  if (!store) { delete m.cropPlan; return; }
  if (c.siteId !== store.siteId) return { attempt: { kind: "travel", siteId: store.siteId }, reason: "retrieve grain for selected cultivated crop" };
  if (c.bulkTransport!.bagFreeMass < c.bulkTransport!.grainUnitMass) return { reason: "leave sowing grain stored until carrying space is available" };
  return { attempt: { kind: "load_grain", lotId: store.lots[0].id, quantity: 1 }, reason: "load one grain for selected cultivated crop" };
}
