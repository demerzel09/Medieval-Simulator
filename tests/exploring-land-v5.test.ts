import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { exploringLandEconomy90V1 } from "../fixtures/land-economy-wide";
import { exploringLandEconomyVillageModel } from "../packages/ai/farming-skill";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld, queueVillageTerrainCommand,
  villageHash } from "../packages/sim/autonomous-world";
import { replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

describe("local wild-plant exploration", () => {
  it("discovers edible patches, visits their cells, gathers and returns within the work hour", () => {
    const w = newVillageWorld(240924, structuredClone(exploringLandEconomy90V1));
    advanceVillageWorld(w, 3 * 24, exploringLandEconomyVillageModel);
    const gathered = w.events.filter((e) => e.kind === "plant_gathered" && e.actors.includes("F"));
    expect(gathered.map((e) => String(e.data.plantId)))
      .toEqual(["herb_patch", "herb_patch_2", "orchard_2"]);
    expect(new Set(w.events.filter((e) => e.kind === "plant_discovered" &&
      e.actors.includes("F")).map((e) => e.data.plantId)).size).toBeGreaterThanOrEqual(3);
    for (const event of gathered) {
      const steps = w.events.filter((e) => e.hour === event.hour && e.kind === "travel_step" &&
        e.actors.includes("F"));
      const patch = w.land.plants[String(event.data.plantId)];
      expect(steps.some((e) => e.data.x === patch.cell.x && e.data.y === patch.cell.y)).toBe(true);
      expect([steps.at(-1)?.data.x, steps.at(-1)?.data.y])
        .toEqual([w.grid.sites.grove.x, w.grid.sites.grove.y]);
    }
    for (let day = 1; day <= 3; day++) for (const id of ["S", "F", "C", "B1", "B2"])
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
        .toBe(true);
    checkVillageWorld(w);
  });

  it("falls back to the existing berry harvest without the finding skill", () => {
    const w = newVillageWorld(240924, structuredClone(exploringLandEconomy90V1));
    w.people.F.foragingSkill = 0;
    advanceVillageWorld(w, 2, exploringLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "foraged" && e.actors.includes("F") &&
      e.data.resource === "food")).toBe(true);
    expect(w.events.some((e) => e.kind === "plant_gathered" && e.actors.includes("F")))
      .toBe(false);
    checkVillageWorld(w);
  });

  it("routes around a newly blocked cell during a gathering excursion", () => {
    const w = newVillageWorld(240924, structuredClone(exploringLandEconomy90V1));
    queueVillageTerrainCommand(w, { id: "fallen-tree", at: 2,
      cell: { x: 15, y: 11 }, blocked: true });
    advanceVillageWorld(w, 2, exploringLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "terrain_changed" && e.data.commandId === "fallen-tree"))
      .toBe(true);
    expect(w.events.some((e) => e.kind === "plant_gathered" && e.actors.includes("F")))
      .toBe(true);
    expect(w.events.filter((e) => e.kind === "travel_step" && e.actors.includes("F"))
      .some((e) => e.data.x === 15 && e.data.y === 11)).toBe(false);
    checkVillageWorld(w);
  });

  it("replays 90 days and retains daily food, fuel and animal ecology", () => {
    const bytes = readFileSync("fixtures/recordings/autonomous-village-exploring-90.v2.json.gz");
    const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as VillageRecording;
    expect(recording.rulesetId).toBe("autonomous-village-exploring-land-v5");
    const w = replayVillageRecording(recording);
    expect(villageHash(w)).toBe(recording.finalStateHash);
    expect([w.eatenFood, w.burnedWood, w.land.animalBirths, w.land.animalDeaths])
      .toEqual([450, 450, 6, 6]);
    for (let day = 1; day <= 90; day++) for (const id of ["S", "F", "C", "B1", "B2"])
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
        .toBe(true);
  }, 60000);
});
