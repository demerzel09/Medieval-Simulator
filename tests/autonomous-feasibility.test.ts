import { describe, expect, it } from "vitest";
import { autonomous90FeasibilityV1 } from "../fixtures/autonomous-90";
import { assessAutonomous90Feasibility } from "../packages/tools/feasibility-model";

describe("90-day accounting feasibility, not an agent simulation", () => {
  it("finds a 90-day resource, time and cash circuit without replenishing money", () => {
    const result = assessAutonomous90Feasibility(autonomous90FeasibilityV1);
    expect(result.days).toHaveLength(90);
    expect(result.totalFoodHarvested).toBe(450);
    expect(result.totalFoodEaten).toBe(450);
    expect(result.totalWoodHarvested).toBe(450);
    expect(result.totalWoodUsed).toBe(450);
    expect(result.initialCash).toBe(22);
    expect(result.finalCash).toBe(22);
    expect(result.lowestCash).toEqual({ S: 2, F: 0, C: 0, B1: 0, B2: 0 });
    expect(result.lowestEnergy).toEqual({ S: 3, F: 1, C: 3, B1: 0, B2: 2 });
    expect(result.highestDailyHours).toEqual({ S: 15, F: 17, C: 15, B1: 18, B2: 18 });
    expect(result.days[0].cash).toEqual({ S: 20, F: 0, C: 0, B1: 2, B2: 0 });
    expect(result.days[89].cash).toEqual({ S: 20, F: 0, C: 0, B1: 0, B2: 2 });
    expect(result.days.every((day) => day.foodPatch === 3 && day.woodPatch === 3)).toBe(true);
  });

  it("shows which initial liquidity, regeneration, carrying and time assumptions are necessary", () => {
    const noBuyerBuffer = structuredClone(autonomous90FeasibilityV1);
    noBuyerBuffer.initialCash.B2 = 0;
    expect(() => assessAutonomous90Feasibility(noBuyerBuffer)).toThrow("day 1: B2 lacks cash");
    const lowGrowth = structuredClone(autonomous90FeasibilityV1);
    lowGrowth.resources.wood.growthPerDay = 4;
    expect(() => assessAutonomous90Feasibility(lowGrowth)).toThrow("day 5: natural resource shortfall");
    const tooHeavy = structuredClone(autonomous90FeasibilityV1);
    tooHeavy.carryingCapacity.carrierTotalMass = 17;
    expect(() => assessAutonomous90Feasibility(tooHeavy)).toThrow("planned cargo exceeds carrying capacity");
    const slowHarvest = structuredClone(autonomous90FeasibilityV1);
    slowHarvest.workHours.woodPerUnit = 5;
    expect(() => assessAutonomous90Feasibility(slowHarvest)).toThrow("exceeds 24 hours");
    const tired = structuredClone(autonomous90FeasibilityV1);
    tired.body.initialEnergy = 7;
    expect(() => assessAutonomous90Feasibility(tired)).toThrow("day 1: B1 lacks energy");
    const lowerRetail = structuredClone(autonomous90FeasibilityV1);
    lowerRetail.prices.foodRetail = 5;
    expect(() => assessAutonomous90Feasibility(lowerRetail)).toThrow("lacks cash");
  });
});
