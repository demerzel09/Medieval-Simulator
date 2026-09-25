import type {
  Action,
  Battle,
  Command,
  Person,
  Unit,
  World,
} from "../contracts";
import { clamp, event, random, uid, zero } from "./core";
import { policyResponse } from "../ai";
import { report, send, transfer } from "./economy";
import content from "../content/scenario.json";
import { route } from "./geography";
export { route } from "./geography";
export function delay(w: World, from: string, to: string, speed = 6) {
  return Math.max(1, Math.ceil((route(from, to).distance / speed) * 60));
}
export function militaryAction(w: World, c: Command, cause: string): boolean {
  const a = c.action,
    p = w.people[c.actorId],
    f = p.factionId;
  if (
    ![
      "ASSIGN_COMMANDER",
      "ISSUE_ORDER",
      "MOVE_UNIT",
      "DISPATCH_SUPPLY",
      "SURRENDER",
    ].includes(a.kind)
  )
    return false;
  const unitId = "unitId" in a ? a.unitId : "",
    u = w.units[unitId];
  const fail = (text: string) => event(w, "rejected", text, [p.id], [cause]);
  if (!u || u.factionId !== f) {
    fail("部隊の指揮権がない");
    return true;
  }
  if (a.kind === "ASSIGN_COMMANDER") {
    const target = w.people[a.personId];
    if (!target?.alive || target.captiveBy || target.factionId !== f) {
      fail("指揮官を任命できない");
      return true;
    }
    send(
      w,
      p.id,
      u.commanderId,
      "order",
      { unitId: u.id, commanderId: target.id },
      [cause],
      delay(w, p.location, u.location),
    );
  }
  if (a.kind === "ISSUE_ORDER" || a.kind === "MOVE_UNIT") {
    if (
      !w.settlements[a.destination] ||
      (a.kind === "ISSUE_ORDER" && !w.settlements[a.fallback])
    ) {
      fail("目的地が存在しない");
      return true;
    }
    send(
      w,
      p.id,
      u.commanderId,
      "order",
      { ...a, unitId: u.id },
      [cause],
      delay(w, p.location, u.location),
    );
  }
  if (a.kind === "DISPATCH_SUPPLY") {
    if (u.destination) {
      fail("移動中の部隊には輸送先を確定できない");
      return true;
    }
    const path = route(w.factions[f].capitalId, u.location);
    if (path.path.some((id) => w.settlements[id].factionId !== f)) {
      fail("荷車は敵領を通過できない");
      return true;
    }
    if (w.accounts[f].food < a.amount) {
      fail("食糧不足");
      return true;
    }
    const id = uid(w, "supply");
    w.accounts[id] = zero();
    transfer(w, f, id, "food", a.amount);
    w.shipments.push({
      id,
      from: f,
      to: u.id,
      destination: u.location,
      arriveAt: w.minute + Math.max(1, Math.ceil((path.distance / 2) * 60)),
      cause,
    });
    event(w, "supply_sent", `${a.amount}食糧を荷車で発送`, [p.id], [cause], {
      shipmentId: id,
    });
  }
  if (a.kind === "SURRENDER")
    for (const id of u.memberIds)
      capture(w, w.people[id], f === "a" ? "b" : "a", cause);
  return true;
}
export function receiveOrder(w: World, m: World["messages"][number]) {
  const u = w.units[String(m.data.unitId)];
  if (!u) return;
  const commander = w.people[u.commanderId];
  if (!commander.alive || commander.captiveBy) return;
  if (m.data.commanderId) {
    u.commanderId = String(m.data.commanderId);
    event(w, "appointment", "新隊長が部隊に着任", [u.commanderId], m.causes);
    return;
  }
  const intent = String(m.data.intent ?? "attack"),
    destination = String(m.data.destination);
  const result = policyResponse(
    commander,
    m.sender,
    intent === "defend" ? "defense" : "expedition",
    0.15,
    0.35 +
      1.15 *
        Math.min(
          1,
          commander.beliefs
            .filter((b) => b.kind === "promise_fulfilled")
            .reduce(
              (sum, b) =>
                sum +
                Number(
                  w.events.find((e) => e.id === b.eventId)?.data.benefit ?? 0,
                ) /
                  40,
              0,
            ),
        ),
  );
  const outcome =
    intent === "retreat" || intent === "rest" || intent === "defend"
      ? "comply"
      : result.response;
  const e = event(
    w,
    "order_response",
    `${commander.name}：${outcome}（${intent}命令）`,
    [commander.id],
    m.causes,
    { unitId: u.id, response: outcome },
    [commander.id],
  );
  report(
    w,
    e,
    m.sender,
    delay(w, u.location, w.people[m.sender].location),
    commander.id,
  );
  u.orderEvent = e.id;
  if (["refuse", "delay", "flee", "bargain"].includes(outcome)) {
    u.intent = "defend";
    return;
  }
  u.intent = intent;
  u.fallback = String(m.data.fallback ?? w.factions[u.factionId].capitalId);
  u.retreatFood = Number(m.data.retreatFood ?? 1);
  const battle = w.battles.find(
    (b) => b.status === "active" && b.units.includes(u.id),
  );
  if (battle) {
    if (intent === "retreat") u.intent = "retreat";
    return;
  }
  if (u.location !== destination && !u.destination && u.readyAt <= w.minute) {
    u.destination = destination;
    u.arriveAt = w.minute + delay(w, u.location, destination, 2);
    for (const id of u.memberIds)
      w.people[id].fatigue = clamp(w.people[id].fatigue + 0.15);
  }
}
export function militaryArrivals(w: World) {
  for (const u of Object.values(w.units))
    if (u.destination && u.arriveAt! <= w.minute) {
      u.location = u.destination;
      u.destination = undefined;
      u.arriveAt = undefined;
      for (const id of u.memberIds) w.people[id].location = u.location;
      const e = event(
        w,
        "arrival",
        `${w.people[u.commanderId].name}の部隊が${w.settlements[u.location].name}へ到着`,
        [u.commanderId],
        u.orderEvent ? [u.orderEvent] : [],
        { unit: unitSnapshot(w, u) },
        [u.commanderId],
      );
      report(
        w,
        e,
        w.factions[u.factionId].rulerId,
        delay(
          w,
          u.location,
          w.settlements[w.factions[u.factionId].capitalId].id,
        ),
      );
    }
  const due = w.shipments.filter((s) => s.arriveAt <= w.minute);
  w.shipments = w.shipments.filter((s) => s.arriveAt > w.minute);
  for (const s of due) {
    const u = w.units[s.to];
    if (u && !u.destination && u.location === s.destination) {
      transfer(w, s.id, u.id, "food", w.accounts[s.id].food);
      const e = event(
        w,
        "supply_arrived",
        "補給便が到着",
        [u.commanderId],
        [s.cause],
        { shipmentId: s.id },
      );
      report(
        w,
        e,
        w.factions[u.factionId].rulerId,
        delay(w, u.location, w.factions[u.factionId].capitalId),
      );
    } else {
      transfer(w, s.id, s.from, "food", w.accounts[s.id].food);
      event(w, "supply_returned", "部隊不在、補給を返送", [], [s.cause]);
    }
  }
}
export function makeTerrain() {
  return Array.from({ length: 4096 }, (_, i) => {
    const x = i % 64,
      y = Math.floor(i / 64);
    return x === 32
      ? y >= 29 && y <= 35
        ? "bridge"
        : "river"
      : x > 40 && y < 40
        ? "highland"
        : x < 22 && y < 25
          ? "forest"
          : "plain";
  });
}
export function beginBattle(
  w: World,
  location: string,
  unitIds: string[],
  cause: string,
) {
  const b: Battle = {
    id: uid(w, "battle"),
    location,
    startedAt: w.minute,
    units: unitIds,
    terrain: makeTerrain(),
    status: "active",
    losses: { a: 0, b: 0 },
    cause,
  };
  let left = 0,
    right = 0;
  for (const id of unitIds) {
    const u = w.units[id];
    u.x = u.factionId === "a" ? 25 : 39;
    u.y = 30 + 2 * (u.factionId === "a" ? left++ : right++);
    u.intent = u.intent === "retreat" ? "retreat" : "attack";
  }
  w.battles.push(b);
  return b;
}
function ready(w: World, u: Unit) {
  return u.memberIds
    .map((id) => w.people[id])
    .filter(
      (p) =>
        p.alive &&
        !p.captiveBy &&
        !p.journey &&
        p.location === u.location &&
        p.health > 0.3 &&
        p.morale > 0.1,
    );
}
export function power(w: World, u: Unit, b: Battle) {
  const ps = ready(w, u);
  if (!ps.length) return 0;
  const mean = (f: (p: Person) => number) =>
    ps.reduce((n, p) => n + f(p), 0) / ps.length;
  const terrain = b.terrain[u.y * 64 + u.x];
  return (
    ps.length *
    (0.5 + mean((p) => p.skill) / 100) *
    (0.5 + mean((p) => p.morale)) *
    (1 - 0.5 * mean((p) => p.fatigue)) *
    (terrain === "highland" ? 1.15 : 1) *
    mean((p) => (w.accounts[p.id].equipment ? 1 : 0.6)) *
    (mean((p) => p.hunger) > 1 ? 0.65 : 1)
  );
}
export function kill(w: World, p: Person, cause: string) {
  if (!p.alive) return;
  p.alive = false;
  p.health = 0;
  p.military = undefined;
  const e = event(
    w,
    "death",
    `${p.name}が戦死。${p.householdId}に家族を残した`,
    [p.id],
    [cause],
    { householdId: p.householdId },
    [],
  );
  report(w, e, w.factions[p.factionId].rulerId, 360, p.id);
  for (const id of w.households[p.householdId].memberIds)
    if (w.people[id].alive) report(w, e, id, 360, p.id);
}
export function capture(w: World, p: Person, by: string, cause: string) {
  if (!p.alive || p.captiveBy) return;
  p.captiveBy = by;
  event(w, "capture", `${p.name}が捕虜になった`, [p.id], [cause], {}, []);
}
function nextCell(
  b: Battle,
  x: number,
  y: number,
  tx: number,
  ty: number,
): [number, number] {
  const start = y * 64 + x,
    target = ty * 64 + tx,
    queue = [start],
    prev = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length; i++) {
    const pos = queue[i];
    if (pos === target) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = (pos % 64) + dx,
        ny = Math.floor(pos / 64) + dy,
        n = ny * 64 + nx;
      if (
        nx < 0 ||
        nx >= 64 ||
        ny < 0 ||
        ny >= 64 ||
        b.terrain[n] === "river" ||
        prev.has(n)
      )
        continue;
      prev.set(n, pos);
      queue.push(n);
    }
  }
  if (!prev.has(target)) return [x, y];
  let n = target;
  while (prev.get(n) !== start && prev.get(n) !== -1) n = prev.get(n)!;
  return [n % 64, Math.floor(n / 64)];
}
export function battleTick(w: World) {
  for (const b of w.battles.filter((b) => b.status === "active")) {
    const units = b.units.map((id) => w.units[id]);
    const active = units.filter(
      (u) => ready(w, u).length > 0 && u.intent !== "escaped",
    );
    const hits: { target: Person; fatal: boolean; cause: string }[] = [],
      moves: { unit: Unit; x: number; y: number; escaped?: boolean }[] = [];
    for (const u of active) {
      const enemies = active
        .filter((v) => v.factionId !== u.factionId && v.intent !== "escaped")
        .sort(
          (a, c) =>
            Math.abs(a.x - u.x) +
              Math.abs(a.y - u.y) -
              Math.abs(c.x - u.x) -
              Math.abs(c.y - u.y) || a.id.localeCompare(c.id),
        );
      const enemy = enemies[0];
      if (!enemy) continue;
      const ps = ready(w, u);
      if (
        u.intent === "retreat" ||
        ps.every(
          (p) =>
            p.morale - 0.3 * p.fear + 0.2 * (p.trust[u.commanderId] ?? 0.5) <
            0.2,
        )
      ) {
        u.intent = "retreat";
        const tx = u.factionId === "a" ? 0 : 63;
        const [x, y] = nextCell(b, u.x, u.y, tx, u.y);
        moves.push({ unit: u, x, y, escaped: x === tx });
        continue;
      }
      const distance = Math.max(
        Math.abs(enemy.x - u.x),
        Math.abs(enemy.y - u.y),
      );
      if (distance > 1) {
        if (b.terrain[u.y * 64 + u.x] !== "forest" || w.minute % 2 === 0) {
          const [x, y] = nextCell(b, u.x, u.y, enemy.x, enemy.y);
          moves.push({ unit: u, x, y });
        }
        continue;
      }
      const targets = ready(w, enemy);
      const expected =
        content.combat.casualtyRate *
        power(w, u, b) *
        (b.terrain[enemy.y * 64 + enemy.x] === "forest" ? 0.7 : 1);
      let count =
        Math.floor(expected) + (random(w, "combat") < expected % 1 ? 1 : 0);
      const selected = [...targets];
      while (count-- > 0 && selected.length) {
        const i = Math.floor(random(w, "combat") * selected.length),
          target = selected.splice(i, 1)[0];
        hits.push({
          target,
          fatal: random(w, "combat") < content.combat.fatality,
          cause: u.orderEvent ?? b.cause,
        });
      }
    }
    for (const m of moves) {
      m.unit.x = m.x;
      m.unit.y = m.y;
      if (m.escaped) m.unit.intent = "escaped";
    }
    const lost = new Set<string>();
    for (const h of hits) {
      if (lost.has(h.target.id)) continue;
      lost.add(h.target.id);
      b.losses[h.target.factionId]++;
      if (h.fatal) kill(w, h.target, h.cause);
      else {
        h.target.health = 0.25;
        event(
          w,
          "wounded",
          `${h.target.name}が負傷`,
          [h.target.id],
          [h.cause],
          {},
          [],
        );
      }
    }
    for (const u of active) {
      const loss =
        u.memberIds.filter((id) => lost.has(id)).length /
        Math.max(1, u.memberIds.length);
      for (const p of ready(w, u)) {
        p.fatigue = clamp(p.fatigue + 0.002);
        p.fear = clamp(p.fear + loss);
        p.morale = clamp(
          p.morale -
            0.5 * loss -
            0.01 * p.fatigue -
            0.01 * Math.min(1, p.hunger) +
            0.004 * (w.people[u.commanderId].alive ? 1 : -1),
        );
      }
    }
    const sides = new Set(
      units
        .filter((u) => ready(w, u).length && u.intent !== "escaped")
        .map((u) => u.factionId),
    );
    if (sides.size < 2 || w.minute - b.startedAt >= 360) {
      b.status = "ended";
      b.winner = sides.size === 1 ? [...sides][0] : undefined;
      const e = event(
        w,
        "battle_end",
        `${w.settlements[b.location].name}の会戦：${b.winner ? (b.winner === "a" ? "アウル勝利" : "ベル勝利") : "決着なし"}。損害 アウル${b.losses.a}／ベル${b.losses.b}`,
        [],
        [b.cause],
        { battle: structuredClone(b), contacts: contacts(w, b.units) },
        [],
      );
      if (b.winner) {
        w.settlements[b.location].factionId = b.winner;
        if (b.winner === "a") w.victoryEvents.push(e.id);
        const loser = b.winner === "a" ? "b" : "a";
        const loot = Math.min(100, w.accounts[loser].money);
        transfer(w, loser, `loot_${b.winner}`, "money", loot);
        for (const u of units.filter((u) => u.factionId === loser))
          for (const id of u.memberIds) {
            const p = w.people[id];
            if (p.alive && p.health <= 0.3) capture(w, p, b.winner, e.id);
          }
      }
      for (const u of units) {
        u.readyAt = w.minute + 360;
        u.intent = "rest";
        if (b.winner && u.factionId !== b.winner) {
          u.location = u.fallback;
          for (const id of u.memberIds)
            if (!w.people[id].captiveBy) w.people[id].location = u.location;
        }
      }
      for (const f of Object.values(w.factions))
        report(
          w,
          e,
          f.rulerId,
          delay(w, b.location, f.capitalId),
          units.find((u) => u.factionId === f.id)?.commanderId ?? f.rulerId,
        );
    }
  }
}
export function militaryHour(w: World) {
  if (w.minute % 360 === 0) {
    for (const u of Object.values(w.units)) {
      const e = event(
        w,
        "unit_report",
        `${w.people[u.commanderId].name}から部隊報告`,
        [u.commanderId],
        u.orderEvent ? [u.orderEvent] : [],
        { unit: unitSnapshot(w, u) },
        [u.commanderId],
      );
      report(
        w,
        e,
        w.factions[u.factionId].rulerId,
        delay(w, u.location, w.factions[u.factionId].capitalId),
      );
    }
    for (const b of w.battles.filter((b) => b.status === "active")) {
      const e = event(
        w,
        "battle_report",
        "会戦の経過報告",
        [],
        [b.cause],
        { battle: structuredClone(b), contacts: contacts(w, b.units) },
        [],
      );
      for (const f of Object.values(w.factions))
        report(w, e, f.rulerId, delay(w, b.location, f.capitalId));
    }
  }
  for (const s of Object.values(w.settlements)) {
    if (w.battles.some((b) => b.location === s.id && b.status === "active"))
      continue;
    const us = Object.values(w.units).filter(
      (u) =>
        u.location === s.id &&
        !u.destination &&
        u.readyAt <= w.minute &&
        ready(w, u).length,
    );
    if (new Set(us.map((u) => u.factionId)).size === 2)
      beginBattle(
        w,
        s.id,
        us.map((u) => u.id),
        us.find((u) => u.orderEvent)?.orderEvent ?? w.events[0].id,
      );
    else if (
      us.some((u) => u.factionId !== s.factionId && u.intent === "attack")
    ) {
      const u = us.find((u) => u.factionId !== s.factionId)!;
      s.factionId = u.factionId;
      const e = event(
        w,
        "occupation",
        `${s.name}を占領`,
        [u.commanderId],
        u.orderEvent ? [u.orderEvent] : [],
        { settlement: structuredClone(s) },
        [u.commanderId],
      );
      if (u.factionId === "a") w.victoryEvents.push(e.id);
      report(
        w,
        e,
        w.factions[u.factionId].rulerId,
        delay(w, s.id, w.factions[u.factionId].capitalId),
      );
    }
  }
  for (const u of Object.values(w.units)) {
    if (w.battles.some((b) => b.status === "active" && b.units.includes(u.id)))
      continue;
    for (const id of u.memberIds)
      if (!u.destination)
        w.people[id].fatigue = clamp(w.people[id].fatigue - 0.01);
    if (
      u.memberIds.length &&
      w.accounts[u.id].food < u.memberIds.length * u.retreatFood &&
      u.location !== u.fallback &&
      !u.destination
    ) {
      u.destination = u.fallback;
      u.arriveAt = w.minute + delay(w, u.location, u.fallback, 2);
      u.intent = "retreat";
    }
  }
}

export function contacts(w: World, unitIds: string[]) {
  return unitIds.map((id) => {
    const u = w.units[id],
      n = ready(w, u).length;
    return {
      unitId: id,
      factionId: u.factionId,
      location: u.location,
      x: u.x,
      y: u.y,
      min: Math.floor(n * 0.8),
      max: Math.ceil(n * 1.2),
      observedAt: w.minute,
    };
  });
}

export function unitSnapshot(w: World, u: Unit): Unit {
  return {
    ...structuredClone(u),
    memberIds: u.memberIds.filter(
      (id) => w.people[id].alive && !w.people[id].captiveBy,
    ),
    reportedFood: w.accounts[u.id].food,
  };
}
