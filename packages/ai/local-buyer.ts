import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

/** Buyer-specific known data inside the shared personality boundary. */
export type BuyerContext = {
  day: number; homeId: string; location: string; journeyTo?: string;
  energy: number; available: boolean; householdSize: number;
  homeFood?: number; homeCash?: number; price: number;
  order?: { id: string; quantity: number; status: "requested" | "sale_reserved" | "settled" | "expired" };
  purchaseTask?: { id: string; end: number; status: "accepted" | "completed" | "refused" };
  marketDepartAt: number; marketCloseAt: number; nextDayOrderAt: number;
};
type BuyerSubjectiveState = { knownOrderId?: string };
type BuyerWake = { at: number };
export type BuyerStimulus = { kind: "order_notice" | "arrival" | "sale_result"; receivedAt: number; causeEventIds: string[]; orderId?: string };
export type BuyerInput = ActorInput<BuyerContext, BuyerSubjectiveState, BuyerStimulus>;
export type BuyerAttempt =
  | { kind: "post_order"; quantity: number }
  | { kind: "depart_market"; orderId: string }
  | { kind: "reserve_sale"; orderId: string }
  | { kind: "settle_sale"; orderId: string }
  | { kind: "return_home" };
export type BuyerResponse = ActorResponse<BuyerAttempt, BuyerSubjectiveState, BuyerWake>;
export type BuyerModel = PersonalityModel<BuyerInput, BuyerResponse>;

/** It uses only home observations, its own order, and public market hours. */
export const ordinaryBuyerModel: BuyerModel = {
  decide(input) {
    const c = input.knownContext, now = input.at;
    const nextDay = { attempts: [], wait: { at: c.nextDayOrderAt } } satisfies BuyerResponse;
    if (!c.available) return nextDay;
    if (c.journeyTo) return { attempts: [], wait: { at: now + 1 } };
    if (!c.order && c.location === c.homeId && c.homeFood !== undefined && c.homeCash !== undefined) {
      const need = Math.max(0, c.householdSize - c.homeFood);
      if (need > 0 && c.homeCash >= need * c.price)
        return { attempts: [{ kind: "post_order", quantity: need }], wait: { at: c.marketDepartAt } };
      return nextDay;
    }
    if (c.order?.status === "requested" && c.location === c.homeId) {
      if (c.homeCash === undefined || c.homeCash < c.order.quantity * c.price) return nextDay;
      if (now >= c.marketDepartAt && now < c.marketCloseAt)
        return { attempts: [{ kind: "depart_market", orderId: c.order.id }], wait: { at: now + 15 } };
      return { attempts: [], wait: { at: c.marketDepartAt } };
    }
    if (c.location === "market" && c.order?.status === "requested") {
      if (now < c.marketCloseAt)
        return { attempts: [{ kind: "reserve_sale", orderId: c.order.id }], wait: { at: now + 15 } };
      return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayOrderAt } };
    }
    if (c.location === "market" && c.order?.status === "sale_reserved" && c.purchaseTask) {
      if (now >= c.purchaseTask.end)
        return { attempts: [{ kind: "settle_sale", orderId: c.order.id }, { kind: "return_home" }], wait: { at: c.nextDayOrderAt } };
      return { attempts: [], wait: { at: c.purchaseTask.end } };
    }
    if (c.location === "market") return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayOrderAt } };
    return nextDay;
  },
};
