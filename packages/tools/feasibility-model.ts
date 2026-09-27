import type { FeasibilityActor, FeasibilityFixture } from "../../fixtures/autonomous-90";

const actors: FeasibilityActor[] = ["S", "F", "C", "B1", "B2"];
type Holdings = Record<FeasibilityActor, number>;
export type FeasibilityDay = { day: number; cash: Holdings; foodEaten: Holdings; woodUsed: Holdings;
  workAndRestHours: Holdings; energySpent: Holdings; energyEnd: Holdings; foodPatch: number; woodPatch: number };
export type FeasibilityResult = { schemaVersion: 1; days: FeasibilityDay[]; totalFoodHarvested: number;
  totalWoodHarvested: number; totalFoodEaten: number; totalWoodUsed: number;
  initialCash: number; finalCash: number; lowestCash: Holdings; lowestEnergy: Holdings;
  highestDailyHours: Holdings };
const empty = (): Holdings => ({ S: 0, F: 0, C: 0, B1: 0, B2: 0 });
function demand(condition: boolean, reason: string): asserts condition { if (!condition) throw Error(reason); }

/** A proposed daily sequence and its arithmetic constraints. It does not call any personality or world gateway. */
export function assessAutonomous90Feasibility(f: FeasibilityFixture): FeasibilityResult {
  demand(f.schemaVersion === 1 && Number.isSafeInteger(f.days) && f.days >= 1 && f.days <= 90,
    "invalid feasibility version or days");
  const numbers = [
    ...Object.values(f.initialCash), ...Object.values(f.resources).flatMap(Object.values),
    ...Object.values(f.prices), f.foodPerPersonPerDay, f.woodPerPersonPerDay,
    ...Object.values(f.dailyHarvest), ...Object.values(f.travelHours), ...Object.values(f.workHours),
    ...Object.values(f.energyPerHour), f.restEnergyGain, ...Object.values(f.body),
    ...Object.values(f.carryingCapacity), f.foodShelfLifeDays,
  ];
  demand(numbers.every((n) => Number.isSafeInteger(n) && n >= 0), "invalid feasibility quantity");
  demand(f.foodPerPersonPerDay === 1 && f.woodPerPersonPerDay === 1 &&
    f.dailyHarvest.food === 5 && f.dailyHarvest.wood === 5,
    "v1 daily allocation requires one meal and one fuel per person");
  demand(f.foodShelfLifeDays >= 1 && f.access.foodHarvesters.length === 1 &&
    f.access.foodHarvesters[0] === "F" && f.access.woodHarvesters.length === 2 &&
    f.access.woodHarvesters.includes("B1") && f.access.woodHarvesters.includes("B2"),
    "v1 harvest rights or food lifetime changed");
  demand(f.body.initialEnergy <= f.body.maxEnergy, "initial energy exceeds capacity");
  demand(f.resources.food.initial <= f.resources.food.capacity &&
    f.resources.wood.initial <= f.resources.wood.capacity, "initial resource exceeds capacity");
  demand(f.carryingCapacity.farmerFood >= 5 && f.carryingCapacity.carrierFood >= 4 &&
    f.carryingCapacity.woodcutterWood >= 3 &&
    f.carryingCapacity.carrierTotalMass >= 4 + f.prices.carrierFee + 4 * f.prices.foodBid,
    "planned cargo exceeds carrying capacity");
  const cash = { ...f.initialCash }, lowestCash = { ...cash }, highestDailyHours = empty();
  const energyLeft: Holdings = { S: f.body.initialEnergy, F: f.body.initialEnergy,
    C: f.body.initialEnergy, B1: f.body.initialEnergy, B2: f.body.initialEnergy };
  const lowestEnergy = { ...energyLeft };
  const initialCash = actors.reduce((sum, id) => sum + cash[id], 0);
  const food = empty(), wood = empty(), foodEaten = empty(), woodUsed = empty();
  let foodPatch = f.resources.food.initial, woodPatch = f.resources.wood.initial;
  const days: FeasibilityDay[] = [];
  const transfer = (from: FeasibilityActor, to: FeasibilityActor, quantity: number, holdings: Holdings, kind: string,
    day: number) => {
    demand(holdings[from] >= quantity, `day ${day}: ${from} lacks ${kind}`);
    holdings[from] -= quantity; holdings[to] += quantity;
    if (kind === "cash") lowestCash[from] = Math.min(lowestCash[from], holdings[from]);
  };
  const use = (id: FeasibilityActor, quantity: number, holdings: Holdings, tally: Holdings, kind: string, day: number) => {
    demand(holdings[id] >= quantity, `day ${day}: ${id} lacks ${kind}`);
    holdings[id] -= quantity; tally[id] += quantity;
  };
  for (let day = 1; day <= f.days; day++) {
    if (day > 1) {
      foodPatch = Math.min(f.resources.food.capacity, foodPatch + f.resources.food.growthPerDay);
      woodPatch = Math.min(f.resources.wood.capacity, woodPatch + f.resources.wood.growthPerDay);
    }
    demand(foodPatch >= 5 && woodPatch >= 5, `day ${day}: natural resource shortfall`);
    foodPatch -= 5; woodPatch -= 5;
    food.F += 5;
    const high: FeasibilityActor = cash.B1 <= cash.B2 ? "B1" : "B2";
    const low: FeasibilityActor = high === "B1" ? "B2" : "B1";
    wood[high] += 3; wood[low] += 2;
    // Each woodcutter heats their own home; these units never enter the market.
    use(high, 1, wood, woodUsed, "wood", day);
    use(low, 1, wood, woodUsed, "wood", day);
    use("F", 1, food, foodEaten, "food", day);
    // S pays for carriage and F's actual four units before C brings S-owned food back.
    transfer("S", "C", f.prices.carrierFee, cash, "cash", day);
    transfer("F", "S", 4, food, "food", day);
    transfer("S", "F", 4 * f.prices.foodBid, cash, "cash", day);
    // S, C and F each have a separate household need for fuel.
    transfer(high, "S", 1, wood, "wood", day);
    transfer("S", high, f.prices.wood, cash, "cash", day);
    transfer(high, "C", 1, wood, "wood", day);
    transfer("C", high, f.prices.wood, cash, "cash", day);
    transfer(low, "F", 1, wood, "wood", day);
    transfer("F", low, f.prices.wood, cash, "cash", day);
    for (const id of ["S", "F", "C"] as const) use(id, 1, wood, woodUsed, "wood", day);
    use("S", 1, food, foodEaten, "food", day);
    for (const id of ["C", "B1", "B2"] as const) {
      transfer("S", id, 1, food, "food", day);
      transfer(id, "S", f.prices.foodRetail, cash, "cash", day);
      use(id, 1, food, foodEaten, "food", day);
    }
    const w = f.workHours, t = f.travelHours, e = f.energyPerHour;
    const hours: Holdings = {
      F: 5 * w.foodPerUnit + w.foodHandover + w.woodDeliveryPerSale + w.meal + w.fuel + w.rest,
      C: t.carrierRoundTrip + w.carrierLoadUnload + w.woodDeliveryPerSale + w.meal + w.fuel + w.rest,
      S: w.foodHandover + 3 * w.marketPerBuyer + w.woodDeliveryPerSale + w.meal + w.fuel + w.rest,
      B1: t.woodcutterRoute + (high === "B1" ? 3 : 2) * w.woodPerUnit +
        (high === "B1" ? 2 : 1) * w.woodDeliveryPerSale + w.meal + w.fuel + w.rest,
      B2: t.woodcutterRoute + (high === "B2" ? 3 : 2) * w.woodPerUnit +
        (high === "B2" ? 2 : 1) * w.woodDeliveryPerSale + w.meal + w.fuel + w.rest,
    };
    const energy: Holdings = {
      F: 5 * w.foodPerUnit * e.gathering + (w.foodHandover + w.woodDeliveryPerSale) * e.handling,
      C: t.carrierRoundTrip * e.travel + (w.carrierLoadUnload + w.woodDeliveryPerSale) * e.handling,
      S: (w.foodHandover + 3 * w.marketPerBuyer + w.woodDeliveryPerSale) * e.handling,
      B1: t.woodcutterRoute * e.travel + ((high === "B1" ? 3 : 2) * w.woodPerUnit) * e.gathering +
        ((high === "B1" ? 2 : 1) * w.woodDeliveryPerSale) * e.handling,
      B2: t.woodcutterRoute * e.travel + ((high === "B2" ? 3 : 2) * w.woodPerUnit) * e.gathering +
        ((high === "B2" ? 2 : 1) * w.woodDeliveryPerSale) * e.handling,
    };
    for (const id of actors) {
      demand(hours[id] <= 24, `day ${day}: ${id} exceeds 24 hours`);
      demand(energyLeft[id] >= energy[id], `day ${day}: ${id} lacks energy`);
      energyLeft[id] -= energy[id];
      lowestEnergy[id] = Math.min(lowestEnergy[id], energyLeft[id]);
      energyLeft[id] = Math.min(f.body.maxEnergy, energyLeft[id] + f.restEnergyGain);
      demand(foodEaten[id] === day && woodUsed[id] === day, `day ${day}: ${id} missing daily need`);
      demand(food[id] === 0 && wood[id] === 0, `day ${day}: ${id} has unexplained stock`);
      highestDailyHours[id] = Math.max(highestDailyHours[id], hours[id]);
    }
    demand(actors.reduce((sum, id) => sum + cash[id], 0) === initialCash, `day ${day}: cash conservation`);
    days.push({ day, cash: { ...cash }, foodEaten: { ...foodEaten }, woodUsed: { ...woodUsed },
      workAndRestHours: hours, energySpent: energy, energyEnd: { ...energyLeft }, foodPatch, woodPatch });
  }
  return { schemaVersion: 1, days, totalFoodHarvested: f.days * 5, totalWoodHarvested: f.days * 5,
    totalFoodEaten: actors.reduce((sum, id) => sum + foodEaten[id], 0),
    totalWoodUsed: actors.reduce((sum, id) => sum + woodUsed[id], 0), initialCash,
    finalCash: actors.reduce((sum, id) => sum + cash[id], 0), lowestCash, lowestEnergy, highestDailyHours };
}
