import type { VillageContext, VillageStimulus } from "./autonomous-world";

export type TravelPrediction = {
  id: string; madeAt: number; expiresAt: number; from: string; to: string; carriedMass: number;
  source: "route-experience" | "distance-prior" | "unknown-destination";
  expectedHours?: number; margin?: number; estimateCount: number; modelVersion: 1;
  evidenceIds: string[]; processId?: string; attemptEventId?: string; startedAt?: number;
};
export type TravelOutcome = {
  prediction: TravelPrediction; occurredAt: number; receivedAt: number;
  status: "completed" | "failed" | "redirected" | "rejected" | "superseded" | "unobserved";
  evidenceIds: string[]; actualHours?: number; errorHours?: number; exclusionReason?: string;
};
export type PredictionLedger = {
  version: 1; nextId: number; pending: TravelPrediction[]; recent: TravelOutcome[];
  knownSites: Record<string, { x: number; y: number }>;
  totals: { predicted: number; completed: number; excluded: number; scored: number;
    absoluteError: number; signedError: number; squaredError: number };
};
export const newPredictionLedger = (): PredictionLedger => ({ version: 1, nextId: 1, pending: [], recent: [], knownSites: {},
  totals: { predicted: 0, completed: 0, excluded: 0, scored: 0, absoluteError: 0, signedError: 0, squaredError: 0 } });
function close(ledger: PredictionLedger, outcome: TravelOutcome) {
  ledger.pending = ledger.pending.filter((p) => p.id !== outcome.prediction.id);
  ledger.recent.push(outcome); if (ledger.recent.length > 24) ledger.recent.shift();
  if (outcome.status === "completed") ledger.totals.completed++;
  else ledger.totals.excluded++;
  if (outcome.errorHours !== undefined) {
    ledger.totals.scored++;
    ledger.totals.absoluteError += Math.abs(outcome.errorHours);
    ledger.totals.signedError += outcome.errorHours;
    ledger.totals.squaredError += outcome.errorHours ** 2;
  }
}

/** Match delivered evidence to the frozen pre-action forecast, never to the current location. */
export function receiveTravelOutcomes(ledger: PredictionLedger, stimuli: VillageStimulus[], at: number): TravelOutcome[] {
  const closed: TravelOutcome[] = [];
  for (const stimulus of stimuli) {
    const travel = stimulus.kind === "result" ? stimulus.travel : undefined;
    if (!travel?.predictionId || stimulus.receivedAt > at || stimulus.occurredAt > at ||
      stimulus.receivedAt < stimulus.occurredAt) continue;
    const p = ledger.pending.find((p) => p.id === travel.predictionId);
    if (!p || stimulus.occurredAt < p.madeAt) continue;
    if (travel.phase === "started") {
      if (travel.destinationId === p.to && travel.processId && travel.startedAt === p.madeAt &&
          (!p.processId || p.processId === travel.processId && p.attemptEventId === travel.attemptEventId)) {
        p.processId = travel.processId; p.attemptEventId = travel.attemptEventId; p.startedAt = travel.startedAt;
      }
      continue;
    }
    const terminalProcess = ["completed", "failed", "redirected"].includes(travel.phase);
    if (terminalProcess && (!p.processId || travel.processId !== p.processId ||
      travel.startedAt !== p.startedAt || travel.attemptEventId !== p.attemptEventId)) continue;
    if (travel.phase !== "redirected" && travel.destinationId !== p.to) continue;
    const outcome: TravelOutcome = { prediction: structuredClone(p), status: travel.phase,
      occurredAt: stimulus.occurredAt, receivedAt: at, evidenceIds: [...stimulus.causeEventIds] };
    if (travel.phase === "completed") {
      const elapsed = stimulus.occurredAt - p.startedAt!;
      if (elapsed < 1 || travel.elapsedHours !== elapsed) continue;
      outcome.actualHours = elapsed;
      if (p.expectedHours !== undefined) outcome.errorHours = elapsed - p.expectedHours;
      else outcome.exclusionReason = "no pre-action duration estimate";
    } else outcome.exclusionReason = stimulus.reason ?? travel.phase;
    close(ledger, outcome); closed.push(outcome);
  }
  // Process all delivered evidence first: a valid delayed outcome can still close an overdue prediction.
  for (const p of [...ledger.pending]) if (at >= p.expiresAt) {
    const outcome: TravelOutcome = { prediction: structuredClone(p), status: "unobserved",
      occurredAt: at, receivedAt: at, evidenceIds: [], exclusionReason: "outcome deadline passed" };
    close(ledger, outcome); closed.push(outcome);
  }
  return closed;
}

/** Only places observed locally or explicitly present in the actor's own context become known. */
export function rememberTravelSites(ledger: PredictionLedger, c: VillageContext) {
  if (!c.siteId.startsWith("transit_")) ledger.knownSites[c.siteId] = { ...c.cell };
  if (c.needs) ledger.knownSites[c.needs.home.siteId] = { ...c.needs.home.cell };
  for (const plant of c.visiblePlants) if (plant.siteId && plant.cell) ledger.knownSites[plant.siteId] = { ...plant.cell };
}

export function beginTravelPrediction(ledger: PredictionLedger, actorId: string, at: number,
  c: VillageContext, to: string, estimate: { count: number; mean: number; m2: number } | undefined,
  evidenceIds: string[]): TravelPrediction {
  if (ledger.pending.length >= 16) close(ledger, { prediction: structuredClone(ledger.pending[0]), status: "unobserved",
    occurredAt: at, receivedAt: at, evidenceIds: [], exclusionReason: "pending capacity reached" });
  const target = ledger.knownSites[to];
  const expectedHours = estimate ? Math.max(1, estimate.mean) : target ? Math.max(1,
    Math.ceil(Math.max(Math.abs(target.x - c.cell.x), Math.abs(target.y - c.cell.y)) *
      (1 + Math.floor(c.carriedMass / 20)) / 16)) : undefined;
  const p: TravelPrediction = { id: `${actorId}:travel:${ledger.nextId++}`, madeAt: at,
    expiresAt: at + Math.max(48, Math.ceil((expectedHours ?? 1) * 4 + 8)), from: c.siteId, to,
    carriedMass: c.carriedMass, source: estimate ? "route-experience" : target ? "distance-prior" : "unknown-destination",
    ...(expectedHours === undefined ? {} : { expectedHours, margin: estimate && estimate.count > 1 ?
      Math.sqrt(Math.max(0, estimate.m2) / (estimate.count - 1)) : 1 }),
    estimateCount: estimate?.count ?? 0, modelVersion: 1, evidenceIds: [...new Set(evidenceIds)] };
  ledger.pending.push(p); ledger.totals.predicted++;
  return p;
}

export function checkPredictionLedger(ledger: PredictionLedger, at: number) {
  const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
  const time = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= at;
  const validPrediction = (p: TravelPrediction) => p.modelVersion === 1 && !!p.id && !!p.from && !!p.to &&
    time(p.madeAt) && Number.isSafeInteger(p.expiresAt) && p.expiresAt > p.madeAt &&
    nonnegative(p.carriedMass) && Number.isSafeInteger(p.estimateCount) && p.estimateCount >= 0 &&
    (p.expectedHours === undefined || nonnegative(p.expectedHours) && p.expectedHours >= 1) &&
    (p.margin === undefined || nonnegative(p.margin)) && (p.startedAt === undefined || time(p.startedAt)) &&
    ["route-experience", "distance-prior", "unknown-destination"].includes(p.source) &&
    (p.source !== "unknown-destination" || p.expectedHours === undefined) &&
    (p.source === "unknown-destination" || p.expectedHours !== undefined) &&
    (p.processId === undefined && p.startedAt === undefined && p.attemptEventId === undefined ||
      !!p.processId && !!p.attemptEventId && p.startedAt === p.madeAt) &&
    Array.isArray(p.evidenceIds) && p.evidenceIds.every((id) => typeof id === "string");
  const t = ledger.totals;
  if (ledger.version !== 1 || !Number.isSafeInteger(ledger.nextId) || ledger.nextId < 1 ||
    ledger.pending.length > 16 || ledger.recent.length > 24 ||
    new Set([...ledger.pending.map((p) => p.id), ...ledger.recent.map((o) => o.prediction.id)]).size !==
      ledger.pending.length + ledger.recent.length ||
    ledger.pending.some((p) => !validPrediction(p)) || ledger.recent.some((o) => !validPrediction(o.prediction) ||
      !["completed", "failed", "redirected", "rejected", "superseded", "unobserved"].includes(o.status) ||
      !time(o.occurredAt) || !time(o.receivedAt) || o.receivedAt < o.occurredAt ||
      o.occurredAt < o.prediction.madeAt || !Array.isArray(o.evidenceIds) ||
      (o.status === "completed" ? !o.prediction.processId || o.actualHours !== o.occurredAt - o.prediction.startedAt! ||
        o.errorHours !== (o.prediction.expectedHours === undefined ? undefined : o.actualHours! - o.prediction.expectedHours) :
        o.actualHours !== undefined || o.errorHours !== undefined) ||
      o.actualHours !== undefined && (!nonnegative(o.actualHours) || o.actualHours < 1) ||
      o.errorHours !== undefined && !Number.isFinite(o.errorHours)) ||
    Object.values(ledger.knownSites).some((p) => !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) ||
    [t.predicted, t.completed, t.excluded, t.scored].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    t.predicted !== t.completed + t.excluded + ledger.pending.length || t.scored > t.completed ||
    !nonnegative(t.absoluteError) || !nonnegative(t.squaredError) || !Number.isFinite(t.signedError))
    throw Error("invalid prediction ledger");
}
