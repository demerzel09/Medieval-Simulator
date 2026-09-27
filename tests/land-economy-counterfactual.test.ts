import { describe, expect, it } from "vitest";
import { landEconomy90V1 } from "../fixtures/land-economy-90";
import { landEconomyVillageModel } from "../packages/ai/farming-skill";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld,
  queueVillageTerrainCommand, villageHash } from "../packages/sim/autonomous-world";
import { defaultVillageGrid } from "../packages/sim/grid-path";
import { newLandEcology } from "../packages/sim/land-ecology";
import { captureVillageRecording, compareVillageRecordings,
  replayVillageRecording } from "../packages/sim/village-recording";

const fixture = () => structuredClone(landEconomy90V1.world);
const ate = (w: ReturnType<typeof newVillageWorld>, id: string, day: number) =>
  w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id));

describe("land economy counterfactuals", () => {
  it("lets plot, seed and yield shortages change real production and meals", () => {
    const fewPlots = fixture(); fewPlots.landEconomy!.grainPlots = 3;
    const land = newVillageWorld(240924, fewPlots);
    advanceVillageWorld(land, 7 * 24, landEconomyVillageModel);
    expect(Object.values(land.land.plants).filter((p) => p.species === "grain")).toHaveLength(3);
    expect(ate(land, "S", 7)).toBe(false);
    checkVillageWorld(land);

    const fewSeeds = fixture(); fewSeeds.landEconomy!.initialSeeds = 2;
    const seedWorld = newVillageWorld(240924, fewSeeds);
    advanceVillageWorld(seedWorld, 3 * 24, landEconomyVillageModel);
    expect(seedWorld.events.filter((e) => e.kind === "plot_sown")).toHaveLength(2);
    expect(seedWorld.events.some((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "crop stage unavailable")).toBe(true);
    expect(ate(seedWorld, "S", 3)).toBe(false);
    checkVillageWorld(seedWorld);

    const f = fixture(), grid = defaultVillageGrid();
    const ecology = newLandEcology(grid, f.resources.food.initial, f.resources.food.capacity, 4);
    for (const patch of Object.values(ecology.plants)) if (patch.species === "grain")
      patch.growthQuantity = 4;
    const poor = newVillageWorld(240924, f, grid, ecology);
    advanceVillageWorld(poor, 5 * 24, landEconomyVillageModel);
    expect(poor.events.some((e) => e.kind === "crop_harvested" && e.data.quantity === 4)).toBe(true);
    expect(ate(poor, "S", 4)).toBe(false);
    expect(Object.values(poor.physical.objects).filter((o) => o.typeId === "currency")).toHaveLength(26);
    checkVillageWorld(poor);
  }, 30000);

  it("does not deliver goods when the farmer refuses or the order arrives late", () => {
    const refuses: VillageModel = { decide(input) {
      if (input.actorId === "F") return { attempts: [], wait: { at: input.at + 1 },
        subjectiveUpdate: input.subjectiveState };
      return landEconomyVillageModel.decide(input);
    } };
    const w = newVillageWorld(240924, fixture());
    advanceVillageWorld(w, 2 * 24, refuses);
    expect(w.events.some((e) => e.kind === "food_delivered")).toBe(false);
    expect(ate(w, "S", 1)).toBe(false);
    const delayed = fixture(); delayed.informationDelayHours = 24;
    const late = newVillageWorld(240924, delayed);
    advanceVillageWorld(late, 2 * 24, landEconomyVillageModel);
    expect(late.events.some((e) => e.kind === "food_order_accepted" && e.day === 1)).toBe(false);
    expect(ate(late, "S", 1)).toBe(false);
    checkVillageWorld(w); checkVillageWorld(late);
  });

  it("replays a mid-route road closure and compares its first divergence", () => {
    const grid = defaultVillageGrid();
    grid.sites.field = { x: 4, y: 1 }; grid.sites.meadow = { x: 4, y: 3 };
    const f = fixture();
    const ordinary = newVillageWorld(240924, f, grid);
    const closed = newVillageWorld(240924, f, grid);
    queueVillageTerrainCommand(closed, { id: "field-north-road-closes", at: 5,
      cell: { x: 3, y: 0 }, blocked: true });
    queueVillageTerrainCommand(closed, { id: "field-middle-road-closes", at: 5,
      cell: { x: 3, y: 1 }, blocked: true });
    advanceVillageWorld(ordinary, 3 * 24, landEconomyVillageModel);
    advanceVillageWorld(closed, 3 * 24, landEconomyVillageModel);
    expect(closed.events.some((e) => e.kind === "travel_replanned" && e.actors.includes("F")))
      .toBe(true);
    const baseRecord = captureVillageRecording(ordinary), closureRecord = captureVillageRecording(closed);
    expect(villageHash(replayVillageRecording(closureRecord))).toBe(villageHash(closed));
    const comparison = compareVillageRecordings(baseRecord, closureRecord);
    expect(comparison.equal).toBe(false);
    expect(comparison.firstDifference?.right?.hour).toBe(5);
    expect(comparison.gridEqual).toBe(true);
    expect(comparison.commandsEqual).toBe(false);
    checkVillageWorld(closed);
  }, 30000);
});
