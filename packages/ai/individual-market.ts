import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type MarketContext =
  | { role: "seller"; phase: "plan"; cash: number; stock: number; price: number; bid: number; carrierFee: number;
      reserveCash: number; triedMarket: boolean; soldYesterday: number; unsoldYesterday: number; fundedUnmetYesterday: number }
  | { role: "carrier"; phase: "request"; offeredFee: number; requestedQuantity: number }
  | { role: "farmer"; phase: "contract"; offeredPrice: number; requestedQuantity: number; available: number; bagSpace: number }
  | { role: "farmer"; phase: "work"; contractedQuantity: number; available: number; bagSpace: number }
  | { role: "farmer"; phase: "handover"; contractedQuantity: number; carriedFood: number }
  | { role: "carrier"; phase: "deliver"; carriedForSeller: number }
  | { role: "buyer"; phase: "plan_trip"; siteId: string; cash: number; pantryFood: number; knownPrice: number }
  | { role: "buyer"; phase: "shop"; cash: number; stock: number; price: number; pantryFood?: number }
  | { role: "buyer"; phase: "return_home" }
  | { role: "buyer"; phase: "store"; carriedFood: number }
  | { role: "buyer"; phase: "eat"; hunger: number; pantryFood: number }
  | { role: "woodcutter"; phase: "propose"; siteId: string; knownPrice: number; available: number; cash: number }
  | { role: "woodcutter"; phase: "work"; available: number }
  | { role: "woodcutter"; phase: "deliver"; carriedWood: number }
  | { role: "seller"; phase: "accept_wood"; cash: number; stock: number; foodStock: number; offeredPrice: number;
      supplierId: string; lastSupplier?: string };
export type MarketAttempt = { kind: "post_buy"; price: number; quantity: number; carrierFee: number; salePrice: number } |
  { kind: "accept_carriage" } | { kind: "accept_harvest_contract"; quantity: number } | { kind: "harvest"; quantity: number } |
  { kind: "tender_crops"; quantity: number } |
  { kind: "deliver" } | { kind: "buy"; quantity: number } | { kind: "request_food" } |
  { kind: "travel_to_market" } | { kind: "return_home" } | { kind: "store_food" } | { kind: "eat" } |
  { kind: "offer_wood"; price: number } | { kind: "accept_wood" } | { kind: "gather_wood" } | { kind: "deliver_wood" };
export type MarketResponse = ActorResponse<MarketAttempt, Record<string, never>, { at: number }>;
export type MarketModel = PersonalityModel<ActorInput<MarketContext, Record<string, never>, { kind: string; causeEventIds: string[] }>, MarketResponse>;

/** One local rule personality for the trade-only counterfactual; outcomes may be losses or no trade. */
export const ordinaryMarketModel: MarketModel = {
  decide(input) {
    const c = input.knownContext, wait = { at: input.at + 1 };
    if (c.role === "seller" && c.phase === "plan") {
      const salePrice = c.fundedUnmetYesterday ? c.price + 1 : c.unsoldYesterday ? Math.max(1, c.price - 1) : c.price;
      const quantity = c.fundedUnmetYesterday ? 2 : 1;
      const expense = quantity * c.bid + c.carrierFee;
      return { attempts: [{ kind: "post_buy", price: c.bid, quantity: c.stock ? 0 :
        c.cash - expense >= c.reserveCash && salePrice * quantity > expense &&
        (!c.triedMarket || c.soldYesterday > 0 || c.fundedUnmetYesterday > 0) ? quantity : 0,
        carrierFee: c.carrierFee, salePrice }], wait };
    }
    if (c.role === "carrier" && c.phase === "request") return { attempts: c.offeredFee >= 2 && c.requestedQuantity > 0 ?
      [{ kind: "accept_carriage" }] : [], wait };
    if (c.role === "carrier") return { attempts: c.carriedForSeller ? [{ kind: "deliver" }] : [], wait };
    if (c.role === "farmer" && c.phase === "contract") return { attempts: c.offeredPrice >= 1 && c.available && c.bagSpace ?
      [{ kind: "accept_harvest_contract", quantity: Math.min(c.requestedQuantity, c.available, c.bagSpace) }] : [], wait };
    if (c.role === "farmer" && c.phase === "work") return { attempts: c.available && c.bagSpace ?
      [{ kind: "harvest", quantity: Math.min(c.contractedQuantity, c.available, c.bagSpace) }] : [], wait };
    if (c.role === "farmer") return { attempts: c.carriedFood ?
      [{ kind: "tender_crops", quantity: Math.min(c.contractedQuantity, c.carriedFood) }] : [], wait };
    if (c.role === "buyer" && c.phase === "shop") return { attempts: c.cash < c.price ? [] :
      c.stock ? [{ kind: "buy", quantity: 1 }] : [{ kind: "request_food" }], wait };
    return { attempts: [], wait };
  },
};

/** Buyer needs and local food ownership, using the same personality port as the trade-only fixture. */
export const livingMarketModel: MarketModel = {
  decide(input) {
    const c = input.knownContext, wait = { at: input.at + 1 };
    if (c.role === "woodcutter") {
      if (c.phase === "propose") return { attempts: c.available > 0 && c.knownPrice >= 2 ?
        [{ kind: "offer_wood", price: c.knownPrice }] : [], wait };
      if (c.phase === "work") return { attempts: c.available > 0 ? [{ kind: "gather_wood" }] : [], wait };
      return { attempts: c.carriedWood > 0 ? [{ kind: "deliver_wood" }] : [], wait };
    }
    if (c.role === "seller" && c.phase === "accept_wood") return { attempts:
      c.stock < 1 && c.foodStock > 0 && c.cash >= c.offeredPrice && c.supplierId !== c.lastSupplier ?
        [{ kind: "accept_wood" }] : [], wait };
    if (c.role !== "buyer") return ordinaryMarketModel.decide(input);
    if (c.phase === "plan_trip") return { attempts: c.siteId === "market" ? [{ kind: "return_home" }] :
      c.pantryFood < 2 && c.cash >= c.knownPrice ?
      [{ kind: "travel_to_market" }] : [], wait };
    if (c.phase === "shop") {
      if (c.pantryFood! >= 2 || c.cash < c.price) return { attempts: [], wait };
      if (!c.stock) return { attempts: [{ kind: "request_food" }], wait };
      const quantity = Math.min(2 - c.pantryFood!, c.stock, Math.floor(c.cash / c.price));
      return { attempts: quantity ? [{ kind: "buy", quantity }] : [], wait };
    }
    if (c.phase === "return_home") return { attempts: [{ kind: "return_home" }], wait };
    if (c.phase === "store") return { attempts: c.carriedFood ? [{ kind: "store_food" }] : [], wait };
    return { attempts: c.hunger > 0 && c.pantryFood > 0 ? [{ kind: "eat" }] : [], wait };
  },
};
