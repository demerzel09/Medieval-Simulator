import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bulkTransport90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageContext, VillageId, VillageModel } from "../packages/ai/autonomous-world";
import type { AnticipationMemory } from "../packages/ai/anticipatory-needs";
import { foodMarketChoice } from "../packages/ai/food-market";
import { trackedNeedsVillageModel } from "../packages/ai/tracked-needs";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, loadVillageWorld, saveVillageWorld, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { loadMovement, travelExperienceKey } from "../packages/sim/load-movement";
import { villagePersonStatus } from "../packages/sim/village-status";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function act(w: VillageWorld, id: VillageId, attempt: VillageAttempt) {
  queueVillageCommand(w, { id: `${id}:${w.hour}`, actorId: id, at: w.hour + 1, attempt });
  advanceVillageWorld(w, 1, idle);
  let remaining = 48;
  while (w.people[id].activeProcessId && remaining-- > 0) advanceVillageWorld(w, 1, idle);
  expect(w.people[id].activeProcessId).toBeUndefined();
}
function harvested() {
  const w = newVillageWorld(240924, bulkTransport90V1);
  act(w, "B1", { kind: "travel", siteId: "grain_plot_5" });
  act(w, "B1", { kind: "harvest_plot", plantId: "grain_plot_5" });
  const lot = Object.values(w.physical.objects).find((o) => o.parentId === "granary_field_grain_plot_5")!;
  expect(lot).toBeDefined();
  return { w, lot };
}
describe("bulk grain and load transport v16", () => {
  it("harvests twenty units into the owner's field stock, then loads real batches within capacity", () => {
    const { w, lot } = harvested();
    expect(lot).toMatchObject({ quantity: 20, typeId: "bulk_grain", ownerId: "B1" });
    expect(villagePersonStatus(w, "B1")).toMatchObject({ carried: { mass: 8 }, field: { mass: 40 } });
    expect(Object.values(w.physical.objects).some((o) => o.typeId === "seed")).toBe(false);
    expect(w.seedsProduced).toBe(0);
    const damaged = JSON.parse(saveVillageWorld(w));
    delete damaged.physical.objects.granary_field_grain_plot_6;
    expect(() => loadVillageWorld(JSON.stringify(damaged))).toThrow("invalid field grain store");
    act(w, "B1", { kind: "load_grain", lotId: lot.id, quantity: 20 });
    expect(w.physical.objects[lot.id].quantity).toBe(20);
    act(w, "B2", { kind: "load_grain", lotId: lot.id, quantity: 5 });
    expect(w.physical.objects[lot.id].quantity).toBe(20);
    act(w, "B1", { kind: "load_grain", lotId: lot.id, quantity: 5 });
    expect(villagePersonStatus(w, "B1")).toMatchObject({ carried: { mass: 18 }, field: { mass: 30 } });
    expect(w.physical.objects[lot.id].quantity).toBe(15);
    const loaded = w.events.find((e) => e.kind === "grain_loaded")!;
    expect(w.foodLots[String(loaded.data.lotId)]).toEqual(w.foodLots[lot.id]);
    act(w, "B1", { kind: "eat" });
    expect(w.people.B1.meals).toBe(0);
    act(w, "B1", { kind: "travel", siteId: "home_B1" });
    act(w, "B1", { kind: "store_home", objectId: String(loaded.data.lotId), quantity: 5 });
    expect(villagePersonStatus(w, "B1").home.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "grain", quantity: 5, mass: 10 })]));
    expect(villageHash(loadVillageWorld(saveVillageWorld(w)))).toBe(villageHash(w));
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  });
  it("consumes the same grain for sowing without generating separate seeds", () => {
    const w = newVillageWorld(240924, bulkTransport90V1);
    const crop = Object.values(w.land.plants).find((p) => p.ownerId === "B1" && p.species === "grain" && p.stage === "bare")!;
    act(w, "B1", { kind: "travel", siteId: crop.siteId });
    act(w, "B1", { kind: "till_plot", plantId: crop.id });
    act(w, "B1", { kind: "sow_plot", plantId: crop.id });
    expect(w.seedsUsed).toBe(1);
    expect(villagePersonStatus(w, "B1").carried.items).toEqual([expect.objectContaining({ kind: "grain", quantity: 3, mass: 6 })]);
    expect(w.land.plants[crop.id].stage).toBe("seeded");
    expect(w.land.plants[crop.id].growthQuantity).toBe(20);
    expect(w.initialGrain).toBe(12);
  });
  it("walks fewer cells and consumes more energy over the same route when loaded", () => {
    const { w: base, lot } = harvested();
    const light = loadVillageWorld(saveVillageWorld(base)), heavy = loadVillageWorld(saveVillageWorld(base));
    const initial = villagePersonStatus(light, "B1").carried.items.find((o) => o.kind === "grain")!;
    act(light, "B1", { kind: "store_grain", lotId: initial.id, storeId: "granary_field_grain_plot_5" });
    act(heavy, "B1", { kind: "load_grain", lotId: lot.id, quantity: 5 });
    expect(villagePersonStatus(light, "B1").carried.mass).toBe(0);
    expect(villagePersonStatus(heavy, "B1").carried.mass).toBe(18);
    for (const w of [light, heavy]) {
      queueVillageCommand(w, { id: "compare-route", actorId: "B1", at: w.hour + 1, attempt: { kind: "travel", siteId: "grove" } });
      advanceVillageWorld(w, 1, idle);
    }
    const travel = (w: VillageWorld) => Object.values(w.processes).filter((p) => p.actorId === "B1" && p.kind === "travel").at(-1)!;
    expect(travel(light).path).toEqual(travel(heavy).path);
    expect(travel(heavy).duration).toBeGreaterThan(travel(light).duration);
    expect(travel(heavy).energyPerHour).toBe(4);
    expect(travel(light).energyPerHour).toBe(1);
    const counts = (w: VillageWorld) => w.events.filter((e) => e.kind === "travel_step" && e.actors[0] === "B1" && e.hour === w.hour).length;
    advanceVillageWorld(light, 1, idle); advanceVillageWorld(heavy, 1, idle);
    expect(counts(heavy)).toBeLessThan(counts(light));
    expect(light.people.B1.energy).toBeGreaterThan(heavy.people.B1.energy);
    for (let mass = 0; mass < 20; mass++) {
      expect(loadMovement(mass + 1, bulkTransport90V1.bulkTransport!).speedRatio).toBeLessThan(loadMovement(mass, bulkTransport90V1.bulkTransport!).speedRatio);
    }
    expect(travelExperienceKey("field", "market", 0, true)).not.toBe(travelExperienceKey("field", "market", 18, true));
    expect(travelExperienceKey("field", "market", 18, false)).toBe("field>market");
  });
  it("starts a fresh market waiting period on arrival after an interrupted visit", () => {
    const w = newVillageWorld(240924, bulkTransport90V1);
    let context: VillageContext | undefined;
    const observe: VillageModel = { decide(i) { if (i.actorId === "F") context = i.knownContext; return idle.decide(i); } };
    advanceVillageWorld(w, 1, observe);
    const memory = { foodMarket: { retryAt: 0, visitStartedAt: 3 } } as AnticipationMemory;
    expect(foodMarketChoice(context!, memory, "F", 18)?.attempt?.kind).toBe("travel");
    expect(memory.foodMarket?.visitStartedAt).toBeUndefined();
    const market = { ...context!, siteId: "market" };
    expect(foodMarketChoice(market, memory, "F", 20)?.reason).toBe("wait for an actual edible-food offer");
    expect(memory.foodMarket?.visitStartedAt).toBe(20);
    expect(foodMarketChoice(market, memory, "F", 25)?.reason).toBe("wait for an actual edible-food offer");
    expect(foodMarketChoice(market, memory, "F", 26)).toBeUndefined();
  });
  it("recalculates ten days of decisions and a save/resume with the same physical state", () => {
    const w = newVillageWorld(240924, bulkTransport90V1);
    advanceVillageWorld(w, 120, trackedNeedsVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 120, trackedNeedsVillageModel);
    advanceVillageWorld(resumed, 120, trackedNeedsVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
    const fresh = newVillageWorld(240924, bulkTransport90V1);
    advanceVillageWorld(fresh, 240, trackedNeedsVillageModel);
    expect(villageHash(fresh)).toBe(villageHash(w));
    const r = captureVillageRecording(w);
    expect(r.rulesetId).toBe("autonomous-village-bulk-transport-v16");
    expect(villageHash(replayVillageRecording(r))).toBe(villageHash(w));
    expect(w.events.some((e) => e.kind === "grain_loaded")).toBe(true);
  }, 120000);
  it("replays the ninety day archive with twenty-unit harvests and actual field and carried inventories", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-bulk-transport-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(villageHash(w)).toBe(r.finalStateHash);
    const harvests = w.events.filter((e) => e.kind === "crop_harvested");
    expect(harvests.length).toBeGreaterThan(0);
    expect(harvests.every((e) => e.data.quantity === 20 && e.data.storeId)).toBe(true);
    expect(w.seedsProduced).toBe(0);
    expect(w.events.some((e) => e.kind === "grain_loaded" && e.data.quantity === 5)).toBe(true);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      const status = villagePersonStatus(w, id);
      expect(w.people[id].meals).toBe(90);
      expect(w.people[id].hunger).toBe(0);
      expect(status.carried.mass).toBeLessThanOrEqual(20);
      expect(JSON.parse(String(r.events.filter((e) => e.kind === "person_status" && e.actors[0] === id).at(-1)!.data.status))).toEqual(status);
    }
  }, 240000);
});
