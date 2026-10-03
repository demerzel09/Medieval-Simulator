/** Debug-only food availability. World truth stays outside the personality input. */
import type { VillageContext, VillageId, VillageModel } from "../ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, queueVillageTerrainCommand, type VillageWorld } from "./autonomous-world";
import { effortNutrition } from "./effort-body";
import { cellKey, findGridPathV2 } from "./grid-path";
import { loadMovement } from "./load-movement";
import { siteOf } from "./physical";
import type { VillageRecording } from "./village-recording";

export function inspectVillageFoodSupply(w: VillageWorld) {
  if (!w.fixture.effortBody) throw Error("food nutrition audit requires an effort body");
  const mealUnits = (species: string, quantity: number) => species === "herb" ? Math.floor(quantity / 2) * 2 : quantity;
  const plants = Object.values(w.land.plants).filter((p) => p.stage === "ripe" &&
    ["herb", "wild_berry", "fruit_tree"].includes(p.species) && mealUnits(p.species, p.available) > 0).map((p) => {
    const work = Object.values(w.processes).find((process) => process.kind === "gather_plant" && process.plantId === p.id);
    return { id: p.id, siteId: p.siteId, cell: { ...p.cell }, quantity: p.available,
      nutrition: mealUnits(p.species, p.available) * effortNutrition(w.fixture.effortBody!, p.species) / 1000,
      ...(work ? { occupiedBy: work.actorId } : {}) };
  });
  const lots = Object.values(w.physical.objects).filter((o) => w.physical.types[o.typeId].tags.includes("food") && w.foodLots[o.id]).map((o) => {
    const meta = w.foodLots[o.id], kind = meta.product ?? meta.species!;
    return { id: o.id, ownerId: o.ownerId, siteId: siteOf(w.physical, o.id), containerId: o.parentId,
      kind, quantity: o.quantity, nutrition: mealUnits(meta.species!, o.quantity) * effortNutrition(w.fixture.effortBody!, meta.species!, meta.product) / 1000 };
  });
  const edible = lots.filter((l) => l.nutrition > 0);
  return { plants, edible, readyNutrition: [...plants, ...edible].reduce((n, p) => n + p.nutrition, 0),
    rawGrain: { storedQuantity: lots.filter((l) => l.kind === "grain").reduce((n, l) => n + l.quantity, 0),
      byOwner: Object.fromEntries(["S", "F", "C", "B1", "B2"].map((id) => [id,
        lots.filter((l) => l.kind === "grain" && l.ownerId === id).reduce((n, l) => n + l.quantity, 0)])),
      ripeCropQuantity: Object.values(w.land.plants).filter((p) => p.species === "grain" && p.stage === "ripe").reduce((n, p) => n + p.available, 0) } };
}

export function inspectVillageFoodAccess(w: VillageWorld, id: VillageId, c: VillageContext,
  supply = inspectVillageFoodSupply(w)) {
  if (!w.fixture.bulkTransport) throw Error("food access audit requires grid transport");
  const own = supply.edible.filter((l) => l.ownerId === id);
  const ownNow = own.filter((l) => c.ownFoodLots?.some((item) => item.id === l.id) ||
    c.homeStorage?.items.some((item) => item.id === l.id) || c.ownGroundItems?.some((item) => item.id === l.id));
  const movement = loadMovement(c.carriedMass, w.fixture.bulkTransport!);
  const plants = supply.plants.map((p) => {
    const route = findGridPathV2(w.grid, w.people[id].cell, p.cell);
    const travelHours = !route ? null : p.siteId === c.siteId ? 0 : Math.max(1, Math.ceil(route.slice(1)
      .reduce((n, point) => n + movement.edgeTicks * (w.grid.cost[cellKey(point)] ?? 1), 0) / (24 * w.fixture.bulkTransport!.baseMoveTicks)));
    const species = w.land.plants[p.id].species, gatherHours = species === "herb" ? 2 : 1;
    const startEffort = travelHours === null ? null : travelHours * movement.energyPerHour + gatherHours;
    return { ...p, seen: c.visiblePlants.some((visible) => visible.id === p.id), travelHours, gatherHours,
      canCarryMinimumMeal: gatherHours <= c.bulkTransport!.bagFreeMass, skillSufficient: (c.foragingSkill ?? 0) >= 1,
      // Static uninterrupted-work budget only. Absorption/recovery, later basal loss, exposure and competition are separate.
      initialCapacityCoversWork: startEffort !== null && c.energy >= startEffort };
  });
  const offers = Object.values(w.foodOffers ?? {}).filter((o) => !o.purchasedEventId && !o.cancelledEventId &&
    o.sellerId !== id && siteOf(w.physical, o.sellerId) === "market" &&
    supply.edible.some((l) => l.id === o.lotId && l.ownerId === o.sellerId && l.siteId === "market" && l.quantity >= o.quantity))
    .map((o) => {
      const lot = w.foodLots[o.lotId], quantity = lot.species === "herb" ? Math.floor(o.quantity / 2) * 2 : o.quantity;
      return { id: o.id, quantity: o.quantity, price: o.price, affordable: o.price <= c.ownCash,
        nutrition: quantity * effortNutrition(w.fixture.effortBody!, lot.species!, lot.product) / 1000,
        canCarry: o.quantity * w.physical.types[w.physical.objects[o.lotId].typeId].unitMass <= c.bulkTransport!.bagFreeMass,
        observed: c.visibleFoodOffers?.some((offer) => offer.id === o.id) ?? false };
    }).filter((o) => o.nutrition > 0);
  return { ownReadyNutrition: ownNow.reduce((n, l) => n + l.nutrition, 0),
    ownRemoteNutrition: own.filter((l) => !ownNow.includes(l)).reduce((n, l) => n + l.nutrition, 0), plants, offers };
}

/** Replays the saved choices exactly, then inspects before each person's choice. No new policy is inferred. */
export function auditVillageFoodRecording(r: VillageRecording, untilHour = Math.min(240, r.untilHour)) {
  if (r.formatVersion !== 2 || !r.fixture.effortBody || !r.fixture.bulkTransport ||
    !Number.isSafeInteger(untilHour) || untilHour < 1 || untilHour > r.untilHour) throw Error("invalid food audit window");
  const w = newVillageWorld(r.seed, r.fixture, r.initialGrid, r.initialLand);
  for (const command of r.commands) queueVillageCommand(w, command);
  for (const command of r.terrainCommands) queueVillageTerrainCommand(w, command);
  type Witness = ReturnType<typeof witness>;
  const witness = (id: VillageId, c: VillageContext, supply: ReturnType<typeof inspectVillageFoodSupply>, d: VillageRecording["decisions"][number]) => ({
    hour: w.hour, siteId: c.siteId, reserve: w.people[id].effort!.reserve / 1000,
    pendingNutrition: w.people[id].effort!.digestion.reduce((n, item) => n + item.amount, 0) / 1000,
    activityCapacity: c.energy, fatigue: c.effortBody!.fatigue, cold: c.cold, cash: c.ownCash,
    action: d.chosen?.kind ?? "wait", reason: d.response.subjectiveUpdate?.anticipation?.effort?.selected,
    supply, access: inspectVillageFoodAccess(w, id, c, supply),
  });
  const people: Record<string, { depletedDecisions: number; noReadyFood: number; readyFoodExists: number;
    ownEdibleNow: number; absorbing: number; firstEmpty?: Witness;
    lowReserve: { decisions: number; noReadyFood: number; readyFoodExists: number; ownEdibleNow: number;
      absorbing: number; actionsWithOwnFood: Record<string, number> } }> = {};
  const hours: { hour: number; readyNutrition: number; ripeNutrition: number; storedEdibleNutrition: number; rawGrain: ReturnType<typeof inspectVillageFoodSupply>["rawGrain"] }[] = [];
  let index = 0;
  const playback: VillageModel = { decide(input) {
    const d = r.decisions[index++];
    if (!d || d.actorId !== input.actorId || d.hour !== input.at || JSON.stringify(d.stimuli) !== JSON.stringify(input.stimuli) ||
      JSON.stringify(d.knownContext) !== JSON.stringify(input.knownContext) || JSON.stringify(d.subjectiveBefore) !== JSON.stringify(input.subjectiveState))
      throw Error(`food audit replay diverged at ${input.at}:${input.actorId}`);
    const supply = inspectVillageFoodSupply(w), body = w.people[input.actorId].effort!;
    if (hours.at(-1)?.hour !== w.hour) hours.push({ hour: w.hour, readyNutrition: supply.readyNutrition,
      ripeNutrition: supply.plants.reduce((n, p) => n + p.nutrition, 0),
      storedEdibleNutrition: supply.edible.reduce((n, l) => n + l.nutrition, 0), rawGrain: supply.rawGrain });
    const person = people[input.actorId] ??= { depletedDecisions: 0, noReadyFood: 0, readyFoodExists: 0, ownEdibleNow: 0, absorbing: 0,
      lowReserve: { decisions: 0, noReadyFood: 0, readyFoodExists: 0, ownEdibleNow: 0, absorbing: 0, actionsWithOwnFood: {} } };
    if (body.reserve < r.fixture.effortBody!.supplyThreshold) {
      const low = person.lowReserve;
      low.decisions++;
      if (supply.readyNutrition === 0) low.noReadyFood++; else low.readyFoodExists++;
      if (body.digestion.length) low.absorbing++;
      if (inspectVillageFoodAccess(w, input.actorId, input.knownContext, supply).ownReadyNutrition > 0) {
        low.ownEdibleNow++;
        const action = d.chosen?.kind ?? "wait";
        low.actionsWithOwnFood[action] = (low.actionsWithOwnFood[action] ?? 0) + 1;
      }
    }
    if (body.reserve === 0) {
      person.depletedDecisions++;
      if (supply.readyNutrition === 0) person.noReadyFood++; else person.readyFoodExists++;
      if (body.digestion.length) person.absorbing++;
      const snapshot = witness(input.actorId, input.knownContext, supply, d);
      if (snapshot.access.ownReadyNutrition > 0) person.ownEdibleNow++;
      person.firstEmpty ??= snapshot;
    }
    return JSON.parse(JSON.stringify(d.response));
  } };
  advanceVillageWorld(w, untilHour, playback);
  if (index !== r.decisions.filter((d) => d.hour <= untilHour).length ||
    JSON.stringify(w.events) !== JSON.stringify(r.events.filter((e) => e.hour <= untilHour))) throw Error("food audit event prefix mismatch");
  const emptyIntervals: { from: number; to: number }[] = [];
  for (const h of hours.filter((h) => h.readyNutrition === 0)) {
    const last = emptyIntervals.at(-1);
    if (last?.to === h.hour - 1) last.to = h.hour; else emptyIntervals.push({ from: h.hour, to: h.hour });
  }
  return { rulesetId: r.rulesetId, seed: r.seed, untilHour, eventPrefixMatched: true,
    definition: "Availability snapshots, not proof of sufficient sustained supply or successful acquisition. Raw grain, regrowth and other owners' unoffered food are not immediately edible by this person. Hourly supply is sampled before the first person's decision; counts are per saved decision. Low reserve is below the configured supply threshold, depletion is exactly zero; pending absorption is separate. Own-food, absorption and world-availability counts can overlap. Initial-capacity coverage compares shortest-path travel plus the smallest legal meal's work budget without rest or absorption; it does not predict completion or rule out a journey with recovery.",
    noReadyFoodHours: hours.filter((h) => h.readyNutrition === 0).length, emptyIntervals, people, hours };
}
