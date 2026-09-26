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
      .reduce((n, o) => n + o.quantity, 0)).toBe(0);
    expect(w.harvested).toBe(1);
    const contract = w.events.find((e) => e.kind === "harvest_contract_accepted")!;
    const worked = w.events.find((e) => e.kind === "foraged")!;
    const bought = w.events.find((e) => e.kind === "crop_bought")!;
    const delivered = w.events.find((e) => e.kind === "crop_delivered")!;
    const sold = w.events.find((e) => e.kind === "food_sold")!;
    expect(worked.causes).toContain(contract.id);
    expect(bought.causes).toContain(contract.id);
    expect(bought.causes).toContain(worked.id);
    expect(delivered.causes).toContain(bought.id);
    expect(sold.causes).toContain(delivered.id);
    checkMarketWorld(w);
  });

  it("raises the posted price after a funded stockout, then lowers it when buyers lose purchasing power", () => {
    const w = newMarketWorld();
    const prices = [];
    for (let day = 0; day < 7; day++) { advanceMarketDay(w); prices.push(w.seller.price); }
    expect(prices).toEqual([4, 5, 5, 5, 4, 3, 2]);
    expect(marketSummary(w)).toMatchObject({ sold: 4, stock: 0, spoiled: 5, sellerCash: 16,
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
    expect(unfunded.harvested).toBe(0);
    const noReserve = newMarketWorld(12, 6, 10);
    advanceMarketDay(noReserve);
    expect(noReserve.events.some((e) => e.kind === "supply_requested")).toBe(false);
    const funded = newMarketWorld(12, 7, 10);
    advanceMarketDay(funded);
    expect(marketSummary(funded).sellerCash).toBe(8);
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
    expect(noCarrier.harvested).toBe(0);
  });

  it("charges the transport fee even when the farmer refuses, and resumes from a save", () => {
    const refusingFarmer: MarketModel = { decide(input) {
      if (input.knownContext.role === "farmer" && input.knownContext.phase === "contract")
        return { attempts: [], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const failed = newMarketWorld(); advanceMarketDay(failed, refusingFarmer);
    expect(marketSummary(failed)).toMatchObject({ sellerCash: 8, carrierCash: 2, farmerCash: 0,
      sellerProfit: -2, sold: 0 });
    expect(failed.events.some((e) => e.kind === "purchase_cash_returned" && e.data.amount === 1)).toBe(true);
    expect(failed.harvested).toBe(0);
    const original = newMarketWorld(17); advanceMarketDay(original); advanceMarketDay(original);
    const resumed = loadMarketWorld(saveMarketWorld(original));
    for (let i = 0; i < 5; i++) { advanceMarketDay(original); advanceMarketDay(resumed); }
    expect(marketHash(resumed)).toBe(marketHash(original));
  });

  it("does not pay for work that F accepted but never performed", () => {
    const refusingWork: MarketModel = { decide(input) {
      if (input.knownContext.role === "farmer" && input.knownContext.phase === "work")
        return { attempts: [], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const w = newMarketWorld(); advanceMarketDay(w, refusingWork);
    expect(w.events.some((e) => e.kind === "harvest_contract_accepted")).toBe(true);
    expect(w.events.some((e) => e.kind === "crop_bought")).toBe(false);
    expect(marketSummary(w)).toMatchObject({ sellerCash: 8, farmerCash: 0, carrierCash: 2, harvested: 0 });
    checkMarketWorld(w);
  });

  it("pays the commissioned unit wage only for the quantity actually handed over", () => {
    const partialWork: MarketModel = { decide(input) {
      if (input.knownContext.role === "farmer" && input.knownContext.phase === "work" &&
        input.knownContext.contractedQuantity === 2)
        return { attempts: [{ kind: "harvest", quantity: 1 }], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const w = newMarketWorld(); advanceMarketDay(w, partialWork); advanceMarketDay(w, partialWork);
    const contract = w.events.find((e) => e.kind === "harvest_contract_accepted" && e.day === 2)!;
    const sale = w.events.find((e) => e.kind === "crop_bought" && e.day === 2)!;
    expect(contract.data.quantity).toBe(2);
    expect(sale.data).toMatchObject({ quantity: 1, cost: 1, unitPrice: 1 });
    expect(marketSummary(w).farmerCash).toBe(2);
    expect(w.events.some((e) => e.kind === "purchase_cash_entrusted" && e.day === 2 && e.data.amount === 2)).toBe(true);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency" && o.ownerId === "S")).toHaveLength(marketSummary(w).sellerCash);
    checkMarketWorld(w);
  });

  it("leaves a contracted harvest with F when F does not hand it over", () => {
    const holdingFarmer: MarketModel = { decide(input) {
      if (input.knownContext.role === "farmer" && input.knownContext.phase === "handover")
        return { attempts: [], wait: { at: input.at + 1 } };
      return ordinaryMarketModel.decide(input);
    } };
    const w = newMarketWorld(); advanceMarketDay(w, holdingFarmer);
    expect(marketSummary(w)).toMatchObject({ sellerCash: 8, farmerCash: 0, carrierCash: 2, harvested: 1 });
    const lot = Object.values(w.physical.objects).find((o) => o.typeId === "food")!;
    expect(lot).toMatchObject({ ownerId: "F", parentId: "bag_F", quantity: 1 });
    expect(w.events.some((e) => e.kind === "crop_bought")).toBe(false);
    checkMarketWorld(w);
  });

  it("keeps each food lot for three calendar days, then spoils it without minting money", () => {
    const w = newMarketWorld(); advanceMarketDay(w);
    const firstLot = Object.values(w.physical.objects).find((o) => o.typeId === "food" && o.ownerId === "B1")!.id;
    advanceMarketDay(w); advanceMarketDay(w);
    expect(w.physical.objects[firstLot]).toBeDefined();
    expect(w.foodLots[firstLot]).toEqual({ kind: "berries", harvestedDay: 1 });
    advanceMarketDay(w);
    expect(w.physical.objects[firstLot]).toBeUndefined();
    expect(w.events.some((e) => e.kind === "food_spoiled" && e.day === 4 && e.data.lotId === firstLot)).toBe(true);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency")).toHaveLength(30);
    checkMarketWorld(w);
  });
});
