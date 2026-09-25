import { describe, it, expect } from "vitest";
import { newGame, tick, observe } from "../packages/sim/engine";
import { check, hash, load, save, submit, event } from "../packages/sim/core";
import { receiveOrder } from "../packages/sim/military";
import { receiveReport } from "../packages/sim/economy";
describe("M3 90-day playable scenario", () => {
  it("diplomatic victory pays real funds and survives save/resume with ordinary AI", () => {
    const w = newGame();
    submit(w, "a_0000", {
      kind: "NEGOTIATE",
      amount: 3000,
      nonAggression: true,
      durationDays: 120,
    });
    tick(w, 10 * 1440);
    expect(w.treaties).toHaveLength(1);
    expect(w.offers[0].status).toBe("accepted");
    const r = load(save(w));
    tick(w, 80 * 1440);
    tick(r, 80 * 1440);
    expect(w.outcome).toBe("victory");
    expect(hash(w)).toBe(hash(r));
    check(w);
    expect(w.commands.some((c) => c.origin === "ordinary_ai")).toBe(true);
  });
  it("military route captures pass after actual combat", () => {
    const w = newGame();
    submit(w, "a_0000", {
      kind: "RECRUIT",
      count: 80,
      purpose: "expedition",
      termDays: 90,
      reward: 20,
    });
    tick(w, 1440);
    for (const u of Object.values(w.units).filter((u) => u.factionId === "a")) {
      submit(w, "a_0000", {
        kind: "DISPATCH_SUPPLY",
        unitId: u.id,
        amount: 250,
      });
      submit(w, "a_0000", {
        kind: "ISSUE_ORDER",
        unitId: u.id,
        intent: "attack",
        destination: "pass",
        fallback: "capital",
        retreatFood: 0,
      });
    }
    tick(w, 89 * 1440);
    expect(w.outcome).toBe("victory");
    expect(w.settlements.pass.factionId).toBe("a");
    expect(w.battles.some((b) => b.winner === "a")).toBe(true);
    expect(w.events.some((e) => e.kind === "death")).toBe(true);
    check(w);
  });
  it("inaction loses at day 90", () => {
    const w = newGame();
    tick(w, 90 * 1440);
    expect(w.outcome).toBe("defeat");
    expect(w.minute).toBe(129600);
  });
  it("fulfilling family support changes Mira’s expedition decision", () => {
    const w = newGame(),
      u = Object.values(w.units)[0];
    u.commanderId = "a_0002";
    const message = {
      id: "fixture",
      sender: "a_0000",
      recipient: "a_0002",
      sentAt: 0,
      arriveAt: 1,
      causes: [w.events[0].id],
      kind: "order" as const,
      data: {
        unitId: u.id,
        intent: "attack",
        destination: "pass",
        fallback: "capital",
        retreatFood: 1,
      },
    };
    receiveOrder(w, message);
    expect(u.destination).toBeUndefined();
    submit(w, "a_0000", {
      kind: "PROPOSE_PROMISE",
      beneficiaries: ["a_0002"],
      amount: 40,
      dueDay: 1,
      trigger: "always",
      promiseKind: "family",
      escrow: true,
      inherited: true,
    });
    tick(w, 1440 + 400);
    receiveOrder(w, message);
    expect(u.destination).toBe("pass");
    expect(
      w.events.filter((e) => e.kind === "order_response").at(-1)?.data.response,
    ).toMatch(/support|comply/);
  });
  it("hidden army movement and captured settlement do not leak before report", () => {
    const w = newGame(),
      r = load(save(w));
    const u = Object.values(r.units).find((u) => u.factionId === "b")!;
    u.location = "farm";
    r.settlements.pass.factionId = "a";
    expect(observe(w)).toEqual(observe(r));
  });
});
