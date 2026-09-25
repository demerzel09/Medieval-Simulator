import type { ActorObservation, Command, World } from "../contracts";
import { advance, check, event, submit, uid, zero } from "./core";
import {
  dailyEconomy,
  demobilizePerson,
  makePromise,
  receiveReport,
  recruit,
  report,
  send,
  transfer,
} from "./economy";
import {
  contacts,
  unitSnapshot,
  militaryAction,
  militaryArrivals,
  receiveOrder,
  battleTick,
  militaryHour,
} from "./military";
import {
  advanceAudiences,
  diplomacyAction,
  diplomaticMessage,
  finish,
} from "./diplomacy";
import { generate } from "./generate";
import { OrdinaryPlanner, policyResponse } from "../ai";
export function newGame(seed = 240924, populations = [600, 400]) {
  const w = generate(seed, populations);
  for (const f of ["a", "b"]) {
    const e = event(
      w,
      "start",
      "峠の商用通行権を90日目までに確保せよ。条約または占領が必要。",
      [w.factions[f].rulerId],
    );
    recruit(
      w,
      f,
      Math.min(
        f === "a" ? 40 : 30,
        Math.floor(populations[f === "a" ? 0 : 1] / 4),
      ),
      "defense",
      90,
      20,
      e.id,
    );
  }
  for (const u of Object.values(w.units))
    event(
      w,
      "unit_report",
      "初期の軍籍報告",
      [w.factions[u.factionId].rulerId],
      [],
      { unit: unitSnapshot(w, u) },
    );
  check(w);
  return w;
}
export function observe(w: World, actorId = "a_0000"): ActorObservation {
  const p = w.people[actorId],
    f = p.factionId,
    known = new Set(p.beliefs.map((b) => b.eventId));
  const events = w.events.filter((e) => known.has(e.id));
  const unitMap: Record<string, World["units"][string]> = {};
  const locations = structuredClone(w.settlements);
  for (const s of Object.values(locations))
    s.factionId = ["capital", "farm", "trade"].includes(s.id) ? "a" : "b";
  const battles: World["battles"] = [];
  const contactMap: Record<string, ActorObservation["contacts"][number]> = {};
  for (const e of events) {
    for (const c of (e.data.contacts ?? []) as ActorObservation["contacts"])
      if (c.factionId !== f) contactMap[c.unitId] = c;
    if (e.data.unit) {
      const u = e.data.unit as World["units"][string];
      unitMap[u.id] = u;
    }
    if (e.data.settlement) {
      const s = e.data.settlement as World["settlements"][string];
      locations[s.id] = s;
    }
    if (e.data.battle) {
      const b = e.data.battle as World["battles"][number];
      const i = battles.findIndex((x) => x.id === b.id);
      if (i >= 0) battles[i] = b;
      else battles.push(b);
      if (b.winner) locations[b.location].factionId = b.winner;
    }
  }
  for (const u of Object.values(w.units))
    if (u.location === p.location && !u.destination) {
      if (u.factionId === f) unitMap[u.id] = unitSnapshot(w, u);
      else contactMap[u.id] = contacts(w, [u.id])[0];
    }
  for (const b of w.battles.filter((b) => b.location === p.location)) {
    const i = battles.findIndex((x) => x.id === b.id);
    if (i >= 0) battles[i] = b;
    else battles.push(b);
  }
  const own = Object.values(w.people).filter((other) => other.factionId === f);
  const lastEconomy = [...events].reverse().find((e) => e.kind === "economy");
  return structuredClone({
    actorId,
    location: p.location,
    contacts: Object.values(contactMap),
    minute: w.minute,
    day: Math.floor(w.minute / 1440),
    people: own.map(({ id, name, roles, homeId, householdId, job }) => ({
      id,
      name,
      roles,
      homeId,
      householdId,
      job,
    })),
    settlements: Object.values(locations),
    reports: p.beliefs,
    promises: w.promises.filter(
      (pr) =>
        pr.promisorId === actorId || pr.beneficiarySnapshot.includes(actorId),
    ),
    units: Object.values(unitMap),
    treasury: w.accounts[f],
    pending: w.messages
      .filter((m) => m.sender === actorId)
      .map((m) => ({ id: m.id, kind: m.kind, arriveAt: m.arriveAt })),
    offers: w.offers.filter((o) => o.from === actorId),
    passage:
      locations.pass.factionId === f ||
      w.treaties.some(
        (t) => t.from === f && t.commercial && t.expiresAt > w.minute,
      ),
    outcome: w.outcome,
    summary: {
      dead: events.filter(
        (e) =>
          e.kind === "death" &&
          e.actorIds.some((id) => w.people[id]?.factionId === f),
      ).length,
      hungry: Number(
        (lastEconomy?.data.hungry as Record<string, number> | undefined)?.[f] ??
          0,
      ),
      fulfilled: w.promises.filter(
        (p) => p.promisorId === actorId && p.status === "fulfilled",
      ).length,
      breached: w.promises.filter(
        (p) => p.promisorId === actorId && p.status === "breached",
      ).length,
    },
    battles,
  });
}
export function arrivals(w: World) {
  militaryArrivals(w);
  const due = w.messages.filter((m) => m.arriveAt <= w.minute);
  w.messages = w.messages.filter((m) => m.arriveAt > w.minute);
  for (const m of due) {
    const courier = m.courierId ? w.people[m.courierId] : undefined;
    if (
      !courier?.alive ||
      courier.captiveBy ||
      courier.military ||
      !m.destination ||
      !w.people[m.recipient] ||
      w.people[m.recipient].location !== m.destination
    ) {
      const missed = event(
        w,
        "message_missed",
        `${courier?.name ?? "伝令"}の届け物は相手へ届かなかった`,
        courier ? [courier.id] : [],
        m.causes,
        { messageId: m.id, kind: m.kind, recipient: m.recipient },
      );
      if (m.kind === "audience_invite") {
        const audience = w.audiences.find((a) => a.id === m.data.audienceId);
        if (audience) audience.status = "missed";
        report(w, missed, m.sender, 1, courier?.id ?? m.sender);
      }
      if (courier && m.destination) courier.location = m.destination;
      continue;
    }
    courier.location = m.destination;
    const delivered = event(
      w,
      "message_delivered",
      `${courier.name}が${w.people[m.recipient].name}へ${m.kind}を届けた`,
      [courier.id, m.recipient],
      m.causes,
      { messageId: m.id, kind: m.kind },
      [courier.id, m.recipient],
    );
    m.causes.push(delivered.id);
    if (m.kind === "order") receiveOrder(w, m);
    if (
      m.kind === "offer" ||
      m.kind === "reply" ||
      m.kind === "audience_invite"
    )
      diplomaticMessage(w, m);
    if (m.kind === "report")
      receiveReport(w, m.recipient, String(m.data.eventId), m.sender);
    if (m.kind === "remittance")
      transfer(
        w,
        String(m.data.from),
        String(m.data.to),
        "money",
        Number(m.data.amount),
      );
    if (m.kind === "tax") {
      const p = w.people[m.recipient];
      if (!p.alive) continue;
      p.knownTax = Number(m.data.rate);
      const result = policyResponse(
        p,
        m.sender,
        m.data.purpose as "defense",
        Number(m.data.amount) / 30,
      );
      p.reactions[m.causes[0]] = result.response;
      const paid = ["support", "comply"].includes(result.response)
        ? Math.min(Number(m.data.amount), w.accounts[p.householdId].money)
        : 0;
      transfer(w, p.householdId, p.factionId, "money", paid);
      if (p.roles.length || p.id.endsWith("0010")) {
        const e = event(
          w,
          "reaction",
          `${p.name}：${result.response}。${paid}通貨を納税`,
          [p.id],
          m.causes,
          { response: result.response, paid },
          [p.id],
        );
        report(w, e, m.sender, 60, p.id);
      }
    }
    if (m.kind === "promise") {
      const pr = w.promises.find((p) => p.id === m.data.promiseId);
      if (pr && !pr.deliveredTo.includes(m.recipient)) {
        pr.deliveredTo.push(m.recipient);
        pr.status = "active";
        event(
          w,
          "promise_accepted",
          `${w.people[m.recipient].name}が約束を受諾`,
          [m.recipient],
          pr.sourceEventIds,
          { promiseId: pr.id },
          [m.recipient],
        );
      }
    }
  }
  advanceAudiences(w);
}
export function apply(w: World, c: Command) {
  const p = w.people[c.actorId];
  if (!p?.alive || p.captiveBy) {
    event(w, "rejected", "行動者が不在", [c.actorId]);
    return;
  }
  const staff = c.staffId ? w.people[c.staffId] : undefined;
  if (
    c.staffId &&
    (!staff?.alive || staff.captiveBy || staff.location !== p.location)
  ) {
    event(
      w,
      "command_unprepared",
      `${p.name}の文書は書記が不在で完成しなかった`,
      [p.id, ...(staff ? [staff.id] : [])],
    );
    return;
  }
  const prepared = staff
    ? event(
        w,
        "scribe_prepared",
        `${staff.name}が${p.name}の文書を整えた`,
        [staff.id, p.id],
        [],
        { commandId: c.id },
        [staff.id, p.id],
      )
    : undefined;
  const a = c.action,
    f = p.factionId;
  const e = event(
    w,
    "command",
    `${p.name}：${a.kind}`,
    [p.id, ...(staff ? [staff.id] : [])],
    prepared ? [prepared.id] : [],
    {
      commandId: c.id,
      action: a,
    },
  );
  const fail = (reason: string) => event(w, "rejected", reason, [p.id], [e.id]);
  if (militaryAction(w, c, e.id) || diplomacyAction(w, c, e.id)) return;
  switch (a.kind) {
    case "WAIT":
      break;
    case "SET_TAX":
      w.factions[f].tax = a.rate;
      w.factions[f].purpose = a.purpose;
      for (const person of Object.values(w.people))
        if (person.factionId === f)
          send(
            w,
            p.id,
            person.id,
            "tax",
            a,
            [e.id],
            person.location === p.location ? 1 : 240,
          );
      break;
    case "TRANSFER_RESOURCE":
      if (
        ![p.id, f].includes(a.from) ||
        !w.accounts[a.to] ||
        !transfer(w, a.from, a.to, a.good, a.amount)
      )
        fail("権限または資産が不足");
      break;
    case "ASSIGN_JOB": {
      const person = w.people[a.personId];
      if (
        !person ||
        person.factionId !== f ||
        !person.alive ||
        person.captiveBy ||
        person.military
      )
        fail("勤務変更できない人物");
      else person.job = a.job;
      break;
    }
    case "RECRUIT": {
      const before = new Set(
        Object.values(w.people)
          .filter((p) => p.military)
          .map((p) => p.id),
      );
      recruit(w, f, a.count, a.purpose, a.termDays, a.reward, e.id);
      const ids = Object.values(w.people)
        .filter((p) => p.military && !before.has(p.id))
        .map((p) => p.id);
      if (a.reward && ids.length) {
        const pr = makePromise(w, {
          promisorId: p.id,
          beneficiarySnapshot: ids,
          witnessIds: [p.id],
          dueAt: w.minute + 7 * 1440,
          kind: "reward",
          trigger: "victory",
          amount: ids.length * a.reward,
          sourceEventIds: [e.id],
          inherited: true,
        });
        for (const id of ids)
          send(w, p.id, id, "promise", { promiseId: pr.id }, [e.id], 60);
      }
      break;
    }
    case "DEMOBILIZE": {
      const u = w.units[a.unitId];
      if (
        !u ||
        u.factionId !== f ||
        u.destination ||
        u.location !== w.factions[f].capitalId
      )
        fail("首都への帰還が必要");
      else for (const id of [...u.memberIds]) demobilizePerson(w, w.people[id]);
      break;
    }
    case "PROPOSE_PROMISE": {
      if (
        a.beneficiaries.some((id) => !w.people[id]) ||
        a.dueDay * 1440 <= w.minute
      ) {
        fail("対象または期限が無効");
        break;
      }
      let escrow: string | undefined;
      if (a.escrow) {
        if (w.accounts[f].money < a.amount) {
          fail("保証金が不足");
          break;
        }
        escrow = uid(w, "escrow");
        w.accounts[escrow] = zero();
        transfer(w, f, escrow, "money", a.amount);
      }
      const pr = makePromise(w, {
        promisorId: p.id,
        beneficiarySnapshot: [...new Set(a.beneficiaries)],
        witnessIds: [p.id],
        dueAt: a.dueDay * 1440,
        kind: a.promiseKind,
        trigger: a.trigger,
        amount: a.amount,
        sourceEventIds: [e.id],
        escrow,
        inherited: a.inherited,
      });
      for (const id of pr.beneficiarySnapshot)
        send(
          w,
          p.id,
          id,
          "promise",
          { promiseId: pr.id },
          [e.id],
          w.people[id].location === p.location ? 1 : 240,
        );
      break;
    }
    case "ACCEPT_PROMISE": {
      const pr = w.promises.find((pr) => pr.id === a.promiseId);
      if (!pr?.beneficiarySnapshot.includes(p.id)) fail("受益者ではない");
      else {
        pr.status = "active";
        if (!pr.deliveredTo.includes(p.id)) pr.deliveredTo.push(p.id);
      }
      break;
    }
    case "SEND_MESSAGE":
      if (!w.people[a.recipient]) fail("相手不明");
      else {
        const msg = event(w, "letter", a.text, [p.id], [e.id]);
        report(w, msg, a.recipient, 240, p.id);
      }
      break;
    default:
      fail("この段階では未実装");
  }
}
const planner = new OrdinaryPlanner();
export function tick(w: World, minutes: number) {
  return advance(w, minutes, {
    arrivals,
    apply,
    battle: battleTick,
    hour: militaryHour,
    day: (w) => {
      dailyEconomy(w);
      runAI(w);
    },
    finish,
  });
}
export function runAI(w: World) {
  for (const f of Object.values(w.factions))
    if (f.id === "b")
      for (const a of planner.plan(observe(w, f.rulerId)))
        submit(w, f.rulerId, a, undefined, "ordinary_ai");
}
