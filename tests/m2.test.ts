import { describe, it, expect } from "vitest";
import { newGame, tick, observe } from "../packages/sim/engine";
import { check, event, load, save, submit } from "../packages/sim/core";
import {
  beginBattle,
  battleTick,
  power,
  kill,
  route,
  delay,
} from "../packages/sim/military";
import { OrdinaryPlanner } from "../packages/ai";
import { recruit, transfer, demobilizePerson } from "../packages/sim/economy";
function arena() {
  const w = newGame(71);
  const us = Object.values(w.units)
    .filter((u) => u.memberIds.length >= 10)
    .slice(0, 1)
    .concat(
      Object.values(w.units)
        .filter((u) => u.factionId === "b")
        .slice(0, 1),
    );
  const e = event(w, "fixture", "会戦比較");
  const b = beginBattle(
    w,
    "pass",
    us.map((u) => u.id),
    e.id,
  );
  us[0].x = 30;
  us[1].x = 31;
  us[0].y = us[1].y = 32;
  return { w, b, us };
}
describe("M2 war and communication", () => {
  it("route and courier speeds differ", () => {
    expect(route("capital", "pass").distance).toBe(66);
    const w = newGame();
    expect(delay(w, "capital", "pass", 2)).toBe(1980);
    expect(delay(w, "capital", "pass")).toBe(660);
  });
  it("supply and high ground independently affect combat power and losses", () => {
    const { w, b, us } = arena();
    const base = power(w, us[0], b);
    b.terrain[us[0].y * 64 + us[0].x] = "highland";
    expect(power(w, us[0], b)).toBeGreaterThan(base);
    b.terrain[us[0].y * 64 + us[0].x] = "plain";
    for (const id of us[0].memberIds) w.people[id].hunger = 3;
    expect(power(w, us[0], b)).toBeLessThan(base);
    const healthy = arena(),
      hungry = arena();
    for (const id of hungry.us[0].memberIds) hungry.w.people[id].hunger = 3;
    for (let i = 0; i < 90; i++) {
      healthy.w.minute++;
      hungry.w.minute++;
      battleTick(healthy.w);
      battleTick(hungry.w);
    }
    expect(hungry.b.losses.b).toBeLessThanOrEqual(healthy.b.losses.b);
    expect(healthy.w.minute).toBe(90);
    check(healthy.w);
    check(hungry.w);
  });
  it("commands wait for delivery; no instantaneous army turn", () => {
    const w = newGame(),
      u = Object.values(w.units)[0];
    u.location = "pass";
    submit(w, "a_0000", {
      kind: "ISSUE_ORDER",
      unitId: u.id,
      intent: "retreat",
      destination: "capital",
      fallback: "capital",
      retreatFood: 0,
    });
    tick(w, 60);
    expect(u.intent).toBe("rest");
    expect(w.messages.some((m) => m.kind === "order")).toBe(true);
    tick(w, 660);
    expect(u.intent).toBe("retreat");
  });
  it("military cap 120+80 preserves IDs, death idempotency and families", () => {
    const w = newGame();
    for (const f of ["a", "b"]) {
      transfer(
        w,
        `work_${f}`,
        f,
        "equipment",
        w.accounts[`work_${f}`].equipment,
      );
      w.accounts[f].equipment += 200;
      w.produced.equipment += 200;
      recruit(w, f, 200, "defense", 90, 100, w.events[0].id);
    }
    expect(Object.values(w.people).filter((p) => p.military).length).toBe(200);
    const p = Object.values(w.people).find((p) => p.military)!;
    const household = p.householdId;
    demobilizePerson(w, p);
    expect(p.householdId).toBe(household);
    kill(w, p, w.events[0].id);
    kill(w, p, w.events[0].id);
    expect(
      w.events.filter((e) => e.kind === "death" && e.actorIds.includes(p.id)),
    ).toHaveLength(1);
    check(w);
  });
  it("enemy secret changes do not change own observation or planner input", () => {
    const w = newGame(),
      r = load(save(w));
    r.people.b_0020.skill = 100;
    r.people.b_0020.trust.a_0000 = 0;
    expect(observe(w)).toEqual(observe(r));
    expect(new OrdinaryPlanner().plan(observe(w))).toEqual(
      new OrdinaryPlanner().plan(observe(r)),
    );
  });
});
