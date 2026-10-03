/** Approximate physiology in explicit nutrition units (1000 ticks/unit), not calibrated kcal. */
export type EffortConfig = { version: 1; initialReserve: number; reserveCapacity: number;
  supplyThreshold: number; appetiteThreshold: number; basalPerHour: number; workPerEffort: number;
  recoveryNutritionPerHour: number; supportPerMassHour: number; strainPerEffort: number;
  recoveryPerHour: number; absorptionMinutes: number; breadNutrition: number;
  berryNutrition: number; fruitNutrition: number; herbNutrition: number };
export type EffortBody = { version: 1; reserve: number; initialReserve: number; fatigue: number;
  intake: number; absorbed: number; consumed: number; lost: number; unmet: number;
  digestion: { dueMinute: number; amount: number; causeId: string }[];
  pleasure: number; relief: number };
const scale = 1_000_000;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const defaultEffortConfig: EffortConfig = { version: 1, initialReserve: 60000, reserveCapacity: 96000,
  supplyThreshold: 12000, appetiteThreshold: 48000, basalPerHour: 1000, workPerEffort: 700,
  recoveryNutritionPerHour: 150, supportPerMassHour: 25, strainPerEffort: 40000,
  recoveryPerHour: 76000, absorptionMinutes: 120,
  breadNutrition: 36000, berryNutrition: 24000, fruitNutrition: 30000, herbNutrition: 12000 };
export function newEffortBody(c: EffortConfig, energy: number, maxEnergy: number): EffortBody {
  return { version: 1, reserve: c.initialReserve, initialReserve: c.initialReserve,
    fatigue: Math.round(clamp(1 - energy / maxEnergy) * scale), intake: 0, absorbed: 0,
    consumed: 0, lost: 0, unmet: 0, digestion: [], pleasure: 0, relief: 0 };
}
export function effortNutrition(c: EffortConfig, species: string, product?: string) {
  return product === "bread" ? c.breadNutrition : species === "herb" ? c.herbNutrition :
    species === "fruit_tree" ? c.fruitNutrition : species === "wild_berry" ? c.berryNutrition : 0;
}
export function effortEnergy(b: EffortBody, c: EffortConfig, max: number) {
  return Math.round(max * clamp(b.reserve / c.supplyThreshold) * (1 - b.fatigue / scale) * 10000) / 10000;
}
export function effortAppetite(b: EffortBody, c: EffortConfig) {
  const available = b.reserve + b.digestion.reduce((n, d) => n + d.amount, 0);
  return available >= c.appetiteThreshold ? 0 : 1 + Math.floor((c.appetiteThreshold - available) / 24000);
}
export function effortSensation(b: EffortBody, c: EffortConfig, mass: number) {
  const pending = b.digestion.reduce((n, d) => n + d.amount, 0);
  return { fatigue: b.fatigue / scale,
    nutritionNeed: clamp((c.appetiteThreshold - b.reserve - pending * .5) / c.appetiteThreshold),
    digesting: pending > 0, loadDiscomfort: clamp(mass / 20 * (.6 + .4 * b.fatigue / scale)),
    pleasure: b.pleasure / scale, relief: b.relief / scale };
}
export type ReturnEffortSensation = ReturnType<typeof effortSensation> & { learningEnabled: boolean };
function consume(b: EffortBody, requested: number) {
  const actual = Math.min(b.reserve, Math.max(0, Math.round(requested)));
  b.reserve -= actual; b.consumed += actual; b.unmet += Math.max(0, Math.round(requested) - actual);
}
export function exertEffort(b: EffortBody, c: EffortConfig, effort: number) {
  consume(b, effort * c.workPerEffort);
  b.fatigue = Math.min(scale, b.fatigue + Math.round(effort * c.strainPerEffort));
}
export function ingestEffort(b: EffortBody, c: EffortConfig, minute: number, amount: number, causeId: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error("invalid nutritional intake");
  b.intake += amount; b.digestion.push({ dueMinute: minute + c.absorptionMinutes, amount, causeId });
  b.pleasure = Math.round(scale * (.4 + .4 * effortSensation(b, c, 0).nutritionNeed));
}
/** One quarter hour. Process work is accounted separately once, on its actual progress. */
export function advanceEffortQuarter(b: EffortBody, c: EffortConfig, minute: number,
  activity: string, mass: number, cold: number, sleepQuality: number) {
  for (const meal of b.digestion.filter((d) => d.dueMinute <= minute)) {
    const stored = Math.min(meal.amount, c.reserveCapacity - b.reserve);
    b.reserve += stored; b.absorbed += meal.amount; b.lost += meal.amount - stored;
  }
  b.digestion = b.digestion.filter((d) => d.dueMinute > minute);
  const resting = ["rest", "settling", "sleep"].includes(activity);
  const supporting = ["wait", "rest", "settling"].includes(activity);
  const support = supporting ? mass * c.supportPerMassHour : 0;
  consume(b, c.basalPerHour / 4 + support / 4 + (cold >= 8 ? c.basalPerHour / 8 : 0) +
    (resting && b.fatigue > 0 ? c.recoveryNutritionPerHour / 4 : 0));
  const before = b.fatigue;
  const recovery = resting ? c.recoveryPerHour / 4 * clamp(b.reserve / c.supplyThreshold) *
    (activity === "sleep" ? sleepQuality : 1) : 0;
  b.fatigue = Math.round(Math.max(0, Math.min(scale, b.fatigue - recovery +
    (supporting ? mass * 800 : 0))));
  b.pleasure = Math.round(b.pleasure * .5);
  b.relief = Math.round(Math.max(b.relief * .5, Math.max(0, before - b.fatigue)));
}
export function checkEffortConfig(c: EffortConfig) {
  if (c.version !== 1 || Object.values(c).some((v) => !Number.isSafeInteger(v) || v < 1) ||
    c.initialReserve > c.reserveCapacity || c.supplyThreshold >= c.appetiteThreshold ||
    c.appetiteThreshold >= c.reserveCapacity || c.absorptionMinutes % 15) throw Error("invalid effort config");
}
export function checkEffortBody(b: EffortBody, c: EffortConfig, minute: number) {
  const { digestion, ...numbers } = b;
  if (b.version !== 1 || Object.values(numbers).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    b.reserve > c.reserveCapacity || b.fatigue > scale || b.pleasure > scale || b.relief > scale ||
    b.initialReserve !== c.initialReserve || b.initialReserve + b.absorbed !== b.reserve + b.consumed + b.lost ||
    b.intake !== b.absorbed + digestion.reduce((n, d) => n + d.amount, 0) ||
    digestion.some((d) => !Number.isSafeInteger(d.dueMinute) || d.dueMinute <= minute ||
      !Number.isSafeInteger(d.amount) || d.amount <= 0 || !d.causeId)) throw Error("invalid effort body balance");
}
