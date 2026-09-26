import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { checkPhysical, contentsQuantity, physicalTransaction, siteOf } from "../packages/sim/physical";
import { advanceLocalV2, cancelPurchaseV2, checkLocalV2, loadLocalV2, localV2Summary, newLocalWorldV2,
  replayLocalV2, reservePurchaseV2, saveLocalV2, submitLocalV2 } from "../packages/sim/local-economy-v2";
import { validateEconomyE1V2 } from "../packages/content/economy-e1-v2";
import fixture from "../packages/content/economy-e1-v2.json";

describe("L1 physical E1 economy", () => {
  it("runs the 20-person three-day economy from the object tree", () => {
    const w = newLocalWorldV2();
    const expected = [
      { day: 1, producedFood: 21, consumedFood: 20, farmFood: 0, marketFood: 1, cooperativeMoney: 40, hungryPeople: 0, settledOrders: 4 },
      { day: 2, producedFood: 42, consumedFood: 40, farmFood: 0, marketFood: 2, cooperativeMoney: 80, hungryPeople: 0, settledOrders: 8 },
      { day: 3, producedFood: 60, consumedFood: 60, farmFood: 0, marketFood: 0, cooperativeMoney: 120, hungryPeople: 0, settledOrders: 12 },
    ];
    for (const e of expected) {
      advanceLocalV2(w, 1440);
      const { ownerMoney, ...summary } = localV2Summary(w);
      expect(summary).toEqual(e);
      expect([ownerMoney.H0, ownerMoney.H1, ownerMoney.H2, ownerMoney.H3]).toEqual(Array(4).fill(40 - e.day * 10));
    }
    expect(w.shipments.map((s) => s.quantity)).toEqual([21, 21, 18]);
    expect(w.events.filter((e) => e.kind === "meal_eaten")).toHaveLength(60);
    expect(w.events.filter((e) => e.kind === "rest_completed")).toHaveLength(60);
    expect(w.cartCondition).toBe(88);
    expect(w.events.filter((e) => e.kind === "delivery_proposed")).toHaveLength(3);
    expect(w.events.filter((e) => e.kind === "delivery_replanned")).toHaveLength(3);
    expect(w.tasks.filter((t) => t.capability === "carry_food" && t.status === "completed")).toHaveLength(3);
    expect(Object.keys(w.people)).toHaveLength(20);
    expect(w.physical.objects.cart_1.ownerId).toBe("cooperative");
    expect(w.physical.reservations).toHaveLength(0);
    expect("lots" in w).toBe(false);
    expect("wallets" in w).toBe(false);
    const byId = new Map(w.events.map((e) => [e.id, e]));
    const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
      for (const cause of byId.get(id)?.causes ?? []) if (!seen.has(cause)) { seen.add(cause); ancestors(cause, seen); }
      return seen;
    };
    const meal = w.events.find((e) => e.kind === "meal_eaten" && e.minute === 1140)!;
    const kinds = [...ancestors(meal.id)].map((id) => byId.get(id)!.kind);
    for (const kind of ["food_produced", "shipment_delivered", "sale_settled", "task_accepted"]) expect(kinds).toContain(kind);
    checkLocalV2(w);
  });

  it("changes physical outcomes for absence, no money, and fatigue", () => {
    const carrier = newLocalWorldV2();
    expect(submitLocalV2(carrier, "C", { kind: "ABSENT", personId: "C", day: 2 })).toBe(true);
    advanceLocalV2(carrier, 2880);
    expect(carrier.shipments[1].status).toBe("failed");
    expect(contentsQuantity(carrier.physical, "store_farm", "food")).toBe(21);
    expect(localV2Summary(carrier).hungryPeople).toBe(20);
    const money = newLocalWorldV2();
    expect(submitLocalV2(money, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocalV2(money, 1440);
    expect(money.orders.find((o) => o.householdId === "H0")?.status).toBe("expired");
    expect(localV2Summary(money).ownerMoney.reserve).toBe(40);
    expect(localV2Summary(money).settledOrders).toBe(3);
    const farmer = newLocalWorldV2();
    expect(submitLocalV2(farmer, "F6", { kind: "ABSENT", personId: "F6", day: 2 })).toBe(true);
    advanceLocalV2(farmer, 2880);
    expect(farmer.producedFood).toBe(39);
    expect(farmer.shipments[1].quantity).toBe(18);
    expect(localV2Summary(farmer).hungryPeople).toBe(5);
    const tired = newLocalWorldV2(); tired.people.C.energy = 10;
    advanceLocalV2(tired, 1440);
    expect(tired.shipments[0].status).toBe("failed");
    expect(contentsQuantity(tired.physical, "store_farm", "food")).toBe(21);
    expect(tired.events.some((e) => e.kind === "journey_blocked" && e.data.reason === "exhausted")).toBe(true);
  });

  it("keeps transit cargo on the cart across save, load and replay", () => {
    const w = newLocalWorldV2(42);
    submitLocalV2(w, "C", { kind: "ABSENT", personId: "C", day: 2 });
    advanceLocalV2(w, 751);
    expect(w.shipments[0].status).toBe("in_transit");
    expect(siteOf(w.physical, "cart_1")).toBe(w.people.C.journey?.transitId);
    expect(contentsQuantity(w.physical, "cart_1", "food")).toBe(21);
    expect(contentsQuantity(w.physical, "store_market", "food")).toBe(0);
    const saved = saveLocalV2(w), resumed = loadLocalV2(saved);
    advanceLocalV2(w, 4320 - 751); advanceLocalV2(resumed, 4320 - 751);
    const replayed = replayLocalV2(42, w.commands, 4320);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayed)).toBe(hash(w));
    expect(() => loadLocalV2(saved.replace('"contentHash":"', '"contentHash":"tampered'))).toThrow();
    expect(() => loadLocalV2(JSON.stringify({ ...resumed, schemaVersion: 2 }))).toThrow("incompatible");
    expect(() => loadLocalV2(JSON.stringify({ ...resumed, engineVersion: "0.4.0-e1" }))).toThrow("incompatible");
    const broken = structuredClone(resumed);
    broken.physical.objects.cart_1.parentId = "missing";
    expect(() => checkLocalV2(broken)).toThrow();
  });

  it("resumes a reserved sale with the same food and money claims", () => {
    const w = newLocalWorldV2(17);
    advanceLocalV2(w, 840);
    expect(w.orders[0].status).toBe("sale_reserved");
    expect(w.physical.reservations.length).toBeGreaterThan(1);
    const resumed = loadLocalV2(saveLocalV2(w));
    advanceLocalV2(w, 1440 - 840);
    advanceLocalV2(resumed, 1440 - 840);
    expect(hash(resumed)).toBe(hash(w));
    expect(w.physical.reservations).toHaveLength(0);
    expect(localV2Summary(w).settledOrders).toBe(4);
  });

  it("uses order claims to settle atomically and prevents a second reservation", () => {
    const w = newLocalWorldV2();
    submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 30 });
    submitLocalV2(w, "B0", { kind: "EXTRA_ORDER", householdId: "H0", day: 1, amount: 5 });
    advanceLocalV2(w, 840);
    const orders = w.orders.filter((o) => o.householdId === "H0");
    expect(orders[0].status).toBe("sale_reserved");
    const before = hash(w.physical);
    expect(reservePurchaseV2(w, orders[1].id)).toBe(false);
    expect(hash(w.physical)).toBe(before);
    expect(cancelPurchaseV2(w, orders[0].id)).toBe(true);
    expect(reservePurchaseV2(w, orders[1].id)).toBe(true);
    expect(cancelPurchaseV2(w, orders[1].id)).toBe(true);
    expect(w.physical.reservations).toHaveLength(0);
    checkLocalV2(w);
  });

  it("rejects malformed physical content and unauthorized movement", () => {
    const invalid = structuredClone(fixture);
    invalid.physicalTypes.cart.container.maxContentsMass = 10;
    expect(() => validateEconomyE1V2(invalid)).toThrow();
    const w = newLocalWorldV2();
    const before = hash(w.physical);
    const remote = physicalTransaction(w.physical, { actorId: "B0", ownerIds: ["cooperative"] }, (t) => t.move("cart_1", "farm"));
    expect(remote.ok).toBe(false);
    expect(hash(w.physical)).toBe(before);
    checkPhysical(w.physical);
    const stolen = structuredClone(w);
    stolen.physical.objects.initial_coins_H0.ownerId = "cooperative";
    expect(() => checkLocalV2(stolen)).toThrow("cash owner");
  });

  it("keeps farm food in place when the cart is elsewhere or the carrier cannot return", () => {
    const cartAway = newLocalWorldV2();
    cartAway.physical.objects.cart_1.parentId = "farm";
    advanceLocalV2(cartAway, 840);
    expect(cartAway.shipments[0].status).toBe("failed");
    expect(contentsQuantity(cartAway.physical, "store_farm", "food")).toBe(21);
    expect(cartAway.events.some((e) => e.kind === "journey_blocked" && e.data.reason === "cart_not_here")).toBe(true);
    const tired = newLocalWorldV2(); tired.people.C.energy = 11;
    advanceLocalV2(tired, 840);
    expect(tired.shipments[0].status).toBe("failed");
    expect(contentsQuantity(tired.physical, "store_farm", "food")).toBe(21);
    expect(contentsQuantity(tired.physical, "cart_1", "food")).toBe(0);
  });

  it("charges loading, travel and unloading separately, wears the cart, then restores energy by a completed rest task", () => {
    const w = newLocalWorldV2();
    advanceLocalV2(w, 749);
    expect(w.people.C.energy).toBe(89);
    expect(w.cartCondition).toBe(98);
    advanceLocalV2(w, 1);
    expect(w.people.C.energy).toBe(64); // 5 to load 21 food, then 20 to drive it homeward
    expect(w.cartCondition).toBe(96);
    expect(w.events.find((e) => e.kind === "work_effort_paid" && e.data.work === "load_food")?.data).toMatchObject({ effort: 5, energyBefore: 89, energyAfter: 84 });
    advanceLocalV2(w, 90);
    expect(w.people.C.energy).toBe(58); // 5 to unload, 1 to walk home
    expect(w.events.find((e) => e.kind === "work_effort_paid" && e.data.work === "unload_food")?.data).toMatchObject({ effort: 5, energyBefore: 64, energyAfter: 59 });
    expect(w.events.filter((e) => e.kind === "vehicle_worn" && e.actors.includes("C"))).toHaveLength(2);
    advanceLocalV2(w, 600);
    expect(w.people.C.energy).toBe(100);
    expect(w.events.some((e) => e.kind === "rest_completed" && e.actors.includes("C") && e.data.energyBefore === 58)).toBe(true);
    expect(w.tasks.some((t) => t.personId === "C" && t.capability === "rest" && t.status === "completed")).toBe(true);
  });

  it("does not unload or produce when the worker lacks effort, and does not recover away from home", () => {
    const unloading = newLocalWorldV2();
    advanceLocalV2(unloading, 751);
    unloading.people.C.energy = 0;
    advanceLocalV2(unloading, 840 - 751);
    expect(unloading.shipments[0].status).toBe("failed");
    expect(contentsQuantity(unloading.physical, "cart_1", "food")).toBe(21);
    expect(contentsQuantity(unloading.physical, "store_market", "food")).toBe(0);
    expect(unloading.events.some((e) => e.kind === "work_blocked" && e.data.work === "unload_food")).toBe(true);
    const brokenCart = newLocalWorldV2(); brokenCart.cartCondition = 1;
    advanceLocalV2(brokenCart, 360);
    expect(brokenCart.shipments[0].status).toBe("failed");
    expect(brokenCart.events.some((e) => e.kind === "journey_blocked" && e.data.reason === "cart_unfit")).toBe(true);
    expect(brokenCart.cartCondition).toBe(1);
    const farmer = newLocalWorldV2(); farmer.people.F0.energy = 7;
    advanceLocalV2(farmer, 720);
    expect(farmer.producedFood).toBe(18);
    expect(farmer.events.some((e) => e.kind === "work_blocked" && e.actors.includes("F0") && e.data.work === "farm_shift")).toBe(true);
    farmer.people.F0.energy = 40;
    advanceLocalV2(farmer, 1440 - 720);
    expect(farmer.people.F0.energy).toBe(40);
    expect(farmer.events.some((e) => e.kind === "rest_missed" && e.actors.includes("F0"))).toBe(true);
  });
});
