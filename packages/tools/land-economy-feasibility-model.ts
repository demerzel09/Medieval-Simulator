import type { LandEconomyFixture } from "../../fixtures/land-economy-90";

type Person = "S" | "F" | "C" | "B1" | "B2";
type Cash = Record<Person, number>;
type Plot = { readyDay: number; lastHarvestDay: number };
export type LandEconomyDay = { day: number; source: "wild_berry" | "grain";
  foodHarvested: number; foodEaten: number; grainPlot?: number; sownPlot?: number;
  seeds: number; wildRemaining: number; woodRemaining: number; farmerWorkHours: number;
  farmerHoursWithRest: number; farmerEnergyBeforeRest: number; farmerEnergyEnd: number;
  farmerPeakBagMass: number; cash: Cash };
export type LandEconomyResult = { fixtureVersion: 1; days: LandEconomyDay[];
  totalFood: number; wildFood: number; grainFood: number; totalWood: number;
  last30GrainFood: number; initialCash: number; finalCash: number;
  peakFarmerHoursWithRest: number; minimumFarmerEnergyBeforeRest: number;
  peakFarmerBagMass: number; endingSeeds: number; endingWildReserve: number;
  carrierDailyWorkHours: number; carrierDailyTravelEnergy: number };

function requireCondition(ok: boolean, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}

/** Necessary daily material and time budget. It does not schedule actor decisions or hourly rendezvous. */
export function assessLandEconomy90(f: LandEconomyFixture): LandEconomyResult {
  const w = f.world, c = f.crop;
  requireCondition(f.schemaVersion === 1 && f.days === 90 && f.plots >= 1 &&
    Number.isSafeInteger(f.plots) && Number.isSafeInteger(f.initialSeeds) && f.initialSeeds >= 0 &&
    c.yield === 5 && c.growthDays === 3 && c.tillHours === (f.farmerGrainSkill === 2 ? 1 : 2) &&
    c.sowHours === 1 && c.harvestHours === (f.farmerGrainSkill === 2 ? 1 : 2) &&
    Number.isSafeInteger(f.fieldRoundTripHours) && f.fieldRoundTripHours >= 2 &&
    f.tenderHours === 1 &&
    f.restHours === 8, "unsupported land accounting fixture");
  requireCondition(w.foodPerPersonPerDay === 1 && w.woodPerPersonPerDay === 1 &&
    w.foodShelfLifeDays >= 1 && w.carryingCapacity.farmerFood >= 5 &&
    w.carryingCapacity.carrierFood >= 4 && w.carryingCapacity.carrierTotalMass >=
      4 + w.prices.carrierFee + 4 * w.prices.foodBid,
  "food demand, shelf life or carrier capacity incompatible");
  requireCondition(w.resources.food.initial <= w.resources.food.capacity &&
    w.resources.wood.initial <= w.resources.wood.capacity &&
    w.body.initialEnergy <= w.body.maxEnergy, "invalid initial stock or energy");
  const carrierTravelMass = w.prices.carrierFee + 4 * w.prices.foodBid;
  const carrierTravelEnergy = 2 * (1 + Math.floor(carrierTravelMass / 10));
  const carrierWorkHours = 2 + 1; // Market → grove → market, then one-hour delivery.
  requireCondition(carrierWorkHours + f.restHours <= 24 &&
    carrierTravelEnergy + 1 <= w.restEnergyGain,
  "carrier cannot repeat daily route and delivery");
  const plots: Plot[] = Array.from({ length: f.plots }, () => ({ readyDay: 0, lastHarvestDay: 0 }));
  const cash: Cash = { ...w.initialCash };
  const initialCash = Object.values(cash).reduce((a, b) => a + b, 0);
  const transfer = (from: Person, to: Person, quantity: number, day: number) => {
    requireCondition(cash[from] >= quantity, `day ${day}: ${from} lacks cash`);
    cash[from] -= quantity; cash[to] += quantity;
  };
  let seeds: number = f.initialSeeds, wild: number = w.resources.food.initial;
  let wood: number = w.resources.wood.initial, energy: number = w.body.initialEnergy;
  let wildFood = 0, grainFood = 0, totalWood = 0;
  let peakHours = 0, minimumEnergy = energy, peakBag = 0;
  const days: LandEconomyDay[] = [];
  for (let day = 1; day <= f.days; day++) {
    if (day > 1) {
      wild = Math.min(w.resources.food.capacity, wild + w.resources.food.growthPerDay);
      wood = Math.min(w.resources.wood.capacity, wood + w.resources.wood.growthPerDay);
    }
    const grainPlot = plots.findIndex((p) => p.readyDay > 0 && p.readyDay <= day);
    if (day > c.growthDays && grainPlot < 0) throw Error(`day ${day}: no ripe grain plot`);
    let foodSource: LandEconomyDay["source"];
    if (day <= c.growthDays) {
      requireCondition(wild >= 5, `day ${day}: wild starter food shortfall`);
      wild -= 5; wildFood += 5; foodSource = "wild_berry";
    } else {
      plots[grainPlot].readyDay = 0;
      plots[grainPlot].lastHarvestDay = day;
      seeds++; grainFood += c.yield; foodSource = "grain";
    }
    // Keep replanting through day 90 so seed inventory and field state remain in a steady cycle.
    let sownPlot = -1;
    if (day <= f.days) {
      sownPlot = day <= f.plots ? day - 1 : plots.findIndex((p) => p.lastHarvestDay === day - 1);
      if (sownPlot >= 0) {
        requireCondition(plots[sownPlot].readyDay === 0, `day ${day}: plot not bare`);
        requireCondition(seeds > 0, `day ${day}: seed shortfall`);
        seeds--;
        plots[sownPlot].readyDay = day + c.growthDays;
      }
    }
    requireCondition(wood >= 5, `day ${day}: wood shortfall`);
    wood -= 5; totalWood += 5;
    const cropWork = (grainPlot >= 0 ? c.harvestHours : 0) +
      (sownPlot >= 0 ? c.tillHours + c.sowHours : 0);
    const forageWork = day <= c.growthDays ? 5 * w.workHours.foodPerUnit : 0;
    const farmerWork = cropWork + forageWork + f.fieldRoundTripHours + f.tenderHours;
    const hoursWithRest = farmerWork + f.restHours;
    requireCondition(hoursWithRest <= 24, `day ${day}: farmer exceeds 24 hours`);
    requireCondition(energy >= farmerWork, `day ${day}: farmer lacks energy`);
    energy -= farmerWork;
    minimumEnergy = Math.min(minimumEnergy, energy);
    const beforeRest = energy;
    energy = Math.min(w.body.maxEnergy, energy + w.restEnergyGain);
    // On a crop day, harvest creates a seed before any same-day sowing can consume it.
    const bagMass = 5 + seeds + (grainPlot >= 0 && sownPlot >= 0 ? 1 : 0);
    requireCondition(bagMass <= f.farmerBagMass, `day ${day}: farmer bag overloaded`);
    peakBag = Math.max(peakBag, bagMass);
    // Same sale and wood exchange as the accepted village, with F's 4-coin starting float.
    const high: Person = cash.B1 <= cash.B2 ? "B1" : "B2";
    const low: Person = high === "B1" ? "B2" : "B1";
    transfer("S", "C", w.prices.carrierFee, day);
    transfer("S", "F", 4 * w.prices.foodBid, day);
    transfer("S", high, w.prices.wood, day);
    transfer("C", high, w.prices.wood, day);
    transfer("F", low, w.prices.wood, day);
    for (const buyer of ["C", "B1", "B2"] as const)
      transfer(buyer, "S", w.prices.foodRetail, day);
    requireCondition(Object.values(cash).reduce((a, b) => a + b, 0) === initialCash,
      `day ${day}: cash changed`);
    peakHours = Math.max(peakHours, hoursWithRest);
    days.push({ day, source: foodSource, foodHarvested: 5, foodEaten: 5,
      grainPlot: grainPlot < 0 ? undefined : grainPlot + 1,
      sownPlot: sownPlot < 0 ? undefined : sownPlot + 1,
      seeds, wildRemaining: wild, woodRemaining: wood, farmerWorkHours: farmerWork,
      farmerHoursWithRest: hoursWithRest, farmerEnergyBeforeRest: beforeRest,
      farmerEnergyEnd: energy, farmerPeakBagMass: bagMass, cash: { ...cash } });
  }
  return { fixtureVersion: 1, days, totalFood: wildFood + grainFood, wildFood, grainFood,
    totalWood, last30GrainFood: days.slice(-30).filter((d) => d.source === "grain").length * 5,
    initialCash, finalCash: Object.values(cash).reduce((a, b) => a + b, 0),
    peakFarmerHoursWithRest: peakHours, minimumFarmerEnergyBeforeRest: minimumEnergy,
    peakFarmerBagMass: peakBag, endingSeeds: seeds, endingWildReserve: wild,
    carrierDailyWorkHours: carrierWorkHours,
    carrierDailyTravelEnergy: carrierTravelEnergy };
}
