import { findGridPath, findGridPathV2, sameCell, traversable,
  type GridMap, type GridPoint } from "./grid-path";

export type PlantSpecies = "wild_berry" | "grain" | "fruit_tree" | "herb" | "grass";
export type PlantStage = "bare" | "tilled" | "seeded" | "growing" | "ripe" | "regrowing" |
  "flowering" | "fallow";
export type PlantPatch = { id: string; species: PlantSpecies; siteId: string; cell: GridPoint;
  stage: PlantStage; ageHours: number; available: number; capacity: number;
  growHours: number; growthQuantity: number; initialAvailable: number; grown: number;
  fallowHours?: number; ownerId?: string; farmId?: string;
  personHarvested: number; animalEaten: number; useRightHolderId?: string };
export type WildAnimal = { id: string; species: "rabbit"; cell: GridPoint; ageHours: number;
  lifeStage: "juvenile" | "adult"; hunger: number; diet: PlantSpecies[];
  senseRange: number; lastMealHour: number; sex?: "female" | "male"; lastBirthHour?: number };
export type LandEcology = { plants: Record<string, PlantPatch>; animals: Record<string, WildAnimal>;
  rulesetVersion?: 2 | 3; season?: "spring" | "summer" | "autumn" | "winter";
  initialAnimals?: number; animalBirths?: number; animalDeaths?: number; nextAnimalNumber?: number };
export type EcologyEffect = { kind: "plant_stage" | "plant_grew" | "animal_moved" |
  "animal_ate" | "animal_grew" | "animal_born" | "animal_died" | "season_changed";
  plantId?: string; animalId?: string; parentAnimalId?: string;
  x?: number; y?: number; quantity?: number; stage?: string };

export function newLandEcology(grid: GridMap, wildFood: number, wildCapacity: number,
  grainPlots = 1, ecologyV2 = grainPlots > 1, wideWorld = false,
  physicalGrowth = false): LandEcology {
  const patch = (id: string, species: PlantSpecies, siteId: string, stage: PlantStage,
    available: number, capacity: number, growHours: number, growthQuantity: number): PlantPatch => ({
    id, species, siteId, cell: structuredClone(grid.sites[siteId]), stage, ageHours: 0,
    available, capacity, growHours, growthQuantity, initialAvailable: available,
    grown: 0, personHarvested: 0, animalEaten: 0 });
  const plants: LandEcology["plants"] = {
    wild_berry: patch("wild_berry", "wild_berry", "grove", "ripe", wildFood, wildCapacity, 24, 5),
    grain_plot: patch("grain_plot", "grain", "field", "bare", 0, 5, 72, 5),
    orchard: patch("orchard", "fruit_tree", grid.sites.orchard ? "orchard" : "meadow",
      "ripe", 2, 4, 48, 2),
    herb_patch: patch("herb_patch", "herb", grid.sites.herb_patch ? "herb_patch" : "grove",
      "ripe", 2, 3, 24, 1),
    grass_patch: patch("grass_patch", "grass", grid.sites.grass_patch ? "grass_patch" : "meadow",
      "ripe", 3, 3, 24, 3),
  };
  if (grid.sites.herb_patch_2) plants.herb_patch_2 =
    patch("herb_patch_2", "herb", "herb_patch_2", "ripe", 2, 3, 24, 1);
  if (grid.sites.orchard_2) plants.orchard_2 =
    patch("orchard_2", "fruit_tree", "orchard_2", "ripe", 2, 4, 48, 2);
  if (physicalGrowth) {
    const berrySites = [1, 2, 3, 4].map((i) => `berry_patch_${i}`);
    if (berrySites.some((id) => !grid.sites[id]) || wildFood !== 20 || wildCapacity !== 20)
      throw Error("physical berry fixture requires four five-fruit stands");
    delete plants.wild_berry;
    berrySites.forEach((siteId, i) => {
      const id = i ? `wild_berry_${i + 1}` : "wild_berry";
      plants[id] = patch(id, "wild_berry", siteId, "ripe", 5, 5, 7 * 24, 5);
    });
    for (let i = 3; i <= 8; i++) {
      const id = `herb_patch_${i}`;
      plants[id] = patch(id, "herb", id, "ripe", 3, 3, 4 * 24, 3);
    }
    for (let i = 2; i <= 10; i++) {
      const id = `grass_patch_${i}`;
      plants[id] = patch(id, "grass", id, "ripe", 3, 3, 24, 3);
    }
    for (const p of Object.values(plants)) {
      if (p.species === "grain") continue;
      if (p.species === "herb") {
        p.capacity = 3; p.available = 3; p.initialAvailable = 3;
        p.growthQuantity = 3; p.growHours = 4 * 24;
      } else if (p.species === "fruit_tree") {
        p.capacity = 4; p.available = 4; p.initialAvailable = 4;
        p.growthQuantity = 4; p.growHours = 3 * 24;
      } else if (p.species === "grass") {
        p.capacity = 3; p.available = 3; p.initialAvailable = 3;
        p.growthQuantity = 3; p.growHours = 24;
      }
    }
  }
  for (let i = 1; i <= grainPlots; i++) {
    const id = i === 1 ? "grain_plot" : `grain_plot_${i}`;
    if (i > 1) plants[id] = patch(id, "grain", grid.sites[id] ? id : "field", "bare", 0, 5, 72, 5);
    if (i === 1 && grid.sites[id]) {
      plants[id].siteId = id;
      plants[id].cell = structuredClone(grid.sites[id]);
    }
    if (ecologyV2) plants[id].useRightHolderId = "F";
    if (physicalGrowth) {
      plants[id].growHours = 6 * 24;
      plants[id].fallowHours = 3 * 24;
    }
  }
  if (physicalGrowth) for (let i = 9; i <= 12; i++) {
    const crop = plants[`grain_plot_${i}`];
    crop.stage = "growing";
    crop.ageHours = 3 * 24; // Four pre-existing crops bridge the first longer sowing cycle.
  }
  const ecology: LandEcology = { plants, animals: { rabbit_1: { id: "rabbit_1", species: "rabbit",
    cell: structuredClone(grid.sites.meadow), ageHours: 0, lifeStage: "juvenile",
    hunger: 1, diet: ["grass", "herb"], senseRange: wideWorld ? 6 : 2, lastMealHour: 0 } } };
  if (ecologyV2) {
    ecology.rulesetVersion = physicalGrowth ? 3 : 2; ecology.season = "spring";
    ecology.initialAnimals = 2; ecology.animalBirths = 0; ecology.animalDeaths = 0;
    ecology.nextAnimalNumber = 3;
    ecology.animals.rabbit_1.sex = "female";
    ecology.animals.rabbit_1.lastBirthHour = 0;
    ecology.animals.rabbit_2 = { id: "rabbit_2", species: "rabbit",
      cell: structuredClone(grid.sites.meadow), ageHours: 72, lifeStage: "adult",
      hunger: 1, diet: ["grass", "herb"], senseRange: wideWorld ? 6 : 2, lastMealHour: 0,
      sex: "male", lastBirthHour: 0 };
  }
  return ecology;
}

export function advanceLandHour(ecology: LandEcology, grid: GridMap, hour: number): EcologyEffect[] {
  const effects: EcologyEffect[] = [];
  if (ecology.rulesetVersion && hour > 1 && (hour - 1) % (30 * 24) === 0) {
    const seasons = ["spring", "summer", "autumn", "winter"] as const;
    ecology.season = seasons[Math.floor((hour - 1) / (30 * 24)) % seasons.length];
    effects.push({ kind: "season_changed", stage: ecology.season });
  }
  for (const p of Object.values(ecology.plants)) {
    if (ecology.rulesetVersion === 3) {
      if (p.species === "grain") {
        if (p.stage === "fallow") {
          if (++p.ageHours >= p.fallowHours!) {
            p.stage = "bare"; p.ageHours = 0;
            effects.push({ kind: "plant_stage", plantId: p.id, stage: p.stage });
          }
        } else if (p.stage === "seeded") {
          p.stage = "growing"; p.ageHours = 0;
          effects.push({ kind: "plant_stage", plantId: p.id, stage: p.stage });
        } else if (p.stage === "growing" && ++p.ageHours >= p.growHours) {
          p.stage = "ripe"; p.available = p.growthQuantity; p.grown += p.growthQuantity;
          effects.push({ kind: "plant_grew", plantId: p.id, quantity: p.growthQuantity,
            stage: p.stage });
        }
      } else if (p.stage === "regrowing" && ++p.ageHours >= p.growHours) {
        p.ageHours = 0;
        if (p.species === "fruit_tree") {
          p.stage = "flowering";
          effects.push({ kind: "plant_stage", plantId: p.id, stage: p.stage });
        } else {
          const amount = p.capacity - p.available;
          p.available += amount; p.grown += amount; p.stage = "ripe";
          effects.push({ kind: "plant_grew", plantId: p.id, quantity: amount, stage: p.stage });
        }
      } else if (p.stage === "flowering" && ++p.ageHours >= 24) {
        const amount = p.capacity - p.available;
        p.available += amount; p.grown += amount; p.stage = "ripe"; p.ageHours = 0;
        effects.push({ kind: "plant_grew", plantId: p.id, quantity: amount, stage: p.stage });
      }
      continue;
    }
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
    if (ecology.rulesetVersion === 2 && p.species === "fruit_tree" && p.stage === "regrowing") {
      p.ageHours++;
      if (p.ageHours >= 24) {
        p.stage = "flowering"; p.ageHours = 0;
        effects.push({ kind: "plant_stage", plantId: p.id, stage: p.stage });
      }
      continue;
    }
    if (ecology.rulesetVersion === 2 && p.species === "fruit_tree" &&
      ecology.season === "winter") continue;
    if (p.available < p.capacity) p.ageHours++;
    const growHours = ecology.rulesetVersion === 2 && ecology.season === "winter" ?
      p.growHours * 2 : p.growHours;
    if (p.ageHours >= growHours && p.available < p.capacity) {
      const amount = Math.min(p.growthQuantity, p.capacity - p.available);
      p.ageHours = 0;
      if (amount > 0) {
        p.available += amount; p.grown += amount; p.stage = "ripe";
        effects.push({ kind: "plant_grew", plantId: p.id, quantity: amount, stage: p.stage });
      }
    }
  }
  for (const animal of Object.values(ecology.animals).sort((a, b) => a.id.localeCompare(b.id))) {
    animal.ageHours++;
    if (ecology.rulesetVersion && animal.ageHours >=
      (ecology.rulesetVersion === 3 ? 45 : 30) * 24) {
      delete ecology.animals[animal.id]; ecology.animalDeaths!++;
      effects.push({ kind: "animal_died", animalId: animal.id,
        x: animal.cell.x, y: animal.cell.y, stage: "old_age" });
      continue;
    }
    if (animal.lifeStage === "juvenile" && animal.ageHours >= 72) {
      animal.lifeStage = "adult";
      effects.push({ kind: "animal_grew", animalId: animal.id, stage: animal.lifeStage });
    }
    if (hour > 1 && (hour - 1) % 24 === 0) animal.hunger++;
    if (animal.hunger >= 1) {
      const candidates = Object.values(ecology.plants).filter((p) => animal.diet.includes(p.species) &&
      p.available > 0 && (ecology.rulesetVersion !== 3 || p.stage === "ripe") &&
      Math.max(Math.abs(p.cell.x - animal.cell.x),
        Math.abs(p.cell.y - animal.cell.y)) <= animal.senseRange)
      .map((p) => ({ p, path: (ecology.rulesetVersion === 3 ? findGridPathV2 : findGridPath)
        (grid, animal.cell, p.cell) }))
      .filter((entry): entry is { p: PlantPatch; path: GridPoint[] } => !!entry.path)
      .sort((a, b) => a.path.length - b.path.length || a.p.id.localeCompare(b.p.id));
      const target = candidates[0];
      if (target) {
        if (!sameCell(animal.cell, target.p.cell)) {
          animal.cell = structuredClone(target.path[1]);
          effects.push({ kind: "animal_moved", animalId: animal.id,
            x: animal.cell.x, y: animal.cell.y });
        }
        if (sameCell(animal.cell, target.p.cell) && animal.hunger > 0 && target.p.available > 0) {
          target.p.available--; target.p.animalEaten++; animal.hunger--; animal.lastMealHour = hour;
          if (ecology.rulesetVersion === 3) {
            target.p.stage = "regrowing"; target.p.ageHours = 0;
          } else if (!target.p.available) target.p.stage = "regrowing";
          effects.push({ kind: "animal_ate", animalId: animal.id, plantId: target.p.id, quantity: 1 });
        }
      }
    }
    if (ecology.rulesetVersion && animal.hunger >= 3) {
      delete ecology.animals[animal.id]; ecology.animalDeaths!++;
      effects.push({ kind: "animal_died", animalId: animal.id,
        x: animal.cell.x, y: animal.cell.y, stage: "starvation" });
      continue;
    }
    if (ecology.rulesetVersion && animal.sex === "female" &&
      animal.lifeStage === "adult" && animal.hunger === 0 && animal.ageHours >= 7 * 24 &&
      hour - (animal.lastBirthHour ?? 0) >= 14 * 24 &&
      Object.values(ecology.animals).some((mate) => mate.id !== animal.id &&
        mate.sex === "male" && mate.lifeStage === "adult" && mate.hunger === 0 &&
        Math.max(Math.abs(mate.cell.x - animal.cell.x),
          Math.abs(mate.cell.y - animal.cell.y)) <= 2)) {
      const id = `rabbit_${ecology.nextAnimalNumber!++}`;
      ecology.animals[id] = { id, species: "rabbit", cell: structuredClone(animal.cell),
        ageHours: 0, lifeStage: "juvenile", hunger: 1, diet: ["grass", "herb"],
        senseRange: 2, lastMealHour: hour,
        sex: ecology.nextAnimalNumber! % 2 ? "female" : "male", lastBirthHour: hour };
      ecology.animalBirths!++; animal.lastBirthHour = hour;
      effects.push({ kind: "animal_born", animalId: id, parentAnimalId: animal.id,
        x: animal.cell.x, y: animal.cell.y });
    }
  }
  return effects;
}
export function checkLandEcology(ecology: LandEcology, grid: GridMap) {
  if (ecology.rulesetVersion && (!ecology.season ||
    !["spring", "summer", "autumn", "winter"].includes(ecology.season) ||
    !Number.isSafeInteger(ecology.initialAnimals) || !Number.isSafeInteger(ecology.animalBirths) ||
    !Number.isSafeInteger(ecology.animalDeaths) || !Number.isSafeInteger(ecology.nextAnimalNumber) ||
    ecology.animalBirths! < 0 || ecology.animalDeaths! < 0 ||
    Object.keys(ecology.animals).length !== ecology.initialAnimals! +
      ecology.animalBirths! - ecology.animalDeaths!)) throw Error("invalid ecology population");
  for (const p of Object.values(ecology.plants)) if (p.id !== ecology.plants[p.id]?.id ||
    !grid.sites[p.siteId] || !sameCell(p.cell, grid.sites[p.siteId]) ||
    p.useRightHolderId !== undefined && !p.useRightHolderId ||
    !Number.isSafeInteger(p.available) || p.available < 0 || p.available > p.capacity ||
    p.available !== p.initialAvailable + p.grown - p.personHarvested - p.animalEaten ||
    p.ageHours < 0 || !Number.isSafeInteger(p.ageHours) ||
    p.fallowHours !== undefined && (!Number.isSafeInteger(p.fallowHours) || p.fallowHours < 1) ||
    p.stage === "fallow" && (!p.fallowHours || p.species !== "grain"))
    throw Error("invalid plant patch");
  for (const a of Object.values(ecology.animals)) if (a.id !== ecology.animals[a.id]?.id ||
    !traversable(grid, a.cell) ||
    !Number.isSafeInteger(a.ageHours) || a.ageHours < 0 ||
    !Number.isSafeInteger(a.hunger) || a.hunger < 0 ||
    !Number.isSafeInteger(a.senseRange) || a.senseRange < 0) throw Error("invalid wild animal");
  if (Object.keys(ecology.plants).some((id) => !ecology.plants[id]) ||
    Object.keys(ecology.animals).some((id) => !ecology.animals[id])) throw Error("invalid ecology keys");
}
