import { autonomous90FeasibilityV1, type FeasibilityFixture } from "./autonomous-90";

export type VillageFixture = FeasibilityFixture & { informationDelayHours: number;
  landEconomy?: { grainPlots: number; initialSeeds: number; farmerGrainSkill: number;
    spatialGrid?: true; wideWorld?: true } };

/** Execution fixture v1. Physical timing needs F's 4-coin float and an energy reserve. */
export const autonomousVillageV1: VillageFixture = {
  ...autonomous90FeasibilityV1,
  initialCash: { ...autonomous90FeasibilityV1.initialCash, F: 4 },
  body: { initialEnergy: 16, maxEnergy: 20 },
  informationDelayHours: 1,
};
