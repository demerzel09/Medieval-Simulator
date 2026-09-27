import { describe, expect, it } from "vitest";
import { cultivatorVillageModel } from "../packages/ai/farming-skill";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld,
  queueVillageCommand, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { defaultVillageGrid } from "../packages/sim/grid-path";
import { newLandEcology } from "../packages/sim/land-ecology";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";

const idle: VillageModel = { decide(input) { return { attempts: [],
  wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState }; } };

describe("land-rooted ecology", () => {
  it("lets a crop-skilled farmer till, sow, wait for growth and harvest physical food and seed", () => {
    const w = newVillageWorld(91);
    advanceVillageWorld(w, 4 * 24, cultivatorVillageModel);
    expect(w.events.some((e) => e.kind === "plot_tilled")).toBe(true);
    expect(w.events.some((e) => e.kind === "plot_sown")).toBe(true);
    expect(w.events.some((e) => e.kind === "plant_grew" && e.data.plantId === "grain_plot")).toBe(true);
    expect(w.events.some((e) => e.kind === "crop_harvested" && e.actors.includes("F"))).toBe(true);
    expect(w.land.plants.grain_plot.personHarvested).toBeGreaterThan(0);
    expect(w.harvestedLandFood).toBeGreaterThan(0);
    expect(w.seedsProduced).toBeGreaterThan(0);
    expect(w.events.some((e) => e.kind === "animal_ate" && e.data.animalId === "rabbit_1")).toBe(true);
    expect(w.land.animals.rabbit_1.lifeStage).toBe("adult");
    checkVillageWorld(w);
  });

  it("keeps fruit-tree picking and herb gathering at their land cells", () => {
    const w = newVillageWorld();
    queueVillageCommand(w, { id: "herb", actorId: "F", at: 1,
      attempt: { kind: "gather_plant", plantId: "herb_patch", quantity: 1 } });
    queueVillageCommand(w, { id: "go-meadow", actorId: "F", at: 3,
      attempt: { kind: "travel", siteId: "meadow" } });
    queueVillageCommand(w, { id: "fruit", actorId: "F", at: 5,
      attempt: { kind: "gather_plant", plantId: "orchard", quantity: 1 } });
    advanceVillageWorld(w, 6, idle);
    expect(w.events.filter((e) => e.kind === "plant_gathered").map((e) => e.data.plantId))
      .toEqual(["herb_patch", "orchard"]);
    expect(w.harvestedLandFood).toBe(2);
    expect(w.land.plants.herb_patch.personHarvested).toBe(1);
    expect(w.land.plants.orchard.personHarvested).toBe(1);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 2 * 24, idle); advanceVillageWorld(resumed, 2 * 24, idle);
    expect(villageHash(resumed)).toBe(villageHash(w));
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  });

  it("rejects work without crop knowledge or when the actor is away from the plot", () => {
    const w = newVillageWorld();
    queueVillageCommand(w, { id: "remote", actorId: "F", at: 1,
      attempt: { kind: "till_plot", plantId: "grain_plot" } });
    queueVillageCommand(w, { id: "unskilled", actorId: "B1", at: 1,
      attempt: { kind: "gather_plant", plantId: "herb_patch", quantity: 1 } });
    advanceVillageWorld(w, 1, idle);
    expect(w.events.filter((e) => e.kind === "attempt_rejected")).toHaveLength(2);
    expect(w.land.plants.grain_plot.stage).toBe("bare");
    expect(w.land.plants.herb_patch.available).toBe(2);
  });

  it("moves an animal to a different edible plant when its preferred patch is empty", () => {
    const grid = defaultVillageGrid(), land = newLandEcology(grid, 8, 8);
    land.plants.grass_patch.available = 0;
    land.plants.grass_patch.initialAvailable = 0;
    land.plants.grass_patch.stage = "regrowing";
    const w = newVillageWorld(22, undefined, grid, land);
    advanceVillageWorld(w, 1, idle);
    expect(w.events.some((e) => e.kind === "animal_moved" &&
      e.data.animalId === "rabbit_1")).toBe(true);
    expect(w.events.some((e) => e.kind === "animal_ate" &&
      e.data.plantId === "herb_patch")).toBe(true);
    expect(w.physical.objects.rabbit_1.parentId).toBe("tile_2_1");
    const recording = captureVillageRecording(w);
    expect(villageHash(replayVillageRecording(recording))).toBe(villageHash(w));
  });
});
