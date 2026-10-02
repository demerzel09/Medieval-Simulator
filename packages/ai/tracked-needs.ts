import { anticipatoryNeedsVillageModel, checkAnticipationMemory, updateEstimate } from "./anticipatory-needs";
import type { VillageModel } from "./autonomous-world";
import { beginTravelPrediction, checkPredictionLedger, newPredictionLedger, receiveTravelOutcomes,
  rememberTravelSites } from "./prediction-ledger";

/** Stage A: keep v12 action priorities, learn travel duration only from matched delivered completion. */
export const trackedNeedsVillageModel: VillageModel = { decide(input) {
  if (!input.knownContext.predictionLedger || !input.knownContext.needs)
    throw Error("tracked needs requires prediction ledger fixture");
  const state = structuredClone(input.subjectiveState);
  const ledger = state.anticipation?.predictions ?? newPredictionLedger();
  if (state.anticipation) {
    delete state.anticipation.trip; // Current location and decision time cannot identify a completed trip.
    for (const outcome of receiveTravelOutcomes(ledger, input.stimuli, input.at)) if (outcome.status === "completed") {
      const key = `${outcome.prediction.from}>${outcome.prediction.to}`;
      state.anticipation.travelTimes[key] = updateEstimate(state.anticipation.travelTimes[key], outcome.actualHours!);
    }
  }
  const response = anticipatoryNeedsVillageModel.decide({ ...input, subjectiveState: state });
  const m = response.subjectiveUpdate!.anticipation!;
  m.predictions = ledger; delete m.trip;
  rememberTravelSites(ledger, input.knownContext);
  const chosen = response.attempts[0];
  if (chosen?.kind === "travel") {
    const key = `${input.knownContext.siteId}>${chosen.siteId}`;
    const p = beginTravelPrediction(ledger, input.actorId, input.at, input.knownContext, chosen.siteId,
      m.travelTimes[key], input.stimuli.flatMap((s) => s.causeEventIds));
    chosen.predictionId = p.id;
  }
  checkPredictionLedger(ledger, input.at); checkAnticipationMemory(m, input.at);
  return response;
} };
