/** Accounting assumptions for the next world fixture, not a simulation outcome. */
export type FeasibilityActor = "S" | "F" | "C" | "B1" | "B2";
export type FeasibilityFixture = {
  schemaVersion: 1;
  days: number;
  initialCash: Record<FeasibilityActor, number>;
  resources: { food: { initial: number; growthPerDay: number; capacity: number };
    wood: { initial: number; growthPerDay: number; capacity: number } };
  prices: { foodBid: number; foodRetail: number; carrierFee: number; wood: number };
  foodPerPersonPerDay: number;
  woodPerPersonPerDay: number;
  dailyHarvest: { food: number; wood: number };
  travelHours: { carrierRoundTrip: number; woodcutterRoute: number };
  workHours: { foodPerUnit: number; woodPerUnit: number; foodHandover: number;
    carrierLoadUnload: number; woodDeliveryPerSale: number; marketPerBuyer: number;
    meal: number; fuel: number; rest: number };
  energyPerHour: { gathering: number; travel: number; handling: number };
  restEnergyGain: number;
  body: { initialEnergy: number; maxEnergy: number };
  carryingCapacity: { farmerFood: number; carrierFood: number; woodcutterWood: number;
    carrierTotalMass: number };
  access: { foodHarvesters: FeasibilityActor[]; woodHarvesters: FeasibilityActor[] };
  foodShelfLifeDays: number;
};

/** The lower-cash woodcutter gathers three units; the other gathers two. */
export const autonomous90FeasibilityV1: FeasibilityFixture = {
  schemaVersion: 1,
  days: 90,
  initialCash: { S: 20, F: 0, C: 0, B1: 0, B2: 2 },
  resources: {
    food: { initial: 8, growthPerDay: 5, capacity: 8 },
    wood: { initial: 8, growthPerDay: 5, capacity: 8 },
  },
  prices: { foodBid: 1, foodRetail: 6, carrierFee: 10, wood: 4 },
  foodPerPersonPerDay: 1,
  woodPerPersonPerDay: 1,
  dailyHarvest: { food: 5, wood: 5 },
  travelHours: { carrierRoundTrip: 2, woodcutterRoute: 3 },
  workHours: { foodPerUnit: 1, woodPerUnit: 1, foodHandover: 1,
    carrierLoadUnload: 2, woodDeliveryPerSale: 1, marketPerBuyer: 1,
    meal: 1, fuel: 1, rest: 8 },
  energyPerHour: { gathering: 1, travel: 1, handling: 1 },
  restEnergyGain: 8,
  body: { initialEnergy: 8, maxEnergy: 10 },
  carryingCapacity: { farmerFood: 5, carrierFood: 4, woodcutterWood: 3, carrierTotalMass: 20 },
  access: { foodHarvesters: ["F"], woodHarvesters: ["B1", "B2"] },
  foodShelfLifeDays: 3,
};
