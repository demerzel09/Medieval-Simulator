import { describe, expect, it } from "vitest";
import { livingMarketModel, type MarketModel } from "../packages/ai/individual-market";
import { advanceMarketDay, checkMarketWorld, livingMarketSummary, loadMarketWorld, marketHash,
  newLivingMarketWorld, replayLivingMarketWorld, saveMarketWorld } from "../packages/sim/individual-market";
import { siteOf } from "../packages/sim/physical";

describe("living buyers in a person-owned market", () => {
  it("travels, buys, stores and eats from the buyer's own pantry", () => {
    const w = newLivingMarketWorld();
    advanceMarketDay(w); advanceMarketDay(w);
    expect(livingMarketSummary(w).buyers).toMatchObject({
      B1: { site: "home_B1", hunger: 0, meals: 2, pantryFood: 1, cash: 6 },
      B2: { site: "home_B2", hunger: 2, meals: 0, pantryFood: 0, cash: 20 },
    });
    expect(w.physical.objects.home_B1.ownerId).toBe("B1");
    expect(w.physical.objects.pantry_B1.ownerId).toBe("B1");
    expect(Object.values(w.physical.objects).filter((o) => o.parentId === "pantry_B1" && o.typeId === "food")
      .every((o) => o.ownerId === "B1" && siteOf(w.physical, o.id) === "home_B1")).toBe(true);
    const stored = w.events.find((e) => e.kind === "food_stored" && e.day === 2)!;
    const ate = w.events.find((e) => e.kind === "ate" && e.day === 2 && e.actors.includes("B1"))!;
    expect(ate.causes).toContain(stored.id);
    checkMarketWorld(w);
  });

  it("does not make a buyer shop or eat when their personality declines the trip", () => {
    const staysHome: MarketModel = { decide(input) {
      if (input.knownContext.role === "buyer" && input.knownContext.phase === "plan_trip")
        return { attempts: [], wait: { at: input.at + 1 } };
      return livingMarketModel.decide(input);
    } };
    const w = newLivingMarketWorld();
    for (let day = 0; day < 3; day++) advanceMarketDay(w, staysHome);
    expect(livingMarketSummary(w).buyers).toMatchObject({ B1: { hunger: 3, meals: 0, cash: 20 },
      B2: { hunger: 3, meals: 0, cash: 20 } });
    expect(w.events.some((e) => e.kind === "food_sold")).toBe(false);
    expect(w.events.some((e) => e.kind === "food_stored")).toBe(false);
    checkMarketWorld(w);
  });

  it("expires a personally owned pantry lot after its three usable days", () => {
    const keepsFood: MarketModel = { decide(input) {
      if (input.actorId === "B1" && input.knownContext.role === "buyer" && input.knownContext.phase === "eat")
        return { attempts: [], wait: { at: input.at + 1 } };
      return livingMarketModel.decide(input);
    } };
    const w = newLivingMarketWorld(); advanceMarketDay(w, keepsFood);
    const firstLot = Object.values(w.physical.objects).find((o) => o.typeId === "food" && o.parentId === "pantry_B1")!.id;
    advanceMarketDay(w, keepsFood); advanceMarketDay(w, keepsFood);
    expect(w.physical.objects[firstLot]).toBeDefined();
    advanceMarketDay(w, keepsFood);
    expect(w.physical.objects[firstLot]).toBeUndefined();
    expect(w.events.some((e) => e.kind === "food_spoiled" && e.day === 4 && e.data.lotId === firstLot &&
      e.data.siteId === "home_B1" && e.data.ownerId === "B1")).toBe(true);
    checkMarketWorld(w);
  });

  it("preserves money, food and causality across saving and a 90-day shortage", () => {
    const w = newLivingMarketWorld(73);
    for (let day = 0; day < 7; day++) advanceMarketDay(w);
    const resumed = loadMarketWorld(saveMarketWorld(w));
    for (let day = 7; day < 90; day++) { advanceMarketDay(w); advanceMarketDay(resumed); }
    expect(marketHash(resumed)).toBe(marketHash(w));
    expect(marketHash(replayLivingMarketWorld(73, 90))).toBe(marketHash(w));
    expect(livingMarketSummary(w)).toMatchObject({ harvested: 8, sold: 7, eaten: 7, spoiled: 1,
      sellerCash: 28, farmerCash: 8, carrierCash: 12, buyerCash: { B1: 0, B2: 2 },
      buyers: { B1: { hunger: 86 }, B2: { hunger: 87 } } });
    checkMarketWorld(w);
  });
});
