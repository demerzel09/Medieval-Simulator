import type { VillageAttempt, VillageContext, VillageStimulus } from "./autonomous-world";

/** Self-observation only. Neither observations nor model keys contain hidden world state. */
export type ActionObservation = { fatigue?: number; nutritionNeed?: number; sleepiness?: number; sleepDeficit?: number; site: string; energy: number; maxEnergy: number; cold: number;
  debt: number; hunger: number; mass: number; cash: number; meals: number; raw: number; sheltered: boolean };
export function actionObservation(c: VillageContext): ActionObservation {
  return { site: c.siteId, energy: c.energy, maxEnergy: c.bulkTransport?.maxEnergy ?? c.energy,
    ...(c.needs?.sleep ? { sleepiness: c.needs.sleep.sleepiness, sleepDeficit: c.needs.sleep.deficitHours } : {}),
    ...(c.effortBody ? { fatigue: c.effortBody.fatigue, nutritionNeed: c.effortBody.nutritionNeed } : {}),
    cold: c.cold, debt: c.needs?.sleepDebt ?? 0, hunger: c.hunger, mass: c.carriedMass,
    cash: c.ownCash, meals: c.edibleMeals ?? 0, raw: (c.grainCarried ?? 0) + (c.grainStores ?? []).reduce((n, s) => n + s.grain, 0),
    sheltered: c.needs?.sheltered ?? false };
}
export type ActionExecution = { phase: "started" | "completed" | "failed" | "rejected" | "interrupted" | "superseded";
  sleep?: { actualHours: number; waitHours: number; endedMinute: number; reason: string };
  predictionId?: string; attemptEventId: string; processId?: string; startedAt: number; elapsedHours: number;
  before: ActionObservation; after: ActionObservation };
type Mean = { count: number; mean: number };
type ConditionModel = { samples: number; energyRate?: Mean; completedHours?: Mean; success: Mean;
  priorError: Mean; learnedError: Mean; updatedAt: number };
export type ActionPrediction = { id: string; action: VillageAttempt["kind"]; key: string; madeAt: number;
  expiresAt: number; before: ActionObservation; expectedHours: number; priorRate: number; learnedRate?: number;
  selected: "prior" | "experience"; processId?: string; attemptEventId?: string };
export type ActionOutcome = { prediction: ActionPrediction; status: ActionExecution["phase"] | "unobserved";
  sleep?: ActionExecution["sleep"];
  at: number; evidenceIds: string[]; elapsedHours?: number; energyChange?: number; error?: number;
  mealsChange?: number; cashChange?: number; massChange?: number; debtChange?: number; rawChange?: number };
export type ActionLearningMemory = { version: 1; nextId: number; pending: ActionPrediction[];
  recent: ActionOutcome[]; models: Record<string, ConditionModel>;
  totals: { predicted: number; matched: number; excluded: number; scored: number; absoluteError: number } };
export const newActionLearning = (): ActionLearningMemory => ({ version: 1, nextId: 1, pending: [], recent: [], models: {},
  totals: { predicted: 0, matched: 0, excluded: 0, scored: 0, absoluteError: 0 } });
const mean = (m: Mean | undefined, value: number): Mean => ({ count: (m?.count ?? 0) + 1,
  mean: (m?.mean ?? 0) + (value - (m?.mean ?? 0)) / ((m?.count ?? 0) + 1) });
export function actionCondition(action: VillageAttempt["kind"], o: ActionObservation) {
  // A load of grain and the same load of another item share one effort model.
  return o.fatigue !== undefined ? `${action}:v22:load${Math.floor(o.mass / 4)}:${o.sheltered ? "inside" : "outside"}:supply${o.nutritionNeed! > .75 ? 0 : 1}` : o.sleepiness !== undefined ? `${action}:v20:load${Math.floor(o.mass / 4)}:${o.sheltered ? "inside" : "outside"}:cold${o.cold >= 8 ? 1 : 0}:sleepy${o.sleepiness >= .65 ? 1 : 0}` :
    `${action}:load${Math.floor(o.mass / 4)}:${o.sheltered ? "inside" : "outside"}:cold${o.cold >= 8 ? 1 : 0}:debt${o.debt >= 24 ? 1 : 0}`;
}
function priorRate(action: VillageAttempt["kind"], o: ActionObservation): number {
  const exposure = o.cold >= 8 ? 1 : !o.sheltered ? 0.4 : 0;
  const debt = (o.sleepiness !== undefined ? o.sleepiness >= .65 : o.debt >= 20) ? 0.25 : 0;
  if (action === "travel") return -(1 + o.mass / 8 + exposure + debt);
  if (action === "rest") return 2 - exposure - debt;
  if (action === "sleep") return (o.sleepiness !== undefined ? 2 * Math.max(.5, 1 - .5 * o.cold / 12) : o.sheltered ? 2 : 1) - exposure;
  if (["gather_plant", "harvest_plot", "till_plot", "sow_plot", "bake_bread"].includes(action)) return -(1 + exposure + debt);
  return 0;
}
/** Competing subjective models. The world movement law is deliberately not consulted here. */
export function effortForecast(memory: ActionLearningMemory | undefined, action: VillageAttempt["kind"], o: ActionObservation) {
  const key = actionCondition(action, o), model = memory?.models[key];
  const initial = priorRate(action, o), learned = model?.energyRate?.mean;
  const useExperience = learned !== undefined && model!.energyRate!.count >= 2 &&
    model!.learnedError.count >= 2 && model!.learnedError.mean <= model!.priorError.mean;
  return { key, priorRate: initial, ...(learned === undefined ? {} : { learnedRate: learned }),
    rate: useExperience ? learned! : initial, selected: useExperience ? "experience" as const : "prior" as const,
    samples: model?.energyRate?.count ?? 0 };
}
function close(m: ActionLearningMemory, outcome: ActionOutcome) {
  m.pending = m.pending.filter((p) => p.id !== outcome.prediction.id);
  m.recent.push(outcome); if (m.recent.length > 4) m.recent.shift();
  if (["completed", "failed", "interrupted"].includes(outcome.status)) m.totals.matched++;
  else m.totals.excluded++;
  if (outcome.error !== undefined) { m.totals.scored++; m.totals.absoluteError += Math.abs(outcome.error); }
}
export function beginActionPrediction(m: ActionLearningMemory, actor: string, at: number, c: VillageContext,
  action: VillageAttempt, hours: number) {
  if (m.pending.length >= 8) close(m, { prediction: structuredClone(m.pending[0]), status: "unobserved", at, evidenceIds: [] });
  const before = actionObservation(c), f = effortForecast(m, action.kind, before);
  const p: ActionPrediction = { id: `${actor}:action:${m.nextId++}`, action: action.kind, key: f.key, madeAt: at,
    expiresAt: at + Math.max(48, Math.ceil(hours * 4 + 8)), before, expectedHours: hours,
    priorRate: f.priorRate, ...(f.learnedRate === undefined ? {} : { learnedRate: f.learnedRate }), selected: f.selected };
  m.pending.push(p); m.totals.predicted++; action.experienceId = p.id; return p;
}
const energyChange = (p: ActionPrediction, rate: number, hours: number) =>
  Math.max(0, Math.min(p.before.maxEnergy, p.before.energy + rate * hours)) - p.before.energy;
/** Freeze both forecasts before acting; score them only against matching, delivered execution evidence. */
export function receiveActionOutcomes(m: ActionLearningMemory, stimuli: VillageStimulus[], at: number) {
  for (const s of stimuli) {
    const e = s.kind === "result" ? s.experience : undefined;
    if (!e?.predictionId || s.receivedAt > at || s.occurredAt > at || s.receivedAt < s.occurredAt) continue;
    const p = m.pending.find((p) => p.id === e.predictionId);
    if (!p || s.action !== p.action || e.startedAt !== p.madeAt || s.occurredAt < p.madeAt ||
      e.elapsedHours !== s.occurredAt - e.startedAt || JSON.stringify(e.before) !== JSON.stringify(p.before)) continue;
    if (e.phase === "started") {
      if (e.processId && (!p.processId || p.processId === e.processId && p.attemptEventId === e.attemptEventId)) {
        p.processId = e.processId; p.attemptEventId = e.attemptEventId;
      }
      continue;
    }
    if (e.processId && (e.processId !== p.processId || e.attemptEventId !== p.attemptEventId)) continue;
    if (!e.processId && p.processId) continue;
    const outcome: ActionOutcome = { prediction: structuredClone(p), status: e.phase, at: s.occurredAt, evidenceIds: [...s.causeEventIds] };
    if (["completed", "failed", "interrupted"].includes(e.phase)) {
      const actual = e.after.energy - e.before.energy;
      Object.assign(outcome, { elapsedHours: e.elapsedHours, energyChange: actual, mealsChange: e.after.meals - e.before.meals,
        ...(e.sleep ? { sleep: structuredClone(e.sleep) } : {}),
        cashChange: e.after.cash - e.before.cash, massChange: e.after.mass - e.before.mass, debtChange: e.after.debt - e.before.debt,
        rawChange: e.after.raw - e.before.raw });
      // Failed/redirected durations describe observed effort, never time to successful completion.
      const priorError = Math.abs(actual - energyChange(p, p.priorRate, e.elapsedHours));
      const learnedError = p.learnedRate === undefined ? undefined : Math.abs(actual - energyChange(p, p.learnedRate, e.elapsedHours));
      outcome.error = actual - energyChange(p, p.selected === "experience" ? p.learnedRate! : p.priorRate, e.elapsedHours);
      // Instantaneous effects remain in the outcome history, without a redundant condition model.
      if (e.elapsedHours === 0) { close(m, outcome); continue; }
      const model = m.models[p.key] ??= { samples: 0, success: { count: 0, mean: 0 },
        priorError: { count: 0, mean: 0 }, learnedError: { count: 0, mean: 0 }, updatedAt: at };
      model.samples++; model.updatedAt = at; model.success = mean(model.success, e.phase === "completed" ? 1 : 0);
      if (e.phase === "completed" && e.elapsedHours > 0) model.completedHours = mean(model.completedHours, e.elapsedHours);
      if (e.elapsedHours > 0) {
        // Compare both models on exactly the same episodes; the first untrained trial is not paired.
        if (learnedError !== undefined) {
          model.priorError = mean(model.priorError, priorError); model.learnedError = mean(model.learnedError, learnedError);
        }
        // Saturated recovery cannot reveal the underlying recovery rate.
        if (e.after.energy > 0 && !(["rest", "sleep"].includes(p.action) && e.after.energy === e.after.maxEnergy))
          model.energyRate = mean(model.energyRate, actual / e.elapsedHours);
      }
      if (Object.keys(m.models).length > 16) delete m.models[Object.keys(m.models).sort((a, b) => m.models[a].updatedAt - m.models[b].updatedAt)[0]];
    }
    close(m, outcome);
  }
  for (const p of [...m.pending]) if (at >= p.expiresAt) close(m, { prediction: structuredClone(p), status: "unobserved", at, evidenceIds: [] });
}
export function checkActionLearning(m: ActionLearningMemory, at: number) {
  const finite = (n: number) => Number.isFinite(n);
  const validObservation = (o: ActionObservation) => typeof o.site === "string" && !!o.site && typeof o.sheltered === "boolean" &&
    Object.values(o).every((v) => typeof v !== "number" || finite(v) && v >= 0) && o.maxEnergy >= 1 && o.energy <= o.maxEnergy;
  const validPrediction = (p: ActionPrediction) => p.id && p.key && Number.isSafeInteger(p.madeAt) && p.madeAt <= at && p.madeAt >= 0 &&
    Number.isSafeInteger(p.expiresAt) && p.expiresAt > p.madeAt && finite(p.expectedHours) && p.expectedHours >= 0 && finite(p.priorRate) &&
    (p.learnedRate === undefined || finite(p.learnedRate)) && (p.selected === "prior" || p.selected === "experience" && p.learnedRate !== undefined) &&
    validObservation(p.before) && p.key === actionCondition(p.action, p.before) && (!p.processId && !p.attemptEventId || !!p.processId && !!p.attemptEventId);
  const t = m.totals;
  if (m.version !== 1 || !Number.isSafeInteger(m.nextId) || m.nextId < 1 || m.pending.length > 8 || m.recent.length > 4 ||
    Object.keys(m.models).length > 16 || [...m.pending, ...m.recent.map((o) => o.prediction)].some((p) => !validPrediction(p)) ||
    new Set([...m.pending, ...m.recent.map((o) => o.prediction)].map((p) => p.id)).size !== m.pending.length + m.recent.length ||
    m.recent.some((o) => !Number.isSafeInteger(o.at) || o.at > at || o.at < o.prediction.madeAt ||
      !["completed", "failed", "interrupted", "rejected", "superseded", "unobserved"].includes(o.status) ||
      [o.energyChange, o.error, o.mealsChange, o.cashChange, o.massChange, o.debtChange, o.rawChange].some((n) => n !== undefined && !finite(n))) ||
    Object.values(m.models).some((model) => !Number.isSafeInteger(model.updatedAt) || model.updatedAt < 0 || model.updatedAt > at ||
      !Number.isSafeInteger(model.samples) || model.samples < 1 || Object.values(model).some((value) =>
      typeof value === "object" && (!Number.isSafeInteger(value.count) || value.count < 0 || !finite(value.mean)))) ||
    [t.predicted, t.matched, t.excluded, t.scored].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    t.predicted !== t.matched + t.excluded + m.pending.length || t.scored > t.matched || !finite(t.absoluteError) || t.absoluteError < 0)
    throw Error("invalid action learning memory");
}
