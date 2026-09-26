import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type MarketContext =
  | { role: "seller"; phase: "plan"; cash: number; stock: number; price: number; bid: number; carrierFee: number;
      reserveCash: number; triedMarket: boolean; soldYesterday: number; unsoldYesterday: number; fundedUnmetYesterday: number }
  | { role: "carrier"; phase: "request"; offeredFee: number; requestedQuantity: number }
  | { role: "farmer"; phase: "contract"; offeredPrice: number; requestedQuantity: number; available: number; bagSpace: number }
  | { role: "farmer"; phase: "work"; contractedQuantity: number; available: number; bagSpace: number }
  | { role: "farmer"; phase: "handover"; contractedQuantity: number; carriedFood: number }
  | { role: "carrier"; phase: "deliver"; carriedForSeller: number }
  | { role: "buyer"; phase: "shop"; cash: number; stock: number; price: number };
export type MarketAttempt = { kind: "post_buy"; price: number; quantity: number; carrierFee: number; salePrice: number } |
  { kind: "accept_carriage" } | { kind: "accept_harvest_contract"; quantity: number } | { kind: "harvest"; quantity: number } |
  { kind: "tender_crops"; quantity: number } |
  { kind: "deliver" } | { kind: "buy"; quantity: number } | { kind: "request_food" };
export type MarketResponse = ActorResponse<MarketAttempt, Record<string, never>, { at: number }>;
export type MarketModel = PersonalityModel<ActorInput<MarketContext, Record<string, never>, { kind: string; causeEventIds: string[] }>, MarketResponse>;

/** One local rule personality for the trade-only counterfactual; outcomes may be losses or no trade. */
export const ordinaryMarketModel: MarketModel = {
  decide(input) {
    const c = input.knownContext, wait = { at: input.at + 1 };
    if (c.role === "seller") {
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
    return { attempts: c.cash < c.price ? [] : c.stock ? [{ kind: "buy", quantity: 1 }] : [{ kind: "request_food" }], wait };
  },
};
