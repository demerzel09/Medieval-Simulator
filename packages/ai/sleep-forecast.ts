import type { VillageAttempt, VillageContext, VillageStimulus } from "./autonomous-world";
type Estimate = { count: number; bias: number; priorError: number; learnedError: number };
type Frozen = { at: number; minute: number; pressure: number; energy: number; maxEnergy: number; cold: number;
  sheltered: boolean; history: { from: number; to: number; quality: number }[]; action: string; key: string; bias?: number;
  fatigue?: number; fatigueRate?: number; actionId?: string; energyRate?: number };
export type SleepForecastMemory = { version: 1; at: number; pressure: number; models: Record<string, Estimate>;
  pending?: Frozen; matched: number; excluded: number; retryAt: number;
  last?: { expected: number; actual: number; error: number; kind: string; at: number } };
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
// Subjective initial beliefs. Deliberately no import of the world sleep law or its private S/quality.
function night(minute: number) {
  const h = ((minute % 1440) + 1440) % 1440 / 60, smooth = (x: number) => x * x * (3 - 2 * x);
  return h >= 23 || h < 5 ? 1 : h >= 22 ? smooth(h - 22) : h < 6 ? 1 - smooth(h - 5) : 0;
}
function values(p: number, history: Frozen["history"], minute: number, energy: number, max: number, fatigue?: number) {
  const effective = history.reduce((n, i) => n + Math.max(0, Math.min(minute, i.to) - Math.max(minute - 1440, i.from)) * i.quality, 0);
  const deficit = Math.max(0, 360 - effective) / 60, c = night(minute);
  return { deficit, sleepiness: clamp(Math.max(clamp((p - .665241) / (1 - .665241)), deficit / 6) +
    .45 * c * clamp(p / .665241) + .6 * clamp(((fatigue ?? (1 - energy / max)) - .65) / .35)) };
}
function freeze(c: VillageContext, m: SleepForecastMemory, action: string): Frozen {
  const s = c.needs!.sleep!, key = `${action === "sleep" ? "sleep" : "awake"}:${c.needs!.sheltered ? "inside" : "outside"}:${night(s.minute) > .5 ? "night" : "day"}:fatigue${(c.effortBody ? c.effortBody.fatigue >= .65 : c.energy < c.bulkTransport!.maxEnergy * .35) ? 1 : 0}`;
  const model = m.models[key], quality = s.actualHours > 0 ? clamp(s.effectiveHours / s.actualHours, .5, 1) : 1;
  return { at: s.minute / 60, minute: s.minute, pressure: m.pressure, energy: c.energy, maxEnergy: c.bulkTransport!.maxEnergy,
    ...(c.effortBody ? { fatigue: c.effortBody.fatigue, fatigueRate: action === "sleep" || action === "rest" ? -.07 : action === "travel" ? .04 * (1 + c.carriedMass / 8) : .04 } : {}),
    cold: c.cold, sheltered: c.needs!.sheltered, history: s.ownSleeps.map((i) => ({ ...i, quality })), action, key,
    ...(model && model.count >= 2 && model.learnedError <= model.priorError ? { bias: model.bias } : {}) };
}
function project(f: Frozen, hours: number, effort = 0) {
  let p = f.pressure, energy = f.energy, fatigue = f.fatigue, minute = f.minute, history = structuredClone(f.history);
  let mode = f.action === "sleep" ? "settling" : "awake", wait = 0, actual = 0, wakeHours: number | undefined;
  let last = values(p, history, minute, energy, f.maxEnergy, fatigue), peak = clamp(last.sleepiness + (f.bias ?? 0));
  for (let elapsed = 0; elapsed < Math.ceil(hours * 4); elapsed++) {
    const sleeping = mode === "asleep", ready = mode === "settling" && last.sleepiness >= .55 - .2 * night(minute);
    const quality = sleeping ? clamp(1 - .5 * f.cold / 12, .5, 1) : 0;
    if (sleeping) { history.push({ from: minute, to: minute + 15, quality }); actual += 15; }
    if (mode === "settling") wait += 15;
    p = sleeping ? p * Math.exp(-quality * 15 / 180) : 1 - (1 - p) * Math.exp(-15 / 1080);
    energy = clamp(energy + (sleeping ? .5 * quality : mode === "settling" || f.action === "rest" ? .5 : (f.energyRate ?? 0) / 4 - effort / Math.max(1, hours * 4)), 0, f.maxEnergy);
    if (fatigue !== undefined) fatigue = clamp(fatigue + (sleeping ? -.07 * quality : mode === "settling" || f.action === "rest" ? -.07 : f.fatigueRate ?? 0) / 4);
    minute += 15; history = history.filter((i) => i.to > minute - 1440);
    last = values(p, history, minute, energy, f.maxEnergy, fatigue);
    if (mode === "settling" && ready) mode = "asleep";
    else if (mode === "settling" && wait >= 120) { mode = "awake"; wakeHours ??= (minute - f.minute) / 60; }
    else if (sleeping && actual >= 30 && p <= .090033 && last.deficit === 0 && last.sleepiness <= .1 + .15 * (1 - night(minute))) {
      mode = "awake"; wakeHours ??= (minute - f.minute) / 60;
    }
    peak = Math.max(peak, clamp(last.sleepiness + (f.bias ?? 0)));
  }
  return { sleepiness: clamp(last.sleepiness + (f.bias ?? 0)), peak, deficit: last.deficit, energy,
    expectedHours: wakeHours ?? hours, actualHours: actual / 60 };
}
export function observeSleep(c: VillageContext, memory: SleepForecastMemory | undefined, stimuli: VillageStimulus[], at: number) {
  const s = c.needs!.sleep!;
  const m: SleepForecastMemory = memory ?? { version: 1, at: 0, pressure: .090031, models: {}, matched: 0, excluded: 0, retryAt: 0 };
  if (m.pending) {
    const f = m.pending, outcome = f.actionId ? stimuli.slice().reverse().find((v) =>
      v.experience?.predictionId === f.actionId && v.experience?.phase !== "started") : undefined;
    const e = outcome?.experience, sleeping = f.action === "sleep";
    const target = sleeping ? e?.sleep?.endedMinute : f.minute + 60;
    const actual = sleeping ? e?.after.sleepiness : s.minute === target ? s.sleepiness : undefined;
    const matchedAwake = !s.ownSleeps.some((i) => i.from < f.minute + 60 && i.to > f.minute) &&
      (f.actionId ? e?.phase === "completed" && e.startedAt === f.at && e.elapsedHours <= 1 :
        !stimuli.some((v) => v.experience?.startedAt === f.at));
    if (target !== undefined && actual !== undefined && target > f.minute && target <= f.minute + 1440 &&
      (sleeping ? !!e?.sleep && e.sleep.actualHours > 0 && e.phase === "completed" : matchedAwake)) {
      const prior = project({ ...f, bias: undefined }, (target - f.minute) / 60).sleepiness;
      const expected = project(f, (target - f.minute) / 60).sleepiness;
      const model = m.models[f.key] ??= { count: 0, bias: 0, priorError: 0, learnedError: 0 };
      const oldBias = model.bias; model.count++;
      model.priorError += (Math.abs(actual - prior) - model.priorError) / model.count;
      model.learnedError += (Math.abs(actual - clamp(prior + oldBias)) - model.learnedError) / model.count;
      model.bias = clamp(oldBias + .15 * (actual - clamp(prior + oldBias)), -.25, .25);
      m.matched++; m.last = { expected, actual, error: actual - expected, kind: f.action, at };
      delete m.pending;
    } else if (sleeping ? !!outcome || s.minute > f.minute + 1440 : s.minute >= f.minute + 60 || !!outcome && e?.phase !== "completed") {
      m.excluded++; delete m.pending;
    }
  }
  for (let minute = m.at; minute < s.minute; minute += 15) {
    const asleep = s.ownSleeps.some((i) => i.from <= minute && i.to > minute);
    const quality = s.actualHours > 0 ? clamp(s.effectiveHours / s.actualHours, .5, 1) : 1;
    m.pressure = asleep ? m.pressure * Math.exp(-quality * 15 / 180) : 1 - (1 - m.pressure) * Math.exp(-15 / 1080);
  }
  m.at = s.minute;
  if (stimuli.some((v) => v.action === "sleep" && v.success === false)) m.retryAt = Math.max(m.retryAt, at + 2);
  return m;
}
export function forecastSleep(c: VillageContext, m: SleepForecastMemory, hours: number, effort = 0, action = "awake") {
  return project(freeze(c, m, action), hours, effort);
}
export function canPlanSleep(c: VillageContext, m: SleepForecastMemory, at: number) {
  return at >= m.retryAt && c.needs!.sleep!.sleepiness >= .55 - .20 * night(c.needs!.sleep!.minute) && c.cold < 12;
}
export function predictSleepAction(c: VillageContext, m: SleepForecastMemory, action: VillageAttempt | undefined, id?: string, energyRate?: number) {
  if (m.pending) { m.excluded++; delete m.pending; }
  m.pending = freeze(c, m, action?.kind ?? "wait");
  if (id) m.pending.actionId = id;
  if (energyRate !== undefined) m.pending.energyRate = energyRate;
}
export function checkSleepForecast(m: SleepForecastMemory, hour: number) {
  if (m.version !== 1 || !Number.isSafeInteger(m.at) || m.at < 0 || m.at > hour * 60 || m.pressure < 0 || m.pressure > 1 ||
    !Number.isFinite(m.pressure) || [m.matched, m.excluded, m.retryAt].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    Object.keys(m.models).length > 16 || Object.values(m.models).some((e) => !Number.isSafeInteger(e.count) || e.count < 1 ||
      !Number.isFinite(e.bias) || Math.abs(e.bias) > .25 || !Number.isFinite(e.priorError) || e.priorError < 0 ||
      !Number.isFinite(e.learnedError) || e.learnedError < 0) || m.pending && (m.pending.minute > m.at ||
      !Number.isSafeInteger(m.pending.minute) || m.pending.minute < 0 || m.pending.minute % 15 !== 0 ||
      m.pending.at !== m.pending.minute / 60 || !Number.isFinite(m.pending.pressure) || m.pending.pressure < 0 || m.pending.pressure > 1 ||
      ![m.pending.energy, m.pending.maxEnergy, m.pending.cold, m.pending.bias ?? 0, m.pending.energyRate ?? 0].every(Number.isFinite) ||
      m.pending.history.length > 97 || m.pending.history.some((i, index) => ![i.from, i.to, i.quality].every(Number.isFinite) ||
        i.from >= i.to || i.to > m.pending!.minute || i.quality < .5 || i.quality > 1 || index > 0 && m.pending!.history[index - 1].to > i.from)))
    throw Error("invalid sleep forecast memory");
}
