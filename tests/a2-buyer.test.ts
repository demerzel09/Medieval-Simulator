import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { advanceLocalV2, loadLocalA2, loadLocalV2, localV2Summary, newLocalWorldA2, replayLocalA2, saveLocalA2, submitLocalV2 } from "../packages/sim/local-economy-v2";
import type { BuyerModel } from "../packages/ai/local-buyer";

describe("A2 buyer-led E1 slice", () => {
  it("keeps the three-day physical food and cash loop with buyer decisions", () => {
    const w = newLocalWorldA2();
    for (let day = 1; day <= 3; day++) {
      advanceLocalV2(w, 1440);
      const s = localV2Summary(w);
      expect(s.consumedFood).toBe(day * 20);
      expect(s.settledOrders).toBe(day * 4);
      expect(s.hungryPeople).toBe(0);
    }
    expect(localV2Summary(w).cooperativeMoney).toBe(120);
    expect(w.events.filter((e) => e.kind === "buyer_decided" && e.data.action === "post_order")).toHaveLength(12);
    expect(w.events.filter((e) => e.kind === "buyer_decided" && e.data.action === "depart_market")).toHaveLength(12);
    expect(w.events.filter((e) => e.kind === "buyer_decided" && e.data.action === "settle_sale,return_home")).toHaveLength(12);
  });

  it("does not create orders when the buyer model declines to act", () => {
    const passive: BuyerModel = { decide(input) { return { attempts: [], wait: { at: input.knownContext.nextDayOrderAt } }; } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 1440, passive);
    expect(w.orders).toHaveLength(0);
    expect(localV2Summary(w).settledOrders).toBe(0);
    expect(localV2Summary(w).hungryPeople).toBe(20);
    expect(localV2Summary(w).cooperativeMoney).toBe(0);
  });

  it("does not give a household food when its buyer has no cash", () => {
    const w = newLocalWorldA2();
    expect(submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocalV2(w, 1440);
    expect(w.orders.some((o) => o.householdId === "H0")).toBe(false);
    expect(localV2Summary(w).settledOrders).toBe(3);
    expect(localV2Summary(w).hungryPeople).toBe(5);
  });

  it("rechecks local cash before departing after an order was placed", () => {
    const w = newLocalWorldA2();
    advanceLocalV2(w, 500);
    expect(w.orders.some((o) => o.householdId === "H0" && o.status === "requested")).toBe(true);
    expect(submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocalV2(w, 940);
    expect(w.events.some((e) => e.kind === "journey_started" && e.actors.includes("B0"))).toBe(false);
    expect(w.orders.find((o) => o.householdId === "H0")?.status).toBe("expired");
    expect(localV2Summary(w).settledOrders).toBe(3);
  });

  it("does not replace an absent buyer or invent a sale when the seller is absent", () => {
    const absentBuyer = newLocalWorldA2();
    expect(submitLocalV2(absentBuyer, "B0", { kind: "ABSENT", personId: "B0", day: 1 })).toBe(true);
    advanceLocalV2(absentBuyer, 1440);
    expect(absentBuyer.orders.some((o) => o.householdId === "H0")).toBe(false);
    expect(localV2Summary(absentBuyer).settledOrders).toBe(3);

    const absentSeller = newLocalWorldA2();
    expect(submitLocalV2(absentSeller, "S", { kind: "ABSENT", personId: "S", day: 1 })).toBe(true);
    advanceLocalV2(absentSeller, 1440);
    expect(absentSeller.orders).toHaveLength(4);
    expect(localV2Summary(absentSeller).settledOrders).toBe(0);
    expect(absentSeller.events.some((e) => e.kind === "purchase_failed")).toBe(true);
    expect(absentSeller.people.B0.journey).toBeUndefined();
  });

  it("resumes buyer intentions and reproduces the event chain", () => {
    const w = newLocalWorldA2(71);
    advanceLocalV2(w, 830);
    const resumed = loadLocalA2(saveLocalA2(w));
    advanceLocalV2(w, 610); advanceLocalV2(resumed, 610);
    const replayed = replayLocalA2(71, w.commands, 1440);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayed)).toBe(hash(w));
    expect(() => loadLocalV2(saveLocalA2(w))).toThrow("incompatible");
    expect(() => loadLocalA2(JSON.stringify({ ...w, buyerActors: undefined }))).toThrow();
  });
});
