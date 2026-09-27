import { describe, expect, it } from "vitest";
import { landEconomy90V1 } from "../fixtures/land-economy-90";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld,
  queueVillageCommand } from "../packages/sim/autonomous-world";
import { defaultVillageGrid } from "../packages/sim/grid-path";
import { advanceLandHour, checkLandEcology, newLandEcology } from "../packages/sim/land-ecology";
import { siteOf } from "../packages/sim/physical";

const idle: VillageModel = { decide(input) { return { attempts: [],
  wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState }; } };
const fixture = () => structuredClone(landEconomy90V1.world);

describe("land economy ecology and shared roads", () => {
  it("passes fruit through regrowth and flowering before new fruit appears", () => {
    const w = newVillageWorld(24, fixture());
    queueVillageCommand(w, { id: "to-orchard", actorId: "F", at: 1,
      attempt: { kind: "travel", siteId: "meadow" } });
    queueVillageCommand(w, { id: "pick-fruit", actorId: "F", at: 2,
      attempt: { kind: "gather_plant", plantId: "orchard", quantity: 2 } });
    advanceVillageWorld(w, 5, idle);
    expect(w.land.plants.orchard).toMatchObject({ available: 0, stage: "regrowing",
      personHarvested: 2 });
    advanceVillageWorld(w, 80, idle);
    expect(w.events.some((e) => e.kind === "plant_stage" && e.data.plantId === "orchard" &&
      e.data.stage === "flowering")).toBe(true);
    expect(w.land.plants.orchard.available).toBe(2);
    checkVillageWorld(w);
  });

  it("records seasons, births, old age and starvation with population conservation", () => {
    const grid = defaultVillageGrid();
    const land = newLandEcology(grid, 20, 20, 4);
    let seasonEvents = 0;
    for (let hour = 1; hour <= 61 * 24; hour++)
      seasonEvents += advanceLandHour(land, grid, hour).filter((e) => e.kind === "season_changed").length;
    expect(seasonEvents).toBe(2);
    expect(land.season).toBe("autumn");
    expect(land.animalBirths).toBeGreaterThan(0);
    expect(land.animalDeaths).toBeGreaterThan(0);
    checkLandEcology(land, grid);

    const depleted = newLandEcology(grid, 20, 20, 4);
    for (const plant of Object.values(depleted.plants)) if (["grass", "herb"].includes(plant.species)) {
      plant.available = 0; plant.initialAvailable = 0; plant.growthQuantity = 0;
      plant.stage = "regrowing";
    }
    const w = newVillageWorld(31, fixture(), grid, depleted);
    advanceVillageWorld(w, 4 * 24, idle);
    expect(Object.keys(w.land.animals)).toHaveLength(0);
    expect(w.land.animalDeaths).toBe(2);
    expect(w.events.filter((e) => e.kind === "animal_died" &&
      e.data.stage === "starvation")).toHaveLength(2);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "animal")).toHaveLength(0);
    checkVillageWorld(w);
  });

  it("slows herbs and pauses fruiting during winter", () => {
    const grid = defaultVillageGrid(), land = newLandEcology(grid, 20, 20, 4);
    land.season = "winter";
    land.animals = {}; land.initialAnimals = 0;
    const herb = land.plants.herb_patch, tree = land.plants.orchard;
    herb.available = 0; herb.initialAvailable = 0; herb.stage = "regrowing";
    tree.available = 0; tree.initialAvailable = 0; tree.stage = "flowering";
    for (let hour = 1; hour <= 24; hour++) advanceLandHour(land, grid, hour);
    expect(herb.available).toBe(0);
    expect(tree.available).toBe(0);
    for (let hour = 25; hour <= 48; hour++) advanceLandHour(land, grid, hour);
    expect(herb.available).toBe(1);
    expect(tree.available).toBe(0);
    checkLandEcology(land, grid);
  });

  it("reroutes simultaneous travellers around a person on a non-site road cell", () => {
    const grid = defaultVillageGrid();
    grid.height = 4;
    grid.sites = { market: { x: 4, y: 1 }, grove: { x: 0, y: 1 },
      field: { x: 1, y: 3 }, meadow: { x: 4, y: 3 },
      home_B1: { x: 0, y: 0 }, home_B2: { x: 4, y: 0 } };
    const w = newVillageWorld(44, fixture(), grid);
    queueVillageCommand(w, { id: "F-crosses", actorId: "F", at: 1,
      attempt: { kind: "travel", siteId: "market" } });
    queueVillageCommand(w, { id: "C-crosses", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "grove" } });
    for (let hour = 1; hour <= 8; hour++) {
      advanceVillageWorld(w, 1, idle);
      const road = ["F", "C"].filter((id) => siteOf(w.physical, id).startsWith("transit_"))
        .map((id) => `${w.people[id as "F" | "C"].cell.x},${w.people[id as "F" | "C"].cell.y}`)
        .filter((cell) => !Object.values(grid.sites).some((s) => `${s.x},${s.y}` === cell));
      expect(new Set(road).size).toBe(road.length);
    }
    expect(w.events.some((e) => e.kind === "travel_replanned" &&
      e.data.reason === "occupied road cell")).toBe(true);
    checkVillageWorld(w);
  });
});
