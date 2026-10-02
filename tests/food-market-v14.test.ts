import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { foodMarket90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageId, VillageModel } from "../packages/ai/autonomous-world";
import { trackedNeedsVillageModel } from "../packages/ai/tracked-needs";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand,
  saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function harvest() {
  const w = newVillageWorld(240924, foodMarket90V1);
  const act = (actorId: VillageId, attempt: VillageAttempt) => {
    queueVillageCommand(w, { id: `${actorId}:${w.hour}`, actorId, at: w.hour + 1, attempt });
    advanceVillageWorld(w, 1, idle);
    let remaining = 16;
    while (w.people[actorId].activeProcessId && remaining-- > 0) advanceVillageWorld(w, 1, idle);
    expect(w.people[actorId].activeProcessId).toBeUndefined();
  };
  act("B1", { kind: "travel", siteId: "grain_plot_5" });
  act("B1", { kind: "harvest_plot", plantId: "grain_plot_5" });
  const lotId = Object.keys(w.foodLots).find((id) => w.foodLots[id].species === "grain")!;
  expect(lotId).toBeTruthy();
  return { w, act, lotId };
}
describe("grain sale and skilled market baking v14", () => {
  it("requires baking skill and market workplace, keeping raw grain inedible", () => {
    const { w, act, lotId } = harvest();
    act("B1", { kind: "eat" });
    act("B1", { kind: "travel", siteId: "home_B1" });
    act("B1", { kind: "store_grain", lotId, storeId: "granary_home_B1" });
    const quantity = w.physical.objects[lotId].quantity;
    act("B1", { kind: "bake_bread", lotId });
    expect(w.bakedBread).toBe(0); expect(w.people.B1.meals).toBe(0);
    expect(w.physical.objects[lotId].quantity).toBe(quantity);
    expect(w.events.some((e) => e.kind === "attempt_rejected" && e.data.reason === "market baking skill or workplace unavailable")).toBe(true);
    act("S", { kind: "travel", siteId: "home_S" });
    act("S", { kind: "bake_bread", lotId });
    expect(w.events.at(-1)!.kind).toBe("attempt_rejected");
    expect(w.people.S.bakingSkills!.bread).toBe(1);
    expect(w.people.B1.bakingSkills!.bread).toBe(0);
  });
  it("transfers actual grain and cash, deposits purchased ingredients, then sells a perishable loaf to the farmer", () => {
    const { w, act, lotId } = harvest();
    act("B1", { kind: "travel", siteId: "market" });
    const quantity = w.physical.objects[lotId].quantity;
    act("B1", { kind: "post_surplus_offer", lotId, quantity, price: 2 });
    const grainOffer = Object.values(w.foodOffers!)[0];
    // The farmer cannot purchase with an empty wallet; posting an offer alone creates no cash.
    act("C", { kind: "buy_surplus", offerId: grainOffer.id });
    expect(grainOffer.purchasedEventId).toBeUndefined();
    expect(w.physical.objects[lotId].ownerId).toBe("B1");
    act("S", { kind: "buy_surplus", offerId: grainOffer.id });
    expect(w.physical.objects[lotId]).toMatchObject({ ownerId: "S", parentId: "granary_market_S", quantity });
    expect(w.events.find((e) => e.kind === "surplus_sold")!.data).toMatchObject({ product: "grain", price: 2, quantity });
    act("B1", { kind: "bake_bread", lotId });
    expect(w.bakedBread).toBe(0);
    act("S", { kind: "bake_bread", lotId });
    const breadId = Object.keys(w.foodLots).find((id) => w.foodLots[id].product === "bread")!;
    expect(w.physical.objects[lotId].quantity).toBe(quantity - 1);
    expect(w.foodLots[breadId]).toMatchObject({ originPlantId: "grain_plot_5", harvestedDay: 1, product: "bread" });
    act("S", { kind: "post_surplus_offer", lotId: breadId, quantity: 1, price: 1 });
    const breadOffer = Object.values(w.foodOffers!).find((o) => o.lotId === breadId)!;
    act("B1", { kind: "buy_surplus", offerId: breadOffer.id });
    expect(w.physical.objects[breadId]).toMatchObject({ ownerId: "B1", parentId: "bag_B1" });
    act("B1", { kind: "eat" });
    expect(w.people.B1.meals).toBe(1);
    expect(w.events.find((e) => e.kind === "ate")!.data.product).toBe("bread");
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency")).toHaveLength(26);
    const cash = (id: string) => Object.values(w.physical.objects).filter((o) => o.typeId === "currency" && o.ownerId === id).length;
    expect(cash("B1")).toBe(1); expect(cash("S")).toBe(19);
    const restored = loadVillageWorld(saveVillageWorld(w));
    expect(villageHash(restored)).toBe(villageHash(w));
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  });
  it("keeps ordinary food activity and travel prediction reproducible after a save", () => {
    const w = newVillageWorld(240924, foodMarket90V1);
    advanceVillageWorld(w, 5 * 24, trackedNeedsVillageModel);
    const restored = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 5 * 24, trackedNeedsVillageModel);
    advanceVillageWorld(restored, 5 * 24, trackedNeedsVillageModel);
    expect(villageHash(restored)).toBe(villageHash(w));
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
    for (const id of ["F", "B1", "B2"]) {
      expect(w.events.some((e) => e.kind === "surplus_sold" && e.data.product === "grain" && e.actors[0] === id)).toBe(true);
      expect(w.events.some((e) => e.kind === "surplus_sold" && e.data.product === "bread" && e.actors[1] === id)).toBe(true);
    }
    expect(w.events.filter((e) => e.kind === "bread_baked").every((e) => e.actors[0] === "S" && e.data.siteId === "market")).toBe(true);
  }, 120000);
  it("replays 90 days with grain and bread trades and no unskilled home baking", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-food-market-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(r.rulesetId).toBe("autonomous-village-food-market-v14");
    for (const id of ["F", "B1", "B2"]) {
      expect(w.events.some((e) => e.kind === "surplus_sold" && e.data.product === "grain" && e.actors[0] === id)).toBe(true);
      expect(w.events.some((e) => e.kind === "surplus_sold" && e.data.product === "bread" && e.actors[1] === id)).toBe(true);
      expect(w.events.some((e) => e.kind === "ate" && e.data.product === "bread" && e.actors[0] === id)).toBe(true);
    }
    expect(w.events.filter((e) => e.kind === "bread_baked").every((e) => e.actors[0] === "S" && e.data.siteId === "market")).toBe(true);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
  }, 240000);
});
