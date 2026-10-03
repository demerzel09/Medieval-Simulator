import type { VillageFixture } from "./autonomous-village";
import { spatialLandEconomy90V1 } from "./land-economy-spatial";
import { defaultEffortConfig } from "../packages/sim/effort-body";

/** Distributed 40×24 economy; movement crosses many cells per world hour. */
export const wideLandEconomy90V1: VillageFixture = {
  ...structuredClone(spatialLandEconomy90V1),
  landEconomy: { ...spatialLandEconomy90V1.landEconomy!, wideWorld: true },
};

/** Search and wild-plant gathering are opt-in to preserve the wide-world archive. */
export const exploringLandEconomy90V1: VillageFixture = {
  ...structuredClone(wideLandEconomy90V1),
  landEconomy: { ...wideLandEconomy90V1.landEconomy!, exploreWildPlants: true },
};

/** Physical regrowth, distributed berry stands and crop fallow in a separate replay ruleset. */
export const ecologicalLandEconomy90V1: VillageFixture = {
  ...structuredClone(exploringLandEconomy90V1),
  landEconomy: { ...exploringLandEconomy90V1.landEconomy!, grainPlots: 12,
    initialSeeds: 12, physicalGrowth: true },
};

/** Wood suspension control: no replacement income or synthetic food funding. */
export const woodPausedLandEconomy90V1: VillageFixture = {
  ...structuredClone(ecologicalLandEconomy90V1),
  woodEnabled: false,
  resources: { ...structuredClone(ecologicalLandEconomy90V1.resources),
    wood: { initial: 0, capacity: 0, growthPerDay: 0 } },
  woodPerPersonPerDay: 0,
};

/** Independent farm owners; grain keeps indefinitely and there are no employees. */
export const ownedFarms90V1: VillageFixture = {
  ...structuredClone(woodPausedLandEconomy90V1),
  grainNonperishable: true,
  landEconomy: { ...woodPausedLandEconomy90V1.landEconomy!, farms: [
    { id: "farm_F", ownerId: "F", siteId: "field", initialSeeds: 4,
      plotIds: ["grain_plot", "grain_plot_2", "grain_plot_3", "grain_plot_4"] },
    { id: "farm_B1", ownerId: "B1", siteId: "field_B1", initialSeeds: 4,
      plotIds: ["grain_plot_5", "grain_plot_6", "grain_plot_7", "grain_plot_8"] },
    { id: "farm_B2", ownerId: "B2", siteId: "field_B2", initialSeeds: 4,
      plotIds: ["grain_plot_9", "grain_plot_10", "grain_plot_11", "grain_plot_12"] },
  ] },
};

/** Wild food can be gathered without money and surplus can be offered in person. */
export const wildFoodMarket90V1: VillageFixture = {
  ...structuredClone(ownedFarms90V1), publicForaging: true,
};

/** Harvest work takes place at the plant cell, with no automatic trip back to a label. */
export const localWork90V1: VillageFixture = {
  ...structuredClone(wildFoodMarket90V1), spatialForaging: true,
};

/** Grain is a stored ingredient; only bread and gathered wild foods are edible. */
export const breadStorage90V1: VillageFixture = {
  ...structuredClone(localWork90V1),
  breadEconomy: { bakeHours: 2, shelfLifeDays: 3, storageCapacity: 128 },
};

/** Needs-driven body and experience-based anticipation, preserving all earlier archives. */
export const anticipatoryNeeds90V1: VillageFixture = {
  ...structuredClone(breadStorage90V1),
  needs: { dayTemperature: 22, nightTemperature: 8, homeInsulation: 10,
    comfortableTemperature: 16, initialSleepDebt: 4, initialMealHours: 18 },
};

/** Explicit pre-action travel forecasts and delivered outcomes, in a separate ruleset. */
export const predictionLedger90V1: VillageFixture = {
  ...structuredClone(anticipatoryNeeds90V1), predictionLedger: true,
};

/** Farmers sell raw grain; initially S alone has the skill to bake at the market. */
export const foodMarket90V1: VillageFixture = {
  ...structuredClone(predictionLedger90V1),
  foodMarket: { initialBakingSkills: { S: 1, F: 0, C: 0, B1: 0, B2: 0 },
    grainBatchQuantity: 5, grainBatchPrice: 2, breadPrice: 1 },
};

/** Physical home storage and exact replay status for people and possessions. */
export const homeStorage90V1: VillageFixture = {
  ...structuredClone(foodMarket90V1), homeStorage: { capacity: 40 },
};

/** Grain is one material for sowing/processing; harvests stay at the field until physically loaded. */
export const bulkTransport90V1: VillageFixture = {
  ...structuredClone(homeStorage90V1),
  bulkTransport: { grainYield: 20, grainUnitMass: 2, baseMoveTicks: 10, fatigueMass: 8 },
};

/** Actual meal time and matched experience for effort, recovery and purposeful transport. */
export const experienceLearning90V1: VillageFixture = { ...structuredClone(bulkTransport90V1), experienceLearning: true };

/** Preserve cultivation intent and observed market visit outcomes across shelter interruptions. */
export const foodJourneys90V1: VillageFixture = { ...structuredClone(experienceLearning90V1), foodJourneys: true };

/** Compare food acquisition with the next meal, shelter and sleep; observe local gathering work. */
export const foodPlanning90V1: VillageFixture = { ...structuredClone(foodJourneys90V1), foodPlanning: true };

/** v20 changes sleep physiology only; resources, money, crops and transport inherit v19. */
export const sleepRegulation90V1: VillageFixture = { ...structuredClone(foodPlanning90V1),
  sleepRegulation: { version: 1, requiredMinutes: 360, wakeTauMinutes: 1080, sleepTauMinutes: 180,
    initialPressure: 90031, initialHistory: [{ from: -1440, to: -360, quality: 0 }, { from: -360, to: 0, quality: 1000 }] } };

/** v21 repairs material offers and binds the explicitly selected sowing lot. */
export const offerIntegrity90V1: VillageFixture = { ...structuredClone(sleepRegulation90V1), offerIntegrity: true };
/** v22 separates dietary supply, activity fatigue, present effort and delayed outcomes. */
export const energyEffort90V1: VillageFixture = { ...structuredClone(offerIntegrity90V1), effortBody: { ...defaultEffortConfig } };
/** v23 keeps v22 choices and adds terminal death at zero activity capacity. */
export const mortality90V1: VillageFixture = { ...structuredClone(energyEffort90V1), deathOnZeroEnergy: true };
