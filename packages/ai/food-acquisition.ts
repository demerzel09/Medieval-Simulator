import type { VillageAttempt, VillageContext, VillageStimulus } from "./autonomous-world";
import { forecastCold, travelEstimate, type AnticipationMemory } from "./anticipatory-needs";
import { effortRate } from "./effort-choice";
import { forecastSleep } from "./sleep-forecast";
import { personalChoiceOrder } from "./personal-choice";

type Kind = "gather" | "sale" | "buy" | "home" | "explore";
type Outcome = "acquired" | "observed-food" | "depleted" | "no-food" | "no-buyer" | "timeout" | "fatigue" | "shelter" | "unavailable";
export type AcquisitionCandidate = {
  id: string; kind: Kind; siteId: string; source: "observed" | "remembered" | "unconfirmed";
  quantity: number; meals: number; probability: number; saleProbability: number;
  acquiredAt: number; eatAt: number; absorbedAt: number; hours: number; effort: number;
  fatigue: number; cold: number; sleepiness: number; benefit: number; cost: number; value: number;
  feasible: boolean; exclusion?: string; fallback: string; attempt?: VillageAttempt;
  lotId?: string; plantId?: string;
};
type Plan = { id: string; kind: Kind; siteId: string; quantity: number; lotId?: string; plantId?: string;
  startedAt: number; deadline: number; acquiredAt: number; probability: number;
  stage: "source" | "market" | "sale" | "buy"; arrivedAt?: number; offerId?: string;
  carriedBefore: string[];
  pending?: { id: string; at: number; action: string }; sold?: boolean };
export type AcquisitionMemory = {
  version: 1; sequence: number; retryAt: number;
  market: { successes: number; failures: number; seenAt?: number; offers: NonNullable<VillageContext["visibleFoodOffers"]> };
  candidates: AcquisitionCandidate[]; selected?: string; plan?: Plan;
  outcomes: { id: string; kind: Kind; startedAt: number; at: number; expectedAt: number; probability: number;
    outcome: Outcome; sold: boolean; evidenceIds: string[] }[];
};
const fresh = (): AcquisitionMemory => ({ version: 1, sequence: 0, retryAt: 0,
  market: { successes: 0, failures: 0, offers: [] }, candidates: [], outcomes: [] });
const mealSize = (species: string) => species === "herb" ? 2 : 1;
const expiry = (o: { expiresDay?: number }) => o.expiresDay === undefined ? Infinity : (o.expiresDay - 1) * 24 + 1;
const trip = (m: AnticipationMemory, c: VillageContext, site: string, cell: { x: number; y: number }) => {
  const t = travelEstimate(m, c, site, cell); return t.hours + t.margin;
};
function end(m: AnticipationMemory, at: number, outcome: Outcome, evidenceIds: string[] = []) {
  const a = m.effort!.acquisition!, p = a.plan;
  if (!p) return;
  a.outcomes.push({ id: p.id, kind: p.kind, startedAt: p.startedAt, at, expectedAt: p.acquiredAt,
    probability: p.probability, outcome, sold: !!p.sold, evidenceIds });
  if (a.outcomes.length > 24) a.outcomes.shift();
  if (["buy", "sale"].includes(p.kind) && ["no-food", "no-buyer", "unavailable", "timeout"].includes(outcome)) a.retryAt = at + 12;
  delete a.plan;
}
export function cancelAcquisition(m: AnticipationMemory, at: number, outcome: Outcome) {
  if (m.effort?.acquisition?.plan) end(m, at, outcome);
}
/** Only local observations and execution delivered to this person update the route belief. */
export function observeAcquisition(c: VillageContext, m: AnticipationMemory, stimuli: VillageStimulus[], at: number) {
  const a = m.effort!.acquisition ??= fresh(); a.candidates = []; delete a.selected;
  if (c.siteId === "market") { a.market.seenAt = at; a.market.offers = structuredClone(c.visibleFoodOffers ?? []).slice(0, 20); }
  for (const s of stimuli) {
    if (s.occurredAt > at || s.receivedAt > at || s.receivedAt < s.occurredAt) continue;
    const p = a.plan; if (!p) break;
    if (s.offerChange?.valid && p.kind === "sale" && ["sale", "market"].includes(p.stage)) { p.offerId = s.offerChange.id; p.stage = "sale"; }
    if (p.offerId && s.trade?.offerId === p.offerId) { p.sold = true; p.stage = "buy"; p.arrivedAt = at; }
    const pending = p.pending, x = s.experience;
    if (!pending || x?.predictionId !== pending.id || x.startedAt !== pending.at || s.action !== pending.action ||
      x.elapsedHours !== s.occurredAt - pending.at || x.phase === "started") continue;
    delete p.pending;
    if (x.phase === "completed") {
      if (["gather_plant", "take_home", "buy_surplus"].includes(pending.action)) {
        if (pending.action === "buy_surplus" && c.effortBody!.learningEnabled) a.market.successes++;
        end(m, s.occurredAt, "acquired", s.causeEventIds);
      }
    } else if (x.phase !== "interrupted") end(m, at, "unavailable", s.causeEventIds);
  }
}
/** Bind the chosen attempt to the ordinary personal execution prediction, including atomic transactions. */
export function bindAcquisitionAttempt(m: AnticipationMemory, action: VillageAttempt, id: string, at: number) {
  const p = m.effort?.acquisition?.plan;
  if (p) p.pending = { id, at, action: action.kind };
}

/** Initial probabilities are subjective policy priors; remembered offers never authorize a purchase. */
function marketBelief(c: VillageContext, a: AcquisitionMemory, at: number, arrival: number, cash: number) {
  const observed = c.siteId === "market";
  const offers = (observed ? c.visibleFoodOffers ?? [] : a.market.offers)
    .filter((o) => o.product !== "grain" && o.quantity >= mealSize(o.species) && o.price <= cash &&
      o.quantity <= c.bulkTransport!.bagFreeMass && expiry(o) > arrival + 1)
    .sort((x, y) => x.price - y.price || x.id.localeCompare(y.id));
  const offer = offers[0];
  const learned = c.effortBody!.learningEnabled ? (a.market.successes + 1) / (a.market.successes + a.market.failures + 2) : .5;
  const age = at - (a.market.seenAt ?? -1000);
  const probability = observed ? offer ? Math.exp(-.08 * (arrival - at)) : 0 : offer ? Math.max(.15, .85 * Math.exp(-.04 * (age + arrival - at))) :
    age < 12 ? .1 : learned;
  return { offer, probability, source: observed ? "observed" as const : offer ? "remembered" as const : "unconfirmed" as const };
}

export function acquisitionCandidates(c: VillageContext, m: AnticipationMemory, actorId: string, at: number) {
  const e = m.effort!, a = e.acquisition ??= fresh(), b = c.effortBody!, home = c.needs!.home;
  const candidates: AcquisitionCandidate[] = [];
  // A felt urgency horizon, not a reconstruction of private nutrition reserves.
  const horizon = b.nutritionNeed >= .9 ? 4 : b.nutritionNeed >= .75 ? 8 : b.nutritionNeed >= .5 ? 14 : 24;
  const add = (p: Pick<AcquisitionCandidate, "id" | "kind" | "siteId" | "source" | "quantity" | "meals" | "probability" | "saleProbability" | "attempt" | "fallback"> &
    Partial<Pick<AcquisitionCandidate, "lotId" | "plantId" | "exclusion">>, cell: { x: number; y: number },
    acquisitionHours: number, effort: number, mass: number) => {
    const inward = trip(m, { ...c, siteId: p.siteId, cell, carriedMass: mass }, home.siteId, home.cell);
    const acquiredAt = at + acquisitionHours, eatAt = Math.max(acquiredAt + 1, c.hunger > 0 ? at : at + 2);
    const absorbedAt = eatAt + 2;
    const hours = Math.max(absorbedAt - at, acquisitionHours + inward);
    const fatigue = Math.min(1, b.fatigue + effort + inward * Math.max(0, effortRate(e, "travel", { ...c, carriedMass: mass })));
    const cold = forecastCold(m, c.cold, at, acquisitionHours + inward, c.needs!.sheltered && p.siteId === home.siteId).peak;
    const sleepiness = forecastSleep(c, m.sleep!, acquisitionHours + inward).peak;
    let exclusion = p.exclusion;
    if (!exclusion && (fatigue >= .9 || cold >= 8 || sleepiness >= .88 ||
      c.energy < Math.max(1, effort * 25) || absorbedAt - at > horizon && !b.digesting && (c.edibleMeals ?? 0) === 0)) exclusion = "body-or-absorption-deadline";
    const usefulMeals = Math.min(p.meals, Math.max(1, 3 - (c.edibleMeals ?? 0)));
    const benefit = (18 + 10 * b.nutritionNeed) * usefulMeals * p.probability * Math.exp(-.04 * (absorbedAt - at));
    const cost = 6 * (fatigue - b.fatigue) + .25 * hours + (p.kind === "sale" ? .03 * mass * (acquisitionHours + inward) : 0) +
      (p.source === "unconfirmed" ? 1 : p.source === "remembered" ? .4 : 0);
    candidates.push({ ...p, acquiredAt, eatAt, absorbedAt, hours, effort, fatigue, cold, sleepiness, benefit, cost,
      value: benefit - cost - personalChoiceOrder(actorId, p.siteId) * .01, feasible: !exclusion, ...(exclusion ? { exclusion } : {}) });
  };
  const observed = new Set<string>();
  for (const p of c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) && p.cell && p.siteId).slice(0, 12)) {
    observed.add(p.siteId!);
    const per = mealSize(p.species), occupied = c.visiblePlantWork?.some((w) => w.actorId !== actorId && w.plantId === p.id);
    const max = Math.min(p.available, c.bulkTransport!.bagFreeMass, per * 3);
    for (let quantity = per; quantity <= Math.max(per, max); quantity += per) {
      const outward = trip(m, c, p.siteId!, p.cell!);
      add({ id: `gather:${p.id}:${quantity}`, kind: "gather", siteId: p.siteId!, plantId: p.id, source: "observed", quantity,
        meals: quantity / per, probability: 1, saleProbability: 1, fallback: "reobserve competing food sources, then shelter",
        exclusion: occupied ? "occupied" : p.stage !== "ripe" || p.available < quantity ? "not-ripe" : c.bulkTransport!.bagFreeMass < quantity ? "capacity" : undefined,
        attempt: c.siteId === p.siteId ? { kind: "gather_plant", plantId: p.id, quantity } : { kind: "travel", siteId: p.siteId! } },
      p.cell!, outward + quantity, outward * Math.max(0, effortRate(e, "travel", c)) + quantity * Math.max(0, effortRate(e, "gather_plant", c)), c.carriedMass + quantity);
    }
  }
  const homeItems = c.homeStorage?.items ?? m.foodPlanning?.home?.items ?? [];
  const item = homeItems.find((i) => !["grain", "seed", "wood"].includes(i.kind) && i.quantity >= mealSize(i.kind));
  if (item) {
    const outward = trip(m, c, home.siteId, home.cell), quantity = mealSize(item.kind);
    add({ id: `home:${item.id}`, kind: "home", siteId: home.siteId, lotId: item.id, source: c.homeStorage ? "observed" : "remembered",
      quantity, meals: 1, probability: c.homeStorage ? 1 : .8, saleProbability: 1, fallback: "recheck own reserve; shelter locally",
      exclusion: expiry(item) <= at + outward + 2 ? "expiry" : c.bulkTransport!.bagFreeMass < quantity ? "capacity" : undefined,
      attempt: c.siteId === home.siteId ? { kind: "take_home", objectId: item.id, quantity } : { kind: "travel", siteId: home.siteId } },
    home.cell, outward + 1, outward * Math.max(0, effortRate(e, "travel", c)), c.carriedMass + quantity);
  }
  const market = c.knownLandmarks!.market, outward = trip(m, c, "market", market);
  const purchase = marketBelief(c, a, at, at + outward, c.ownCash);
  add({ id: "buy:market", kind: "buy", siteId: "market", source: purchase.source, quantity: purchase.offer?.quantity ?? 1,
    meals: purchase.offer ? Math.floor(purchase.offer.quantity / mealSize(purchase.offer.species)) : 1,
    probability: purchase.probability, saleProbability: 1, fallback: "wait at most two hours, then recompare gathering or return",
    exclusion: c.ownCash < (purchase.offer?.price ?? c.foodMarket!.breadPrice) ? "cash" :
      c.siteId === "market" && !purchase.offer ? "no-local-food-offer" : at < a.retryAt ? "retry-window" : undefined,
    attempt: c.siteId === "market" ? purchase.offer ? { kind: "buy_surplus", offerId: purchase.offer.id } : undefined : { kind: "travel", siteId: "market" } },
  market, outward + (purchase.source === "observed" ? 1 : 3), outward * Math.max(0, effortRate(e, "travel", c)), c.carriedMass + 1);
  if (c.foodMarket!.bakingSkill === 0) {
    const stores = (c.grainStores ?? []).filter((s) => s.grain > c.bulkTransport!.plantingReserve && s.lots.length)
      .sort((x, y) => x.siteId.localeCompare(y.siteId)).slice(0, 12);
    const carried = c.ownFoodLots?.find((l) => l.product === "grain" && !l.offered);
    const sources = stores.map((s) => ({ siteId: s.siteId, lotId: s.lots[0].id,
      quantity: Math.min(s.lots[0].quantity, s.grain - c.bulkTransport!.plantingReserve),
      cell: c.fieldGrainStores?.find((f) => f.id === s.id)?.cell ?? (s.siteId === home.siteId ? home.cell : c.knownLandmarks?.[s.siteId]) }));
    const carriedSurplus = carried ? Math.max(0, carried.quantity - Math.max(m.cropPlan ? 1 : 0, c.bulkTransport!.plantingReserve -
      (c.grainStores ?? []).reduce((n, s) => n + s.grain, 0))) : 0;
    if (carried && carriedSurplus) sources.unshift({ siteId: c.siteId, lotId: carried.id, quantity: carriedSurplus,
      cell: c.cell });
    for (const s of sources.filter((s) => s.cell)) for (let quantity = 1; quantity <= Math.min(5, s.quantity,
      carried?.id === s.lotId ? carried.quantity : Math.floor(Math.max(0, c.bulkTransport!.bagFreeMass - 1) / c.bulkTransport!.grainUnitMass)); quantity++) {
      const pickup = carried?.id === s.lotId ? 0 : trip(m, c, s.siteId, s.cell!) + 1;
      const mass = c.carriedMass + (carried?.id === s.lotId ? 0 : quantity * c.bulkTransport!.grainUnitMass);
      const loaded = { ...c, siteId: s.siteId, cell: s.cell!, carriedMass: mass };
      const toMarket = trip(m, loaded, "market", market);
      const saleProbability = c.effortBody!.learningEnabled ? (e.trade.successes + 1) / (e.trade.successes + e.trade.failures + 2) : .5;
      const price = Math.max(1, Math.ceil(c.foodMarket!.grainBatchPrice * quantity / c.foodMarket!.grainBatchQuantity));
      const food = marketBelief({ ...c, bulkTransport: { ...c.bulkTransport!, bagFreeMass: c.bulkTransport!.bagFreeMass + (carried?.id === s.lotId ? quantity * c.bulkTransport!.grainUnitMass : 0) } }, a, at, at + pickup + toMarket + 3, c.ownCash + price);
      add({ id: `sale:${s.lotId}:${quantity}`, kind: "sale", siteId: "market", source: food.source, lotId: s.lotId,
        quantity, meals: food.offer ? Math.floor(food.offer.quantity / mealSize(food.offer.species)) : Math.min(2, Math.floor((c.ownCash + price) / c.foodMarket!.breadPrice)),
        probability: saleProbability * food.probability, saleProbability, fallback: "two-hour sale and purchase limits; unload unsold grain and recompare gathering or shelter",
        exclusion: c.ownCash >= 8 ? "cash-reserve-sufficient" : at < e.trade.retryAt || at < a.retryAt ? "retry-window" :
          food.probability === 0 && c.siteId === "market" ? "no-local-food-offer" : m.cropPlan && (c.edibleMeals ?? 0) >= 2 ? "cultivation-purpose" : undefined,
        attempt: carried?.id === s.lotId ? c.siteId === "market" ? { kind: "post_surplus_offer", lotId: s.lotId, quantity, price } : { kind: "travel", siteId: "market" } :
          c.siteId === s.siteId ? { kind: "load_grain", lotId: s.lotId, quantity } : { kind: "travel", siteId: s.siteId } },
      market, pickup + toMarket + 6, pickup * Math.max(0, effortRate(e, "travel", c)) + toMarket * Math.max(0, effortRate(e, "travel", loaded)) + .006 * mass, mass);
    }
  }
  const explored = e.explored ??= {}; if (!c.siteId.startsWith("transit_")) explored[c.siteId] = at;
  const places = Object.values(m.foraging?.places ?? {}).filter((p) => !observed.has(p.siteId) && p.siteId !== c.siteId &&
    (p.visitedAt === undefined || at - p.visitedAt >= 12)).sort((x, y) => y.seenAt - x.seenAt).slice(0, 6);
  const destinations: { siteId: string; cell: { x: number; y: number }; source: AcquisitionCandidate["source"]; probability: number }[] = places.map((p) => ({ siteId: p.siteId, cell: { x: p.x, y: p.y },
    source: "remembered" as const, probability: p.ripe ? .6 * Math.exp(-.02 * (at - p.seenAt)) : at >= p.checkAt ? .25 : .05 }));
  for (const [siteId, cell] of Object.entries(c.knownLandmarks!).filter(([s]) => s !== "market" && s !== c.siteId && !observed.has(s) &&
    !destinations.some((p) => p.siteId === s) && (explored[s] === undefined || at - explored[s] >= 12)))
    destinations.push({ siteId, cell, source: "unconfirmed", probability: .4 });
  for (const p of destinations) {
    const outward = trip(m, c, p.siteId, p.cell);
    add({ id: `check:${p.siteId}`, kind: "explore", siteId: p.siteId, source: p.source, quantity: 1, meals: 1,
      probability: p.probability, saleProbability: 1, fallback: "confirm food locally; recompare or shelter if depleted",
      attempt: { kind: "travel", siteId: p.siteId } }, p.cell, outward + 3, (outward + 2) * Math.max(0, effortRate(e, "travel", c)), c.carriedMass + 1);
  }
  return candidates.slice(0, 96);
}

export function acquisitionChoice(c: VillageContext, m: AnticipationMemory, actorId: string, at: number): { attempt?: VillageAttempt; reason: string } | undefined {
  const e = m.effort!, a = e.acquisition ??= fresh(), p = a.plan;
  if (p) {
    a.selected = p.id;
    if (at >= p.deadline) {
      end(m, at, "timeout");
      if (e.trade.offer) return { attempt: { kind: "withdraw_surplus_offer", offerId: e.trade.offer.id }, reason: "食品行程の期限に達したので提示を撤回して別手段を再検討する" };
    } else if (p.kind === "sale" || p.kind === "buy") {
      if (p.stage === "source") {
        const source = c.grainStores?.find((s) => s.lots.some((l) => l.id === p.lotId));
        const cargo = c.ownFoodLots?.find((l) => l.product === "grain" && !l.offered && l.quantity >= p.quantity &&
          (l.id === p.lotId || !p.carriedBefore.includes(l.id)));
        if (cargo) { p.lotId = cargo.id; p.stage = "market"; }
        else if (!source || source.grain - c.bulkTransport!.plantingReserve < p.quantity) end(m, at, "unavailable");
        else return { attempt: c.siteId === source.siteId ? { kind: "load_grain", lotId: p.lotId!, quantity: p.quantity } : { kind: "travel", siteId: source.siteId }, reason: "選んだ食品行程の自己所有穀物を現地で取得する" };
      }
      if (a.plan && c.siteId !== "market") return { attempt: { kind: "travel", siteId: "market" }, reason: "有限の食品行程を続け、市場到着後に実際の提示を確認する" };
      if (a.plan) {
        p.arrivedAt ??= at;
        const offer = marketBelief(c, a, at, at, c.ownCash).offer;
        if (offer) return { attempt: { kind: "buy_surplus", offerId: offer.id }, reason: "食品行程で到着した市場の有効な食品提示を購入する" };
        if (p.kind === "sale" && !p.sold) {
          if (e.trade.offer) {
            if (at >= e.trade.offer.deadline) {
              if (!e.trade.offer.expired) { e.trade.offer.expired = true; if (c.effortBody!.learningEnabled) e.trade.failures++; e.trade.retryAt = at + 24; }
              end(m, at, "no-buyer");
              return { attempt: { kind: "withdraw_surplus_offer", offerId: e.trade.offer.id }, reason: "有効提示の有限待機が終了したので売れない穀物を撤回する" };
            }
            return { reason: "買い手の成立を有限の期限内で待つ" };
          }
          const cargo = c.ownFoodLots?.find((l) => l.id === p.lotId && l.quantity >= p.quantity);
          if (cargo && !cargo.offered) {
            p.stage = "sale";
            return { attempt: { kind: "post_surplus_offer", lotId: cargo.id, quantity: p.quantity,
              price: Math.max(1, Math.ceil(c.foodMarket!.grainBatchPrice * p.quantity / c.foodMarket!.grainBatchQuantity)) }, reason: "現物の穀物を有限の待機期限付きで提示し食品購入へつなぐ" };
          }
        } else if (at < p.arrivedAt + 2) return { reason: "食品提示を現地で再確認し、二時間を上限に待つ" };
        if (at >= p.arrivedAt + 2) { if (c.effortBody!.learningEnabled) a.market.failures++; end(m, at, "no-food"); }
        else return { reason: "提示の成立結果を本人に届く刺激で確認する" };
      }
    } else if (c.siteId !== p.siteId) return { attempt: { kind: "travel", siteId: p.siteId }, reason: "選んだ食品取得先へ期限内で進み、到着後に再観察する" };
    else if (p.kind === "explore") {
      const available = c.visiblePlants.some((i) => i.siteId === p.siteId && ["herb", "wild_berry", "fruit_tree"].includes(i.species) &&
        i.stage === "ripe" && i.available >= mealSize(i.species));
      end(m, at, available ? "observed-food" : "depleted");
    }
    else if (p.kind === "home") {
      const item = c.homeStorage?.items.find((i) => i.id === p.lotId && expiry(i) > at && i.quantity >= p.quantity);
      if (item) return { attempt: { kind: "take_home", objectId: item.id, quantity: p.quantity }, reason: "現地で再確認した自己所有の食品を取り出す" };
      end(m, at, "unavailable");
    } else {
      const plant = c.visiblePlants.find((i) => i.id === p.plantId && i.stage === "ripe" && i.available >= p.quantity);
      if (plant && c.bulkTransport!.bagFreeMass >= p.quantity && !c.visiblePlantWork?.some((w) => w.actorId !== actorId && w.plantId === plant.id))
        return { attempt: { kind: "gather_plant", plantId: plant.id, quantity: p.quantity }, reason: "到着後に可食量と競合を再確認して採集する" };
      end(m, at, "unavailable");
    }
  }
  const reserveSufficient = (c.edibleMeals ?? 0) >= 2;
  if (reserveSufficient && (c.foodMarket!.bakingSkill > 0 || c.ownCash >= 8 || m.cropPlan)) return;
  a.candidates = acquisitionCandidates(c, m, actorId, at);
  if (reserveSufficient) for (const p of a.candidates) if (p.kind !== "sale") { p.feasible = false; p.exclusion = "food-reserve-sufficient"; }
  const best = a.candidates.filter((p) => p.feasible && p.value > 0 && p.attempt).sort((x, y) => y.value - x.value || x.id.localeCompare(y.id))[0];
  if (!best) return reserveSufficient ? undefined : { reason: "既知の食品行程は提示・身体・吸収期限の条件を満たさないため再観察を待つ" };
  a.selected = best.id;
  a.plan = { id: `food-${actorId}-${at}-${++a.sequence}`, kind: best.kind, siteId: best.siteId, quantity: best.quantity,
    ...(best.lotId ? { lotId: best.lotId } : {}), ...(best.plantId ? { plantId: best.plantId } : {}),
    startedAt: at, deadline: at + Math.max(4, Math.ceil(best.hours)), acquiredAt: best.acquiredAt, probability: best.probability,
    carriedBefore: (c.ownFoodLots ?? []).map((l) => l.id),
    stage: best.kind === "sale" && !c.ownFoodLots?.some((l) => l.id === best.lotId) ? "source" : best.kind === "sale" ? "market" : "buy" };
  return { attempt: best.attempt, reason: "採集・穀物売却後の食品取得・現金購入を吸収時刻と負担と成立見込みで比較する" };
}

export function checkAcquisitionMemory(a: AcquisitionMemory, at: number) {
  if (a.version !== 1 || a.candidates.length > 96 || a.outcomes.length > 24 || a.market.offers.length > 20 ||
    [a.sequence, a.retryAt, a.market.successes, a.market.failures].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    a.market.seenAt !== undefined && (a.market.seenAt < 0 || a.market.seenAt > at) ||
    a.plan && (a.plan.startedAt > at || a.plan.deadline <= a.plan.startedAt || a.plan.pending && a.plan.pending.at > at) ||
    a.outcomes.some((o) => o.startedAt > o.at || o.at > at || !o.id || o.probability < 0 || o.probability > 1) ||
    a.candidates.some((p) => ![p.probability, p.saleProbability, p.acquiredAt, p.eatAt, p.absorbedAt, p.hours, p.effort, p.fatigue,
      p.cold, p.sleepiness, p.benefit, p.cost, p.value].every(Number.isFinite) || p.probability < 0 || p.probability > 1 || p.eatAt < p.acquiredAt || p.absorbedAt < p.eatAt))
    throw Error("invalid food acquisition memory");
}
