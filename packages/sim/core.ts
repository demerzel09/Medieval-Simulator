import content from "../content/scenario.json";
import {
  actionSchema,
  type Action,
  type Command,
  type Event,
  type Stock,
  type World,
} from "../contracts";
export const zero = (): Stock => ({ money: 0, food: 0, wood: 0, equipment: 0 });
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export function random(w: World, stream = "world"): number {
  let x =
    w.rng[stream] ??
    ((w.seed ^ Array.from(stream).reduce((a, c) => a + c.charCodeAt(0), 0)) >>>
      0 ||
      1);
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  w.rng[stream] = x >>> 0;
  return (x >>> 0) / 4294967296;
}
export function uid(w: World, prefix: string) {
  return `${prefix}_${String(w.nextId++).padStart(7, "0")}`;
}
export function event(
  w: World,
  kind: string,
  text: string,
  actorIds: string[] = [],
  causes: string[] = [],
  data: Record<string, unknown> = {},
  witnesses = actorIds,
): Event {
  const e = {
    id: uid(w, "e"),
    worldMinute: w.minute,
    kind,
    text,
    actorIds: [...actorIds],
    causes: [...causes],
    data,
    witnesses: [...witnesses],
  };
  w.events.push(e);
  for (const id of witnesses) {
    const p = w.people[id];
    if (p) {
      p.beliefs.push({
        eventId: e.id,
        observedAt: w.minute,
        receivedAt: w.minute,
        source: id,
        confidence: 1,
        text,
        kind,
        causes: [...causes],
      });
      p.memories.push(e.id);
    }
  }
  return e;
}
export function hash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function save(w: World): string {
  return JSON.stringify(w);
}
export function load(s: string): World {
  const w = JSON.parse(s) as World;
  if (
    w.schemaVersion !== 1 ||
    !["0.1.0", "0.2.0"].includes(w.engineVersion) ||
    w.contentHash !== hash(content)
  )
    throw Error("互換性のないセーブ");
  if (w.engineVersion === "0.1.0") {
    w.audiences = [];
    w.activities = [];
    for (const faction of ["a", "b"]) {
      const ruler = w.people[w.factions[faction].rulerId];
      const available = Object.values(w.people)
        .filter(
          (p) =>
            p.factionId === faction &&
            p.alive &&
            !p.captiveBy &&
            !p.military &&
            p.location === ruler.location &&
            p.id !== ruler.id,
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const [scribe, ...couriers] = available.slice(0, 4);
      if (!scribe || couriers.length < 3)
        throw Error("旧版セーブに家臣を配置できない");
      scribe.roles.push("scribe");
      scribe.job = "administrator";
      for (const c of [...w.commands, ...w.queue])
        if (c.actorId === ruler.id) c.staffId = scribe.id;
      for (const courier of couriers) {
        courier.roles.push("courier");
        courier.job = "administrator";
      }
    }
    for (const c of [...w.commands, ...w.queue]) {
      if (c.action.kind === "REQUEST_AUDIENCE" && !c.action.mode)
        c.action.mode = "visit";
    }
    for (const m of w.messages) {
      if (m.kind === "reply" && m.data.audience) m.data.legacyAudience = true;
      if (!m.courierId) {
        const faction = w.people[m.sender]?.factionId ?? "a";
        m.courierId = Object.values(w.people).find(
          (p) => p.factionId === faction && p.roles.includes("courier"),
        )?.id;
        m.destination = w.people[m.recipient]?.location;
      }
    }
    w.engineVersion = "0.2.0";
    event(w, "save_migrated", "旧版の保存状態を読み込み、家臣の役職を補った");
  }
  for (const c of w.queue) {
    actionSchema.parse(c.action);
    if (
      !Number.isSafeInteger(c.executeAt) ||
      c.executeAt < w.minute ||
      !w.people[c.actorId]
    )
      throw Error("invalid command queue");
  }
  check(w);
  return w;
}
export function check(w: World) {
  if (!Number.isSafeInteger(w.minute) || w.minute < 0)
    throw Error("invalid clock");
  if (Object.keys(w.people).length !== w.population)
    throw Error("population conservation");
  const seenEvents = new Set<string>();
  for (const e of w.events) {
    if (seenEvents.has(e.id) || e.causes.some((id) => !seenEvents.has(id)))
      throw Error("invalid causal event graph");
    seenEvents.add(e.id);
  }
  const sum = zero();
  for (const a of Object.values(w.accounts))
    for (const g of Object.keys(sum) as (keyof Stock)[]) {
      if (!Number.isSafeInteger(a[g]) || a[g] < 0)
        throw Error(`invalid asset ${g}`);
      sum[g] += a[g];
    }
  for (const g of Object.keys(sum) as (keyof Stock)[])
    if (sum[g] !== w.baseline[g] + w.produced[g] - w.consumed[g])
      throw Error(`conservation ${g}`);
  for (const [id, p] of Object.entries(w.people)) {
    if (
      id !== p.id ||
      !w.factions[p.factionId] ||
      !w.accounts[id] ||
      !w.settlements[p.location] ||
      !w.settlements[p.homeId]
    )
      throw Error("invalid person reference");
    if (
      ![
        p.health,
        p.morale,
        p.fear,
        p.fatigue,
        ...Object.values(p.values),
        ...Object.values(p.trust),
      ].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      throw Error("invalid person range");
    if (!w.households[p.householdId]?.memberIds.includes(p.id))
      throw Error("household ownership");
    if (p.military && !w.units[p.military.unitId]?.memberIds.includes(p.id))
      throw Error("military membership");
  }
  for (const [id, u] of Object.entries(w.units)) {
    if (
      id !== u.id ||
      !w.accounts[id] ||
      !w.people[u.commanderId] ||
      u.memberIds.some((p) => !w.people[p])
    )
      throw Error("invalid unit");
  }
  const members = Object.values(w.households).flatMap((h) => h.memberIds);
  if (members.length !== w.population || new Set(members).size !== w.population)
    throw Error("duplicate household member");
  const all = Object.values(w.units).flatMap((u) => u.memberIds);
  if (new Set(all).size !== all.length) throw Error("duplicate soldier");
  for (const m of w.messages)
    if (m.courierId && !w.people[m.courierId]) throw Error("unknown courier");
  for (const a of w.audiences)
    if (
      !w.people[a.requesterId] ||
      !w.people[a.targetId] ||
      !w.people[a.staffId]
    )
      throw Error("invalid audience actor");
  for (const a of w.activities)
    if (!w.people[a.personId] || !seenEvents.has(a.sourceEventId))
      throw Error("invalid activity source");
}
export function submit(
  w: World,
  actorId: string,
  input: unknown,
  id = `command_${w.commands.length + 1}`,
  origin: Command["origin"] = "player",
) {
  if (w.outcome) return { ok: false, reason: "SCENARIO_ENDED" };
  if (w.commands.some((c) => c.id === id))
    return { ok: false, reason: "ALREADY_APPLIED" };
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_CONDITION" };
  const p = w.people[actorId];
  if (!p) return { ok: false, reason: "UNKNOWN_ACTOR" };
  if (!p.alive || p.captiveBy)
    return { ok: false, reason: "ACTOR_UNAVAILABLE" };
  if (
    !p.roles.includes("ruler") &&
    !["WAIT", "SEND_MESSAGE", "ACCEPT_PROMISE"].includes(parsed.data.kind)
  )
    return { ok: false, reason: "NO_AUTHORITY" };
  const staff = p.roles.includes("ruler")
    ? Object.values(w.people)
        .filter(
          (candidate) =>
            candidate.factionId === p.factionId &&
            candidate.roles.includes("scribe") &&
            candidate.alive &&
            !candidate.captiveBy &&
            !candidate.military &&
            candidate.location === p.location,
        )
        .sort(
          (a, b) =>
            (w.busyUntil[a.id] ?? 0) - (w.busyUntil[b.id] ?? 0) ||
            a.id.localeCompare(b.id),
        )[0]
    : undefined;
  if (p.roles.includes("ruler") && !staff)
    return { ok: false, reason: "NO_AVAILABLE_SCRIBE" };
  const executeAt =
    Math.max(
      w.minute,
      w.busyUntil[actorId] ?? 0,
      staff ? (w.busyUntil[staff.id] ?? 0) : 0,
    ) +
    (parsed.data.kind === "WAIT"
      ? Math.max(1, parsed.data.minutes)
      : parsed.data.kind === "REQUEST_AUDIENCE"
        ? 120
        : 60);
  const c: Command = {
    id,
    actorId,
    issuedAt: w.minute,
    executeAt,
    sequence: w.commands.length,
    action: parsed.data,
    origin,
    staffId: staff?.id,
  };
  w.busyUntil[actorId] = executeAt;
  if (staff) w.busyUntil[staff.id] = executeAt;
  w.commands.push(c);
  w.queue.push(c);
  return { ok: true, id };
}
export type Hooks = {
  arrivals?: (w: World) => void;
  apply?: (w: World, c: Command) => void;
  battle?: (w: World) => void;
  hour?: (w: World) => void;
  day?: (w: World) => void;
  finish?: (w: World) => void;
};
export function advance(w: World, minutes: number, h: Hooks = {}) {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440 * 180)
    throw Error("invalid time");
  const end = w.minute + minutes;
  while (w.minute < end && !w.outcome) {
    w.minute++;
    h.arrivals?.(w);
    const due = w.queue
      .filter((c) => c.executeAt <= w.minute)
      .sort(
        (a, b) =>
          a.executeAt - b.executeAt ||
          a.actorId.localeCompare(b.actorId) ||
          a.sequence - b.sequence,
      );
    w.queue = w.queue.filter((c) => c.executeAt > w.minute);
    for (const c of due) {
      if (w.applied.includes(c.id)) continue;
      w.applied.push(c.id);
      h.apply
        ? h.apply(w, c)
        : event(w, "command", c.action.kind, [c.actorId], [], {
            commandId: c.id,
          });
    }
    h.battle?.(w);
    if (w.minute % 60 === 0) h.hour?.(w);
    if (w.minute % 1440 === 0) {
      h.day?.(w);
      check(w);
    }
    h.finish?.(w);
  }
  return w;
}
export const action = (kind: Action["kind"]) => kind;
