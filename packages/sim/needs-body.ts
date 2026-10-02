/** World laws only. This module never selects a person's action or destination. */
export type NeedsConfig = { dayTemperature: number; nightTemperature: number; homeInsulation: number;
  comfortableTemperature: number; initialSleepDebt: number; initialMealHours: number };
export type NeedsBody = { sleepDebt: number; mealHours: number; exposureHours: number; sleptHours: number };
export function needsTemperature(hour: number, config: NeedsConfig, sheltered: boolean): number {
  const mean = (config.dayTemperature + config.nightTemperature) / 2;
  const amplitude = (config.dayTemperature - config.nightTemperature) / 2;
  return Math.round(mean + amplitude * Math.cos((hour % 24 - 16) * Math.PI / 12)) +
    (sheltered ? config.homeInsulation : 0);
}
export function advanceNeedsBody(body: NeedsBody, cold: number, energy: number, maxEnergy: number,
  temperature: number, comfortableTemperature: number, activity: string | undefined, sheltered: boolean) {
  const sleeping = activity === "sleep";
  body.sleepDebt = Math.max(0, Math.min(48, body.sleepDebt + (sleeping ? -(sheltered ? 2 : 1) : 1)));
  body.mealHours++;
  const mealDue = body.mealHours >= 24;
  if (mealDue) body.mealHours -= 24;
  cold = temperature < comfortableTemperature ? Math.min(48, cold + Math.ceil((comfortableTemperature - temperature) / 4)) :
    Math.max(0, cold - 2);
  if (cold >= 8) { body.exposureHours++; energy = Math.max(0, energy - 1); }
  if (!sleeping && body.sleepDebt >= 24 && body.mealHours % 4 === 0) energy = Math.max(0, energy - 1);
  if (sleeping) { body.sleptHours++; energy = Math.min(maxEnergy, energy + (sheltered ? 2 : 1)); }
  else if (activity === "rest") energy = Math.min(maxEnergy, energy + 2);
  return { cold, energy, mealDue };
}
