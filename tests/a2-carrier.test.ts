import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { contentsQuantity } from "../packages/sim/physical";
import { ordinaryCarrierModel, type CarrierModel } from "../packages/ai/local-carrier";
import { advanceLocalV2, loadLocalA2, localV2Summary, newLocalWorldA2, replayLocalA2, saveLocalA2, submitLocalV2 } from "../packages/sim/local-economy-v2";

describe("A2 carrier-led delivery", () => {
  it("visits the market for a real request, sees farm stock, loads and unloads three days", () => {
    const w = newLocalWorldA2();
    advanceLocalV2(w, 4320);
    expect(w.shipments.map((shipment) => shipment.quantity)).toEqual([21, 21, 18]);
    expect(w.shipments.every((shipment) => shipment.status === "delivered")).toBe(true);
    expect(localV2Summary(w).consumedFood).toBe(60);
    for (const action of ["accept_delivery", "depart_farm", "deliver_request", "load_and_depart", "unload,return_home"])
      expect(w.events.filter((event) => event.kind === "carrier_decided" && event.data.action === action)).toHaveLength(3);
    for (const decision of w.events.filter((event) => event.kind === "carrier_decided" && event.data.action === "load_and_depart"))
      expect(decision.causes.some((id) => w.events.some((event) => event.id === id && event.kind === "food_produced"))).toBe(true);
    for (const loaded of w.events.filter((event) => event.kind === "shipment_loaded"))
      expect(loaded.causes.some((id) => w.events.some((event) => event.id === id && event.kind === "delivery_replanned" &&
        event.causes.some((cause) => w.events.some((decision) => decision.id === cause && decision.kind === "carrier_decided"))))).toBe(true);
  });

  it("does not assign a task or move cargo when the carrier model declines", () => {
    const passive: CarrierModel = { decide(input) { return { attempts: [], wait: { at: input.knownContext.nextDayWorkAt } }; } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 1440, undefined, undefined, undefined, passive);
    expect(w.shipments[0].status).toBe("failed");
    expect(w.tasks.filter((task) => task.capability === "carry_food")).toHaveLength(0);
    expect(w.producedFood).toBe(21);
    expect(localV2Summary(w).settledOrders).toBe(0);
    expect(w.events.some((event) => event.kind === "journey_started" && event.actors.includes("C"))).toBe(false);
  });

  it("learns the request at the market, not while still at home or on the road", () => {
    const w = newLocalWorldA2();
    advanceLocalV2(w, 330);
    expect(w.shipments[0].status).toBe("requested");
    expect(w.carrierActor?.shipmentId).toBeUndefined();
    advanceLocalV2(w, 15);
    expect(w.shipments[0].status).toBe("assigned");
    expect(w.carrierActor?.shipmentId).toBe(w.shipments[0].id);
    expect(w.events.find((event) => event.kind === "carrier_decided" && event.minute === 345)?.causes).toContain(w.shipments[0].requestEventId);
  });

  it("does not load merely because a delivery task was accepted", () => {
    const idleAtFarm: CarrierModel = { decide(input) {
      if (input.at === input.knownContext.loadAt) return { attempts: [], wait: { at: input.knownContext.nextDayWorkAt } };
      return ordinaryCarrierModel.decide(input);
    } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 840, undefined, undefined, undefined, idleAtFarm);
    expect(w.shipments[0].status).toBe("failed");
    expect(w.events.some((event) => event.kind === "shipment_failed" && event.data.reason === "delivery_deadline_missed")).toBe(true);
    expect(contentsQuantity(w.physical, "store_farm", "food")).toBe(21);
    expect(contentsQuantity(w.physical, "cart_1", "food")).toBe(0);
  });

  it("does not unload cargo merely because the cart reaches the market", () => {
    const idleAtMarket: CarrierModel = { decide(input) {
      if (input.at === input.knownContext.unloadAt) return { attempts: [], wait: { at: input.knownContext.nextDayWorkAt } };
      return ordinaryCarrierModel.decide(input);
    } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 900, undefined, undefined, undefined, idleAtMarket);
    expect(w.shipments[0].status).toBe("failed");
    expect(contentsQuantity(w.physical, "cart_1", "food")).toBe(21);
    expect(contentsQuantity(w.physical, "store_market", "food")).toBe(0);
    expect(localV2Summary(w).settledOrders).toBe(0);
    expect(w.events.some((event) => event.kind === "shipment_failed" && event.data.reason === "delivery_deadline_missed")).toBe(true);
  });

  it("can choose a smaller actual load without creating food", () => {
    const smallLoad: CarrierModel = { decide(input) {
      if (input.at === input.knownContext.loadAt) return { attempts: [{ kind: "load_and_depart", quantity: 5 }], wait: { at: input.knownContext.marketArriveAt } };
      return ordinaryCarrierModel.decide(input);
    } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 1440, undefined, undefined, undefined, smallLoad);
    expect(w.shipments[0].quantity).toBe(5);
    expect(w.shipments[0].status).toBe("delivered");
    expect(localV2Summary(w).settledOrders).toBe(1);
    expect(localV2Summary(w).consumedFood).toBe(5);
    expect(localV2Summary(w).farmFood).toBe(16);
  });

  it("keeps an absent carrier and a broken cart from delivering", () => {
    const absent = newLocalWorldA2();
    expect(submitLocalV2(absent, "C", { kind: "ABSENT", personId: "C", day: 1 })).toBe(true);
    advanceLocalV2(absent, 840);
    expect(absent.shipments[0].status).toBe("failed");
    const broken = newLocalWorldA2(); broken.cartCondition = 1;
    advanceLocalV2(broken, 360);
    expect(broken.shipments[0].status).toBe("failed");
    expect(broken.cartCondition).toBe(1);
    expect(broken.events.some((event) => event.kind === "journey_blocked" && event.data.reason === "cart_unfit")).toBe(true);
  });

  it("restores carrier intent and replays the same physical events", () => {
    const w = newLocalWorldA2(115);
    advanceLocalV2(w, 760);
    const resumed = loadLocalA2(saveLocalA2(w));
    advanceLocalV2(w, 680); advanceLocalV2(resumed, 680);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayLocalA2(115, w.commands, 1440))).toBe(hash(w));
    expect(() => loadLocalA2(JSON.stringify({ ...w, carrierActor: undefined }))).toThrow();
    expect(() => loadLocalA2(JSON.stringify({ ...w, engineVersion: "0.5.2-a2" }))).toThrow("incompatible");
  });
});
