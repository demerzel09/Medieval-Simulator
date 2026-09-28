import type { VillageFixture } from "./autonomous-village";
import { spatialLandEconomy90V1 } from "./land-economy-spatial";

/** Distributed 40×24 economy; movement crosses many cells per world hour. */
export const wideLandEconomy90V1: VillageFixture = {
  ...structuredClone(spatialLandEconomy90V1),
  landEconomy: { ...spatialLandEconomy90V1.landEconomy!, wideWorld: true },
};
