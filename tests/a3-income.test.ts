import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { contentsQuantity } from "../packages/sim/physical";
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

  it("lets an unfunded household collect wages but does not invent a meal", () => {
    const w = newLocalWorldA3Income();
    expect(submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 })).toBe(true);
    advanceLocalV2(w, 4320);
    expect(contentsQuantity(w.physical, "chest_H0", "currency")).toBeGreaterThan(0);
    expect(w.events.some((event) => event.kind === "wage_paid" && event.data.householdId === "H0")).toBe(true);
    expect(w.people.F0.hunger).toBe(3);
    expect(w.people.F0.energy).toBeLessThan(100);
    expect(w.events.some((event) => event.kind === "rest_completed" && event.actors.includes("F0") && event.data.hunger === 2 && Number(event.data.recovered) < 50)).toBe(true);
    expect(w.events.some((event) => event.kind === "meal_eaten" && event.actors.includes("F0"))).toBe(false);
    checkLocalV2(w);
  });

  it("keeps earned wages unpaid when the market has no sales or cashier", () => {
    const w = newLocalWorldA3Income();
    expect(submitLocalV2(w, "S", { kind: "ABSENT", personId: "S", day: 1 })).toBe(true);
    advanceLocalV2(w, 1440);
    expect(w.wageClaims!.filter((claim) => claim.personId.startsWith("F"))).toHaveLength(7);
    expect(w.wageClaims!.some((claim) => claim.paidEventId)).toBe(false);
    expect(contentsQuantity(w.physical, "till_cooperative", "currency")).toBe(0);
    expect(w.events.some((event) => event.kind === "wage_unpaid" && event.data.reason === "seller_unavailable")).toBe(true);
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
});
