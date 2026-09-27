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
      B1: { site: "home_B1", hunger: 0, meals: 2, pantryFood: 1, cash: 8 },
      B2: { site: "home_B2", hunger: 2, meals: 0, pantryFood: 0, cash: 22 },
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
    expect(livingMarketSummary(w).buyers).toMatchObject({ B1: { hunger: 3, meals: 0, cash: 24 },
      B2: { hunger: 3, meals: 0, cash: 22 } });
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

  it("pays both buyers for delivered firewood and consumes it to open the stall", () => {
    const w = newLivingMarketWorld();
    advanceMarketDay(w); advanceMarketDay(w);
    const delivered = w.events.filter((e) => e.kind === "wood_delivered");
    const paid = w.events.filter((e) => e.kind === "wood_paid");
    expect(delivered.map((e) => e.actors[0])).toEqual(["B1", "B2"]);
    expect(paid.map((e) => e.actors[1])).toEqual(["B1", "B2"]);
    for (const payment of paid) {
      const handover = delivered.find((e) => e.id === payment.causes[0])!;
      const contract = w.events.find((e) => e.id === handover.causes[0])!;
      const gathered = w.events.find((e) => e.id === handover.causes[2])!;
      expect(contract.kind).toBe("wood_contract_accepted");
      expect(gathered.kind).toBe("wood_gathered");
      expect(payment.data.amount).toBe(2);
    }
    expect(livingMarketSummary(w).wood).toMatchObject({ gathered: 2, burned: 2, stock: 0,
      earnings: { B1: 2, B2: 2 } });
    expect(w.events.filter((e) => e.kind === "market_heated")).toHaveLength(2);
    checkMarketWorld(w);
  });

  it("allows refusal, unperformed work and unpaid non-delivery", () => {
    const refusingSeller: MarketModel = { decide(input) {
      if (input.knownContext.role === "seller" && input.knownContext.phase === "accept_wood")
        return { attempts: [], wait: { at: input.at + 1 } };
      return livingMarketModel.decide(input);
    } };
    const declined = newLivingMarketWorld(); advanceMarketDay(declined, refusingSeller);
    expect(declined.events.some((e) => e.kind === "wood_offer_declined")).toBe(true);
    expect(declined.events.some((e) => e.kind === "wood_gathered" || e.kind === "wood_paid" || e.kind === "food_sold")).toBe(false);
    checkMarketWorld(declined);
    const refusingWork: MarketModel = { decide(input) {
      if (input.knownContext.role === "woodcutter" && input.knownContext.phase === "work")
        return { attempts: [], wait: { at: input.at + 1 } };
      return livingMarketModel.decide(input);
    } };
    const unworked = newLivingMarketWorld(); advanceMarketDay(unworked, refusingWork);
    expect(unworked.events.some((e) => e.kind === "wood_contract_accepted")).toBe(true);
    expect(unworked.events.some((e) => e.kind === "wood_work_failed")).toBe(true);
    expect(unworked.events.some((e) => e.kind === "wood_paid")).toBe(false);
    checkMarketWorld(unworked);
    const withholding: MarketModel = { decide(input) {
      if (input.knownContext.role === "woodcutter" && input.knownContext.phase === "deliver")
        return { attempts: [], wait: { at: input.at + 1 } };
      return livingMarketModel.decide(input);
    } };
    const undelivered = newLivingMarketWorld(); advanceMarketDay(undelivered, withholding);
    expect(undelivered.events.some((e) => e.kind === "wood_gathered")).toBe(true);
    expect(undelivered.events.some((e) => e.kind === "wood_delivery_failed")).toBe(true);
    expect(undelivered.events.some((e) => e.kind === "wood_paid")).toBe(false);
    expect(Object.values(undelivered.physical.objects).filter((o) => o.typeId === "wood" && o.ownerId === "B1")).toHaveLength(1);
    checkMarketWorld(undelivered);
  });

  it("preserves money, food and causality across saving and a 90-day shortage", () => {
    const w = newLivingMarketWorld(73);
    expect(w.schemaVersion).toBe(3);
    expect(() => loadMarketWorld(JSON.stringify({ ...w, schemaVersion: 2 }))).toThrow("invalid market world");
    for (let day = 0; day < 7; day++) advanceMarketDay(w);
    const resumed = loadMarketWorld(saveMarketWorld(w));
    for (let day = 7; day < 90; day++) { advanceMarketDay(w); advanceMarketDay(resumed); }
    expect(marketHash(resumed)).toBe(marketHash(w));
    expect(marketHash(replayLivingMarketWorld(73, 90))).toBe(marketHash(w));
    expect(livingMarketSummary(w)).toMatchObject({ harvested: 10, sold: 9, eaten: 9, spoiled: 1,
      sellerCash: 20, farmerCash: 10, carrierCash: 14, buyerCash: { B1: 4, B2: 2 },
      wood: { gathered: 9, burned: 9, stock: 0, earnings: { B1: 10, B2: 8 } },
      buyers: { B1: { hunger: 85 }, B2: { hunger: 86 } } });
    checkMarketWorld(w);
  });
});
