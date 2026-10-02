import { autonomous90FeasibilityV1, type FeasibilityFixture } from "./autonomous-90";

export type VillageFixture = FeasibilityFixture & { informationDelayHours: number; predictionLedger?: true; needs?: import("../packages/sim/needs-body").NeedsConfig; woodEnabled?: false; grainNonperishable?: true; publicForaging?: true; spatialForaging?: true; breadEconomy?: { bakeHours: number; shelfLifeDays: number; storageCapacity: number };
  homeStorage?: { capacity: number };
  foodMarket?: { initialBakingSkills: Record<"S" | "F" | "C" | "B1" | "B2", number>;
    grainBatchQuantity: number; grainBatchPrice: number; breadPrice: number };
  landEconomy?: { grainPlots: number; initialSeeds: number; farmerGrainSkill: number;
    spatialGrid?: true; wideWorld?: true; exploreWildPlants?: true; physicalGrowth?: true;
    farms?: { id: string; ownerId: "F" | "B1" | "B2"; siteId: string; plotIds: string[];
      initialSeeds: number }[] } };

/** Execution fixture v1. Physical timing needs F's 4-coin float and an energy reserve. */
export const autonomousVillageV1: VillageFixture = {
  ...autonomous90FeasibilityV1,
  initialCash: { ...autonomous90FeasibilityV1.initialCash, F: 4 },
  body: { initialEnergy: 16, maxEnergy: 20 },
  informationDelayHours: 1,
};
