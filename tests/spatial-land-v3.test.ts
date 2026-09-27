import { describe, expect, it } from "vitest";
import { spatialLandEconomy90V1 } from "../fixtures/land-economy-spatial";
import { spatialLandEconomyVillageModel } from "../packages/ai/farming-skill";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld, queueVillageCommand,
  queueVillageTerrainCommand, villageHash } from "../packages/sim/autonomous-world";
import { cellKey, findGridPath } from "../packages/sim/grid-path";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";

const fixture = () => structuredClone(spatialLandEconomy90V1);

describe("1280×768 spatial land economy", () => {
  it("places crops in distinct cells and makes the farmer work on their cells", () => {
    const w = newVillageWorld(240924, fixture());
    expect([w.grid.width, w.grid.height]).toEqual([40, 24]);
    const crops = Object.values(w.land.plants).filter((p) => p.species === "grain");
    expect(new Set(crops.map((p) => cellKey(p.cell))).size).toBe(4);
    const otherPlants = Object.values(w.land.plants).filter((p) => p.species !== "grain");
    expect(new Set(otherPlants.map((p) => cellKey(p.cell))).size).toBe(otherPlants.length);
    const path = findGridPath(w.grid, w.grid.sites.rock_west, w.grid.sites.ridge_east)!;
    expect(path.length).toBeGreaterThan(29);
    expect(path.every((p) => !w.grid.blocked.includes(cellKey(p)))).toBe(true);
    advanceVillageWorld(w, 7 * 24, spatialLandEconomyVillageModel);
    for (const decision of w.decisions.filter((d) => ["till_plot", "sow_plot", "harvest_plot"]
      .includes(d.chosen?.kind ?? ""))) {
      const plantId = (decision.chosen as { plantId: string }).plantId;
      expect(decision.knownContext.siteId).toBe(plantId);
      expect(decision.knownContext.cell).toEqual(w.land.plants[plantId].cell);
    }
    expect(w.events.some((e) => e.kind === "animal_moved")).toBe(true);
    checkVillageWorld(w);
  });

  it("replans a long route when a traversable cell closes during movement", () => {
    const w = newVillageWorld(240924, fixture());
    const original = findGridPath(w.grid, w.grid.sites.market, w.grid.sites.ridge_east)!;
    queueVillageCommand(w, { id: "walk-to-ridge", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "ridge_east" } });
    queueVillageTerrainCommand(w, { id: "rockfall", at: 5, cell: original[4], blocked: true });
    advanceVillageWorld(w, 12, spatialLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "travel_replanned" && e.actors.includes("C")))
      .toBe(true);
    expect(w.grid.blocked).toContain(cellKey(original[4]));
    checkVillageWorld(w);
  });

  it("sustains five people for 90 days and replays the spatial ruleset", () => {
    const w = newVillageWorld(240924, fixture());
    advanceVillageWorld(w, 90 * 24, spatialLandEconomyVillageModel);
    expect([w.harvestedFood, w.harvestedLandFood, w.eatenFood, w.harvestedWood, w.burnedWood])
      .toEqual([450, 435, 450, 450, 450]);
    for (let day = 1; day <= 90; day++) for (const id of ["S", "F", "C", "B1", "B2"])
      expect(w.events.filter((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
        .toHaveLength(1);
    const recording = captureVillageRecording(w);
    expect(recording.rulesetId).toBe("autonomous-village-spatial-land-v3");
    expect(villageHash(replayVillageRecording(recording))).toBe(villageHash(w));
    checkVillageWorld(w);
  }, 60000);
});
