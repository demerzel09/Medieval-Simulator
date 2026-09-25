import content from "../content/scenario.json";
import type { Good, Person, PromiseContract, World } from "../contracts";
import { clamp, event, uid, zero } from "./core";
import { policyResponse } from "../ai";
export type Entry = [string, string, Good, number];
export function transfer(
  w: World,
  from: string,
  to: string,
  good: Good,
  amount: number,
  ledger?: Entry[],
): boolean {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !w.accounts[from] ||
    !w.accounts[to] ||
    w.accounts[from][good] < amount
  )
    return false;
  w.accounts[from][good] -= amount;
  w.accounts[to][good] += amount;
  if (amount) ledger?.push([from, to, good, amount]);
  return true;
}
export function produce(w: World, owner: string, good: Good, amount: number) {
  w.accounts[owner][good] += amount;
  w.produced[good] += amount;
}
export function consume(w: World, owner: string, good: Good, amount: number) {
  const n = Math.min(amount, w.accounts[owner][good]);
  w.accounts[owner][good] -= n;
  w.consumed[good] += n;
  return n;
}
export function distribute(total: number, ids: string[]) {
  const sorted = [...ids].sort();
  return sorted.map((id, i) => ({
    id,
    amount: Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0),
  }));
}
export function send(
  w: World,
  sender: string,
  recipient: string,
  kind: World["messages"][number]["kind"],
  data: Record<string, unknown>,
  causes: string[],
  delay = 1,
) {
  w.messages.push({
    id: uid(w, "msg"),
    sender,
    recipient,
    sentAt: w.minute,
    arriveAt: w.minute + Math.max(1, delay),
    causes,
    kind,
    data,
  });
}
export function report(
  w: World,
  e: World["events"][number],
  recipient: string,
  delay = 1,
  source = e.actorIds[0] ?? recipient,
) {
  send(w, source, recipient, "report", { eventId: e.id }, [e.id], delay);
}
export function receiveReport(
  w: World,
  recipient: string,
  eventId: string,
  source: string,
) {
  const p = w.people[recipient],
    e = w.events.find((e) => e.id === eventId);
  if (!p || !e || p.beliefs.some((b) => b.eventId === e.id)) return;
  p.beliefs.push({
    eventId: e.id,
    observedAt: e.worldMinute,
    receivedAt: w.minute,
    source,
    confidence: 1,
    text: e.text,
    kind: e.kind,
    causes: e.causes,
  });
  p.memories.push(e.id);
  if (e.kind === "promise_fulfilled" || e.kind === "promise_breached") {
    const promisor = String(e.data.promisorId);
    p.trust[promisor] = clamp(
      (p.trust[promisor] ?? 0.5) +
        (e.kind === "promise_fulfilled" ? 0.08 : -0.2) *
          Number(e.data.severity ?? 1),
    );
  }
}
export function dailyEconomy(w: World) {
  const ledger: Entry[] = [],
    production = { food: 0, wood: 0, equipment: 0 },
    unpaid: Record<string, number> = {};
  for (const p of Object.values(w.people)) {
    if (!p.alive || p.captiveBy || p.military || p.health <= 0.3) continue;
    const owner = `work_${p.factionId}`;
    if (p.job === "farmer") {
      produce(w, owner, "food", 3);
      production.food += 3;
    }
    if (p.job === "woodworker") {
      produce(w, owner, "wood", 2);
      production.wood += 2;
    }
    if (p.job === "artisan" && w.accounts[owner].wood >= 2) {
      consume(w, owner, "wood", 2);
      produce(w, owner, "equipment", 1);
      production.equipment++;
    }
  }
  for (const p of Object.values(w.people)) {
    if (!p.alive || p.captiveBy) continue;
    const employer = p.military ? p.factionId : `work_${p.factionId}`,
      wage = p.military ? content.wages.military : content.wages.civilian;
    const paid = Math.min(wage, w.accounts[employer].money);
    transfer(w, employer, p.id, "money", paid, ledger);
    if (paid < wage) unpaid[p.id] = wage - paid;
    p.taxCarry += Math.round(paid * p.knownTax * 100);
    const tax = Math.floor(p.taxCarry / 100);
    p.taxCarry %= 100;
    transfer(w, p.id, p.factionId, "money", tax, ledger);
    const contribution = Math.floor((paid - tax) * 0.8);
    if (p.military && p.location !== p.homeId && contribution) {
      const transit = uid(w, "remit");
      w.accounts[transit] = zero();
      transfer(w, p.id, transit, "money", contribution, ledger);
      send(
        w,
        p.id,
        p.id,
        "remittance",
        { from: transit, to: p.householdId, amount: contribution },
        [],
        360,
      );
    } else transfer(w, p.id, p.householdId, "money", contribution, ledger);
  }
  for (const f of Object.values(w.factions)) {
    const households = Object.values(w.households).filter(
      (h) => h.factionId === f.id,
    );
    const orders = households.map((h) => {
      const members = h.memberIds
        .map((id) => w.people[id])
        .filter((p) => p.alive && !p.military && !p.captiveBy);
      const need = Math.max(0, members.length - w.accounts[h.id].food);
      for (const p of members) {
        if (w.accounts[h.id].money >= need * 2) break;
        transfer(
          w,
          p.id,
          h.id,
          "money",
          Math.min(w.accounts[p.id].money, need * 2 - w.accounts[h.id].money),
          ledger,
        );
      }
      return {
        h,
        members,
        want: Math.min(need, Math.floor(w.accounts[h.id].money / 2)),
        allocated: 0,
      };
    });
    const stock = w.accounts[`work_${f.id}`],
      demand = orders.reduce((a, o) => a + o.want, 0),
      supply = Math.min(demand, stock.food);
    let used = 0;
    for (const o of orders) {
      o.allocated = demand ? Math.floor((o.want * supply) / demand) : 0;
      used += o.allocated;
    }
    const offset = Math.floor(w.minute / 1440) % orders.length;
    for (let i = 0; used < supply && i < orders.length; i++) {
      const o = orders[(i + offset) % orders.length];
      if (o.allocated < o.want) {
        o.allocated++;
        used++;
      }
    }
    for (const o of orders) {
      transfer(w, o.h.id, `work_${f.id}`, "money", o.allocated * 2, ledger);
      transfer(w, `work_${f.id}`, o.h.id, "food", o.allocated, ledger);
      for (const p of o.members) {
        const fed = consume(w, o.h.id, "food", 1);
        p.hunger = fed ? Math.max(0, p.hunger - 1) : p.hunger + 1;
      }
    }
  }
  for (const u of Object.values(w.units))
    for (const id of u.memberIds) {
      const p = w.people[id];
      if (!p.alive || p.captiveBy) continue;
      const fed = consume(w, u.id, "food", 1);
      p.hunger = fed ? Math.max(0, p.hunger - 1) : p.hunger + 1;
      p.morale = clamp(p.morale + (fed ? 0.005 : -0.06));
    }
  for (const p of Object.values(w.people))
    if (p.alive && p.captiveBy) {
      p.hunger = consume(w, p.captiveBy, "food", 1) ? 0 : p.hunger + 1;
    }
  const e = event(
    w,
    "economy",
    `${Math.floor(w.minute / 1440)}日目の収支：食糧生産${production.food}、未払${Object.keys(unpaid).length}人`,
    [],
    [],
    {
      ledger,
      production,
      unpaid,
      hungry: {
        a: Object.values(w.people).filter(
          (p) => p.factionId === "a" && p.hunger > 0,
        ).length,
        b: Object.values(w.people).filter(
          (p) => p.factionId === "b" && p.hunger > 0,
        ).length,
      },
    },
    [],
  );
  for (const f of Object.values(w.factions))
    report(w, e, f.rulerId, 120, f.rulerId);
  settlePromises(w);
  for (const p of Object.values(w.people))
    if (
      p.military &&
      p.military.dueAt <= w.minute &&
      w.units[p.military.unitId]?.location === p.homeId
    )
      demobilizePerson(w, p);
}
export function settlePromises(w: World) {
  for (const p of w.promises) {
    if (p.status !== "active" || w.minute < p.dueAt) continue;
    const triggered =
      p.trigger === "always" ||
      (p.trigger === "victory" && w.victoryEvents.length > 0) ||
      (p.trigger === "passage" &&
        w.treaties.some((t) => t.expiresAt > w.minute));
    if (!triggered) continue;
    const ruler = w.people[p.promisorId];
    const from =
      p.escrow ??
      (p.kind === "loot" ? `loot_${ruler.factionId}` : ruler.factionId);
    const available = Math.min(
      p.amount - p.fulfilledAmount,
      w.accounts[from].money,
    );
    const ledger: Entry[] = [];
    for (const share of distribute(available, p.beneficiarySnapshot)) {
      const beneficiary = w.people[share.id];
      const to =
        p.kind === "family" || (!beneficiary.alive && p.inherited)
          ? beneficiary.householdId
          : beneficiary.id;
      transfer(w, from, to, "money", share.amount, ledger);
    }
    p.fulfilledAmount += available;
    p.status = p.fulfilledAmount === p.amount ? "fulfilled" : "breached";
    const e = event(
      w,
      `promise_${p.status}`,
      `約束${p.id}：${p.status === "fulfilled" ? "履行" : "未払いによる違反"}（${p.fulfilledAmount}/${p.amount}）`,
      [p.promisorId],
      p.sourceEventIds,
      {
        promiseId: p.id,
        promisorId: p.promisorId,
        ledger,
        severity: Math.min(
          1,
          p.amount / Math.max(1, p.beneficiarySnapshot.length) / 40,
        ),
        benefit: available / Math.max(1, p.beneficiarySnapshot.length),
      },
      [p.promisorId],
    );
    p.sourceEventIds.push(e.id);
    for (const id of p.beneficiarySnapshot)
      report(w, e, id, w.people[id].location === ruler.location ? 1 : 360);
  }
}
export function demobilizePerson(w: World, p: Person) {
  if (!p.military) return;
  const u = w.units[p.military.unitId];
  u.memberIds = u.memberIds.filter((id) => id !== p.id);
  transfer(w, p.id, p.factionId, "equipment", w.accounts[p.id].equipment);
  p.military = undefined;
  p.location = p.homeId;
}
export function recruit(
  w: World,
  factionId: string,
  count: number,
  purpose: "defense" | "expedition" | "trade",
  termDays: number,
  reward: number,
  cause: string,
) {
  const f = w.factions[factionId],
    existing = Object.values(w.people).filter(
      (p) => p.factionId === factionId && p.military,
    ).length;
  let recruited = 0;
  let unit = Object.values(w.units).find(
    (u) =>
      u.factionId === factionId &&
      u.memberIds.length < 20 &&
      !u.destination &&
      u.location === f.capitalId,
  );
  for (const p of Object.values(w.people)) {
    if (recruited >= count || existing + recruited >= f.cap) break;
    if (
      p.factionId !== factionId ||
      !p.alive ||
      p.captiveBy ||
      p.military ||
      p.roles.includes("ruler")
    )
      continue;
    const response = policyResponse(p, f.rulerId, purpose, 0.2, reward / 20);
    p.reactions[cause] = response.response;
    if (response.score < 0) continue;
    if (
      w.accounts[factionId].equipment < 1 &&
      w.accounts[`work_${factionId}`].equipment > 0 &&
      w.accounts[factionId].money >= 12
    ) {
      transfer(w, factionId, `work_${factionId}`, "money", 12);
      transfer(w, `work_${factionId}`, factionId, "equipment", 1);
    }
    if (w.accounts[factionId].equipment < 1) continue;
    if (!unit || unit.memberIds.length >= 20) {
      const id = uid(w, "unit");
      unit = {
        id,
        factionId,
        commanderId: factionId === "a" ? "a_0001" : "b_0001",
        memberIds: [],
        location: f.capitalId,
        intent: "rest",
        fallback: f.capitalId,
        retreatFood: 1,
        readyAt: 0,
        x: factionId === "a" ? 12 : 48,
        y: 32,
      };
      w.units[id] = unit;
      w.accounts[id] = zero();
    }
    unit.memberIds.push(p.id);
    p.military = { unitId: unit.id, dueAt: w.minute + termDays * 1440 };
    p.location = unit.location;
    p.morale = clamp(0.55 + 0.2 * (p.trust[f.rulerId] ?? 0.5));
    transfer(w, factionId, p.id, "equipment", 1);
    transfer(
      w,
      factionId,
      unit.id,
      "food",
      Math.min(12, w.accounts[factionId].food),
    );
    recruited++;
  }
  event(
    w,
    "recruit",
    `${recruited}人が${purpose === "defense" ? "防衛" : "遠征"}の軍籍に加入`,
    [f.rulerId],
    [cause],
    { count: recruited },
  );
  return recruited;
}
export function makePromise(
  w: World,
  p: Omit<
    PromiseContract,
    "id" | "createdAt" | "fulfilledAmount" | "status" | "deliveredTo"
  >,
) {
  const promise: PromiseContract = {
    ...p,
    id: uid(w, "promise"),
    createdAt: w.minute,
    fulfilledAmount: 0,
    status: "proposed",
    deliveredTo: [],
  };
  w.promises.push(promise);
  return promise;
}
