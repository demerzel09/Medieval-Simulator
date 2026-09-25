import { describe, it, expect } from "vitest";
import { newGame, tick } from "../packages/sim/engine";
import { check, hash, load, save, submit } from "../packages/sim/core";
import { replay } from "../packages/sim/replay";
import { combatFixture } from "../fixtures/combat";
import { recruit } from "../packages/sim/economy";
import { beginBattle } from "../packages/sim/military";
import { validateContent } from "../packages/content/validate";
import content from "../packages/content/scenario.json";
import { debugSnapshot } from "../packages/sim/debug";
describe("cross milestone acceptance", () => {
  it("seed + recorded external Commands reproduce ordinary AI and final events", () => {
    const w = newGame(42);
    submit(w, "a_0000", {
      kind: "NEGOTIATE",
      amount: 3000,
      nonAggression: true,
      durationDays: 120,
    });
    tick(w, 3 * 1440);
    submit(w, "a_0000", {
      kind: "PROPOSE_PROMISE",
      beneficiaries: ["a_0002"],
      amount: 40,
      dueDay: 5,
      trigger: "always",
      promiseKind: "family",
      escrow: true,
      inherited: true,
    });
    tick(w, 12 * 1440);
    const r = replay(w.seed, w.commands, w.minute);
    expect(hash(r)).toBe(hash(w));
    expect(r.events).toEqual(w.events);
  });
  it("battle fixtures independently change actual losses by deployment, supply, terrain and courier timing", () => {
    const base = combatFixture("control").battle;
    expect(combatFixture("highland", 51).battle.losses.b).toBeGreaterThan(
      combatFixture("control", 51).battle.losses.b,
    );
    expect(combatFixture("hungry").battle.losses.b).toBeLessThan(base.losses.b);
    expect(combatFixture("distant").battle.losses.a).toBeLessThan(
      base.losses.a,
    );
    expect(combatFixture("retreat_now").battle.losses.a).toBeLessThan(
      combatFixture("retreat_late").battle.losses.a,
    );
  });
  it("all 200 participants remain traceable through combat and world time", () => {
    const w = newGame(2);
    for (const f of ["a", "b"]) {
      w.accounts[f].equipment += 200;
      w.produced.equipment += 200;
      recruit(w, f, 200, "defense", 90, 100, w.events[0].id);
    }
    const units = Object.values(w.units);
    expect(units.flatMap((u) => u.memberIds)).toHaveLength(200);
    const identities = units.flatMap((u) => u.memberIds);
    for (const u of units) {
      u.location = "pass";
      for (const id of u.memberIds) w.people[id].location = "pass";
    }
    beginBattle(
      w,
      "pass",
      units.map((u) => u.id),
      w.events[0].id,
    );
    tick(w, 360);
    expect(w.minute).toBe(360);
    expect(identities.every((id) => w.people[id])).toBe(true);
    expect(w.battles[0].status).toBe("ended");
    check(w);
  });
  it("incompatible content, malformed references and invalid scenario reject cleanly", () => {
    const w = newGame();
    const bad = JSON.parse(save(w));
    bad.contentHash = "tampered";
    expect(() => load(JSON.stringify(bad))).toThrow();
    bad.contentHash = w.contentHash;
    bad.people.a_0001.id = "a_0000";
    expect(() => load(JSON.stringify(bad))).toThrow();
    expect(() =>
      validateContent({ ...content, population: [-1, 400] }),
    ).toThrow();
    expect(() => validateContent({ ...content, caps: [9999, 80] })).toThrow();
  });
});

it("audience requires travel; queued work waits and ruler observes only locally", () => {
  const w = newGame();
  w.people.a_0003.location = "trade";
  submit(w, "a_0000", {
    kind: "REQUEST_AUDIENCE",
    personId: "a_0003",
    mode: "visit",
  });
  submit(w, "a_0000", {
    kind: "SET_TAX",
    rate: 0.2,
    amount: 0,
    purpose: "trade",
  });
  tick(w, 120);
  expect(w.people.a_0000.location).toBe("capital");
  expect(w.factions.a.tax).toBe(0.1);
  tick(w, 1080);
  expect(w.people.a_0000.location).toBe("trade");
  expect(w.factions.a.tax).toBe(0.1);
  tick(w, 180);
  expect(w.factions.a.tax).toBe(0.2);
  check(w);
});
it("zero-value commitments do not create trust or free obedience", () => {
  const w = newGame(),
    before = w.people.a_0002.trust.a_0000;
  submit(w, "a_0000", {
    kind: "PROPOSE_PROMISE",
    beneficiaries: ["a_0002"],
    amount: 0,
    dueDay: 1,
    trigger: "always",
    promiseKind: "family",
    escrow: false,
    inherited: true,
  });
  tick(w, 1440 + 400);
  expect(w.people.a_0002.trust.a_0000).toBe(before);
  check(w);
  expect(w.events.every((e) => !e.causes.includes(e.id))).toBe(true);
  expect(
    w.people.a_0000.beliefs.every((b) => !b.causes?.includes(b.eventId)),
  ).toBe(true);
});

it("initial staff are residents; a summon requires a scribe, courier, guest journey and meeting", () => {
  const w = newGame(42);
  const target = w.people.a_0250;
  target.location = "trade";
  target.trust.a_0000 = 0.8;
  expect(
    Object.values(w.people).filter(
      (p) => p.factionId === "a" && p.roles.includes("scribe"),
    ).length,
  ).toBeGreaterThan(0);
  expect(
    Object.values(w.people).filter(
      (p) => p.factionId === "a" && p.roles.includes("courier"),
    ).length,
  ).toBeGreaterThan(0);
  expect(Object.keys(w.people)).toHaveLength(w.population);
  expect(
    submit(w, "a_0000", {
      kind: "REQUEST_AUDIENCE",
      personId: target.id,
      mode: "summon",
    }).ok,
  ).toBe(true);
  tick(w, 120);
  const audience = w.audiences[0];
  expect(audience.staffId).toBe("a_0005");
  expect(
    w.messages.some(
      (m) => m.kind === "audience_invite" && m.courierId === "a_0006",
    ),
  ).toBe(true);
  expect(target.location).toBe("trade");
  tick(w, 1700);
  expect(audience.status).toBe("completed");
  expect(
    w.events.some(
      (e) => e.kind === "audience" && e.actorIds.includes(audience.staffId),
    ),
  ).toBe(true);
  expect(
    w.events.some(
      (e) =>
        e.kind === "message_delivered" &&
        e.actorIds.includes(audience.courierId!),
    ),
  ).toBe(true);
  const view = debugSnapshot(w, "", target.id);
  expect(view.total).toBe(w.population);
  expect(
    view.selected?.events.some((e) => e.kind === "audience_guest_departure"),
  ).toBe(true);
  expect(view.selected?.activities.length).toBeGreaterThan(0);
  expect(
    view.selected?.activities.every((a) =>
      w.events.some((e) => e.id === a.sourceEventId),
    ),
  ).toBe(true);
  check(w);
  expect(hash(load(save(w)))).toBe(hash(w));
});

it("no scribe blocks court work and no courier prevents a summons", () => {
  const w = newGame(42);
  w.people.a_0005.alive = false;
  expect(
    submit(w, "a_0000", {
      kind: "REQUEST_AUDIENCE",
      personId: "a_0250",
      mode: "summon",
    }),
  ).toMatchObject({ ok: false, reason: "NO_AVAILABLE_SCRIBE" });
  w.people.a_0005.alive = true;
  for (const p of Object.values(w.people))
    if (p.factionId === "a" && p.roles.includes("courier")) p.alive = false;
  submit(w, "a_0000", {
    kind: "REQUEST_AUDIENCE",
    personId: "a_0250",
    mode: "summon",
  });
  tick(w, 120);
  expect(w.audiences[0].status).toBe("missed");
  expect(w.events.some((e) => e.kind === "dispatch_failed")).toBe(true);
  check(w);
});

it("v0.1 saves gain civilian court staff and preserve queued commands", () => {
  const w = newGame(71);
  submit(w, "a_0000", {
    kind: "SET_TAX",
    rate: 0.2,
    amount: 1,
    purpose: "defense",
  });
  const old = JSON.parse(save(w));
  old.engineVersion = "0.1.0";
  delete old.audiences;
  delete old.activities;
  for (const p of Object.values(old.people) as { roles: string[] }[])
    p.roles = p.roles.filter((r) => r !== "scribe" && r !== "courier");
  for (const c of old.commands) delete c.staffId;
  for (const c of old.queue) delete c.staffId;
  const migrated = load(JSON.stringify(old));
  expect(migrated.queue[0].staffId).toBeTruthy();
  expect(migrated.people[migrated.queue[0].staffId!].military).toBeUndefined();
  tick(migrated, 60);
  expect(migrated.factions.a.tax).toBe(0.2);
  check(migrated);
});
