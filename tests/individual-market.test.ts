import { describe, expect, it } from "vitest";
import { ordinaryMarketModel, type MarketModel } from "../packages/ai/individual-market";
import { advanceMarketDay, checkMarketWorld, loadMarketWorld, marketHash, marketSummary,
  newMarketWorld, replayMarketWorld, saveMarketWorld } from "../packages/sim/individual-market";

describe("person-owned market trade", () => {
  it("pays farmer and carrier from S's cash, delivers actual food, and sells for S's profit", () => {
    const w = newMarketWorld();
    advanceMarketDay(w);
    expect(w.physical.objects.market.ownerId).toBe("S");
    expect(marketSummary(w)).toMatchObject({ sellerCash: 11, farmerCash: 1, carrierCash: 2,
      buyerCash: { B1: 6, B2: 10 }, sold: 1, sellerProfit: 1, unmetFundedYesterday: 1 });
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "food" && o.ownerId === "F")
      .reduce((n, o) => n + o.quantity, 0)).toBe(2);
    const bought = w.events.find((e) => e.kind === "crop_bought")!;
    const delivered = w.events.find((e) => e.kind === "crop_delivered")!;
    const sold = w.events.find((e) => e.kind === "food_sold")!;
    expect(delivered.causes).toContain(bought.id);
    expect(sold.causes).toContain(delivered.id);
    checkMarketWorld(w);
  });

  it("raises the posted price after a funded stockout, then lowers it when buyers lose purchasing power", () => {
    const w = newMarketWorld();
    const prices = [];
    for (let day = 0; day < 7; day++) { advanceMarketDay(w); prices.push(w.seller.price); }
    expect(prices).toEqual([4, 5, 5, 5, 4, 3, 2]);
    expect(marketSummary(w)).toMatchObject({ sold: 4, stock: 1, sellerCash: 16,
      buyerCash: { B1: 1, B2: 0 }, sellerProfit: 6 });
    expect(w.events.some((e) => e.kind === "food_sold" && e.day > 3)).toBe(false);
    expect(w.events.some((e) => e.kind === "resource_grew" && e.day > 1)).toBe(true);
    expect(marketHash(replayMarketWorld(w.seed, 7))).toBe(marketHash(w));
  });

  it("cannot purchase before S has working capital or when C declines the job", () => {
    const unfunded = newMarketWorld(11, 0, 10);
    advanceMarketDay(unfunded);
    expect(unfunded.events.some((e) => e.kind === "crop_bought")).toBe(false);
    expect(unfunded.events.some((e) => e.kind === "food_sold")).toBe(false);
    const refusingCarrier: MarketModel = { decide(input) {
      if (input.knownContext.role === "carrier" && input.knownContext.phase === "request")
        return { attempts: [], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const noCarrier = newMarketWorld();
    advanceMarketDay(noCarrier, refusingCarrier);
    expect(noCarrier.events.some((e) => e.kind === "carriage_declined")).toBe(true);
    expect(marketSummary(noCarrier).sellerCash).toBe(10);
    expect(noCarrier.events.some((e) => e.kind === "food_sold")).toBe(false);
  });

  it("charges the transport fee even when the farmer refuses, and resumes from a save", () => {
    const refusingFarmer: MarketModel = { decide(input) {
      if (input.knownContext.role === "farmer" && input.knownContext.phase === "offer")
        return { attempts: [], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const failed = newMarketWorld(); advanceMarketDay(failed, refusingFarmer);
    expect(marketSummary(failed)).toMatchObject({ sellerCash: 8, carrierCash: 2, farmerCash: 0,
      sellerProfit: -2, sold: 0 });
    expect(failed.events.some((e) => e.kind === "purchase_cash_returned" && e.data.amount === 1)).toBe(true);
    const original = newMarketWorld(17); advanceMarketDay(original); advanceMarketDay(original);
    const resumed = loadMarketWorld(saveMarketWorld(original));
    for (let i = 0; i < 5; i++) { advanceMarketDay(original); advanceMarketDay(resumed); }
    expect(marketHash(resumed)).toBe(marketHash(original));
  });
});
