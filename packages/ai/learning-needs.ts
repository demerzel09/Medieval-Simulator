import { beginActionPrediction, checkActionLearning, newActionLearning, receiveActionOutcomes } from "./action-learning";
import type { VillageModel } from "./autonomous-world";
import { trackedNeedsVillageModel } from "./tracked-needs";
import { forecastSleep, predictSleepAction } from "./sleep-forecast";

/** v17: learn from completed, failed and atomic execution; keep existing travel provenance. */
export const learningNeedsVillageModel: VillageModel = { decide(input) {
  if (!input.knownContext.experienceLearning) throw Error("learning needs requires experience fixture");
  const state = structuredClone(input.subjectiveState);
  const learning = state.anticipation?.learning ?? newActionLearning();
  receiveActionOutcomes(learning, input.stimuli, input.at);
  if (state.anticipation) state.anticipation.learning = learning;
  const response = trackedNeedsVillageModel.decide({ ...input, subjectiveState: state });
  const m = response.subjectiveUpdate!.anticipation!; m.learning = learning;
  const action = response.attempts[0];
  if (action) {
    const travel = action.kind === "travel" ? m.predictions!.pending.find((p) => p.id === action.predictionId) : undefined;
    const hours = action.kind === "travel" ? travel?.expectedHours ?? 1 : action.kind === "sleep" ?
      (input.knownContext.sleepRegulation ? forecastSleep(input.knownContext, m.sleep!, 24, 0, "sleep").expectedHours : 8) :
      action.kind === "rest" || action.kind === "bake_bread" ? 2 :
      action.kind === "gather_plant" ? action.quantity :
      ["till_plot", "harvest_plot"].includes(action.kind) ? (input.knownContext.farmingSkills.grain >= 2 ? 1 : 2) :
      action.kind === "sow_plot" ? 1 : 0;
    const p = beginActionPrediction(learning, input.actorId, input.at, input.knownContext, action, hours);
    if (input.knownContext.sleepRegulation) predictSleepAction(input.knownContext, m.sleep!, action, p.id, p.selected === "experience" ? p.learnedRate : p.priorRate);
  }
  else if (input.knownContext.sleepRegulation) predictSleepAction(input.knownContext, m.sleep!, undefined);
  checkActionLearning(learning, input.at); return response;
} };
