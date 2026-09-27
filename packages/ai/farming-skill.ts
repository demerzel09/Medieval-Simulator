import { ordinaryVillageModel, type VillageAttempt, type VillageModel } from "./autonomous-world";

/** A crop-specific skill proposes work from the farmer's local observation. */
export function grainSkillAction(stage: string, plantId: string, level: number): VillageAttempt | undefined {
  if (level < 1) return undefined;
  if (stage === "bare") return { kind: "till_plot", plantId };
  if (stage === "tilled") return { kind: "sow_plot", plantId };
  if (stage === "ripe") return { kind: "harvest_plot", plantId };
  return undefined;
}

/** Demonstration personality that uses the grain skill while sharing the village gateway. */
export const cultivatorVillageModel: VillageModel = { decide(input) {
  if (input.actorId !== "F") return ordinaryVillageModel.decide(input);
  const context = input.knownContext;
  let attempt: VillageAttempt | undefined;
  if (context.hunger > 0 && context.ownFood > 0) attempt = { kind: "eat" };
  else if (context.energy < 3) attempt = { kind: "rest" };
  else if (context.siteId !== "field") attempt = { kind: "travel", siteId: "field" };
  else {
    const plot = context.visiblePlants.find((p) => p.species === "grain");
    if (plot) attempt = grainSkillAction(plot.stage, plot.id, context.farmingSkills.grain ?? 0);
  }
  return { attempts: attempt ? [attempt] : [],
    subjectiveUpdate: structuredClone(input.subjectiveState),
    wait: { at: input.at + (attempt ? 1 : 4) } };
} };
