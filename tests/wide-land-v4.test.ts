import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { wideLandEconomy90V1 } from "../fixtures/land-economy-wide";
import { spatialLandEconomyVillageModel } from "../packages/ai/farming-skill";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld, queueVillageCommand,
  queueVillageTerrainCommand, villageHash } from "../packages/sim/autonomous-world";
import { cellKey, findGridPath } from "../packages/sim/grid-path";
import { replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

describe("distributed 40×24 land economy", () => {
  it("places work, homes and ecology across the playable map", () => {
    const w = newVillageWorld(240924, structuredClone(wideLandEconomy90V1));
    expect([w.grid.width, w.grid.height]).toEqual([40, 24]);
    const sites = ["market", "grove", "field", "meadow", "home_B1", "home_B2"]
      .map((id) => w.grid.sites[id]);
    expect(Math.max(...sites.map((p) => p.x)) - Math.min(...sites.map((p) => p.x)))
      .toBeGreaterThan(30);
    expect(Math.max(...sites.map((p) => p.y)) - Math.min(...sites.map((p) => p.y)))
      .toBeGreaterThan(15);
    const route = findGridPath(w.grid, w.grid.sites.market, w.grid.sites.field)!;
    expect(route.length).toBeGreaterThan(25);
    expect(route.every((p) => !w.grid.blocked.includes(cellKey(p)))).toBe(true);
    const crops = Object.values(w.land.plants).filter((p) => p.species === "grain");
    expect(new Set(crops.map((p) => cellKey(p.cell))).size).toBe(4);
    expect(crops.every((p) => p.cell.x >= 34)).toBe(true);
  });

  it("records each traversed cell and reroutes after an obstacle appears mid journey", () => {
    const w = newVillageWorld(240924, structuredClone(wideLandEconomy90V1));
    const original = findGridPath(w.grid, w.grid.sites.market, w.grid.sites.ridge_east)!;
    queueVillageCommand(w, { id: "cross-world", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "ridge_east" } });
    queueVillageTerrainCommand(w, { id: "rockfall", at: 2, cell: original[25], blocked: true });
    advanceVillageWorld(w, 6, spatialLandEconomyVillageModel);
    const steps = w.events.filter((e) => e.kind === "travel_step" && e.actors.includes("C"));
    expect(steps.length).toBeGreaterThan(30);
    expect(steps.slice(0, 24).map((e) => `${e.data.x},${e.data.y}`))
      .toEqual(original.slice(1, 25).map(cellKey));
    expect(steps.some((e) => `${e.data.x},${e.data.y}` === cellKey(original[25])))
      .toBe(false);
    expect(w.events.some((e) => e.kind === "travel_replanned" && e.actors.includes("C")))
      .toBe(true);
    expect(w.people.C.cell).toEqual(w.grid.sites.ridge_east);
    checkVillageWorld(w);
  });

  it("can change a destination while crossing the map", () => {
    const w = newVillageWorld(240924, structuredClone(wideLandEconomy90V1));
    queueVillageCommand(w, { id: "cross-world", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "ridge_east" } });
    queueVillageCommand(w, { id: "turn-to-field", actorId: "C", at: 2,
      attempt: { kind: "redirect_travel", siteId: "field" } });
    advanceVillageWorld(w, 3, spatialLandEconomyVillageModel);
    expect(w.events.some((e) => e.kind === "travel_redirected" && e.actors.includes("C") &&
      e.data.destinationId === "field")).toBe(true);
    expect(w.events.some((e) => e.kind === "arrived" && e.actors.includes("C") &&
      e.data.siteId === "field")).toBe(true);
    checkVillageWorld(w);
  });

  it("replays the archived 90 days with real movement across the map", () => {
    const bytes = readFileSync("fixtures/recordings/autonomous-village-wide-90.v2.json.gz");
    const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(recording.rulesetId).toBe("autonomous-village-wide-land-v4");
    expect(villageHash(w)).toBe(recording.finalStateHash);
    expect([w.eatenFood, w.harvestedWood, w.burnedWood]).toEqual([450, 450, 450]);
    const steps = recording.events.filter((e) => e.kind === "travel_step");
    const cells = new Set(steps.map((e) => `${e.data.x},${e.data.y}`));
    expect(cells.size).toBeGreaterThan(70);
    expect([...cells].some((key) => Number(key.split(",")[0]) < 5)).toBe(true);
    expect([...cells].some((key) => Number(key.split(",")[0]) >= 30)).toBe(true);
    expect([...cells].some((key) => Number(key.split(",")[1]) >= 19)).toBe(true);
    expect(new Set(recording.events.filter((e) => e.kind === "animal_moved")
      .map((e) => `${e.data.x},${e.data.y}`)).size).toBeGreaterThanOrEqual(4);
    for (let day = 1; day <= 90; day++) for (const id of ["S", "F", "C", "B1", "B2"])
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
        .toBe(true);
  }, 60000);
});
