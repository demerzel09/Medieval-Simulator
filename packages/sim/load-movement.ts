export type LoadTransport = { grainYield: number; grainUnitMass: number; baseMoveTicks: number; fatigueMass: number };
/** Integer ticks keep path progress deterministic while every added mass slows walking. */
export function loadMovement(mass: number, config: LoadTransport) {
  return { edgeTicks: config.baseMoveTicks + mass, ticksPerHour: 24 * config.baseMoveTicks,
    energyPerHour: 1 + Math.ceil(mass / config.fatigueMass), speedRatio: config.baseMoveTicks / (config.baseMoveTicks + mass) };
}
export function travelExperienceKey(from: string, to: string, mass: number, loadAware: boolean) {
  return `${from}>${to}${loadAware ? `@load${Math.floor(mass / 4)}` : ""}`;
}
