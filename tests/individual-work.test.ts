import { describe, expect, it } from "vitest";
import { ordinaryWorkModel, type WorkModel } from "../packages/ai/individual-work";
import { advanceWorkWorld, checkWorkWorld, loadWorkWorld, newWorkWorld, replayWorkWorld,
  saveWorkWorld, workHash } from "../packages/sim/individual-work";
import { contentsQuantity } from "../packages/sim/physical";

describe("individual work wake and delivery fixture", () => {
  it("lets only delivered information trigger F's work and S's physical payment", () => {
    const w = newWorkWorld();
    advanceWorkWorld(w, 2);
    expect(w.offer).toBeDefined();
    expect(w.events.some((e) => e.kind === "offer_accepted")).toBe(false);
    expect(w.people.F.memory.stage).toBe("new");
    expect(w.pending.find((p) => p.recipientId === "F" && p.stimulus.kind === "offer")?.stimulus)
      .toMatchObject({ receivedAt: 3, price: 1, quantity: 1 });
    advanceWorkWorld(w, 4);
    expect(w.events.filter((e) => e.kind === "offer_accepted")).toHaveLength(1);
    expect(w.events.filter((e) => e.kind === "foraged")).toHaveLength(1);
    expect(w.events.filter((e) => e.kind === "food_delivered")).toHaveLength(1);
    expect(w.events.filter((e) => e.kind === "paid")).toHaveLength(1);
    const delivered = w.events.find((e) => e.kind === "food_delivered")!;
    const paid = w.events.find((e) => e.kind === "paid")!;
    expect(paid.causes).toContain(delivered.id);
    expect(w.people.F.memory.stage).toBe("delivered"); // F has not yet heard of S's payment.
    expect(contentsQuantity(w.physical, "bag_S", "food")).toBe(1);
    expect(contentsQuantity(w.physical, "wallet_F", "currency")).toBe(1);
    expect(w.physical.objects.coin_0.ownerId).toBe("F");
    checkWorkWorld(w);
  });

  it("does not enlist an uninformed or refusing farmer, or replace missing work", () => {
    const refuses: WorkModel = { decide(input) {
      if (input.actorId === "F") return { attempts: [], wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState };
      return ordinaryWorkModel.decide(input);
    } };
    const w = newWorkWorld(); advanceWorkWorld(w, 30, refuses);
    expect(w.events.some((e) => e.kind === "offer_accepted" || e.kind === "foraged" || e.kind === "paid")).toBe(false);
    expect(w.resource.available).toBe(1);
    expect(w.pending.length).toBe(0);
    const noCash = newWorkWorld(1, 0); advanceWorkWorld(noCash, 30);
    expect(noCash.events.some((e) => e.kind === "offer_posted")).toBe(false);
  });

  it("rejects a guessed offer ID before its stimulus arrives", () => {
    const w = newWorkWorld();
    const guesses: WorkModel = { decide(input) {
      if (input.actorId === "F" && input.at === 1)
        return { attempts: [], wait: { at: 2 } };
      if (input.actorId === "F" && input.at === 2)
        return { attempts: [{ kind: "accept_offer", offerId: w.offer!.id }], wait: { at: 3 } };
      return ordinaryWorkModel.decide(input);
    } };
    advanceWorkWorld(w, 2, guesses);
    expect(w.offer?.acceptedEventId).toBeUndefined();
    expect(w.events.find((e) => e.kind === "attempt_rejected")?.data.reason).toBe("offer unavailable");
    expect(w.people.F.receivedOfferIds).toEqual([]);
  });

  it("rejects payment before S has received the delivery result", () => {
    const w = newWorkWorld();
    const premature: WorkModel = { decide(input) {
      if (input.actorId === "S" && input.at === 4)
        return { attempts: [], wait: { at: 5 }, subjectiveUpdate: input.subjectiveState };
      if (input.actorId === "S" && input.at === 5)
        return { attempts: [{ kind: "pay", offerId: w.offer!.id }], wait: { at: 6 },
          subjectiveUpdate: input.subjectiveState };
      return ordinaryWorkModel.decide(input);
    } };
    advanceWorkWorld(w, 5, premature);
    expect(w.offer?.deliveredEventId).toBeDefined();
    expect(w.offer?.paidEventId).toBeUndefined();
    expect(w.events.find((e) => e.kind === "attempt_rejected")?.data.reason).toBe("payment unavailable");
    expect(w.people.S.receivedDeliveryIds).toEqual([]);
  });

  it("keeps F's harvest when F declines delivery and distinguishes knowledge from results", () => {
    const withholds: WorkModel = { decide(input) {
      if (input.actorId === "F" && (input.subjectiveState.stage === "foraged" ||
        input.stimuli.some((s) => s.kind === "foraged")))
        return { attempts: [], wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState };
      return ordinaryWorkModel.decide(input);
    } };
    const w = newWorkWorld(); advanceWorkWorld(w, 12, withholds);
    expect(w.offer?.harvestedEventId).toBeDefined();
    expect(w.offer?.deliveredEventId).toBeUndefined();
    expect(w.events.some((e) => e.kind === "paid")).toBe(false);
    expect(w.people.S.memory.stage).toBe("posted");
    expect(contentsQuantity(w.physical, "bag_F", "food")).toBe(1);
  });

  it("preserves conservation, pending delivery and deterministic replay across a save", () => {
    const original = newWorkWorld(42); advanceWorkWorld(original, 4);
    const resumed = loadWorkWorld(saveWorkWorld(original));
    advanceWorkWorld(original, 90 * 24 - 4);
    advanceWorkWorld(resumed, 90 * 24 - 4);
    expect(workHash(resumed)).toBe(workHash(original));
    expect(workHash(replayWorkWorld(42, 90 * 24))).toBe(workHash(original));
    expect(original.harvested).toBe(1);
    expect(original.resource.available).toBe(0);
    expect(original.people.F.memory.stage).toBe("paid");
    checkWorkWorld(original);
  });
});
