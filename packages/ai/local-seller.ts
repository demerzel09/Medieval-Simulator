import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type SellerContext = {
  day: number; location: string; homeId: string; journeyTo?: string;
  available: boolean; energy: number;
  visibleOrders: { id: string; quantity: number; requestEventId: string }[];
  marketFood?: number; reviewedToday: boolean;
  incomeProgram?: { dailyRevenue: number };
  saleTask?: { id: string; end: number; status: "accepted" | "completed" | "refused" };
  workStartAt: number; requestAt: number; saleAt: number; closeAt: number; nextDayWorkAt: number;
  cartCapacity: number;
};
export type SellerSubjectiveState = { knownOrderIds: string[]; requestEventId?: string };
export type SellerStimulus = { kind: "order_notice" | "stock_arrival" | "sale_result"; receivedAt: number; causeEventIds: string[] };
export type SellerInput = ActorInput<SellerContext, SellerSubjectiveState, SellerStimulus>;
export type SellerAttempt =
  | { kind: "go_market" }
  | { kind: "request_replenishment"; quantity: number }
  | { kind: "start_market_sale" }
  | { kind: "finish_market_sale" }
  | { kind: "approve_distribution" }
  | { kind: "return_home" };
export type SellerResponse = ActorResponse<SellerAttempt, SellerSubjectiveState, { at: number }>;
export type SellerModel = PersonalityModel<SellerInput, SellerResponse>;

/** The seller follows known market hours, but requests stock only for visible demand. */
export const ordinarySellerModel: SellerModel = {
  decide(input) {
    const c = input.knownContext, now = input.at;
    const nextDay = { attempts: [], wait: { at: c.nextDayWorkAt } } satisfies SellerResponse;
    if (!c.available) return nextDay;
    if (c.journeyTo) return { attempts: [], wait: { at: now + 1 } };
    if (c.location === c.homeId) {
      if (now >= c.workStartAt && now <= c.requestAt)
        return { attempts: [{ kind: "go_market" }], wait: { at: now + 15 } };
      return nextDay;
    }
    if (c.location !== "market") return nextDay;
    if (!c.reviewedToday) {
      if (now < c.requestAt) return { attempts: [], wait: { at: c.requestAt } };
      if (c.visibleOrders.length > 0 && now === c.requestAt && c.visibleOrders.reduce((n, order) => n + order.quantity, 0) > (c.marketFood ?? 0))
        return { attempts: [{ kind: "request_replenishment", quantity: c.cartCapacity }], wait: { at: c.saleAt } };
      if (c.visibleOrders.length > 0 && now === c.requestAt)
        return { attempts: [], wait: { at: c.saleAt } };
      return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
    }
    if (now < c.saleAt) return { attempts: [], wait: { at: c.saleAt } };
    if (now < c.closeAt && !c.saleTask && c.visibleOrders.length > 0)
      return { attempts: [{ kind: "start_market_sale" }], wait: { at: c.closeAt } };
    if (now < c.closeAt) return { attempts: [], wait: { at: c.closeAt } };
    return { attempts: c.saleTask?.status === "accepted" ? [{ kind: "finish_market_sale" }, ...(c.incomeProgram ? [{ kind: "approve_distribution" as const }] : []), { kind: "return_home" }] : [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
  },
};
