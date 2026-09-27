import { landEconomy90V1 } from "./land-economy-90";
import type { VillageFixture } from "./autonomous-village";

/** 40×24-cell execution fixture. Extra daily walking requires a larger rest recovery. */
export const spatialLandEconomy90V1: VillageFixture = {
  ...structuredClone(landEconomy90V1.world),
  body: { initialEnergy: 26, maxEnergy: 26 },
  restEnergyGain: 14,
  landEconomy: { ...landEconomy90V1.world.landEconomy!, spatialGrid: true },
};
