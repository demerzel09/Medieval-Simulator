import type { AnticipationMemory } from "./anticipatory-needs";
import type { VillageAttempt, VillageContext } from "./autonomous-world";

type Choice = { attempt?: VillageAttempt; reason: string };
/** Initial food trade policy. It uses own stock and delivered local offers; no synthetic buyers or income. */
export function foodMarketChoice(c: VillageContext, m: AnticipationMemory, actorId: string, at: number): Choice | undefined {
  const cfg = c.foodMarket!;
  if (c.bulkTransport && c.siteId !== "market") delete m.foodMarket?.visitStartedAt;
  const state = m.foodMarket ??= { retryAt: 0 };
  const meals = c.edibleMeals ?? 0;
  const market = (reason: string): Choice => {
    if (!c.bulkTransport) state.visitStartedAt ??= at;
    return { attempt: c.siteId === "market" ? undefined : { kind: "travel", siteId: "market" }, reason };
  };
  const reserve = c.bulkTransport?.plantingReserve ?? 0;
  const rawCarried = c.grainCarried ?? 0;
  const rawLots = c.ownFoodLots!.filter((lot) => lot.product === "grain" && lot.quantity > 0);
  const rawLot = rawCarried > reserve ? (c.bulkTransport ? rawLots.sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id))[0] : rawLots[0]) : undefined;
  const rawStored = c.grainStores!.reduce((n, store) => n + store.grain, 0);
  const edibleOffer = c.visibleFoodOffers?.filter((o) => o.sellerId !== actorId && o.product !== "grain" &&
    o.price <= c.ownCash).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
  if (edibleOffer && meals < 2 && cfg.bakingSkill === 0) {
    delete state.visitStartedAt;
    return { attempt: { kind: "buy_surplus", offerId: edibleOffer.id }, reason: "buy edible food with earned cash" };
  }
  if (cfg.bakingSkill > 0) {
    if (rawLot) {
      const store = c.grainStores!.find((s) => s.siteId === "market" && s.capacity - s.grain >= rawLot.quantity);
      if (!store) return { reason: "market grain storage full; retain purchased grain" };
      if (c.siteId !== "market") return market("carry purchased grain to market bakery");
      return { attempt: { kind: "store_grain", lotId: rawLot.id, storeId: store.id }, reason: "store purchased ingredient before baking" };
    }
    if (c.siteId === "market") {
      // Preserve the oldest meal for self; offer one newer loaf at a time.
      const bread = c.ownFoodLots!.filter((lot) => lot.product === "bread" && !lot.offered && lot.quantity >= 1).at(-1);
      if (meals >= 2 && bread) return { attempt: { kind: "post_surplus_offer", lotId: bread.id, quantity: 1, price: cfg.breadPrice },
        reason: "offer baked bread above personal food reserve" };
      const rawOffer = c.visibleFoodOffers?.filter((o) => o.sellerId !== actorId && o.product === "grain" &&
        o.quantity <= c.grainStores!.find((s) => s.siteId === "market")!.capacity - rawStored && o.price <= c.ownCash)
        .sort((a, b) => a.price / a.quantity - b.price / b.quantity || a.id.localeCompare(b.id))[0];
      const store = c.grainStores!.find((s) => s.siteId === "market" && s.grain > 0);
      if (store && meals === 0) return { attempt: { kind: "bake_bread", lotId: store.lots[0].id },
        reason: "process owned market grain into bread" };
      if (rawStored < 10 && rawOffer) return { attempt: { kind: "buy_surplus", offerId: rawOffer.id },
        reason: "buy offered grain for market bread production" };
      if (store && meals < 4) return { attempt: { kind: "bake_bread", lotId: store.lots[0].id },
        reason: "process owned market grain into bread" };
      if (meals >= 1) return { reason: "wait at market for observed ingredient sellers or bread buyers" };
    } else if (rawStored > 0 || meals > 1 || meals === 0 && c.ownCash >= cfg.grainBatchPrice)
      return market("visit market to buy ingredients, bake or sell bread");
    // No purchased ingredients: permit direct wild-food gathering rather than inventing bread.
    return undefined;
  }
  if (c.bulkTransport && cfg.bakingSkill === 0 && !rawLot) {
    const homeStock = c.grainStores!.find((store) => store.siteId === c.needs!.home.siteId && store.grain > 0);
    const stores = [...(c.fieldGrainStores ?? []), ...(homeStock ? [{ ...homeStock, cell: c.needs!.home.cell }] : [])];
    const field = stores.filter((store) => store.grain > 0).sort((a, b) =>
      Math.max(Math.abs(a.cell.x - c.cell.x), Math.abs(a.cell.y - c.cell.y)) -
      Math.max(Math.abs(b.cell.x - c.cell.x), Math.abs(b.cell.y - c.cell.y)) || a.id.localeCompare(b.id))[0];
    if (field) {
      if (c.siteId !== field.siteId) return { attempt: { kind: "travel", siteId: field.siteId }, reason: "return to owned grain stock for another load" };
      const lot = field.lots[0];
      const quantity = Math.min(cfg.grainBatchQuantity, lot.quantity, Math.floor(c.bulkTransport.bagFreeMass / cfgGrainMass(c)));
      if (quantity > 0) return { attempt: { kind: "load_grain", lotId: lot.id, quantity }, reason: "load only grain that fits while retaining planting reserve" };
      return { reason: "carrying capacity full; leave harvested grain safely at field" };
    }
  }
  if (rawLot) {
    if (rawLot.offered && meals === 0 && c.hunger > 0) return undefined;
    if (c.siteId !== "market") return market("carry harvested grain to sell for edible food");
    if (!rawLot.offered) {
      const quantity = Math.min(cfg.grainBatchQuantity, rawLot.quantity, rawCarried - reserve);
      return { attempt: { kind: "post_surplus_offer", lotId: rawLot.id, quantity,
        price: Math.max(1, Math.ceil(cfg.grainBatchPrice * quantity / cfg.grainBatchQuantity)) },
        reason: "offer inedible grain to an ingredient buyer" };
    }
    return { reason: "wait for an actual grain buyer; retain ownership until sale" };
  }
  if (meals < 2 && c.ownCash >= cfg.breadPrice && at >= state.retryAt) {
    if (c.siteId !== "market") return market("visit market to obtain edible food instead of eating raw grain");
    state.visitStartedAt ??= at;
    if (at - state.visitStartedAt < 6) return { reason: "wait for an actual edible-food offer" };
    state.retryAt = at + 24; delete state.visitStartedAt;
    return undefined; // Failed visit: gather food or work, then reconsider after new information/time.
  }
  delete state.visitStartedAt;
  return undefined;
}

function cfgGrainMass(c: VillageContext) { return c.bulkTransport!.grainUnitMass; }
