import { autonomous90FeasibilityV1 } from "../../fixtures/autonomous-90";
import { assessAutonomous90Feasibility } from "./feasibility-model";

const result = assessAutonomous90Feasibility(autonomous90FeasibilityV1);
console.log(JSON.stringify({ fixtureVersion: autonomous90FeasibilityV1.schemaVersion, days: result.days.length,
  initialCash: result.initialCash, finalCash: result.finalCash, lowestCash: result.lowestCash,
  lowestEnergy: result.lowestEnergy, highestDailyHours: result.highestDailyHours,
  totalFoodHarvested: result.totalFoodHarvested, totalFoodEaten: result.totalFoodEaten,
  totalWoodHarvested: result.totalWoodHarvested, totalWoodUsed: result.totalWoodUsed,
  firstDay: result.days[0], lastDay: result.days.at(-1),
  daily: process.argv.includes("--daily") ? result.days : undefined }, null, 2));
