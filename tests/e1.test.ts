import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import {
  advanceLocal, cancelPurchase, checkLocal, loadLocal, newLocalWorld,
  replayLocal, reservePurchase, saveLocal, submitLocal,
} from "../packages/sim/local-economy";
import { economyE1, validateEconomyE1 } from "../packages/content/economy-e1";

describe("E1 local food circulation", () => {
  it("moves real food through a carrier and seller, then feeds twenty people for three days", () => {
    const w = newLocalWorld();
    const expected = [
      { produced: 21, consumed: 20, money: 40, market: 1 },
      { produced: 42, consumed: 40, money: 80, market: 2 },
      { produced: 60, consumed: 60, money: 120, market: 0 },
    ];
    for (const [index, result] of expected.entries()) {
      advanceLocal(w, 1440);
      const market = w.lots.filter((lot) => lot.ownerId === "cooperative" && lot.place === "market")
        .reduce((n, lot) => n + lot.quantity, 0);
      expect({ produced: w.producedFood, consumed: w.consumedFood, money: w.wallets.cooperative, market }).toEqual(result);
      expect(Object.values(w.people).filter((p) => p.hunger > 0)).toHaveLength(0);
    }
    expect(w.orders.filter((o) => o.status === "settled")).toHaveLength(12);
    expect(w.shipments.map((s) => s.quantity)).toEqual([21, 21, 18]);
    expect(Object.values(w.households).map((h) => w.wallets[h.id])).toEqual([10, 10, 10, 10]);
    expect(w.events.filter((e) => e.kind === "meal_eaten")).toHaveLength(60);
    expect(w.tasks.filter((t) => t.capability === "carry_food" && t.status === "completed")).toHaveLength(3);
    const byId = new Map(w.events.map((e) => [e.id, e]));
    const ancestors = (eventId: string, seen = new Set<string>()): Set<string> => {
      for (const cause of byId.get(eventId)?.causes ?? []) {
        seen.add(cause);
        ancestors(cause, seen);
      }
      return seen;
    };
    const meal = w.events.find((e) => e.kind === "meal_eaten" && e.minute === 1140)!;
    const causes = [...ancestors(meal.id)].map((id) => byId.get(id)!.kind);
    expect(causes).toContain("food_produced");
    expect(causes).toContain("shipment_delivered");
    expect(causes).toContain("sale_settled");
    expect(causes).toContain("task_accepted");
    checkLocal(w);
  });

  it("leaves food at the farm and meals unmet when the carrier is absent", () => {
    const w = newLocalWorld();
    expect(submitLocal(w, "C", { kind: "ABSENT", personId: "C", day: 2 })).toBe(true);
    advanceLocal(w, 2880);
    expect(w.shipments[1].status).toBe("failed");
    expect(w.lots.filter((l) => l.place === "farm").reduce((n,l) => n+l.quantity,0)).toBe(21);
    expect(w.orders.filter((o) => o.day === 2 && o.status === "settled")).toHaveLength(0);
    expect(Object.values(w.people).filter((p) => p.hunger > 0)).toHaveLength(20);
    expect(w.events.some((e) => e.kind === "shipment_failed" && e.actors.includes("C"))).toBe(true);
    checkLocal(w);
  });

  it("requires money and does not take another household's purchase", () => {
    const w = newLocalWorld();
    expect(submitLocal(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocal(w, 1440);
    expect(w.orders.find((o) => o.householdId === "H0")?.status).toBe("expired");
    expect(w.events.filter((e) => e.kind === "meal_missed" && e.data.householdId === "H0")).toHaveLength(5);
    expect(w.orders.filter((o) => o.status === "settled")).toHaveLength(3);
    expect(w.wallets.cooperative).toBe(30);
    expect(w.wallets.reserve).toBe(40);
    checkLocal(w);
  });

  it("reduces actual production when one farmer misses a shift", () => {
    const w = newLocalWorld();
    expect(submitLocal(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 })).toBe(true);
    advanceLocal(w, 2880);
    expect(w.producedFood).toBe(39);
    expect(w.shipments[1].quantity).toBe(18);
    expect(w.orders.filter((o) => o.day === 2 && o.status === "settled")).toHaveLength(3);
    expect(Object.values(w.people).filter((p) => p.hunger > 0)).toHaveLength(5);
    checkLocal(w);
  });

  it("reserves each coin and food unit once, and releases both on cancellation", () => {
    const w = newLocalWorld();
    expect(submitLocal(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 30 })).toBe(true);
    expect(submitLocal(w, "B0", { kind: "EXTRA_ORDER", householdId: "H0", day: 1, amount: 5 })).toBe(true);
    advanceLocal(w, 840);
    const orders = w.orders.filter((o) => o.householdId === "H0");
    expect(orders).toHaveLength(2);
    expect(orders[0].status).toBe("sale_reserved");
    expect(reservePurchase(w, orders[1].id)).toBe(false);
    expect(cancelPurchase(w, orders[0].id)).toBe(true);
    expect(reservePurchase(w, orders[1].id)).toBe(true);
    expect(cancelPurchase(w, orders[1].id)).toBe(true);
    expect(w.holds).toHaveLength(0);
    expect(w.wallets.H0).toBe(10);
    checkLocal(w);
  });

  it("replays accepted commands and resumes a mid-run save exactly", () => {
    const w = newLocalWorld(42);
    expect(submitLocal(w, "C", { kind: "ABSENT", personId: "C", day: 2 })).toBe(true);
    advanceLocal(w, 1440);
    const saved = saveLocal(w);
    advanceLocal(w, 2880);
    const resumed = loadLocal(saved);
    advanceLocal(resumed, 2880);
    const replayed = replayLocal(42, w.commands, 4320);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayed)).toBe(hash(w));
    expect(() => loadLocal(saved.replace('"contentHash":"', '"contentHash":"tampered'))).toThrow();
  });

  it("resumes an in-transit cargo without prematurely exposing market stock", () => {
    const w = newLocalWorld(7);
    advanceLocal(w, 751);
    expect(w.shipments[0].status).toBe("in_transit");
    expect(w.lots.filter((l) => l.place === "market")).toHaveLength(0);
    const resumed = loadLocal(saveLocal(w));
    advanceLocal(w, 1440 - 751);
    advanceLocal(resumed, 1440 - 751);
    expect(hash(resumed)).toBe(hash(w));
    expect(w.orders.filter((o) => o.status === "settled")).toHaveLength(4);
  });

  it("keeps people and purchased food in houses, on roads, or at their actual work sites", () => {
    const w = newLocalWorld();
    expect(w.people.F0.location).toBe("house:H0");
    expect(w.households.H0.memberIds).toContain("F0");
    advanceLocal(w, 330);
    expect(w.people.F0.journey?.to).toBe("farm");
    advanceLocal(w, 30);
    expect(w.people.F0.location).toBe("farm");
    expect(w.people.C.journey?.to).toBe("farm");
    advanceLocal(w, 391);
    expect(w.lots.filter((l) => l.place.startsWith("cargo:")).reduce((n, l) => n + l.quantity, 0)).toBe(21);
    expect(w.lots.filter((l) => l.place.startsWith("house:"))).toHaveLength(0);
    advanceLocal(w, 104);
    expect(w.lots.filter((l) => l.place === "carried:B0").reduce((n, l) => n + l.quantity, 0)).toBe(5);
    advanceLocal(w, 75);
    expect(w.people.B0.location).toBe("house:H0");
    expect(w.lots.filter((l) => l.place === "house:H0").reduce((n, l) => n + l.quantity, 0)).toBe(5);
    checkLocal(w);
  });

  it("moves physical cash through the buyer pouch and charges effort for a loaded cart", () => {
    const w = newLocalWorld();
    expect(w.cashContainers.find((c) => c.id === "chest_H0")?.amount).toBe(40);
    advanceLocal(w, 825);
    expect(w.cashContainers.find((c) => c.id === "chest_H0")?.amount).toBe(30);
    expect(w.cashContainers.find((c) => c.id === "pouch_B0")?.amount).toBe(10);
    expect(w.cart.location).toBe("market");
    expect(w.people.C.energy).toBeLessThan(100);
    advanceLocal(w, 30);
    expect(w.cashContainers.find((c) => c.id === "pouch_B0")?.amount).toBe(0);
    expect(w.cashContainers.find((c) => c.id === "till_cooperative")?.amount).toBe(10);
    const trip = w.events.find((e) => e.kind === "journey_started" && e.actors.includes("C") && e.data.foodLoad === 21);
    expect(trip?.data.effortCost).toBe(20);
    checkLocal(w);
  });

  it("blocks an exhausted carrier without moving food or creating a sale", () => {
    const w = newLocalWorld();
    w.people.C.energy = 10;
    advanceLocal(w, 1440);
    expect(w.shipments[0].status).toBe("failed");
    expect(w.lots.filter((l) => l.place === "farm").reduce((n,l) => n+l.quantity,0)).toBe(21);
    expect(w.orders.filter((o) => o.status === "settled")).toHaveLength(0);
    expect(w.events.some((e) => e.kind === "journey_blocked" && e.actors.includes("C") && e.data.reason === "exhausted")).toBe(true);
    checkLocal(w);
  });

  it("returns loaded food to the farm if the carrier cannot afford the return trip", () => {
    const w = newLocalWorld();
    w.people.C.energy = 11;
    advanceLocal(w, 840);
    expect(w.cart.location).toBe("farm");
    expect(w.shipments[0].status).toBe("failed");
    expect(w.lots.filter((l) => l.place === "farm").reduce((n,l) => n+l.quantity,0)).toBe(21);
    expect(w.lots.filter((l) => l.place.startsWith("cargo:"))).toHaveLength(0);
    expect(w.events.some((e) => e.kind === "shipment_failed" && e.data.reason === "travel_cost")).toBe(true);
    checkLocal(w);
  });

  it("cannot use a cart that is at another location", () => {
    const w = newLocalWorld();
    w.cart.location = "farm";
    advanceLocal(w, 360);
    expect(w.shipments[0].status).toBe("failed");
    expect(w.people.C.location).toBe("market");
    expect(w.cart.location).toBe("farm");
    expect(w.events.some((e) => e.kind === "journey_blocked" && e.data.reason === "cart_not_here")).toBe(true);
    checkLocal(w);
  });

  it("rejects over-capacity food and cash rather than allowing invisible carrying", () => {
    const w = newLocalWorld();
    advanceLocal(w, 840);
    const order = w.orders.find((o) => o.householdId === "H0")!;
    expect(cancelPurchase(w, order.id)).toBe(true);
    const chest = w.cashContainers.find((c) => c.id === "chest_H0")!;
    const pouch = w.cashContainers.find((c) => c.id === "pouch_B0")!;
    chest.amount -= 10; pouch.amount += 10;
    order.status = "requested"; order.quantity = 6;
    expect(reservePurchase(w, order.id)).toBe(false);
    expect(pouch.amount).toBe(20);
    expect(() => { pouch.amount = 21; chest.amount = 19; checkLocal(w); }).toThrow("invalid E1 cash container");
  });

  it("rejects invalid people and impossible travel times in fixture content", () => {
    const duplicate = structuredClone(economyE1);
    duplicate.households[0].other[0] = duplicate.households[1].other[0];
    expect(() => validateEconomyE1(duplicate)).toThrow();
    const impossible = structuredClone(economyE1);
    impossible.roadKm = 20;
    expect(() => validateEconomyE1(impossible)).toThrow();
    const wrongRole = structuredClone(economyE1);
    wrongRole.routines[0].role = "all";
    expect(() => validateEconomyE1(wrongRole)).toThrow();
    const overlapping = structuredClone(economyE1);
    overlapping.map.houses.H0 = { ...overlapping.map.market };
    expect(() => validateEconomyE1(overlapping)).toThrow();
  });
});
