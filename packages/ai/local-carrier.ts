import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type CarrierContext = {
  day: number; location: string; homeId: string; journeyTo?: string;
  available: boolean; energy: number;
  visibleRequest?: { shipmentId: string; requestEventId: string; quantity: number };
  shipment?: { id: string; status: "requested" | "assigned" | "in_transit" | "delivered" | "failed"; quantity: number };
  task?: { id: string; status: "accepted" | "completed" | "refused" };
  farmFood?: number; cartSpace?: number; cartHere: boolean;
  cartCondition?: number; maintenanceEnabled?: boolean; maintenanceMinutes?: number;
  maintenanceTask?: { id: string; end: number; status: "accepted" | "completed" | "refused" };
  workStartAt: number; departAt: number; farmArriveAt: number; loadAt: number;
  marketArriveAt: number; unloadAt: number; nextDayWorkAt: number;
};
export type CarrierSubjectiveState = { shipmentId?: string; taskId?: string };
export type CarrierStimulus = { kind: "request_seen" | "arrival" | "stock_seen"; receivedAt: number; causeEventIds: string[] };
export type CarrierInput = ActorInput<CarrierContext, CarrierSubjectiveState, CarrierStimulus>;
export type CarrierAttempt =
  | { kind: "go_market" }
  | { kind: "accept_delivery"; shipmentId: string }
  | { kind: "depart_farm" }
  | { kind: "deliver_request" }
  | { kind: "load_and_depart"; quantity: number }
  | { kind: "unload" }
  | { kind: "finish_empty" }
  | { kind: "start_maintenance" }
  | { kind: "finish_maintenance" }
  | { kind: "return_home" };
export type CarrierResponse = ActorResponse<CarrierAttempt, CarrierSubjectiveState, { at: number }>;
export type CarrierModel = PersonalityModel<CarrierInput, CarrierResponse>;

/** Known rounds are routine; a request and actual cargo are learned at their sites. */
export const ordinaryCarrierModel: CarrierModel = {
  decide(input) {
    const c = input.knownContext, now = input.at;
    const nextDay = { attempts: [], wait: { at: c.nextDayWorkAt } } satisfies CarrierResponse;
    if (!c.available) return nextDay;
    if (c.journeyTo) return { attempts: [], wait: { at: now + 1 } };
    if (c.location === c.homeId) {
      if (now === c.workStartAt) return { attempts: [{ kind: "go_market" }], wait: { at: now + 15 } };
      return nextDay;
    }
    if (c.location === "market") {
      if (!c.shipment && c.visibleRequest && now < c.departAt)
        return { attempts: [{ kind: "accept_delivery", shipmentId: c.visibleRequest.shipmentId }], wait: { at: c.departAt } };
      if (!c.shipment) return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
      if (c.shipment.status === "assigned" && now >= c.departAt && now < c.loadAt)
        return { attempts: [{ kind: "depart_farm" }], wait: { at: c.farmArriveAt } };
      if (now < c.unloadAt) return { attempts: [], wait: { at: c.unloadAt } };
      if (c.shipment.status === "in_transit")
        return c.maintenanceEnabled ? { attempts: [{ kind: "unload" }], wait: { at: now + 1 } } :
          { attempts: [{ kind: "unload" }, { kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
      if (c.maintenanceEnabled && c.shipment.status === "delivered" && c.cartHere && (c.cartCondition ?? 100) < 100) {
        if (!c.maintenanceTask) return { attempts: [{ kind: "start_maintenance" }], wait: { at: now + c.maintenanceMinutes! } };
        if (c.maintenanceTask.status === "accepted" && now >= c.maintenanceTask.end)
          return { attempts: [{ kind: "finish_maintenance" }, { kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
        if (c.maintenanceTask.status === "accepted") return { attempts: [], wait: { at: c.maintenanceTask.end } };
      }
      if (c.shipment.status === "failed" && c.task?.status === "accepted")
        return { attempts: [{ kind: "finish_empty" }, { kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
      return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
    }
    if (c.location === "farm") {
      if (c.shipment?.status === "assigned" && now === c.farmArriveAt)
        return { attempts: [{ kind: "deliver_request" }], wait: { at: c.loadAt } };
      if (c.shipment?.status === "assigned" && now >= c.loadAt) {
        const quantity = Math.min(c.shipment.quantity, c.farmFood ?? 0, c.cartSpace ?? 0);
        return { attempts: [{ kind: "load_and_depart", quantity }], wait: { at: c.marketArriveAt } };
      }
      return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
    }
    return nextDay;
  },
};
