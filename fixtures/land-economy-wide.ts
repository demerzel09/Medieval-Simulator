import type { VillageFixture } from "./autonomous-village";
import { spatialLandEconomy90V1 } from "./land-economy-spatial";

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
