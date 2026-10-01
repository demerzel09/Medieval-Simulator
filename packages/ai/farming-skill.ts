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
  const done = (action: VillageAttempt["kind"]) =>
    action === "post_wood_bid" && c.woodEnabled === false || m.done.includes(action);
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

/** Spatial farmer: each crop action requires arrival at that crop's own cell. */
export const spatialLandEconomyVillageModel: VillageModel = { decide(input) {
  const ordinary = landEconomyVillageModel.decide(input);
  if (input.actorId !== "F") return ordinary;
  const c = input.knownContext, m = ordinary.subjectiveUpdate!;
  const done = (action: VillageAttempt["kind"]) =>
    action === "post_wood_bid" && c.woodEnabled === false || m.done.includes(action);
  let attempt: VillageAttempt | undefined;
  if (!c.activeAction) {
    if (c.hunger > 0 && c.ownFood > 0) attempt = { kind: "eat" };
    else if (c.cold > 0 && c.ownWood > 0) attempt = { kind: "burn_wood" };
    else if (c.siteId === "grove") {
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
    } else if (c.siteId === "field" || c.siteId.startsWith("grain_plot")) {
      const crops = c.visiblePlants.filter((p) => p.species === "grain");
      const next = !done("sow_plot") ?
        crops.find((p) => p.stage === "tilled") ?? crops.find((p) => p.stage === "bare") :
        undefined;
      const ripe = c.day >= 4 && !done("harvest_plot") ?
        crops.find((p) => p.stage === "ripe") : undefined;
      const target = next ?? ripe;
      if (target) attempt = c.siteId === target.siteId ?
        grainSkillAction(target.stage, target.id, c.farmingSkills.grain ?? 0) :
        { kind: "travel", siteId: target.siteId! };
      else if (c.siteId !== "field" && !done("sow_plot") && c.hourOfDay < 15)
        attempt = { kind: "travel", siteId: "field" };
      else if (done("sow_plot") && (c.day < 4 || done("harvest_plot") || c.hourOfDay >= 15))
        attempt = { kind: "travel", siteId: "grove" };
      else if (c.siteId !== "field") attempt = { kind: "travel", siteId: "field" };
    }
    if (!attempt && !done("rest") && (c.energy <= 6 || c.hourOfDay >= 17))
      attempt = { kind: "rest" };
    if (attempt?.kind !== "rest" && attempt && c.energy <
      (attempt.kind === "travel" ? 1 : attempt.kind === "forage" ? attempt.quantity : 1))
      attempt = !done("rest") ? { kind: "rest" } : undefined;
  }
  return { ...ordinary, attempts: attempt ? [attempt] : [], wait: { at: input.at + (attempt ? 1 : 2) } };
} };

/** Local plant recognition chooses a short wild-food excursion without delaying the crop day. */
export const exploringLandEconomyVillageModel: VillageModel = { decide(input) {
  const ordinary = spatialLandEconomyVillageModel.decide(input);
  if (input.actorId !== "F" || !input.knownContext.foragingSkill ||
    input.knownContext.activeAction) return ordinary;
  const c = input.knownContext;
  if (c.day > 3 || c.siteId !== "grove" || c.hunger === 0 || c.ownFood > 0 || c.energy < 1 ||
    ordinary.attempts[0]?.kind !== "forage" || ordinary.attempts[0].resource !== "food" ||
    ordinary.attempts[0].quantity !== 1) return ordinary;
  const candidates = c.visiblePlants.filter((p) => ["herb", "fruit_tree"].includes(p.species) &&
    p.stage === "ripe" && p.available > 0 && p.siteId && p.cell)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!candidates.length) return ordinary;
  const target = candidates[(c.day - 1) % candidates.length];
  return { ...ordinary, attempts: [{ kind: "forage_route", plantId: target.id }],
    wait: { at: input.at + 1 } };
} };

/** The ecological run also samples the fruit tree before the crop harvest starts. */
export const ecologicalLandEconomyVillageModel: VillageModel = { decide(input) {
  const ordinary = exploringLandEconomyVillageModel.decide(input);
  if (input.actorId !== "F" || input.knownContext.day !== 3 ||
    ordinary.attempts[0]?.kind !== "forage_route") return ordinary;
  const fruit = input.knownContext.visiblePlants.find((p) => p.species === "fruit_tree" &&
    p.stage === "ripe" && p.available > 0 && p.siteId === "orchard_2");
  return fruit ? { ...ordinary, attempts: [{ kind: "forage_route", plantId: fruit.id }] } : ordinary;
} };

/** Each independent farmer works only the crops in their own locally observed field. */
export const ownedFarmsVillageModel: VillageModel = { decide(input) {
  const ordinary = ordinaryVillageModel.decide(input);
  const c = input.knownContext, farm = c.ownFarm;
  if (!farm) {
    const chosen = ordinary.attempts[0];
    if (input.actorId === "C" && chosen?.kind === "relay_order" && !c.visiblePeople?.includes("F"))
      return { ...ordinary, attempts: [], wait: { at: input.at + 1 } };
    if (chosen?.kind === "post_food_order" && c.ownCash < chosen.quantity * chosen.bid + chosen.carrierFee)
      return { ...ordinary, attempts: [], wait: { at: input.at + 2 } };
    return ordinary;
  }
  const m = ordinary.subjectiveUpdate!;
  const emergencyCrop = c.hunger > 0 && c.ownFood === 0 ? c.visiblePlants.find((p) =>
    p.species === "grain" && p.ownerId === input.actorId && p.stage === "ripe") : undefined;
  let attempt: VillageAttempt | undefined;
  if (!c.activeAction) {
    if (c.hunger > 0 && c.ownFood > 0) attempt = { kind: "eat" };
    else if (c.energy < 8 && !m.done.includes("rest")) attempt = { kind: "rest" };
    else if (emergencyCrop) attempt = c.siteId === emergencyCrop.siteId ?
      grainSkillAction(emergencyCrop.stage, emergencyCrop.id, c.farmingSkills.grain ?? 0) :
      { kind: "travel", siteId: emergencyCrop.siteId! };
    else if (!c.publicForaging && input.actorId === "F" && c.siteId === "grove" && m.knownOrder &&
      !m.done.includes("accept_food_order"))
      attempt = { kind: "accept_food_order", orderId: m.knownOrder.id };
    else if (!c.publicForaging && input.actorId === "F" && c.siteId === "grove" && m.knownOrder &&
      m.done.includes("accept_food_order") && !m.done.includes("tender_food") && c.ownFood >= 4)
      attempt = { kind: "tender_food", orderId: m.knownOrder.id, quantity: 4 };
    else if (!c.publicForaging && input.actorId === "F" && c.hourOfDay >= 9 && c.hourOfDay <= 16 && c.siteId !== "grove")
      attempt = { kind: "travel", siteId: "grove" };
    else if (!c.publicForaging && input.actorId === "F" && c.siteId === "grove" && c.hourOfDay >= 9 && c.hourOfDay <= 16) {
      // Wait for the physically arriving carrier rather than reading a remote order.
    } else if (c.hourOfDay >= 17) {
      if (!c.publicForaging && input.actorId === "F" && c.siteId === "grove") attempt = { kind: "travel", siteId: farm.siteId };
      else if (!m.done.includes("rest")) attempt = { kind: "rest" };
    } else {
      const crops = c.visiblePlants.filter((p) => p.species === "grain" &&
        p.ownerId === input.actorId && p.farmId === farm.id);
      const target = (c.ownFood < 5 ? crops.find((p) => p.stage === "ripe") : undefined) ??
        crops.find((p) => p.stage === "tilled") ?? crops.find((p) => p.stage === "bare");
      if (target) attempt = c.siteId === target.siteId ?
        grainSkillAction(target.stage, target.id, c.farmingSkills.grain ?? 0) :
        { kind: "travel", siteId: target.siteId! };
      else if (c.spatialForaging && !farm.plotIds.includes(c.siteId) && c.siteId !== "market")
        attempt = { kind: "travel", siteId: farm.plotIds[0] };
      else if (!c.spatialForaging && c.siteId !== farm.siteId) attempt = { kind: "travel", siteId: farm.siteId };
    }
    if (attempt?.kind === "travel") {
      const effort = (1 + Math.floor(c.carriedMass / 20)) * (1 + Math.floor(c.carriedMass / 10));
      if (c.energy < effort) attempt = !m.done.includes("rest") ? { kind: "rest" } : undefined;
    }
  }
  return { ...ordinary, attempts: attempt ? [attempt] : [], wait: { at: input.at + (attempt ? 1 : 2) } };
} };

/** Eating gathered food requires no money; market offers use only personal surplus. */
export const wildFoodMarketVillageModel: VillageModel = { decide(input) {
  let base = ownedFarmsVillageModel.decide(input);
  const c = input.knownContext;
  // The old fixed four-unit wholesale demonstration is separate from these local offers.
  if (c.publicForaging && base.attempts[0] && ["post_food_order", "fund_carriage", "accept_carriage",
    "relay_order", "accept_food_order", "tender_food", "purchase_food", "deliver_food", "post_sale_quote"]
    .includes(base.attempts[0].kind)) base = { ...base, attempts: [], wait: { at: input.at + 2 } };
  if (!c.publicForaging || c.activeAction) return base;
  const m = base.subjectiveUpdate!, meals = c.edibleMeals ?? 0;
  let attempt: VillageAttempt | undefined;
  if (c.hunger > 0 && meals > 0) attempt = { kind: "eat" };
  else if (c.hunger > 0) {
    if (c.energy < 6 && !m.done.includes("rest")) attempt = { kind: "rest" };
    else {
      const offer = c.visibleFoodOffers?.filter((o) => o.price <= c.ownCash && o.price <= 2)
        .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
      const wild = c.visiblePlants.filter((p) => ["herb", "wild_berry", "fruit_tree"].includes(p.species) &&
        p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1) && p.cell)
        .sort((a, b) => Math.max(Math.abs(a.cell!.x - c.cell.x), Math.abs(a.cell!.y - c.cell.y)) -
          Math.max(Math.abs(b.cell!.x - c.cell.x), Math.abs(b.cell!.y - c.cell.y)) || a.id.localeCompare(b.id))[0];
      const crop = c.visiblePlants.find((p) => p.ownerId === input.actorId && p.species === "grain" && p.stage === "ripe");
      if (crop) attempt = c.siteId === crop.siteId ? { kind: "harvest_plot", plantId: crop.id } :
        { kind: "travel", siteId: crop.siteId! };
      else if (offer) attempt = { kind: "buy_surplus", offerId: offer.id };
      else if (wild && c.energy >= 1) {
        const quantity = wild.species === "herb" ? 2 : Math.min(3, wild.available);
        attempt = c.spatialForaging ? c.siteId === wild.siteId ?
          { kind: "gather_plant", plantId: wild.id, quantity } : { kind: "travel", siteId: wild.siteId! } :
          { kind: "forage_route", plantId: wild.id, quantity };
      }
      else if (c.siteId !== "grove" && c.energy >= 6) attempt = { kind: "travel", siteId: "grove" };
      else if (!m.done.includes("rest")) attempt = { kind: "rest" };
    }
    return { ...base, attempts: attempt ? [attempt] : [], wait: { at: input.at + (attempt ? 1 : 2) } };
  } else if (meals >= 2 && c.hourOfDay >= 10 && c.hourOfDay <= 16 && !m.done.includes("post_surplus_offer")) {
    const lot = c.ownFoodLots?.find((lot) => !lot.offered && lot.quantity >= lot.mealQuantity);
    if (lot) {
      const quantity = Math.min(Math.floor(lot.quantity / lot.mealQuantity), meals - 1) * lot.mealQuantity;
      attempt = c.siteId !== "market" ? { kind: "travel", siteId: "market" } :
        { kind: "post_surplus_offer", lotId: lot.id, quantity, price: 1 };
    }
  } else if (c.siteId === "market" && m.done.includes("post_surplus_offer") && c.hourOfDay <= 16) {
    return { ...base, attempts: [], wait: { at: input.at + 1 } };
  }
  if (!attempt && c.hourOfDay >= 17 && !m.done.includes("rest"))
    attempt = c.ownFarm && c.siteId === "market" && c.spatialForaging ?
      { kind: "travel", siteId: c.ownFarm.plotIds[0] } :
      c.ownFarm && c.siteId !== c.ownFarm.siteId && !c.spatialForaging ?
        { kind: "travel", siteId: c.ownFarm.siteId } : { kind: "rest" };
  return attempt ? { ...base, attempts: [attempt], wait: { at: input.at + 1 } } : base;
} };
