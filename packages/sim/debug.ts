import type { Activity, Audience, Event, Message, World } from "../contracts";

export interface DebugSnapshot {
  total: number;
  people: {
    id: string;
    name: string;
    faction: string;
    location: string;
    roles: string[];
    alive: boolean;
    job: string;
    journey?: string;
  }[];
  selected?: {
    id: string;
    name: string;
    location: string;
    roles: string[];
    job: string;
    alive: boolean;
    activities: Activity[];
    events: Event[];
    messages: Message[];
    audiences: Audience[];
  };
  pendingMessages: {
    id: string;
    kind: string;
    sender: string;
    recipient: string;
    courierId?: string;
    destination?: string;
    pickupAt?: number;
    arriveAt: number;
  }[];
  audiences: Audience[];
}

// Developer-only projection. Never included in an ActorObservation.
export function debugSnapshot(
  w: World,
  query = "",
  personId = "",
  offset = 0,
): DebugSnapshot {
  const q = query.trim().toLowerCase();
  const matches = Object.values(w.people).filter(
    (p) =>
      !q ||
      `${p.id} ${p.name} ${p.job} ${p.roles.join(" ")}`
        .toLowerCase()
        .includes(q),
  );
  const selected = w.people[personId];
  return {
    total: matches.length,
    people: matches
      .slice(Math.max(0, offset), Math.max(0, offset) + 80)
      .map((p) => ({
        id: p.id,
        name: p.name,
        faction: p.factionId,
        location: p.location,
        roles: [...p.roles],
        alive: p.alive,
        job: p.job,
        journey: p.journey
          ? `${p.journey.kind}:${p.journey.destination} @${p.journey.arriveAt}`
          : undefined,
      })),
    selected: selected
      ? {
          id: selected.id,
          name: selected.name,
          location: selected.location,
          roles: [...selected.roles],
          job: selected.job,
          alive: selected.alive,
          activities: w.activities
            .filter((a) => a.personId === personId)
            .reverse(),
          events: w.events
            .filter((e) => e.actorIds.includes(personId))
            .reverse(),
          messages: w.messages.filter(
            (m) =>
              m.courierId === personId ||
              m.sender === personId ||
              m.recipient === personId,
          ),
          audiences: w.audiences.filter((a) =>
            [a.requesterId, a.targetId, a.staffId, a.courierId].includes(
              personId,
            ),
          ),
        }
      : undefined,
    pendingMessages: w.messages.slice(0, 100).map((m) => ({
      id: m.id,
      kind: m.kind,
      sender: m.sender,
      recipient: m.recipient,
      courierId: m.courierId,
      destination: m.destination,
      pickupAt: m.pickupAt,
      arriveAt: m.arriveAt,
    })),
    audiences: w.audiences.slice(-30),
  };
}
