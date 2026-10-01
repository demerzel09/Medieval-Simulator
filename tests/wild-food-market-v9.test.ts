import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { wildFoodMarket90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, villageSummary } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

const idle: VillageModel = { decide(input) { return { attempts: [], subjectiveUpdate: input.subjectiveState,
  wait: { at: input.at + 1 } }; } };
function offerWorld() {
  const w = newVillageWorld(240924, wildFoodMarket90V1);
  queueVillageCommand(w, { id: "forest", actorId: "B1", at: 1, attempt: { kind: "travel", siteId: "grove" } });
  queueVillageCommand(w, { id: "berries", actorId: "B1", at: 2,
    attempt: { kind: "forage_route", plantId: "wild_berry", quantity: 3 } });
  queueVillageCommand(w, { id: "market", actorId: "B1", at: 3, attempt: { kind: "travel", siteId: "market" } });
  advanceVillageWorld(w, 4, idle);
  const lot = Object.entries(w.foodLots).find(([, meta]) => meta.species === "wild_berry")![0];
  queueVillageCommand(w, { id: "surplus", actorId: "B1", at: 5,
    attempt: { kind: "post_surplus_offer", lotId: lot, quantity: 2, price: 1 } });
  advanceVillageWorld(w, 1, idle);
  return { w, lot, offerId: Object.keys(w.foodOffers!)[0] };
}

describe("wild food and surplus market", () => {
  it("exchanges real surplus and cash, keeps origin, and forbids a second purchase", () => {
    const { w, lot, offerId } = offerWorld();
    queueVillageCommand(w, { id: "buy", actorId: "S", at: 6, attempt: { kind: "buy_surplus", offerId } });
    queueVillageCommand(w, { id: "eat", actorId: "S", at: 7, attempt: { kind: "eat" } });
    queueVillageCommand(w, { id: "again", actorId: "S", at: 8, attempt: { kind: "buy_surplus", offerId } });
    advanceVillageWorld(w, 3, idle);
    expect(w.physical.objects[lot].quantity).toBe(1);
    expect(w.people.S.meals).toBe(1);
    expect(villageSummary(w).people.S.cash).toBe(19);
    expect(villageSummary(w).people.B1.cash).toBe(1);
    expect(w.events.filter((e) => e.kind === "surplus_sold")).toHaveLength(1);
    expect(w.events.some((e) => e.kind === "ate" && e.data.species === "wild_berry")).toBe(true);
    expect(w.land.plants.wild_berry).toMatchObject({ available: 2, stage: "regrowing", personHarvested: 3 });
    const saved = captureVillageRecording(w);
    expect(captureVillageRecording(replayVillageRecording(saved)).finalStateHash).toBe(saved.finalStateHash);
  });

  it("leaves an unaffordable offer intact while the cashless buyer gathers and eats herbs", () => {
    const { w, lot, offerId } = offerWorld();
    queueVillageCommand(w, { id: "no-cash", actorId: "C", at: 6, attempt: { kind: "buy_surplus", offerId } });
    queueVillageCommand(w, { id: "C-forest", actorId: "C", at: 7, attempt: { kind: "travel", siteId: "grove" } });
    queueVillageCommand(w, { id: "herbs", actorId: "C", at: 8,
      attempt: { kind: "forage_route", plantId: "herb_patch", quantity: 2 } });
    queueVillageCommand(w, { id: "eat", actorId: "C", at: 9, attempt: { kind: "eat" } });
    advanceVillageWorld(w, 4, idle);
    expect(w.physical.objects[lot].quantity).toBe(3);
    expect(w.foodOffers![offerId].purchasedEventId).toBeUndefined();
    expect(w.people.C.meals).toBe(1);
    expect(villageSummary(w).people.C.cash).toBe(0);
    expect(w.events.some((e) => e.kind === "attempt_rejected" && e.data.reason === "buyer lacks cash")).toBe(true);
    expect(w.events.some((e) => e.kind === "ate" && e.actors.includes("C") && e.data.quantity === 2)).toBe(true);
    expect(w.events.some((e) => e.kind === "travel_step" && e.actors.includes("C") &&
      e.data.destinationId === "herb_patch")).toBe(true);
  });

  it.each(["spoiled", "consumed", "seller left"] as const)(
    "does not transfer money or resurrect a %s surplus offer", (condition) => {
      const { w, lot, offerId } = offerWorld();
      let buyAt: number;
      if (condition === "spoiled") {
        advanceVillageWorld(w, 68, idle);
        expect(w.physical.objects[lot]).toBeUndefined();
        buyAt = 74;
      } else if (condition === "consumed") {
        queueVillageCommand(w, { id: "eat-first", actorId: "B1", at: 25, attempt: { kind: "eat" } });
        queueVillageCommand(w, { id: "eat-second", actorId: "B1", at: 26, attempt: { kind: "eat" } });
        advanceVillageWorld(w, 21, idle);
        expect(w.physical.objects[lot].quantity).toBe(1);
        buyAt = 27;
      } else {
        queueVillageCommand(w, { id: "leave", actorId: "B1", at: 6,
          attempt: { kind: "travel", siteId: "home_B1" } });
        advanceVillageWorld(w, 3, idle);
        expect(villageSummary(w).people.B1.site).toBe("home_B1");
        buyAt = 9;
      }
      const inventoryItems = () => Object.fromEntries(Object.entries(w.physical.objects)
        .filter(([, object]) => object.typeId === "food" || object.typeId === "currency"));
      const inventory = structuredClone(inventoryItems());
      queueVillageCommand(w, { id: "stale-buy", actorId: "S", at: buyAt,
        attempt: { kind: "buy_surplus", offerId } });
      advanceVillageWorld(w, 1, idle);
      expect(inventoryItems()).toEqual(inventory);
      expect(w.foodOffers![offerId].purchasedEventId).toBeUndefined();
      expect(w.events.some((e) => e.kind === "surplus_sold")).toBe(false);
      expect(w.events.some((e) => e.kind === "attempt_rejected" &&
        e.data.reason === "surplus purchase unavailable")).toBe(true);
    });

  it("replays the example without hiding competition or claiming the bread economy is complete", () => {
    const recording = JSON.parse(gunzipSync(readFileSync(
      "fixtures/recordings/autonomous-village-wild-food-90.v2.json.gz")).toString("utf8")) as VillageRecording;
    expect(recording.rulesetId).toBe("autonomous-village-wild-food-market-v9");
    const w = replayVillageRecording(recording);
    expect(w.burnedWood).toBe(0);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) for (let day = 1; day <= 90; day++)
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id))).toBe(true);
    expect(w.events.filter((e) => e.kind === "surplus_sold")).toHaveLength(17);
    expect(w.events.some((e) => e.kind === "process_failed" && e.data.reason === "plant not ready")).toBe(true);
    expect(w.initialMoney).toBe(26);
  }, 60000);
});
