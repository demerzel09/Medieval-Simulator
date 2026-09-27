import { findGridPath, sameCell, traversable, type GridMap, type GridPoint } from "./grid-path";

export type PlantSpecies = "wild_berry" | "grain" | "fruit_tree" | "herb" | "grass";
export type PlantStage = "bare" | "tilled" | "seeded" | "growing" | "ripe" | "regrowing";
export type PlantPatch = { id: string; species: PlantSpecies; siteId: string; cell: GridPoint;
  stage: PlantStage; ageHours: number; available: number; capacity: number;
  growHours: number; growthQuantity: number; initialAvailable: number; grown: number;
  personHarvested: number; animalEaten: number };
export type WildAnimal = { id: string; species: "rabbit"; cell: GridPoint; ageHours: number;
  lifeStage: "juvenile" | "adult"; hunger: number; diet: PlantSpecies[];
  senseRange: number; lastMealHour: number };
export type LandEcology = { plants: Record<string, PlantPatch>; animals: Record<string, WildAnimal> };
export type EcologyEffect = { kind: "plant_stage" | "plant_grew" | "animal_moved" |
  "animal_ate" | "animal_grew"; plantId?: string; animalId?: string;
  x?: number; y?: number; quantity?: number; stage?: string };

export function newLandEcology(grid: GridMap, wildFood: number, wildCapacity: number): LandEcology {
  const patch = (id: string, species: PlantSpecies, siteId: string, stage: PlantStage,
    available: number, capacity: number, growHours: number, growthQuantity: number): PlantPatch => ({
    id, species, siteId, cell: structuredClone(grid.sites[siteId]), stage, ageHours: 0,
    available, capacity, growHours, growthQuantity, initialAvailable: available,
    grown: 0, personHarvested: 0, animalEaten: 0 });
  return { plants: {
    wild_berry: patch("wild_berry", "wild_berry", "grove", "ripe", wildFood, wildCapacity, 24, 5),
    grain_plot: patch("grain_plot", "grain", "field", "bare", 0, 5, 72, 5),
    orchard: patch("orchard", "fruit_tree", "meadow", "ripe", 2, 4, 48, 2),
    herb_patch: patch("herb_patch", "herb", "grove", "ripe", 2, 3, 24, 1),
    grass_patch: patch("grass_patch", "grass", "meadow", "ripe", 3, 3, 24, 3),
  }, animals: { rabbit_1: { id: "rabbit_1", species: "rabbit",
    cell: structuredClone(grid.sites.meadow), ageHours: 0, lifeStage: "juvenile",
    hunger: 1, diet: ["grass", "herb"], senseRange: 2, lastMealHour: 0 } } };
}

export function advanceLandHour(ecology: LandEcology, grid: GridMap, hour: number): EcologyEffect[] {
  const effects: EcologyEffect[] = [];
  for (const p of Object.values(ecology.plants)) {
    if (p.species === "wild_berry") continue; // Mirrored by the legacy resource budget.
    if (p.species === "grain") {
      if (p.stage === "seeded") { p.stage = "growing"; p.ageHours = 0;
        effects.push({ kind: "plant_stage", plantId: p.id, stage: p.stage }); }
      else if (p.stage === "growing") {
        p.ageHours++;
        if (p.ageHours >= p.growHours) {
          p.stage = "ripe"; p.available = p.growthQuantity; p.grown += p.growthQuantity;
          effects.push({ kind: "plant_grew", plantId: p.id, quantity: p.growthQuantity, stage: p.stage });
        }
      }
      continue;
    }
    if (p.available < p.capacity) p.ageHours++;
    if (p.ageHours >= p.growHours && p.available < p.capacity) {
      const amount = Math.min(p.growthQuantity, p.capacity - p.available);
      p.available += amount; p.grown += amount; p.ageHours = 0;
      p.stage = "ripe";
      effects.push({ kind: "plant_grew", plantId: p.id, quantity: amount, stage: p.stage });
    }
  }
  for (const animal of Object.values(ecology.animals).sort((a, b) => a.id.localeCompare(b.id))) {
    animal.ageHours++;
    if (animal.lifeStage === "juvenile" && animal.ageHours >= 72) {
      animal.lifeStage = "adult";
      effects.push({ kind: "animal_grew", animalId: animal.id, stage: animal.lifeStage });
    }
    if (hour > 1 && (hour - 1) % 24 === 0) animal.hunger++;
    if (animal.hunger < 1) continue;
    const candidates = Object.values(ecology.plants).filter((p) => animal.diet.includes(p.species) &&
      p.available > 0 && Math.max(Math.abs(p.cell.x - animal.cell.x),
        Math.abs(p.cell.y - animal.cell.y)) <= animal.senseRange)
      .map((p) => ({ p, path: findGridPath(grid, animal.cell, p.cell) }))
      .filter((entry): entry is { p: PlantPatch; path: GridPoint[] } => !!entry.path)
      .sort((a, b) => a.path.length - b.path.length || a.p.id.localeCompare(b.p.id));
    const target = candidates[0];
    if (!target) continue;
    if (!sameCell(animal.cell, target.p.cell)) {
      animal.cell = structuredClone(target.path[1]);
      effects.push({ kind: "animal_moved", animalId: animal.id,
        x: animal.cell.x, y: animal.cell.y });
    }
    if (sameCell(animal.cell, target.p.cell) && animal.hunger > 0 && target.p.available > 0) {
      target.p.available--; target.p.animalEaten++; animal.hunger--; animal.lastMealHour = hour;
      if (!target.p.available) target.p.stage = "regrowing";
      effects.push({ kind: "animal_ate", animalId: animal.id, plantId: target.p.id, quantity: 1 });
    }
  }
  return effects;
}
export function checkLandEcology(ecology: LandEcology, grid: GridMap) {
  for (const p of Object.values(ecology.plants)) if (p.id !== ecology.plants[p.id]?.id ||
    !grid.sites[p.siteId] || !sameCell(p.cell, grid.sites[p.siteId]) ||
    !Number.isSafeInteger(p.available) || p.available < 0 || p.available > p.capacity ||
    p.available !== p.initialAvailable + p.grown - p.personHarvested - p.animalEaten ||
    p.ageHours < 0 || !Number.isSafeInteger(p.ageHours)) throw Error("invalid plant patch");
  for (const a of Object.values(ecology.animals)) if (a.id !== ecology.animals[a.id]?.id ||
    !traversable(grid, a.cell) ||
    !Number.isSafeInteger(a.ageHours) || a.ageHours < 0 ||
    !Number.isSafeInteger(a.hunger) || a.hunger < 0 ||
    !Number.isSafeInteger(a.senseRange) || a.senseRange < 0) throw Error("invalid wild animal");
  if (Object.keys(ecology.plants).some((id) => !ecology.plants[id]) ||
    Object.keys(ecology.animals).some((id) => !ecology.animals[id])) throw Error("invalid ecology keys");
}
