import { describe, expect, it } from "vitest";
import { landEconomy90V1 } from "../fixtures/land-economy-90";
import { assessLandEconomy90 } from "../packages/tools/land-economy-feasibility-model";

describe("land economy arithmetic, before autonomous acceptance", () => {
  it("accounts for startup food, four crop plots, seeds, work, cargo and cash over 90 days", () => {
    const r = assessLandEconomy90(landEconomy90V1);
    expect(r.days).toHaveLength(90);
    expect([r.totalFood, r.wildFood, r.grainFood, r.last30GrainFood]).toEqual([450, 15, 435, 150]);
    expect([r.initialCash, r.finalCash, r.totalWood]).toEqual([26, 26, 450]);
    expect([r.peakFarmerHoursWithRest, r.minimumFarmerEnergyBeforeRest,
      r.peakFarmerBagMass, r.endingSeeds, r.endingWildReserve]).toEqual([18, 6, 8, 1, 5]);
    expect(r.days[2].wildRemaining).toBe(5);
    expect(r.days[89].wildRemaining).toBe(5);
    expect(r.days[3]).toMatchObject({ source: "grain", grainPlot: 1, sownPlot: 4 });
    expect(r.days.slice(60).every((d) => d.source === "grain" && d.foodEaten === 5)).toBe(true);
    expect(r.days.every((d) => Object.values(d.cash).reduce((a, b) => a + b, 0) === 26)).toBe(true);
  });

  it("exposes the first shortage when land, seeds, startup food, bag space or capital are removed", () => {
    const change = (edit: (f: typeof landEconomy90V1) => void) => {
      const f = structuredClone(landEconomy90V1); edit(f); return () => assessLandEconomy90(f);
    };
    expect(change((f) => { f.plots = 3; })).toThrow("day 7: no ripe grain plot");
    expect(change((f) => { f.initialSeeds = 2; })).toThrow("day 3: seed shortfall");
    expect(change((f) => { f.world.resources.food.initial = 10; })).toThrow("day 3: wild starter food shortfall");
    expect(change((f) => { f.farmerBagMass = 7; })).toThrow("day 1: farmer bag overloaded");
    expect(change((f) => { f.world.initialCash.B2 = 0; })).toThrow("day 1: B2 lacks cash");
  });

  it("keeps one extra hour of field travel feasible and detects an excessive detour", () => {
    const near = structuredClone(landEconomy90V1);
    near.fieldRoundTripHours = 3;
    expect(assessLandEconomy90(near).totalFood).toBe(450);
    const far = structuredClone(landEconomy90V1);
    far.fieldRoundTripHours = 5;
    expect(() => assessLandEconomy90(far)).toThrow("day 3: farmer lacks energy");
  });
});
