import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ecologicalLandEconomy90V1 } from "../fixtures/land-economy-wide";
import { ecologicalLandEconomyVillageModel } from "../packages/ai/farming-skill";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, queueVillageTerrainCommand } from
  "../packages/sim/autonomous-world";
import { cellKey, ecologicalVillageGrid, findGridPath, findGridPathV2 } from
  "../packages/sim/grid-path";
import { replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

describe("ecological land economy", () => {
  it("harvests berries at separate cells and waits seven days for a stand to recover", () => {
    const w = newVillageWorld(240924, structuredClone(ecologicalLandEconomy90V1));
    const berryPatches = Object.values(w.land.plants).filter((p) => p.species === "wild_berry");
    expect(berryPatches).toHaveLength(4);
    expect(new Set(berryPatches.map((p) => cellKey(p.cell))).size).toBe(4);
    advanceVillageWorld(w, 3 * 24, ecologicalLandEconomyVillageModel);
    const picked = w.events.filter((e) => e.kind === "foraged" && e.data.resource === "food");
    expect(picked.map((e) => e.data.plantId)).toEqual(["wild_berry", "wild_berry_2", "wild_berry_3"]);
    expect(w.land.plants.wild_berry.stage).toBe("regrowing");
    expect(w.land.plants.wild_berry.available).toBe(1);
    advanceVillageWorld(w, 5 * 24, ecologicalLandEconomyVillageModel);
    expect(w.land.plants.wild_berry.stage).toBe("ripe");
    expect(w.land.plants.wild_berry.available).toBe(5);
  });

  it("uses two herbs per meal and leaves harvested fields fallow for three days", () => {
    const w = newVillageWorld(240924, structuredClone(ecologicalLandEconomy90V1));
    advanceVillageWorld(w, 4 * 24, ecologicalLandEconomyVillageModel);
    const herbMeal = w.events.find((e) => e.kind === "ate" && e.data.species === "herb");
    expect(herbMeal?.data.quantity).toBe(2);
    expect(w.land.plants.herb_patch.stage).toBe("regrowing");
    expect(Object.values(w.land.plants).filter((p) => p.species === "herb")).toHaveLength(8);
    expect(w.land.plants.grain_plot_9.stage).toBe("fallow");
    advanceVillageWorld(w, 2 * 24, ecologicalLandEconomyVillageModel);
    expect(w.land.plants.grain_plot_9.stage).toBe("fallow");
    advanceVillageWorld(w, 24, ecologicalLandEconomyVillageModel);
    expect(w.land.plants.grain_plot_9.stage).not.toBe("fallow");
  });

  it("uses shorter geometric A* paths and reroutes when a cell closes", () => {
    const grid = ecologicalVillageGrid();
    const old = findGridPath(grid, grid.sites.grove, grid.sites.field)!;
    const improved = findGridPathV2(grid, grid.sites.grove, grid.sites.field)!;
    const geometricCost = (route: typeof old) => route.slice(1).reduce((cost, p, i) =>
      cost + (p.x !== route[i].x && p.y !== route[i].y ? 14 : 10), 0);
    expect(geometricCost(improved)).toBeLessThan(geometricCost(old));
    const blocked = { ...grid, blocked: [...grid.blocked, cellKey(improved[1])] };
    const rerouted = findGridPathV2(blocked, grid.sites.grove, grid.sites.field)!;
    expect(rerouted).toBeDefined();
    expect(rerouted.some((p) => cellKey(p) === cellKey(improved[1]))).toBe(false);
    const w = newVillageWorld(240924, structuredClone(ecologicalLandEconomy90V1));
    queueVillageTerrainCommand(w, { id: "fallen-tree", at: 2,
      cell: { x: 15, y: 11 }, blocked: true });
    advanceVillageWorld(w, 2, ecologicalLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "plant_gathered" && e.actors.includes("F"))).toBe(true);
    expect(w.events.filter((e) => e.kind === "travel_step" && e.actors.includes("F"))
      .some((e) => e.data.x === 15 && e.data.y === 11)).toBe(false);
  });

  it("replans an already moving person's route after a road closes", () => {
    const w = newVillageWorld(240924, structuredClone(ecologicalLandEconomy90V1));
    const original = findGridPathV2(w.grid, w.grid.sites.market, w.grid.sites.field)!;
    const closed = original[26];
    queueVillageCommand(w, { id: "carrier-to-field", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "field" } });
    queueVillageTerrainCommand(w, { id: "road-closes", at: 3, cell: closed, blocked: true });
    advanceVillageWorld(w, 36, ecologicalLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "terrain_changed" &&
      e.data.commandId === "road-closes")).toBe(true);
    expect(w.events.some((e) => e.kind === "travel_replanned" && e.actors.includes("C")))
      .toBe(true);
    expect(w.events.filter((e) => e.kind === "travel_step" && e.actors.includes("C"))
      .some((e) => e.data.x === closed.x && e.data.y === closed.y)).toBe(false);
  });

  it("replays ninety days with daily food and fuel, crop rest and living animals", () => {
    const data = gunzipSync(readFileSync("fixtures/recordings/autonomous-village-ecological-90.v2.json.gz"));
    const recording = JSON.parse(data.toString("utf8")) as VillageRecording;
    expect(recording.rulesetId).toBe("autonomous-village-ecological-land-v6");
    const w = replayVillageRecording(recording);
    expect(w.eatenFood).toBe(452);
    expect(w.burnedWood).toBe(450);
    expect(Object.keys(w.land.animals).length).toBeGreaterThan(0);
    for (let day = 1; day <= 90; day++) for (const id of ["S", "F", "C", "B1", "B2"])
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
        .toBe(true);
  }, 60000);
});
