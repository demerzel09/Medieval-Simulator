import { autonomousVillageV1, type VillageFixture } from "./autonomous-village";

export type LandEconomyFixture = { schemaVersion: 1; days: 90; world: VillageFixture;
  plots: number; initialSeeds: number; farmerGrainSkill: 1 | 2;
  crop: { yield: number; growthDays: number; tillHours: number; sowHours: number; harvestHours: number };
  fieldRoundTripHours: number; tenderHours: number; restHours: number; farmerBagMass: number };

/** Versioned accounting proposal. This is not an accepted autonomous world fixture. */
export const landEconomy90V1: LandEconomyFixture = {
  schemaVersion: 1,
  days: 90,
  world: {
    ...structuredClone(autonomousVillageV1),
    resources: { ...structuredClone(autonomousVillageV1.resources),
      food: { initial: 20, capacity: 20, growthPerDay: 0 } },
    body: { initialEnergy: 20, maxEnergy: 20 },
    landEconomy: { grainPlots: 4, initialSeeds: 4, farmerGrainSkill: 2 },
  },
  plots: 4,
  initialSeeds: 4,
  farmerGrainSkill: 2,
  crop: { yield: 5, growthDays: 3, tillHours: 1, sowHours: 1, harvestHours: 1 },
  fieldRoundTripHours: 2,
  tenderHours: 1,
  restHours: 8,
  farmerBagMass: 8,
};
