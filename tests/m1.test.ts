import { it, expect, describe } from "vitest";
import { newGame, tick } from "../packages/sim/engine";
import { check, hash, load, save, submit, event } from "../packages/sim/core";
import {
  demobilizePerson,
  receiveReport,
  settlePromises,
  transfer,
} from "../packages/sim/economy";
import { policyResponse } from "../packages/ai";
describe("M1 life, commitments and identity", () => {
  it("1000 people survive 30 days with conserved assets and deterministic resume", () => {
    const w = newGame();
    tick(w, 15 * 1440);
    const r = load(save(w));
    tick(w, 15 * 1440);
    tick(r, 15 * 1440);
    check(w);
    expect(w.population).toBe(1000);
    expect(hash(w)).toBe(hash(r));
    expect(w.produced.food).toBeGreaterThan(0);
  });
  it("same tax produces culture, purpose, trust and family dependent responses", () => {
    const p = newGame().people.a_0010;
    const home = { ...p, culture: "hearth" as const },
      honor = { ...p, culture: "honor" as const };
    expect(policyResponse(home, "a_0000", "expedition", 0.3).response).not.toBe(
      policyResponse(honor, "a_0000", "expedition", 0.3).response,
    );
    expect(
      policyResponse(home, "a_0000", "defense", 0.3).score,
    ).toBeGreaterThan(policyResponse(home, "a_0000", "expedition", 0.3).score);
    expect(
      policyResponse(
        { ...p, trust: { a_0000: 0.9 } },
        "a_0000",
        "trade",
        0.2,
        1,
      ).score,
    ).toBeGreaterThan(
      policyResponse(
        { ...p, trust: { a_0000: 0.1 } },
        "a_0000",
        "trade",
        0.2,
        1,
      ).score,
    );
    expect(
      policyResponse({ ...p, hunger: 3 }, "a_0000", "defense", 0.3).score,
    ).toBeLessThan(policyResponse(p, "a_0000", "defense", 0.3).score);
  });
  it("recruit removes workers; demobilization restores same household and production", () => {
    const w = newGame(),
      r = load(save(w));
    const u = Object.values(r.units).find((u) => u.factionId === "a")!;
    const p = r.people[u.memberIds[0]],
      family = p.householdId;
    for (const id of [...u.memberIds]) demobilizePerson(r, r.people[id]);
    tick(w, 1440);
    tick(r, 1440);
    expect(r.produced.food).toBeGreaterThan(w.produced.food);
    expect(p.householdId).toBe(family);
    check(r);
  });
  it("promise fulfilled and breached affect trust exactly once after report", () => {
    const w = newGame(),
      p = w.people.a_0002,
      before = p.trust.a_0000;
    submit(w, "a_0000", {
      kind: "PROPOSE_PROMISE",
      beneficiaries: [p.id],
      amount: 40,
      dueDay: 1,
      trigger: "always",
      promiseKind: "reward",
      escrow: true,
      inherited: true,
    });
    tick(w, 1440 + 400);
    expect(w.promises[0].status).toBe("fulfilled");
    expect(p.trust.a_0000).toBeCloseTo(before + 0.08);
    const e = w.events.find((e) => e.kind === "promise_fulfilled")!;
    receiveReport(w, p.id, e.id, "a_0000");
    expect(p.trust.a_0000).toBeCloseTo(before + 0.08);
    submit(w, "a_0000", {
      kind: "PROPOSE_PROMISE",
      beneficiaries: [p.id],
      amount: 999999,
      dueDay: 2,
      trigger: "always",
      promiseKind: "reward",
      escrow: false,
      inherited: true,
    });
    tick(w, 1440);
    expect(w.promises[1].status).toBe("breached");
    expect(p.trust.a_0000).toBeCloseTo(before - 0.12);
    check(w);
  });
  it("untriggered victory promise is not breached; exact 40/100 loot allocation", () => {
    const w = newGame();
    submit(w, "a_0000", {
      kind: "PROPOSE_PROMISE",
      beneficiaries: Array.from(
        { length: 8 },
        (_, i) => `a_${String(i + 10).padStart(4, "0")}`,
      ),
      amount: 40,
      dueDay: 1,
      trigger: "victory",
      promiseKind: "loot",
      escrow: false,
      inherited: true,
    });
    tick(w, 1440);
    expect(w.promises[0].status).toBe("active");
    const balances = w.promises[0].beneficiarySnapshot.map(
      (id) => w.accounts[id].money,
    );
    const e = event(w, "victory", "勝利");
    w.victoryEvents.push(e.id);
    transfer(w, "b", "loot_a", "money", 100);
    settlePromises(w);
    w.promises[0].beneficiarySnapshot.forEach((id, i) =>
      expect(w.accounts[id].money - balances[i]).toBe(5),
    );
    expect(w.promises[0].fulfilledAmount).toBe(40);
    check(w);
  });
  it("overspending never creates money", () => {
    const w = newGame();
    expect(transfer(w, "a", "b", "money", 999999)).toBe(false);
    expect(transfer(w, "a", "b", "money", -1)).toBe(false);
    check(w);
  });
});
