/** Physical sleep regulation. No action choice, private forecast, or destination selection. */
export type SleepInterval = { from: number; to: number; quality: number };
export type SleepConfig = { version: 1; requiredMinutes: number; wakeTauMinutes: number; sleepTauMinutes: number;
  initialPressure: number; initialHistory: SleepInterval[] };
export type SleepBody = { version: 1; minute: number; pressure: number; history: SleepInterval[];
  mode: "awake" | "settling" | "asleep"; awakeMinutes: number; totalSleepMinutes: number;
  attemptMinute?: number; plannedWakeMinute?: number; readyMinutes: number; episodeSleepMinutes: number;
  episodeEffective: number; episodeWaitMinutes: number };
export type SleepSignal = { deficitHours: number; effectiveHours: number; actualHours: number; sleepiness: number;
  awakeDrive: number; circadian: number; fatigue: number; mode: SleepBody["mode"]; awakeHours: number };
export type SleepTransition = { kind: "sleep_started" | "sleep_woke" | "sleep_interrupted" | "sleep_unavailable";
  minute: number; reason: string; sleepMinutes: number; effectiveMinutes: number; waitMinutes: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const scale = 1_000_000;
function normalSleepPressure(config: SleepConfig) {
  const a = Math.exp(-(1440 - config.requiredMinutes) / config.wakeTauMinutes);
  const b = Math.exp(-config.requiredMinutes / config.sleepTauMinutes);
  const rested = b * (1 - a) / (1 - a * b);
  return { rested, limit: 1 - (1 - rested) * a };
}
export const defaultSleepConfig: SleepConfig = {
  version: 1, requiredMinutes: 360, wakeTauMinutes: 1080, sleepTauMinutes: 180,
  initialPressure: 90031,
  initialHistory: [{ from: -1440, to: -360, quality: 0 }, { from: -360, to: 0, quality: 1000 }],
};
export function newSleepBody(config: SleepConfig): SleepBody {
  return { version: 1, minute: 0, pressure: config.initialPressure, history: structuredClone(config.initialHistory),
    mode: "awake", awakeMinutes: 0, totalSleepMinutes: 0, readyMinutes: 0,
    episodeSleepMinutes: 0, episodeEffective: 0, episodeWaitMinutes: 0 };
}
export function circadianSleep(minute: number) {
  const hour = ((minute % 1440) + 1440) % 1440 / 60;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  return hour >= 23 || hour < 5 ? 1 : hour >= 22 ? smooth(hour - 22) : hour < 6 ? 1 - smooth(hour - 5) : 0;
}
export function sleepSignal(body: SleepBody, config: SleepConfig, energy: number, maxEnergy: number): SleepSignal {
  const effective = body.history.reduce((n, i) => n + Math.max(0, i.to - Math.max(i.from, body.minute - 1440)) * i.quality / 1000, 0);
  const actual = body.history.filter((i) => i.quality > 0).reduce((n, i) => n + Math.max(0, i.to - Math.max(i.from, body.minute - 1440)), 0);
  const { limit } = normalSleepPressure(config);
  const pressure = body.pressure / scale;
  const awakeDrive = clamp((pressure - limit - 2e-6) / (1 - limit));
  const deficit = Math.max(0, config.requiredMinutes - effective), circadian = circadianSleep(body.minute);
  const fatigue = clamp(1 - energy / maxEnergy);
  const sleepiness = clamp(Math.max(awakeDrive, deficit / config.requiredMinutes) +
    .45 * circadian * clamp(pressure / limit) + .60 * clamp((fatigue - .65) / .35));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { deficitHours: round(deficit / 60), effectiveHours: round(effective / 60), actualHours: actual / 60,
    sleepiness: round(sleepiness), awakeDrive: round(awakeDrive), circadian, fatigue: round(fatigue),
    mode: body.mode, awakeHours: body.awakeMinutes / 60 };
}
export function beginSleep(body: SleepBody, plannedWakeMinute?: number) {
  if (body.mode !== "awake" || plannedWakeMinute !== undefined &&
    (!Number.isSafeInteger(plannedWakeMinute) || plannedWakeMinute <= body.minute || plannedWakeMinute % 15 !== 0)) throw Error("invalid sleep attempt");
  body.mode = "settling"; body.attemptMinute = body.minute;
  body.readyMinutes = 0; body.episodeSleepMinutes = 0; body.episodeEffective = 0; body.episodeWaitMinutes = 0;
  if (plannedWakeMinute !== undefined) body.plannedWakeMinute = plannedWakeMinute;
  else delete body.plannedWakeMinute;
}
export function endSleep(body: SleepBody, reason: string, kind: SleepTransition["kind"] = "sleep_woke"): SleepTransition {
  const transition = { kind, minute: body.minute, reason, sleepMinutes: body.episodeSleepMinutes,
    effectiveMinutes: body.episodeEffective / 1000, waitMinutes: body.episodeWaitMinutes };
  if (body.mode === "asleep") body.awakeMinutes = 0;
  body.mode = "awake"; delete body.attemptMinute; delete body.plannedWakeMinute;
  return transition;
}
/** Exactly one canonical quarter hour. Caller accounts for cold and work costs separately. */
export function advanceSleepQuarter(body: SleepBody, config: SleepConfig, energy: number, maxEnergy: number,
  cold: number, resting = false): { energy: number; transitions: SleepTransition[] } {
  const transitions: SleepTransition[] = [];
  if (body.mode !== "awake" && cold >= 12) transitions.push(endSleep(body, "cold exposure", "sleep_interrupted"));
  if (body.mode !== "awake" && body.plannedWakeMinute !== undefined && body.minute >= body.plannedWakeMinute)
    transitions.push(endSleep(body, "personal wake reservation"));
  const asleep = body.mode === "asleep", settling = body.mode === "settling";
  const ready = settling && sleepSignal(body, config, energy, maxEnergy).sleepiness >= .55 - .20 * circadianSleep(body.minute);
  const quality = asleep ? Math.max(500, Math.round(1000 - 500 * cold / 12)) : 0;
  const from = body.minute; body.minute += 15;
  const previous = body.history.at(-1);
  if (previous && previous.to === from && previous.quality === quality) previous.to = body.minute;
  else body.history.push({ from, to: body.minute, quality });
  body.history = body.history.filter((i) => i.to > body.minute - 1440);
  body.history[0].from = Math.max(body.history[0].from, body.minute - 1440);
  body.pressure = Math.round(scale * (asleep ? body.pressure / scale * Math.exp(-quality / 1000 * 15 / config.sleepTauMinutes) :
    1 - (1 - body.pressure / scale) * Math.exp(-15 / config.wakeTauMinutes)));
  if (asleep) {
    body.totalSleepMinutes += 15; body.episodeSleepMinutes += 15; body.episodeEffective += quality * 15;
    energy = Math.min(maxEnergy, energy + .5 * quality / 1000);
  } else {
    body.awakeMinutes += 15;
    if (resting || settling) energy = Math.min(maxEnergy, energy + .5);
    if (settling) { body.episodeWaitMinutes += 15; body.readyMinutes = ready ? body.readyMinutes + 15 : 0; }
  }
  energy = Math.round(energy * 10000) / 10000;
  const signal = sleepSignal(body, config, energy, maxEnergy);
  if (settling && body.readyMinutes >= 15) {
    body.mode = "asleep"; body.awakeMinutes = 0;
    transitions.push({ kind: "sleep_started", minute: body.minute, reason: "sleep onset", sleepMinutes: 0,
      effectiveMinutes: 0, waitMinutes: body.episodeWaitMinutes });
  } else if (settling && body.minute - body.attemptMinute! >= 120)
    transitions.push(endSleep(body, "sleep onset unavailable", "sleep_unavailable"));
  else if (asleep && body.episodeSleepMinutes >= 30 && body.pressure <= Math.round(normalSleepPressure(config).rested * scale) + 2 && signal.deficitHours === 0 &&
    signal.sleepiness <= .10 + .15 * (1 - signal.circadian)) transitions.push(endSleep(body, "natural awakening"));
  if (body.mode !== "awake" && body.plannedWakeMinute !== undefined && body.minute >= body.plannedWakeMinute)
    transitions.push(endSleep(body, "personal wake reservation"));
  return { energy, transitions };
}
/** Only the person's actual sleep times; internal pressure and quality never enter personality input. */
export function observedSleepIntervals(body: SleepBody) {
  const out: { from: number; to: number }[] = [];
  for (const i of body.history.filter((i) => i.quality > 0)) {
    if (out.at(-1)?.to === i.from) out.at(-1)!.to = i.to;
    else out.push({ from: i.from, to: i.to });
  }
  return out;
}
export function checkSleepConfig(c: SleepConfig) {
  if (c.version !== 1 || ![c.requiredMinutes, c.wakeTauMinutes, c.sleepTauMinutes, c.initialPressure].every(Number.isSafeInteger) ||
    c.requiredMinutes < 60 || c.requiredMinutes >= 1440 || c.requiredMinutes % 15 !== 0 || c.wakeTauMinutes <= 0 || c.sleepTauMinutes <= 0 ||
    c.initialPressure < 0 || c.initialPressure > scale || !c.initialHistory.length || c.initialHistory[0].from !== -1440 ||
    c.initialHistory.at(-1)!.to !== 0 || c.initialHistory.some((i, index) => i.from >= i.to ||
      ![i.from, i.to, i.quality].every(Number.isSafeInteger) || i.from % 15 || i.to % 15 || i.quality < 0 || i.quality > 1000 ||
      index > 0 && c.initialHistory[index - 1].to !== i.from)) throw Error("invalid sleep regulation config");
}
export function checkSleepBody(b: SleepBody, minute: number) {
  const integers = [b.minute, b.pressure, b.awakeMinutes, b.totalSleepMinutes, b.readyMinutes,
    b.episodeSleepMinutes, b.episodeEffective, b.episodeWaitMinutes];
  if (b.version !== 1 || b.minute !== minute || integers.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    b.minute % 15 || b.pressure > scale || b.totalSleepMinutes > minute || b.totalSleepMinutes % 15 ||
    b.episodeSleepMinutes > b.totalSleepMinutes || b.episodeEffective > b.episodeSleepMinutes * 1000 || !["awake", "settling", "asleep"].includes(b.mode) ||
    b.mode === "awake" !== (b.attemptMinute === undefined) || b.attemptMinute !== undefined &&
      (!Number.isSafeInteger(b.attemptMinute) || b.attemptMinute > minute || b.attemptMinute < 0 || b.attemptMinute % 15) ||
    b.plannedWakeMinute !== undefined && (b.mode === "awake" || !Number.isSafeInteger(b.plannedWakeMinute) || b.plannedWakeMinute < minute || b.plannedWakeMinute % 15) ||
    b.history.length > 97 || !b.history.length || b.history[0].from !== minute - 1440 || b.history.at(-1)!.to !== minute ||
    b.history.some((i, index) => ![i.from, i.to, i.quality].every(Number.isSafeInteger) || i.from >= i.to || i.from % 15 || i.to % 15 ||
      i.quality < 0 || i.quality > 1000 || index > 0 && b.history[index - 1].to !== i.from)) throw Error("invalid sleep body");
}
