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

/** Farmer's local crop routine inside the same five-person market and body loop. */
export const landEconomyVillageModel: VillageModel = { decide(input) {
  const ordinary = ordinaryVillageModel.decide(input);
  if (input.actorId === "C" && ordinary.attempts[0]?.kind === "relay_order" &&
    !input.knownContext.visiblePeople?.includes("F"))
    return { ...ordinary, attempts: [], wait: { at: input.at + 1 } };
  if (input.actorId !== "F") return ordinary;
  const c = input.knownContext, m = ordinary.subjectiveUpdate!;
  const done = (action: VillageAttempt["kind"]) => m.done.includes(action);
  let attempt: VillageAttempt | undefined;
  if (!c.activeAction) {
    if (c.hunger > 0 && c.ownFood > 0) attempt = { kind: "eat" };
    else if (c.cold > 0 && c.ownWood > 0) attempt = { kind: "burn_wood" };
    else if (c.siteId === "field") {
      if (!done("sow_plot")) {
        const tilled = c.visiblePlants.find((p) => p.species === "grain" && p.stage === "tilled");
        const bare = c.visiblePlants.find((p) => p.species === "grain" && p.stage === "bare");
        if (tilled) attempt = grainSkillAction(tilled.stage, tilled.id, c.farmingSkills.grain ?? 0);
        else if (bare) attempt = grainSkillAction(bare.stage, bare.id, c.farmingSkills.grain ?? 0);
      }
      if (!attempt && c.day >= 4 && !done("harvest_plot")) {
        const ripe = c.visiblePlants.find((p) => p.species === "grain" && p.stage === "ripe");
        if (ripe) attempt = grainSkillAction(ripe.stage, ripe.id, c.farmingSkills.grain ?? 0);
      }
      if (!attempt && (c.day < 4 || done("harvest_plot") || c.hourOfDay >= 15))
        attempt = { kind: "travel", siteId: "grove" };
    } else if (c.siteId === "grove") {
      if (c.day <= 3 && c.hunger > 0 && c.ownFood === 0 && !done("forage") &&
        (c.foodResource ?? 0) > 0) attempt = { kind: "forage", resource: "food", quantity: 1 };
      else if (!done("post_wood_bid")) attempt = { kind: "post_wood_bid", price: m.beliefs.woodPrice };
      else if (!done("sow_plot") || c.day >= 4 && !done("harvest_plot") && c.hourOfDay < 15)
        attempt = { kind: "travel", siteId: "field" };
      else if (m.knownOrder && !done("accept_food_order") && m.knownOrder.bid >= m.beliefs.foodBid)
        attempt = { kind: "accept_food_order", orderId: m.knownOrder.id };
      else if (done("accept_food_order") && !done("tender_food") && c.ownFood < 4 &&
        (c.foodResource ?? 0) >= 4)
        attempt = { kind: "forage", resource: "food", quantity: 4 };
      else if (done("accept_food_order") && !done("tender_food") && c.ownFood >= 4 && m.knownOrder)
        attempt = { kind: "tender_food", orderId: m.knownOrder.id, quantity: 4 };
    }
    if (!attempt && !done("rest") && (c.energy <= 5 || c.hourOfDay >= 16))
      attempt = { kind: "rest" };
    if (attempt?.kind !== "rest" && attempt && c.energy <
      (attempt.kind === "forage" ? attempt.quantity : attempt.kind === "travel" ? 1 :
        attempt.kind === "till_plot" || attempt.kind === "harvest_plot" ?
          c.farmingSkills.grain >= 2 ? 1 : 2 :
          attempt.kind === "sow_plot" || attempt.kind === "tender_food" ? 1 : 0))
      attempt = !done("rest") ? { kind: "rest" } : undefined;
  }
  return { ...ordinary, attempts: attempt ? [attempt] : [], wait: { at: input.at + (attempt ? 1 : 2) } };
} };
