import type { Audience, Command, Message, World } from "../contracts";
import { clamp, event, uid } from "./core";
import { report, send, transfer } from "./economy";
import { delay } from "./military";
export function diplomacyAction(w: World, c: Command, cause: string) {
  const a = c.action,
    p = w.people[c.actorId],
    f = p.factionId;
  const fail = (text: string) => event(w, "rejected", text, [p.id], [cause]);
  if (a.kind === "NEGOTIATE") {
    const other = w.factions[f === "a" ? "b" : "a"].rulerId;
    const offer = {
      id: uid(w, "offer"),
      from: p.id,
      to: other,
      amount: a.amount,
      dueAt: w.minute + a.durationDays * 1440,
      nonAggression: a.nonAggression,
      status: "sent" as const,
      cause,
    };
    w.offers.push(offer);
    send(
      w,
      p.id,
      other,
      "offer",
      { offerId: offer.id },
      [cause],
      delay(w, p.location, w.people[other].location),
    );
    return true;
  }
  if (a.kind === "REQUEST_AUDIENCE") {
    const target = w.people[a.personId];
    if (
      !target?.alive ||
      target.captiveBy ||
      target.factionId !== f ||
      target.id === p.id
    ) {
      fail("面談相手が不在");
      return true;
    }
    const mode = a.mode ?? "summon";
    const audience: Audience = {
      id: uid(w, "audience"),
      requesterId: p.id,
      targetId: target.id,
      staffId: c.staffId!,
      mode,
      destination: mode === "summon" ? p.location : target.location,
      targetOrigin: target.location,
      status: mode === "summon" ? "inviting" : "traveling",
      causeIds: [cause],
    };
    w.audiences.push(audience);
    if (mode === "summon") {
      const invitation = send(
        w,
        p.id,
        target.id,
        "audience_invite",
        { audienceId: audience.id },
        [cause],
        delay(w, p.location, target.location),
      );
      if (!invitation) audience.status = "missed";
      else
        event(
          w,
          "audience_invited",
          `${w.people[c.staffId!].name}が${target.name}への招待状を作成`,
          [c.staffId!, p.id],
          [cause],
          { audienceId: audience.id, courierId: invitation.courierId },
        );
    } else {
      const travel =
        p.location === target.location
          ? 1
          : delay(w, p.location, target.location, 2);
      audience.arriveAt = w.minute + travel;
      p.journey = {
        kind: "audience",
        destination: target.location,
        arriveAt: audience.arriveAt,
      };
      w.people[c.staffId!].journey = {
        kind: "escort",
        destination: target.location,
        arriveAt: audience.arriveAt,
      };
      const departure = event(
        w,
        "audience_departure",
        `${p.name}は${w.people[c.staffId!].name}と${target.name}のもとへ出発`,
        [p.id, c.staffId!],
        [cause],
        { audienceId: audience.id, arriveAt: audience.arriveAt },
      );
      audience.causeIds.push(departure.id);
      postponeCourt(w, p.id, c.staffId!, travel + 120);
    }
    return true;
  }
  if (a.kind === "ASSIGN_ROLE") {
    const target = w.people[a.personId];
    if (!target?.alive || target.factionId !== f || target.captiveBy) {
      fail("任命相手が不在");
      return true;
    }
    for (const other of Object.values(w.people))
      if (other.factionId === f && other.roles.includes(a.role)) {
        other.roles = other.roles.filter((r) => r !== a.role);
        other.trust[p.id] = clamp((other.trust[p.id] ?? 0.5) - 0.12);
        const e = event(
          w,
          "dismissed",
          `${other.name}は解任を名誉の傷と受け止めた`,
          [other.id],
          [cause],
          {},
          [other.id],
        );
        report(w, e, p.id, 60, other.id);
      }
    target.roles.push(a.role);
    target.trust[p.id] = clamp((target.trust[p.id] ?? 0.5) + 0.1);
    return true;
  }
  return false;
}
export function diplomaticMessage(w: World, m: World["messages"][number]) {
  if (m.kind === "reply" && m.data.legacyAudience) {
    const p = w.people[m.recipient],
      visitor = w.people[m.sender];
    visitor.location = String(m.data.location);
    if (!p.alive || p.captiveBy || p.location !== visitor.location) {
      event(
        w,
        "audience_missed",
        `${p.name}は現地に不在だった`,
        [visitor.id],
        m.causes,
      );
      return;
    }
    event(
      w,
      "audience",
      `${p.name}の願い：${p.culture === "hearth" ? "故郷と家族を守ってほしい。遠征には実際の扶助を。" : p.culture === "honor" ? "先代への奉仕を忘れず、私に指揮を任せてほしい。" : "通行権と予測できる契約を望む。"}`,
      [p.id, visitor.id],
      m.causes,
    );
    p.trust[m.sender] = clamp((p.trust[m.sender] ?? 0.5) + 0.03);
    return;
  }
  if (m.kind === "audience_invite") {
    receiveInvitation(w, m);
    return;
  }
  const o = w.offers.find((o) => o.id === m.data.offerId);
  if (!o) return;
  const receiver = w.people[o.to],
    proposer = w.people[o.from];
  if (m.kind === "offer") {
    const trust = receiver.trust[o.from] ?? 0.5;
    const militaryOpportunity = 0.6;
    const materialGain = Math.min(1, o.amount / (30 * (30 * 4 + 15)));
    const score =
      0.35 * materialGain +
      0.25 * (o.nonAggression ? trust : 0) +
      0.2 * trust +
      0.2 * 0.8 -
      0.3 * militaryOpportunity;
    const answer =
      score >= 0.25 ? "accepted" : score >= 0.1 ? "counter" : "rejected";
    const e = event(
      w,
      "diplomatic_answer",
      `${receiver.name}：${answer === "accepted" ? "通行条約を受諾" : answer === "counter" ? "対価20%増の反対提案" : "提案を拒否"}`,
      [receiver.id],
      [o.cause],
      {
        score,
        materialGain,
        securityGain: o.nonAggression ? trust : 0,
        trust,
        normFit: 0.8,
        militaryOpportunity,
      },
      [receiver.id],
    );
    send(
      w,
      o.to,
      o.from,
      "reply",
      { offerId: o.id, answer, eventId: e.id },
      [e.id],
      delay(w, receiver.location, proposer.location),
    );
  }
  if (m.kind === "reply" && m.data.answer) {
    receiveAnswer: {
      const answer = String(m.data.answer);
      if (answer !== "accepted") {
        o.status = answer === "counter" ? "counter" : "rejected";
        if (o.status === "counter") o.amount = Math.ceil(o.amount * 1.2);
        const e = event(
          w,
          "diplomacy",
          `外交返答：${o.status === "counter" ? `反対提案 ${o.amount}通貨` : "拒否"}`,
          [o.from],
          m.causes,
        );
        break receiveAnswer;
      }
      if (
        o.dueAt <= w.minute ||
        !transfer(w, proposer.factionId, receiver.factionId, "money", o.amount)
      ) {
        o.status = "rejected";
        event(w, "diplomacy", "対価を支払えず条約は不成立", [o.from], m.causes);
        break receiveAnswer;
      }
      o.status = "accepted";
      const t = {
        id: uid(w, "treaty"),
        offerId: o.id,
        from: proposer.factionId,
        to: receiver.factionId,
        route: "pass",
        commercial: true,
        military: false,
        expiresAt: o.dueAt,
        notifiedAt: w.minute + delay(w, receiver.location, "pass"),
      };
      w.treaties.push(t);
      event(
        w,
        "treaty",
        `商用通行権を獲得。通行料${o.amount}、軍用通行は対象外。門衛へ通知中。`,
        [o.from],
        m.causes,
        { treaty: t },
      );
    }
  }
}
function postponeCourt(
  w: World,
  rulerId: string,
  staffId: string,
  minutes: number,
  from = w.minute,
) {
  for (const queued of w.queue.filter(
    (q) => q.actorId === rulerId && q.executeAt >= from,
  )) {
    queued.executeAt += minutes;
    const historical = w.commands.find((q) => q.id === queued.id);
    if (historical && historical !== queued)
      historical.executeAt = queued.executeAt;
  }
  w.busyUntil[rulerId] = Math.max(w.busyUntil[rulerId] ?? 0, from) + minutes;
  w.busyUntil[staffId] = Math.max(w.busyUntil[staffId] ?? 0, from) + minutes;
}

function receiveInvitation(w: World, m: Message) {
  const audience = w.audiences.find((a) => a.id === m.data.audienceId);
  if (!audience || audience.status !== "inviting") return;
  const target = w.people[audience.targetId];
  const ruler = w.people[audience.requesterId];
  const trust = target.trust[ruler.id] ?? 0.5;
  const awayOnDuty =
    !!target.military && target.location !== audience.destination;
  if (
    !target.alive ||
    target.captiveBy ||
    target.journey ||
    awayOnDuty ||
    trust < 0.35 ||
    target.hunger >= 4
  ) {
    audience.status = "refused";
    const refusal = event(
      w,
      "audience_refused",
      `${target.name}は面談の招きに応じなかった`,
      [target.id, m.courierId!],
      m.causes,
      { audienceId: audience.id, trust },
      [target.id, m.courierId!],
    );
    report(w, refusal, ruler.id, 1, target.id);
    return;
  }
  audience.courierId = m.courierId;
  audience.status = "traveling";
  const travel =
    target.location === audience.destination
      ? 1
      : delay(w, target.location, audience.destination, 2);
  audience.arriveAt = w.minute + travel;
  target.journey = {
    kind: "audience",
    destination: audience.destination,
    arriveAt: audience.arriveAt,
  };
  if (m.courierId)
    w.people[m.courierId].journey = {
      kind: "escort",
      destination: audience.destination,
      arriveAt: audience.arriveAt,
    };
  const departure = event(
    w,
    "audience_guest_departure",
    `${target.name}は${m.courierId ? w.people[m.courierId].name : "伝令"}と宮廷へ向かった`,
    [target.id, ...(m.courierId ? [m.courierId] : [])],
    m.causes,
    { audienceId: audience.id, arriveAt: audience.arriveAt },
    [target.id, ...(m.courierId ? [m.courierId] : [])],
  );
  audience.causeIds.push(departure.id);
  postponeCourt(w, ruler.id, audience.staffId, 120, audience.arriveAt);
  report(w, departure, ruler.id, 1, target.id);
}

export function advanceAudiences(w: World) {
  for (const audience of w.audiences) {
    const requester = w.people[audience.requesterId];
    const target = w.people[audience.targetId];
    const staff = w.people[audience.staffId];
    if (audience.status === "traveling" && audience.arriveAt! <= w.minute) {
      const traveler = audience.mode === "visit" ? requester : target;
      traveler.location = audience.destination;
      traveler.journey = undefined;
      const escort =
        audience.mode === "visit"
          ? staff
          : audience.courierId
            ? w.people[audience.courierId]
            : undefined;
      if (escort) {
        escort.location = audience.destination;
        escort.journey = undefined;
      }
      if (
        !requester.alive ||
        !target.alive ||
        requester.captiveBy ||
        target.captiveBy ||
        requester.location !== target.location
      ) {
        audience.status = "missed";
        event(
          w,
          "audience_missed",
          `${target.name}との面談は相手が不在で成立しなかった`,
          [traveler.id, ...(escort ? [escort.id] : [])],
          audience.causeIds,
          { audienceId: audience.id },
        );
        continue;
      }
      audience.status = "meeting";
      audience.finishAt = w.minute + 120;
      const arrival = event(
        w,
        "audience_arrival",
        `${requester.name}と${target.name}が面談の場にそろった`,
        [
          requester.id,
          target.id,
          staff.id,
          ...(escort && escort.id !== staff.id ? [escort.id] : []),
        ],
        audience.causeIds,
        { audienceId: audience.id },
        [requester.id, target.id, staff.id],
      );
      audience.causeIds.push(arrival.id);
    }
    if (audience.status === "meeting" && audience.finishAt! <= w.minute) {
      if (
        !requester.alive ||
        !target.alive ||
        requester.captiveBy ||
        target.captiveBy ||
        requester.location !== target.location
      ) {
        audience.status = "missed";
        event(
          w,
          "audience_missed",
          `${target.name}との面談は中断された`,
          [requester.id, target.id],
          audience.causeIds,
          { audienceId: audience.id },
        );
        continue;
      }
      audience.status = "completed";
      const wish =
        target.culture === "hearth"
          ? "故郷と家族を守ってほしい。遠征には実際の扶助を。"
          : target.culture === "honor"
            ? "先代への奉仕を忘れず、私に指揮を任せてほしい。"
            : "通行権と予測できる契約を望む。";
      event(
        w,
        "audience",
        `${target.name}の願い：${wish}`,
        [target.id, requester.id, staff.id],
        audience.causeIds,
        { audienceId: audience.id },
        [target.id, requester.id, staff.id],
      );
      target.trust[requester.id] = clamp(
        (target.trust[requester.id] ?? 0.5) + 0.03,
      );
      if (
        audience.mode === "summon" &&
        target.location !== audience.targetOrigin
      ) {
        const destination = target.military
          ? w.units[target.military.unitId].location
          : audience.targetOrigin;
        const arriveAt = w.minute + delay(w, target.location, destination, 2);
        target.journey = { kind: "return", destination, arriveAt };
        event(
          w,
          "audience_return",
          `${target.name}が面談を終え、${w.settlements[destination].name}へ戻る`,
          [target.id],
          audience.causeIds,
          { audienceId: audience.id, arriveAt },
        );
      }
    }
  }
  for (const audience of w.audiences) {
    if (audience.status !== "completed") continue;
    const p = w.people[audience.targetId];
    if (p.journey?.kind !== "return" || p.journey.arriveAt > w.minute) continue;
    p.location = p.journey.destination;
    p.journey = undefined;
    event(
      w,
      "return_arrived",
      `${p.name}が帰着した`,
      [p.id],
      audience.causeIds,
    );
  }
}
export function finish(w: World) {
  const ruler = w.people.a_0000;
  if (w.settlements.capital.factionId !== "a") w.occupationSince ??= w.minute;
  else w.occupationSince = undefined;
  if (
    !ruler.alive ||
    (w.occupationSince !== undefined && w.minute - w.occupationSince >= 1440)
  )
    w.outcome = "defeat";
  if (w.minute >= 90 * 1440)
    w.outcome =
      ruler.alive &&
      w.settlements.capital.factionId === "a" &&
      (w.settlements.pass.factionId === "a" ||
        w.treaties.some(
          (t) => t.from === "a" && t.commercial && t.expiresAt > w.minute,
        ))
        ? "victory"
        : "defeat";
  if (w.outcome)
    event(
      w,
      "ending",
      w.outcome === "victory"
        ? "90日間を生き延び、峠の通行権を確保した。"
        : "峠の通行権を確保できなかった、または君主・首都を失った。",
      ["a_0000"],
    );
}
