import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type WorkStimulus = { id: string; kind: "offer" | "posted" | "accepted" | "foraged" | "delivered" | "paid" | "rejected";
  occurredAt: number; receivedAt: number; causeEventIds: string[]; offerId?: string; price?: number; quantity?: number };
export type WorkMemory = { stage: "new" | "posted" | "offered" | "accepted" | "foraged" | "delivered" | "paid" | "stopped"; offerId?: string;
  offeredPrice?: number; offeredQuantity?: number; receivedIds: string[] };
export type WorkContext = { siteId: string; ownFood: number; ownCash: number; visibleBerries: number };
export type WorkAttempt = { kind: "post_offer" } | { kind: "accept_offer"; offerId: string } |
  { kind: "forage"; offerId: string } | { kind: "tender"; offerId: string } | { kind: "pay"; offerId: string };
export type WorkModel = PersonalityModel<ActorInput<WorkContext, WorkMemory, WorkStimulus>,
  ActorResponse<WorkAttempt, WorkMemory, { at: number }>>;

/** A tiny rule personality. It updates belief only when a stimulus has arrived. */
export const ordinaryWorkModel: WorkModel = {
  decide(input) {
    const memory: WorkMemory = { ...input.subjectiveState, receivedIds: [...input.subjectiveState.receivedIds] };
    for (const stimulus of input.stimuli) {
      if (memory.receivedIds.includes(stimulus.id)) continue;
      memory.receivedIds.push(stimulus.id);
      if (stimulus.kind === "offer" && input.actorId === "F") {
        memory.stage = "offered"; memory.offerId = stimulus.offerId;
        memory.offeredPrice = stimulus.price; memory.offeredQuantity = stimulus.quantity;
      }
      if (stimulus.kind === "posted" && input.actorId === "S") { memory.stage = "posted"; memory.offerId = stimulus.offerId; }
      if (stimulus.kind === "accepted" && input.actorId === "F") memory.stage = "accepted";
      if (stimulus.kind === "foraged" && input.actorId === "F") memory.stage = "foraged";
      if (stimulus.kind === "delivered") { memory.stage = "delivered"; memory.offerId = stimulus.offerId; }
      if (stimulus.kind === "paid") memory.stage = "paid";
      if (stimulus.kind === "rejected") memory.stage = "stopped"; // Stop automatic retries in this fixture.
    }
    let attempt: WorkAttempt | undefined;
    if (input.actorId === "S") {
      if (memory.stage === "new" && input.knownContext.ownCash > 0) attempt = { kind: "post_offer" };
      if (memory.stage === "delivered" && memory.offerId && input.knownContext.ownCash > 0)
        attempt = { kind: "pay", offerId: memory.offerId };
    } else if (input.actorId === "F" && memory.offerId) {
      if (memory.stage === "offered" && memory.offeredPrice !== undefined && memory.offeredPrice >= 1 &&
        memory.offeredQuantity === 1) attempt = { kind: "accept_offer", offerId: memory.offerId };
      if (memory.stage === "accepted" && input.knownContext.visibleBerries > 0 && input.knownContext.ownFood < 1)
        attempt = { kind: "forage", offerId: memory.offerId };
      if (memory.stage === "foraged" && input.knownContext.ownFood > 0)
        attempt = { kind: "tender", offerId: memory.offerId };
    }
    return { attempts: attempt ? [attempt] : [], subjectiveUpdate: memory, wait: { at: input.at + (attempt ? 1 : 24) } };
  },
};
