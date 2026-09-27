/** Deterministic wake/delivery boundary. The caller owns perception, decisions and world effects. */
export type ClockActor = { nextWakeAt: number };
export type ClockDelivery<S> = { recipientId: string; stimulus: S & { receivedAt: number } };
export function wakeActors<S extends { receivedAt: number }>(
  hour: number, actors: Record<string, ClockActor>, pending: ClockDelivery<S>[],
  onWake: (actorId: string, delivered: S[]) => void,
): void {
  if (!Number.isSafeInteger(hour) || hour < 0) throw Error("invalid wake hour");
  for (const actorId of Object.keys(actors).sort()) {
    const actor = actors[actorId];
    const delivered = pending.filter((p) => p.recipientId === actorId && p.stimulus.receivedAt <= hour)
      .map((p) => p.stimulus);
    if (actor.nextWakeAt > hour && delivered.length === 0) continue;
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].recipientId === actorId &&
      pending[i].stimulus.receivedAt <= hour) pending.splice(i, 1);
    onWake(actorId, delivered);
    if (!Number.isSafeInteger(actor.nextWakeAt) || actor.nextWakeAt <= hour) throw Error("invalid next wake");
  }
}
