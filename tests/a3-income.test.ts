import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { contentsQuantity } from "../packages/sim/physical";
import { ordinaryCarrierModel, type CarrierModel } from "../packages/ai/local-carrier";
import { advanceLocalV2, checkLocalV2, loadLocalA3Income, newLocalWorldA3Income,
  replayLocalA3Income, saveLocalA3Income, submitLocalV2 } from "../packages/sim/local-economy-v2";

describe("A3 income slice", () => {
  it("turns completed work into claims and pays only existing cash carried home", () => {
    const w = newLocalWorldA3Income();
    advanceLocalV2(w, 2880);
    const claims = w.wageClaims!;
    expect(claims.some((claim) => claim.personId === "F0" && claim.paidEventId)).toBe(true);
    expect(claims.some((claim) => claim.personId === "C" && claim.paidEventId)).toBe(true);
    expect(claims.some((claim) => claim.personId === "S" && claim.paidEventId)).toBe(true);
    expect(claims.filter((claim) => claim.paidEventId).every((claim) =>
      w.events.find((event) => event.id === claim.paidEventId)?.causes.includes(claim.causeEventId))).toBe(true);
    expect(contentsQuantity(w.physical, "chest_H0", "currency")).toBeGreaterThan(20);
    expect(w.events.some((event) => event.kind === "cash_moved" && event.data.to === "chest_H0" && event.minute > 1440)).toBe(true);
    checkLocalV2(w);
    expect(Object.values(w.physical.objects).filter((object) => object.typeId === "currency").reduce((n, object) => n + object.quantity, 0)).toBe(160);
  });

  it("lets an unfunded household recover through income without erasing earlier hunger", () => {
    const w = newLocalWorldA3Income();
    expect(submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocalV2(w, 2880);
    expect(w.people.F0.hunger).toBe(2);
    expect(w.people.F0.energy).toBe(98);
    advanceLocalV2(w, 1440);
    expect(contentsQuantity(w.physical, "chest_H0", "currency")).toBeGreaterThan(0);
    expect(w.events.some((event) => event.kind === "wage_paid" && event.data.householdId === "H0")).toBe(true);
    expect(w.people.F0.hunger).toBe(1);
    expect(w.events.some((event) => event.kind === "meal_eaten" && event.actors.includes("F0") && event.minute >= 2880)).toBe(true);
    expect(w.events.some((event) => event.kind === "rest_completed" && event.actors.includes("F0") && event.data.hunger === 2 && Number(event.data.recovered) < 50)).toBe(true);
    expect(w.events.some((event) => event.kind === "meal_eaten" && event.actors.includes("F0") && event.minute < 2880)).toBe(false);
    checkLocalV2(w);
  });

  it("keeps earned wages unpaid when the market has no sales or cashier", () => {
    const w = newLocalWorldA3Income();
    expect(submitLocalV2(w, "S", { kind: "ABSENT", personId: "S", day: 1 })).toBe(true);
    advanceLocalV2(w, 1440);
    expect(w.wageClaims!.filter((claim) => claim.personId.startsWith("F"))).toHaveLength(7);
    expect(w.wageClaims!.some((claim) => claim.paidEventId)).toBe(false);
    expect(contentsQuantity(w.physical, "till_cooperative", "currency")).toBe(0);
    expect(w.events.some((event) => event.kind === "income_unpaid" && event.data.reason === "seller_unavailable")).toBe(true);
    checkLocalV2(w);
  });

  it("does not credit absent work and replays claims and transfers", () => {
    const w = newLocalWorldA3Income(123);
    expect(submitLocalV2(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 })).toBe(true);
    advanceLocalV2(w, 2100);
    const resumed = loadLocalA3Income(saveLocalA3Income(w));
    advanceLocalV2(w, 780); advanceLocalV2(resumed, 780);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayLocalA3Income(123, w.commands, 2880))).toBe(hash(w));
    expect(w.wageClaims?.some((claim) => claim.personId === "F6" &&
      w.events.find((event) => event.id === claim.causeEventId)!.minute >= 1440)).toBe(false);
  });

  it("closes six days of purchases with dividend claims and a real maintenance task", () => {
    const w = newLocalWorldA3Income();
    for (let day = 1; day <= 6; day++) {
      advanceLocalV2(w, 1440);
      expect(w.consumedFood).toBe(day * 20);
      expect(w.cartCondition).toBe(100);
      expect(w.orders.filter((order) => order.day === day && order.status === "settled")).toHaveLength(4);
    }
    expect(w.events.filter((event) => event.kind === "vehicle_maintained")).toHaveLength(6);
    expect(w.tasks.filter((task) => task.capability === "maintain_cart" && task.status === "completed")).toHaveLength(6);
    expect(w.events.filter((event) => event.kind === "distribution_approved")).toHaveLength(6);
    expect(w.distributionClaims!.some((claim) => claim.paidEventId)).toBe(true);
    expect(w.events.some((event) => event.kind === "cash_combined")).toBe(true);
    expect(contentsQuantity(w.physical, "chest_H0", "currency")).toBe(35);
    checkLocalV2(w);
  }, 30_000);

  it("does not repair a cart when the carrier declines maintenance", () => {
    const noMaintenance: CarrierModel = { decide(input) {
      if (input.knownContext.maintenanceEnabled && input.knownContext.shipment?.status === "delivered" &&
        input.knownContext.location === "market")
        return { attempts: [{ kind: "return_home" }], wait: { at: input.knownContext.nextDayWorkAt } };
      return ordinaryCarrierModel.decide(input);
    } };
    const w = newLocalWorldA3Income();
    advanceLocalV2(w, 1440, undefined, undefined, undefined, noMaintenance);
    expect(w.consumedFood).toBe(20);
    expect(w.cartCondition).toBe(96);
    expect(w.events.some((event) => event.kind === "vehicle_maintained")).toBe(false);
    expect(w.tasks.some((task) => task.capability === "maintain_cart")).toBe(false);
  });

  it("withholds farm wages when no carrier brings harvest proof to the seller", () => {
    const w = newLocalWorldA3Income();
    expect(submitLocalV2(w, "C", { kind: "ABSENT", personId: "C", day: 1 })).toBe(true);
    advanceLocalV2(w, 1440);
    expect(w.wageClaims!.filter((claim) => claim.personId.startsWith("F"))).toHaveLength(7);
    expect(w.sellerActor?.knownWorkProofIds).toEqual([]);
    expect(w.wageClaims!.some((claim) => claim.paidEventId)).toBe(false);
    expect(w.events.some((event) => event.kind === "income_unpaid" && event.data.reason === "proof_not_received")).toBe(true);
    expect(w.events.find((event) => event.kind === "distribution_approved")?.data.wages).toBe(2);
    checkLocalV2(w);
  });

  it("delivers proof only for the harvest lots actually loaded", () => {
    const limitedCarrier: CarrierModel = { decide(input) {
      const response = ordinaryCarrierModel.decide(input);
      return { ...response, attempts: response.attempts.map((attempt) => attempt.kind === "load_and_depart" ?
        { ...attempt, quantity: 5 } : attempt) };
    } };
    const w = newLocalWorldA3Income();
    advanceLocalV2(w, 1440, undefined, undefined, undefined, limitedCarrier);
    const shipment = w.shipments[0];
    expect(shipment.quantity).toBe(5);
    expect(shipment.workProofIds).toHaveLength(2);
    expect(w.sellerActor?.knownWorkProofIds).toEqual(shipment.workProofIds);
    expect(w.events.find((event) => event.kind === "shipment_delivered")?.causes).toEqual(expect.arrayContaining(shipment.workProofIds!));
    const visibleFarmWages = w.wageClaims!.filter((claim) => claim.workProofEventId && shipment.workProofIds!.includes(claim.workProofEventId));
    expect(visibleFarmWages).toHaveLength(2);
    expect(w.events.find((event) => event.kind === "distribution_approved")?.data.wages).toBe(
      [...visibleFarmWages, ...w.wageClaims!.filter((claim) => !claim.workProofEventId)].reduce((n, claim) => n + claim.amount, 0));
    expect(w.events.some((event) => event.kind === "income_unpaid" && event.data.reason === "proof_not_received")).toBe(true);
    checkLocalV2(w);
  });
});
