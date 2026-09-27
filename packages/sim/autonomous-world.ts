import { autonomousVillageV1, type VillageFixture } from "../../fixtures/autonomous-village";
import { ordinaryVillageModel, type VillageAttempt, type VillageContext, type VillageId, type VillageMemory,
  type VillageModel, type VillageResponse, type VillageRole, type VillageStimulus } from "../ai/autonomous-world";
import { wakeActors } from "./actor-clock";
import { hash } from "./core";
import { cellKey, checkGridMap, defaultVillageGrid, findGridPath, inGrid, sameCell,
  traversable, type GridMap, type GridPoint } from "./grid-path";
import { advanceLandHour, checkLandEcology, newLandEcology, type LandEcology } from "./land-ecology";
import { checkPhysical, contentsQuantity, physicalTransaction, siteOf, totalMass,
  type PhysicalState, type PhysicalTransaction } from "./physical";

export type VillageEvent = { id: string; hour: number; day: number; kind: string; actors: string[];
  causes: string[]; data: Record<string, string | number> };
type VillagePerson = { id: VillageId; role: VillageRole; nextWakeAt: number; hunger: number; cold: number;
  energy: number; cell: GridPoint; farmingSkills: Record<string, number>;
  memory: VillageMemory; activeProcessId?: string; receivedOrderIds: string[];
  seenBidIds: string[]; seenQuoteIds: string[]; receivedStimulusIds: string[];
  inbox: VillageStimulus[]; meals: number; fuelUsed: number };
type FoodOrder = { id: string; day: number; sellerId: "S"; carrierId?: "C"; farmerId?: "F";
  quantity: number; bid: number; carrierFee: number; salePrice: number; status: "posted" | "carrier_accepted" |
  "funded" | "relayed" | "farmer_accepted" | "tendered" | "purchased" | "delivered";
  postedEventId: string; acceptedEventId?: string; fundedEventId?: string; relayedEventId?: string;
  farmerAcceptedEventId?: string; tenderEventId?: string; tenderLotId?: string;
  purchaseEventId?: string; deliveryEventId?: string };
type WoodBid = { id: string; day: number; buyerId: "S" | "F" | "C"; price: number;
  postedEventId: string; filledEventId?: string };
type SaleQuote = { id: string; day: number; price: number; postedEventId: string };
type VillageProcess = { id: string; actorId: VillageId; kind: "travel" | "forage" | "tender_food" |
  "deliver_food" | "sell_wood" | "rest" | "till_plot" | "sow_plot" | "harvest_plot" |
  "gather_plant"; startedAt: number; duration: number; progress: number;
  energyPerHour: number; startEventId: string; transitId?: string; destinationId?: string;
  path?: GridPoint[]; pathIndex?: number; edgeProgress?: number; stepHours?: number;
  resource?: "food" | "wood"; quantity?: number; orderId?: string; buyerId?: VillageId;
  plantId?: string };
export type VillageCommand = { id: string; actorId: VillageId; at: number; attempt: VillageAttempt;
  status: "queued" | "applied"; eventId?: string };
export type VillageTerrainCommand = { id: string; at: number; cell: GridPoint; blocked: boolean;
  status: "queued" | "applied"; eventId?: string };
export type VillageDecisionRecord = { eventId: string; actorId: VillageId; hour: number;
  stimuli: VillageStimulus[]; knownContext: VillageContext; subjectiveBefore: VillageMemory;
  response: VillageResponse; chosen?: VillageAttempt; commandId?: string };
export type VillageWorld = { schemaVersion: 2; mode: "autonomous_village"; seed: number; hour: number;
  nextId: number; fixture: VillageFixture; physical: PhysicalState; grid: GridMap; initialGrid: GridMap;
  land: LandEcology; initialLand: LandEcology;
  people: Record<VillageId, VillagePerson>; resources: Record<"food" | "wood", {
    available: number; capacity: number; growthPerDay: number; reserved: number; initial: number; grown: number }>;
  foodLots: Record<string, { harvestedDay: number; originPlantId?: string;
    originSiteId?: string; species?: string }>;
  orders: Record<string, FoodOrder>; woodBids: Record<string, WoodBid>; saleQuotes: Record<string, SaleQuote>;
  processes: Record<string, VillageProcess>; pending: { recipientId: VillageId; stimulus: VillageStimulus }[];
  commands: VillageCommand[]; terrainCommands: VillageTerrainCommand[];
  terrainEventIds: Record<string, string>; decisions: VillageDecisionRecord[];
  events: VillageEvent[]; harvestedFood: number; harvestedLandFood: number;
  eatenFood: number; spoiledFood: number; initialSeeds: number; seedsProduced: number; seedsUsed: number;
  harvestedWood: number; burnedWood: number; initialMoney: number };
const ids: VillageId[] = ["S", "F", "C", "B1", "B2"];
const bag = (id: string) => `bag_${id}`;
const wallet = (id: string) => `wallet_${id}`;
const uid = (w: VillageWorld, prefix: string) => `${prefix}_${String(w.nextId++).padStart(6, "0")}`;
const dayAt = (hour: number) => Math.floor((hour - 1) / 24) + 1;
const hourOfDay = (hour: number) => (hour - 1) % 24 + 1;
const atSite = (w: VillageWorld, id: string, site: string) => siteOf(w.physical, id) === site;
const ownObjects = (w: VillageWorld, parentId: string, typeId: string, ownerId?: string) =>
  Object.values(w.physical.objects).filter((o) => o.parentId === parentId && o.typeId === typeId &&
    (!ownerId || o.ownerId === ownerId));
const ownCash = (w: VillageWorld, id: VillageId) => ownObjects(w, wallet(id), "currency", id).length;
const ownWood = (w: VillageWorld, id: VillageId) => ownObjects(w, bag(id), "wood", id)
  .reduce((n, o) => n + o.quantity, 0);
const ownFood = (w: VillageWorld, id: VillageId) =>
  [...ownObjects(w, bag(id), "food", id), ...(id === "S" ? ownObjects(w, "stock_S", "food", id) : [])]
    .reduce((n, o) => n + o.quantity, 0);
const latestOrder = (w: VillageWorld) => Object.values(w.orders).sort((a, b) => b.day - a.day)[0];
function emit(w: VillageWorld, kind: string, actors: string[], causes: string[] = [],
  data: VillageEvent["data"] = {}): VillageEvent {
  const event: VillageEvent = { id: uid(w, "e"), hour: w.hour, day: dayAt(w.hour), kind, actors, causes, data };
  w.events.push(event); return event;
}
function send(w: VillageWorld, recipientId: VillageId, stimulus: Omit<VillageStimulus, "id" | "occurredAt" | "receivedAt">,
  delay = 1) {
  w.pending.push({ recipientId, stimulus: { id: uid(w, "s"), occurredAt: w.hour,
    receivedAt: w.hour + delay, ...stimulus } });
}
function result(w: VillageWorld, actorId: VillageId, action: VillageAttempt["kind"], event: VillageEvent,
  success = true, reason?: string, delay = 1, actionDay = dayAt(w.hour)) {
  send(w, actorId, { kind: "result", action, actionDay, success, reason, causeEventIds: [event.id] }, delay);
}
function tx(w: VillageWorld, actorId: VillageId, ownerIds: string[], op: (t: PhysicalTransaction) => void): string | undefined {
  const outcome = physicalTransaction(w.physical, { actorId, ownerIds }, op);
  if (!outcome.ok) return outcome.reason;
  w.physical = outcome.state; return undefined;
}
function coinIds(w: VillageWorld, parentId: string, ownerId: string, quantity: number): string[] {
  return ownObjects(w, parentId, "currency", ownerId).slice(0, quantity).map((o) => o.id);
}
function moveCoins(t: PhysicalTransaction, coinIds: string[], targetWallet: string, ownerId: string) {
  for (const id of coinIds) { t.move(id, targetWallet); t.changeOwner(id, ownerId); }
}
function transferUnit(t: PhysicalTransaction, lotId: string, quantity: number, unitId: string,
  parentId: string, ownerId: string, causeEventId: string): string {
  const unit = quantity > 1 ? unitId : lotId;
  if (quantity > 1) t.split(lotId, unit, 1, causeEventId);
  t.move(unit, parentId); t.changeOwner(unit, ownerId); return unit;
}
export function newVillageWorld(seed = 240924, fixture: VillageFixture = autonomousVillageV1,
  initialGrid: GridMap = defaultVillageGrid(), landInput?: LandEcology): VillageWorld {
  if (!Number.isSafeInteger(seed) || fixture.schemaVersion !== 1 ||
    !Number.isSafeInteger(fixture.informationDelayHours) || fixture.informationDelayHours < 1 ||
    fixture.landEconomy && (!Number.isSafeInteger(fixture.landEconomy.grainPlots) ||
      fixture.landEconomy.grainPlots < 1 || fixture.landEconomy.grainPlots > 16 ||
      !Number.isSafeInteger(fixture.landEconomy.initialSeeds) || fixture.landEconomy.initialSeeds < 0 ||
      !Number.isSafeInteger(fixture.landEconomy.farmerGrainSkill) ||
      fixture.landEconomy.farmerGrainSkill < 0)) throw Error("invalid village fixture");
  const f = structuredClone(fixture);
  const grid = structuredClone(initialGrid);
  checkGridMap(grid);
  for (const site of ["market", "grove", "home_B1", "home_B2", "field", "meadow"])
    if (!grid.sites[site]) throw Error("missing village site");
  const land = structuredClone(landInput ?? newLandEcology(grid, f.resources.food.initial,
    f.resources.food.capacity, f.landEconomy?.grainPlots ?? 1, !!f.landEconomy));
  checkLandEcology(land, grid);
  if (f.landEconomy && (land.rulesetVersion !== 2 ||
    Object.values(land.plants).filter((p) => p.species === "grain").length !==
      f.landEconomy.grainPlots ||
    Object.values(land.plants).some((p) => p.species === "grain" &&
      p.useRightHolderId !== "F"))) throw Error("land economy fixture mismatch");
  if (land.plants.wild_berry.available !== f.resources.food.initial ||
    land.plants.wild_berry.initialAvailable !== f.resources.food.initial ||
    land.plants.wild_berry.grown || land.plants.wild_berry.personHarvested)
    throw Error("wild food fixture mismatch");
  const types: PhysicalState["types"] = {
    world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["site"] } },
    site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["person", "animal", "resource", "store"] } },
    animal: { id: "animal", tags: ["animal"], unitMass: 1, stackable: false, ownable: false },
    person: { id: "person", tags: ["person"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["bag", "wallet"], maxContentsMass: 24 } },
    bag: { id: "bag", tags: ["bag"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food", "wood", "seed"], maxContentsMass: 8 } },
    wallet: { id: "wallet", tags: ["wallet"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["currency"], maxContentsMass: 24 } },
    store: { id: "store", tags: ["store"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food"], maxContentsMass: 8 } },
    resource: { id: "resource", tags: ["resource"], unitMass: 0, stackable: false, ownable: false },
    food: { id: "food", tags: ["food"], unitMass: 1, stackable: true, ownable: true },
    wood: { id: "wood", tags: ["wood"], unitMass: 1, stackable: true, ownable: true },
    currency: { id: "currency", tags: ["currency"], unitMass: 1, stackable: false, ownable: true },
    seed: { id: "seed", tags: ["seed"], unitMass: 1, stackable: true, ownable: true },
  };
  const objects: PhysicalState["objects"] = {};
  const add = (id: string, typeId: string, parentId: string | null, ownerId?: string) => {
    objects[id] = { id, typeId, parentId, ownerId, quantity: 1, causeEventId: "initial" };
  };
  add("world", "world", null);
  for (const site of Object.keys(grid.sites)) add(site, "site", "world");
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++)
    add(`tile_${x}_${y}`, "site", "world");
  for (const animal of Object.values(land.animals))
    add(animal.id, "animal", `tile_${animal.cell.x}_${animal.cell.y}`);
  add("food_patch", "resource", "grove"); add("wood_patch", "resource", "grove");
  add("stock_S", "store", "market", "S");
  const roles: Record<VillageId, VillageRole> = { S: "merchant", F: "farmer", C: "carrier",
    B1: "woodcutter", B2: "woodcutter" };
  const people = {} as VillageWorld["people"];
  for (const id of ids) {
    add(id, "person", id === "F" ? "grove" : id.startsWith("B") ? `home_${id}` : "market");
    add(bag(id), "bag", id, id); add(wallet(id), "wallet", id, id);
    if (id === "F" && (f.landEconomy?.initialSeeds ?? 2) > 0)
      objects.grain_seed_initial = { id: "grain_seed_initial", typeId: "seed",
        parentId: bag(id), ownerId: id, quantity: f.landEconomy?.initialSeeds ?? 2, causeEventId: "initial" };
    for (let i = 0; i < f.initialCash[id]; i++) add(`coin_${id}_${i}`, "currency", wallet(id), id);
    const initialSite = id === "F" ? "grove" : id.startsWith("B") ? `home_${id}` : "market";
    people[id] = { id, role: roles[id], nextWakeAt: 1, hunger: 1, cold: 1, energy: f.body.initialEnergy,
      cell: structuredClone(grid.sites[initialSite]),
      farmingSkills: id === "F" ? { grain: f.landEconomy?.farmerGrainSkill ?? 1 } : {},
      memory: { day: 0, done: [], beliefs: { foodBid: f.prices.foodBid, foodRetail: f.prices.foodRetail,
        carrierFee: f.prices.carrierFee, woodPrice: f.prices.wood } }, receivedOrderIds: [],
      seenBidIds: [], seenQuoteIds: [], receivedStimulusIds: [], inbox: [], meals: 0, fuelUsed: 0 };
  }
  const w: VillageWorld = { schemaVersion: 2, mode: "autonomous_village", seed, hour: 0, nextId: 1,
    fixture: f, physical: { types, objects, reservations: [] }, grid,
    initialGrid: structuredClone(grid), land, initialLand: structuredClone(land), people,
    resources: { food: { available: f.resources.food.initial, capacity: f.resources.food.capacity,
      growthPerDay: f.resources.food.growthPerDay, reserved: 0, initial: f.resources.food.initial, grown: 0 },
    wood: { available: f.resources.wood.initial, capacity: f.resources.wood.capacity,
      growthPerDay: f.resources.wood.growthPerDay, reserved: 0, initial: f.resources.wood.initial, grown: 0 } },
    foodLots: {}, orders: {}, woodBids: {}, saleQuotes: {}, processes: {}, pending: [], commands: [],
    terrainCommands: [], terrainEventIds: {}, decisions: [], events: [],
    harvestedFood: 0, harvestedLandFood: 0, eatenFood: 0, spoiledFood: 0,
    initialSeeds: f.landEconomy?.initialSeeds ?? 2, seedsProduced: 0, seedsUsed: 0,
    harvestedWood: 0, burnedWood: 0,
    initialMoney: ids.reduce((n, id) => n + f.initialCash[id], 0) };
  checkVillageWorld(w); return w;
}
function startProcess(w: VillageWorld, actorId: VillageId, kind: VillageProcess["kind"], duration: number,
  energyPerHour: number, decisionId: string, extra: Partial<VillageProcess> = {}): string | undefined {
  const person = w.people[actorId];
  if (person.activeProcessId || person.energy < duration * energyPerHour) return "actor unavailable or exhausted";
  const id = uid(w, "process");
  const started = emit(w, "process_started", [actorId], [decisionId], { processId: id, action: kind, duration });
  w.processes[id] = { id, actorId, kind, startedAt: w.hour, duration, progress: 0, energyPerHour,
    startEventId: started.id, ...extra };
  person.activeProcessId = id;
  return undefined;
}
function startTravel(w: VillageWorld, actorId: VillageId, toId: string, decisionId: string) {
  const from = siteOf(w.physical, actorId);
  if (!w.grid.sites[toId] || (from === toId && !from.startsWith("transit_")))
    return "route unavailable";
  const path = findGridPath(w.grid, w.people[actorId].cell, w.grid.sites[toId]);
  if (!path) return "route unavailable";
  const mass = totalMass(w.physical, actorId);
  if (actorId === "C" && mass > w.fixture.carryingCapacity.carrierTotalMass)
    return "carrier overloaded";
  const stepHours = 1 + Math.floor(mass / 20);
  const duration = Math.max(1, path.slice(1).reduce((n, point) =>
    n + stepHours * (w.grid.cost[cellKey(point)] ?? 1), 0));
  const energyPerHour = 1 + Math.floor(mass / 10);
  if (w.people[actorId].energy < duration * energyPerHour) return "traveller exhausted";
  const transitId = from.startsWith("transit_") ? from : uid(w, "transit");
  if (transitId !== from) {
    const reason = tx(w, actorId, [], (t) => t.depart({ id: transitId, typeId: "site", parentId: "world",
      quantity: 1, causeEventId: decisionId }, [actorId]));
    if (reason) return reason;
  }
  return startProcess(w, actorId, "travel", duration, energyPerHour, decisionId,
    { transitId, destinationId: toId, path, pathIndex: 0, edgeProgress: 0, stepHours });
}
function routeRemainingHours(w: VillageWorld, path: GridPoint[], stepHours: number) {
  return Math.max(1, path.slice(1).reduce((n, point) =>
    n + stepHours * (w.grid.cost[cellKey(point)] ?? 1), 0));
}
function redirectTravel(w: VillageWorld, actorId: VillageId, toId: string, causeId: string) {
  const p = w.processes[w.people[actorId].activeProcessId ?? ""];
  if (p?.kind !== "travel" || !w.grid.sites[toId]) return "traveller not on a route";
  const path = findGridPath(w.grid, w.people[actorId].cell, w.grid.sites[toId]);
  if (!path) return "route unavailable";
  p.path = path; p.pathIndex = 0; p.edgeProgress = 0; p.destinationId = toId;
  p.duration = p.progress + routeRemainingHours(w, path, p.stepHours!);
  const event = emit(w, "travel_redirected", [actorId], [causeId, p.startEventId],
    { destinationId: toId, x: w.people[actorId].cell.x, y: w.people[actorId].cell.y });
  result(w, actorId, "redirect_travel", event); return undefined;
}
function finishProcess(w: VillageWorld, p: VillageProcess): string | undefined {
  const id = p.actorId, order = p.orderId ? w.orders[p.orderId] : undefined;
  if (p.kind === "travel") {
    if (!sameCell(w.people[id].cell, w.grid.sites[p.destinationId!])) return "destination not reached";
    const reason = tx(w, id, [], (t) => t.arrive(p.transitId!, p.destinationId!, [id]));
    if (reason) return reason;
    emit(w, "arrived", [id], [p.startEventId], { siteId: p.destinationId! });
  } else if (p.kind === "forage") {
    const resource = w.resources[p.resource!], quantity = p.quantity!;
    if (resource.available < quantity || resource.reserved < quantity) return "reserved resource unavailable";
    const lotId = uid(w, p.resource!);
    const reason = tx(w, id, [], (t) => t.add({ id: lotId, typeId: p.resource!, parentId: bag(id),
      ownerId: id, quantity, causeEventId: p.startEventId }));
    if (reason) return reason;
    resource.available -= quantity; resource.reserved -= quantity;
    if (p.resource === "food") {
      w.harvestedFood += quantity;
      w.foodLots[lotId] = w.fixture.landEconomy ? { harvestedDay: dayAt(w.hour),
        originPlantId: "wild_berry", originSiteId: "grove", species: "wild_berry" } :
        { harvestedDay: dayAt(w.hour) };
    }
    else w.harvestedWood += quantity;
    if (p.resource === "food") {
      const berry = w.land.plants.wild_berry;
      berry.available -= quantity; berry.personHarvested += quantity;
      if (!berry.available) berry.stage = "regrowing";
    }
    const event = emit(w, "foraged", [id], [p.startEventId], { resource: p.resource!, quantity, lotId });
    w.physical.objects[lotId].causeEventId = event.id;
  } else if (p.kind === "tender_food") {
    if (!order || order.status !== "farmer_accepted" || !atSite(w, "C", "grove") ||
      !atSite(w, "F", "grove")) return "tender conditions changed";
    const lot = ownObjects(w, bag("F"), "food", "F").find((o) => o.quantity >= p.quantity!);
    if (!lot) return "farmer no longer carries food";
    if (totalMass(w.physical, "C") + p.quantity! > w.fixture.carryingCapacity.carrierTotalMass)
      return "carrier overloaded";
    const tenderLotId = lot.quantity > p.quantity! ? uid(w, "food") : lot.id;
    const reason = tx(w, "F", [], (t) => {
      if (tenderLotId !== lot.id) t.split(lot.id, tenderLotId, p.quantity!, p.startEventId);
      t.move(tenderLotId, bag("C"));
    });
    if (reason) return reason;
    if (tenderLotId !== lot.id) w.foodLots[tenderLotId] = { ...w.foodLots[lot.id] };
    const event = emit(w, "food_tendered", ["F", "C"], [p.startEventId, order.farmerAcceptedEventId!],
      { orderId: order.id, lotId: tenderLotId, quantity: p.quantity! });
    order.status = "tendered"; order.tenderEventId = event.id; order.tenderLotId = tenderLotId;
    send(w, "C", { kind: "result", action: "tender_food", success: true, causeEventIds: [event.id] }, 0);
  } else if (p.kind === "deliver_food") {
    if (!order || order.status !== "purchased" || !order.tenderLotId ||
      !atSite(w, "C", "market") || !atSite(w, "S", "market")) return "delivery conditions changed";
    const lot = w.physical.objects[order.tenderLotId];
    if (!lot || lot.parentId !== bag("C") || lot.ownerId !== "S") return "cargo unavailable";
    const reason = tx(w, "C", ["S"], (t) => t.move(lot.id, "stock_S"));
    if (reason) return reason;
    const event = emit(w, "food_delivered", ["C", "S"], [p.startEventId, order.purchaseEventId!],
      { orderId: order.id, quantity: lot.quantity });
    order.status = "delivered"; order.deliveryEventId = event.id;
    send(w, "S", { kind: "result", action: "deliver_food", success: true, causeEventIds: [event.id] }, 0);
  } else if (p.kind === "sell_wood") {
    const buyerId = p.buyerId!;
    const bid = Object.values(w.woodBids).find((b) => b.day === dayAt(w.hour) && b.buyerId === buyerId && !b.filledEventId);
    const lot = ownObjects(w, bag(id), "wood", id)[0];
    if (!bid || !lot || siteOf(w.physical, id) !== siteOf(w.physical, buyerId)) return "wood buyer or lot unavailable";
    const coins = coinIds(w, wallet(buyerId), buyerId, bid.price);
    if (coins.length !== bid.price) return "wood buyer lacks cash";
    const unitId = uid(w, "wood");
    const reason = tx(w, id, [buyerId], (t) => {
      transferUnit(t, lot.id, lot.quantity, unitId, bag(buyerId), buyerId, p.startEventId);
      moveCoins(t, coins, wallet(id), id);
    });
    if (reason) return reason;
    const event = emit(w, "wood_sold", [id, buyerId], [p.startEventId, bid.postedEventId],
      { quantity: 1, price: bid.price, lotId: lot.quantity > 1 ? unitId : lot.id });
    bid.filledEventId = event.id;
    send(w, buyerId, { kind: "result", action: "sell_wood", success: true, causeEventIds: [event.id] }, 0);
  } else if (p.kind === "rest") {
    w.people[id].energy = Math.min(w.fixture.body.maxEnergy, w.people[id].energy + w.fixture.restEnergyGain);
    emit(w, "rested", [id], [p.startEventId], { energy: w.people[id].energy });
  } else if (p.kind === "till_plot" || p.kind === "sow_plot" || p.kind === "harvest_plot" ||
    p.kind === "gather_plant") {
    const plant = w.land.plants[p.plantId!];
    if (!plant || !atSite(w, id, plant.siteId)) return "plant worksite changed";
    if (p.kind === "till_plot") {
      if (plant.stage !== "bare") return "plot no longer bare";
      plant.stage = "tilled";
      emit(w, "plot_tilled", [id], [p.startEventId], { plantId: plant.id });
    } else if (p.kind === "sow_plot") {
      if (plant.stage !== "tilled") return "plot no longer tilled";
      const seed = ownObjects(w, bag(id), "seed", id)[0];
      if (!seed) return "seed unavailable";
      const reason = tx(w, id, [], (t) => t.remove(seed.id, 1));
      if (reason) return reason;
      w.seedsUsed++; plant.stage = "seeded"; plant.ageHours = 0;
      emit(w, "plot_sown", [id], [p.startEventId, seed.causeEventId === "initial" ? p.startEventId : seed.causeEventId],
        { plantId: plant.id, species: plant.species, seedQuantity: 1 });
    } else {
      const quantity = p.quantity!;
      if (plant.available < quantity || plant.stage !== "ripe") return "plant not ready";
      const lotId = uid(w, "food");
      const seedId = p.kind === "harvest_plot" ? uid(w, "seed") : undefined;
      const reason = tx(w, id, [], (t) => {
        t.add({ id: lotId, typeId: "food", parentId: bag(id), ownerId: id,
          quantity, causeEventId: p.startEventId });
        if (seedId) t.add({ id: seedId, typeId: "seed", parentId: bag(id), ownerId: id,
          quantity: 1, causeEventId: p.startEventId });
      });
      if (reason) return reason;
      plant.available -= quantity; plant.personHarvested += quantity;
      plant.stage = p.kind === "harvest_plot" ? "bare" : plant.available ? "ripe" : "regrowing";
      if (p.kind === "harvest_plot") { plant.ageHours = 0; w.seedsProduced++; }
      w.harvestedFood += quantity; w.harvestedLandFood += quantity;
      w.foodLots[lotId] = w.fixture.landEconomy ? { harvestedDay: dayAt(w.hour),
        originPlantId: plant.id, originSiteId: plant.siteId, species: plant.species } :
        { harvestedDay: dayAt(w.hour) };
      const event = emit(w, p.kind === "harvest_plot" ? "crop_harvested" : "plant_gathered",
        [id], [p.startEventId], { plantId: plant.id, species: plant.species,
          quantity, lotId, siteId: plant.siteId });
      w.physical.objects[lotId].causeEventId = event.id;
      if (seedId) w.physical.objects[seedId].causeEventId = event.id;
    }
  }
  return undefined;
}
function progressProcesses(w: VillageWorld) {
  for (const p of Object.values(w.processes).sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.startedAt >= w.hour || p.progress >= p.duration) continue;
    if (p.kind === "travel" && p.path && p.pathIndex! < p.path.length - 1 &&
      !traversable(w.grid, p.path[p.pathIndex! + 1])) {
      const path = findGridPath(w.grid, w.people[p.actorId].cell, w.grid.sites[p.destinationId!]);
      const terrainCause = w.terrainEventIds[cellKey(p.path[p.pathIndex! + 1])];
      if (!path) { emit(w, "travel_waited", [p.actorId],
        terrainCause ? [p.startEventId, terrainCause] : [p.startEventId],
        { reason: "route blocked", destinationId: p.destinationId! }); continue; }
      p.path = path; p.pathIndex = 0; p.edgeProgress = 0;
      p.duration = p.progress + routeRemainingHours(w, path, p.stepHours!);
      emit(w, "travel_replanned", [p.actorId],
        terrainCause ? [p.startEventId, terrainCause] : [p.startEventId],
        { destinationId: p.destinationId!, x: w.people[p.actorId].cell.x,
          y: w.people[p.actorId].cell.y });
    }
    if (w.fixture.landEconomy && p.kind === "travel" && p.path &&
      p.pathIndex! < p.path.length - 1) {
      const next = p.path[p.pathIndex! + 1];
      const roadCell = !Object.values(w.grid.sites).some((site) => sameCell(site, next));
      const blocker = roadCell ? ids.find((other) => other !== p.actorId &&
        sameCell(w.people[other].cell, next) &&
        siteOf(w.physical, other).startsWith("transit_")) : undefined;
      if (blocker) {
        const detour = findGridPath({ ...w.grid,
          blocked: [...w.grid.blocked, cellKey(next)] }, w.people[p.actorId].cell,
        w.grid.sites[p.destinationId!]);
        if (detour) {
          p.path = detour; p.pathIndex = 0; p.edgeProgress = 0;
          p.duration = p.progress + routeRemainingHours(w, detour, p.stepHours!);
          emit(w, "travel_replanned", [p.actorId], [p.startEventId,
            w.processes[w.people[blocker].activeProcessId ?? ""]?.startEventId ?? p.startEventId],
          { destinationId: p.destinationId!, reason: "occupied road cell",
            x: w.people[p.actorId].cell.x, y: w.people[p.actorId].cell.y });
        } else {
          emit(w, "travel_waited", [p.actorId], [p.startEventId],
            { reason: "occupied road cell", destinationId: p.destinationId! });
          continue;
        }
      }
    }
    if (w.people[p.actorId].energy < p.energyPerHour) {
      w.people[p.actorId].activeProcessId = undefined; delete w.processes[p.id];
      const failed = emit(w, "process_failed", [p.actorId], [p.startEventId],
        { action: p.kind, reason: "actor exhausted" });
      result(w, p.actorId, p.kind, failed, false, "actor exhausted", 0, dayAt(p.startedAt));
      continue;
    }
    w.people[p.actorId].energy -= p.energyPerHour;
    p.progress++;
    if (p.kind === "travel" && p.path && p.pathIndex! < p.path.length - 1) {
      p.edgeProgress!++;
      const next = p.path[p.pathIndex! + 1];
      if (p.edgeProgress === p.stepHours! * (w.grid.cost[cellKey(next)] ?? 1)) {
        p.edgeProgress = 0; p.pathIndex!++;
        w.people[p.actorId].cell = structuredClone(next);
        emit(w, "travel_step", [p.actorId], [p.startEventId],
          { x: next.x, y: next.y, destinationId: p.destinationId! });
      }
    }
    if (p.progress !== p.duration) continue;
    const reason = finishProcess(w, p);
    w.people[p.actorId].activeProcessId = undefined;
    delete w.processes[p.id];
    if (reason) {
      if (p.kind === "forage") w.resources[p.resource!].reserved -= p.quantity!;
      const failed = emit(w, "process_failed", [p.actorId], [p.startEventId], { action: p.kind, reason });
      result(w, p.actorId, p.kind, failed, false, reason, 0, dayAt(p.startedAt));
    } else {
      const completed = emit(w, "process_completed", [p.actorId], [p.startEventId], { action: p.kind });
      result(w, p.actorId, p.kind, completed, true, undefined, 0, dayAt(p.startedAt));
    }
  }
}
function attempt(w: VillageWorld, id: VillageId, a: VillageAttempt, decisionId: string): string | undefined {
  const day = dayAt(w.hour), site = siteOf(w.physical, id);
  const current = latestOrder(w);
  if (w.people[id].activeProcessId) return "actor already working";
  if (a.kind === "post_food_order") {
    if (id !== "S" || site !== "market" || Object.values(w.orders).some((o) => o.status !== "delivered") ||
      ![a.quantity, a.bid, a.carrierFee, a.salePrice].every((n) => Number.isSafeInteger(n) && n > 0) ||
      a.quantity > 8 || ownCash(w, "S") < a.quantity * a.bid + a.carrierFee)
      return "purchase offer unavailable";
    const orderId = uid(w, "order");
    const event = emit(w, "food_order_posted", [id], [decisionId], { orderId, quantity: a.quantity,
      bid: a.bid, carrierFee: a.carrierFee, salePrice: a.salePrice });
    w.orders[orderId] = { id: orderId, day, sellerId: "S", quantity: a.quantity, bid: a.bid,
      carrierFee: a.carrierFee, salePrice: a.salePrice, status: "posted", postedEventId: event.id };
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "accept_carriage") {
    const order = w.orders[a.orderId];
    if (id !== "C" || site !== "market" || !order || order.day !== day || order.status !== "posted" ||
      !w.people.C.receivedOrderIds.includes(order.id)) return "carriage offer not received";
    const event = emit(w, "carriage_accepted", ["C", "S"], [decisionId, order.postedEventId], { orderId: order.id });
    order.carrierId = "C"; order.status = "carrier_accepted"; order.acceptedEventId = event.id;
    result(w, id, a.kind, event); send(w, "S", { kind: "result", action: a.kind, success: true,
      causeEventIds: [event.id] }); return undefined;
  }
  if (a.kind === "fund_carriage") {
    const order = w.orders[a.orderId];
    if (id !== "S" || !order || order.status !== "carrier_accepted" || order.day !== day ||
      !atSite(w, "S", "market") || !atSite(w, "C", "market")) return "carriage funding unavailable";
    const fee = coinIds(w, wallet("S"), "S", order.carrierFee);
    const purchase = coinIds(w, wallet("S"), "S", order.carrierFee + order.quantity * order.bid)
      .slice(order.carrierFee);
    if (fee.length !== order.carrierFee || purchase.length !== order.quantity * order.bid)
      return "seller lacks working capital";
    const reason = tx(w, "S", [], (t) => {
      moveCoins(t, fee, wallet("C"), "C");
      for (const coinId of purchase) t.move(coinId, wallet("C"));
    });
    if (reason) return reason;
    const event = emit(w, "carriage_funded", ["S", "C"], [decisionId, order.acceptedEventId!],
      { orderId: order.id, fee: order.carrierFee, entrusted: purchase.length });
    order.status = "funded"; order.fundedEventId = event.id;
    result(w, id, a.kind, event); send(w, "C", { kind: "result", action: a.kind, success: true,
      causeEventIds: [event.id] }); return undefined;
  }
  if (a.kind === "post_wood_bid") {
    if (!["S", "F", "C"].includes(id) || !Number.isSafeInteger(a.price) || a.price < 1 ||
      Object.values(w.woodBids).some((bid) => bid.day === day && bid.buyerId === id))
      return "wood bid unavailable";
    const bidId = uid(w, "bid");
    const event = emit(w, "wood_bid_posted", [id], [decisionId], { bidId, price: a.price, siteId: site });
    w.woodBids[bidId] = { id: bidId, day, buyerId: id as "S" | "F" | "C",
      price: a.price, postedEventId: event.id };
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "post_sale_quote") {
    if (id !== "S" || site !== "market" || !Number.isSafeInteger(a.price) || a.price < 1 ||
      Object.values(w.saleQuotes).some((q) => q.day === day)) return "sale quote unavailable";
    const quoteId = uid(w, "quote");
    const event = emit(w, "sale_quote_posted", [id], [decisionId], { quoteId, price: a.price });
    w.saleQuotes[quoteId] = { id: quoteId, day, price: a.price, postedEventId: event.id };
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "travel") return startTravel(w, id, a.siteId, decisionId);
  if (a.kind === "till_plot" || a.kind === "sow_plot" || a.kind === "harvest_plot" ||
    a.kind === "gather_plant") {
    const plant = w.land.plants[a.plantId];
    if (!plant || site !== plant.siteId) return "plant worksite unavailable";
    if (a.kind === "gather_plant") {
      if (id !== "F" || !["fruit_tree", "herb"].includes(plant.species) ||
        !Number.isSafeInteger(a.quantity) || a.quantity < 1 ||
        plant.stage !== "ripe" || plant.available < a.quantity) return "plant gathering denied";
      return startProcess(w, id, a.kind, a.quantity, 1, decisionId,
        { plantId: plant.id, quantity: a.quantity });
    }
    const skill = w.people[id].farmingSkills[plant.species] ?? 0;
    if (plant.species !== "grain" || skill < 1) return "crop skill denied";
    if (plant.useRightHolderId && plant.useRightHolderId !== id) return "land use right denied";
    if (a.kind === "till_plot" && plant.stage === "bare")
      return startProcess(w, id, a.kind, skill >= 2 ? 1 : 2, 1, decisionId, { plantId: plant.id });
    if (a.kind === "sow_plot" && plant.stage === "tilled" &&
      ownObjects(w, bag(id), "seed", id).length)
      return startProcess(w, id, a.kind, 1, 1, decisionId, { plantId: plant.id });
    if (a.kind === "harvest_plot" && plant.stage === "ripe" && plant.available > 0)
      return startProcess(w, id, a.kind, skill >= 2 ? 1 : 2, 1, decisionId,
        { plantId: plant.id, quantity: plant.available });
    return "crop stage unavailable";
  }
  if (a.kind === "relay_order") {
    const order = w.orders[a.orderId];
    if (id !== "C" || site !== "grove" || !atSite(w, "F", "grove") ||
      !order || order.status !== "funded" || order.carrierId !== "C") return "order relay unavailable";
    const event = emit(w, "order_relayed", ["C", "F"], [decisionId, order.fundedEventId!], { orderId: order.id });
    order.status = "relayed"; order.relayedEventId = event.id;
    send(w, "F", { kind: "order", causeEventIds: [event.id], order: { id: order.id, day: order.day,
      quantity: order.quantity, bid: order.bid, carrierFee: order.carrierFee, salePrice: order.salePrice } },
      w.fixture.informationDelayHours);
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "accept_food_order") {
    const order = w.orders[a.orderId];
    if (id !== "F" || site !== "grove" || !atSite(w, "C", "grove") || !order ||
      order.status !== "relayed" || !w.people.F.receivedOrderIds.includes(order.id))
      return "farmer has not received offer";
    const event = emit(w, "food_order_accepted", ["F", "C"], [decisionId, order.relayedEventId!],
      { orderId: order.id, quantity: order.quantity, bid: order.bid });
    order.farmerId = "F"; order.status = "farmer_accepted"; order.farmerAcceptedEventId = event.id;
    result(w, id, a.kind, event); send(w, "C", { kind: "result", action: a.kind, success: true,
      causeEventIds: [event.id] }); return undefined;
  }
  if (a.kind === "forage") {
    if (site !== "grove" || !Number.isSafeInteger(a.quantity) || a.quantity < 1 ||
      a.quantity > 5 || !w.fixture.access[`${a.resource}Harvesters`].includes(id)) return "harvest right denied";
    const r = w.resources[a.resource];
    if (r.available - r.reserved < a.quantity) return "resource unavailable";
    if (contentsQuantity(w.physical, bag(id), a.resource) + a.quantity >
      (id === "F" ? w.fixture.carryingCapacity.farmerFood : w.fixture.carryingCapacity.woodcutterWood))
      return "harvest bag full";
    const reason = startProcess(w, id, "forage", a.quantity, 1, decisionId,
      { resource: a.resource, quantity: a.quantity });
    if (reason) return reason;
    r.reserved += a.quantity; return undefined;
  }
  if (a.kind === "tender_food") {
    const order = w.orders[a.orderId];
    const lot = ownObjects(w, bag("F"), "food", "F").find((o) => o.quantity >= a.quantity);
    if (id !== "F" || site !== "grove" || !atSite(w, "C", "grove") || !order ||
      order.status !== "farmer_accepted" || !Number.isSafeInteger(a.quantity) ||
      a.quantity < 1 || a.quantity > order.quantity || !lot) return "food tender unavailable";
    return startProcess(w, id, "tender_food", 1, 1, decisionId,
      { orderId: order.id, quantity: a.quantity });
  }
  if (a.kind === "purchase_food") {
    const order = w.orders[a.orderId];
    if (id !== "C" || site !== "grove" || !atSite(w, "F", "grove") || !order ||
      order.status !== "tendered" || !order.tenderLotId || !order.tenderEventId) return "crop purchase unavailable";
    const lot = w.physical.objects[order.tenderLotId];
    const coins = coinIds(w, wallet("C"), "S", lot?.quantity * order.bid);
    if (!lot || lot.parentId !== bag("C") || lot.ownerId !== "F" ||
      coins.length !== lot.quantity * order.bid) return "tender or entrusted cash unavailable";
    // Only this validated order and tender authorize C to act on these exact F/S objects.
    const reason = tx(w, "C", ["F", "S"], (t) => {
      t.changeOwner(lot.id, "S"); moveCoins(t, coins, wallet("F"), "F");
    });
    if (reason) return reason;
    const event = emit(w, "crop_bought", ["C", "F", "S"], [decisionId, order.tenderEventId,
      order.fundedEventId!], { orderId: order.id, quantity: lot.quantity, cost: coins.length });
    order.status = "purchased"; order.purchaseEventId = event.id;
    result(w, id, a.kind, event); send(w, "F", { kind: "result", action: a.kind, success: true,
      causeEventIds: [event.id] }); return undefined;
  }
  if (a.kind === "deliver_food") {
    const order = w.orders[a.orderId];
    const lot = order?.tenderLotId ? w.physical.objects[order.tenderLotId] : undefined;
    if (id !== "C" || site !== "market" || !atSite(w, "S", "market") || !order ||
      order.status !== "purchased" || !lot || lot.parentId !== bag("C") || lot.ownerId !== "S")
      return "crop delivery unavailable";
    return startProcess(w, id, "deliver_food", 1, 1, decisionId, { orderId: order.id });
  }
  if (a.kind === "sell_wood") {
    const bid = Object.values(w.woodBids).find((b) => b.day === day && b.buyerId === a.buyerId && !b.filledEventId);
    if (!id.startsWith("B") || !bid || site !== siteOf(w.physical, a.buyerId) ||
      !w.people[id].seenBidIds.includes(bid.id) || ownWood(w, id) < 1 ||
      coinIds(w, wallet(a.buyerId), a.buyerId, bid.price).length !== bid.price)
      return "wood sale unavailable";
    return startProcess(w, id, "sell_wood", 1, 1, decisionId, { buyerId: a.buyerId });
  }
  if (a.kind === "buy_food") {
    const quote = Object.values(w.saleQuotes).find((q) => q.day === day);
    const lot = ownObjects(w, "stock_S", "food", "S")[0];
    if (id === "S" || site !== "market" || !quote || !w.people[id].seenQuoteIds.includes(quote.id) ||
      !lot || ownCash(w, id) < quote.price || ownFood(w, id) >= 1) return "food purchase unavailable";
    const coins = coinIds(w, wallet(id), id, quote.price), unitId = uid(w, "food");
    const reason = tx(w, id, ["S"], (t) => {
      transferUnit(t, lot.id, lot.quantity, unitId, bag(id), id, decisionId);
      moveCoins(t, coins, wallet("S"), "S");
    });
    if (reason) return reason;
    if (lot.quantity > 1) w.foodLots[unitId] = { ...w.foodLots[lot.id] };
    const origin = w.foodLots[lot.id];
    const event = emit(w, "food_sold", ["S", id], [decisionId, quote.postedEventId,
      lot.causeEventId], { price: quote.price, quantity: 1,
      ...(origin?.originPlantId ? { originPlantId: origin.originPlantId } : {}) });
    result(w, id, a.kind, event); send(w, "S", { kind: "result", action: a.kind, success: true,
      causeEventIds: [event.id] }); return undefined;
  }
  if (a.kind === "eat") {
    const lot = id === "S" ? ownObjects(w, "stock_S", "food", "S")[0] ??
      ownObjects(w, bag(id), "food", id)[0] : ownObjects(w, bag(id), "food", id)[0];
    if (!lot || w.people[id].hunger < 1) return "meal unavailable";
    const origin = w.foodLots[lot.id];
    const reason = tx(w, id, [], (t) => t.remove(lot.id, 1));
    if (reason) return reason;
    if (!w.physical.objects[lot.id]) delete w.foodLots[lot.id];
    w.people[id].hunger--; w.people[id].meals++; w.eatenFood++;
    const event = emit(w, "ate", [id], [decisionId, lot.causeEventId], { quantity: 1,
      ...(origin?.originPlantId ? { originPlantId: origin.originPlantId,
        species: origin.species ?? "" } : {}) });
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "burn_wood") {
    const lot = ownObjects(w, bag(id), "wood", id)[0];
    if (!lot || w.people[id].cold < 1) return "fuel unavailable";
    const reason = tx(w, id, [], (t) => t.remove(lot.id, 1));
    if (reason) return reason;
    w.people[id].cold--; w.people[id].fuelUsed++; w.burnedWood++;
    const event = emit(w, "wood_burned", [id], [decisionId, lot.causeEventId], { quantity: 1 });
    result(w, id, a.kind, event); return undefined;
  }
  if (a.kind === "rest") return startProcess(w, id, "rest", w.fixture.workHours.rest, 0, decisionId);
  return "unknown attempt";
}
function localView(w: VillageWorld, id: VillageId): VillageContext {
  const siteId = siteOf(w.physical, id), day = dayAt(w.hour), person = w.people[id];
  const order = siteId === "market" ? Object.values(w.orders).find((o) => o.day === day) : undefined;
  const activeOrder = Object.values(w.orders).find((o) => o.day === day && o.carrierId === id);
  const quote = siteId === "market" ? Object.values(w.saleQuotes).find((q) => q.day === day) : undefined;
  const bids = Object.values(w.woodBids).filter((b) => b.day === day && !b.filledEventId &&
    siteId === siteOf(w.physical, b.buyerId));
  const carriedFarmerFood = id === "C" ? ownObjects(w, bag("C"), "food", "F")
    .reduce((n, o) => n + o.quantity, 0) : 0;
  const carriedSellerFood = id === "C" ? ownObjects(w, bag("C"), "food", "S")
    .reduce((n, o) => n + o.quantity, 0) : 0;
  return { day, hourOfDay: hourOfDay(w.hour), role: person.role, siteId,
    cell: structuredClone(person.cell),
    activeAction: person.activeProcessId ? w.processes[person.activeProcessId]?.kind : undefined,
    hunger: person.hunger, cold: person.cold, energy: person.energy,
    carriedMass: totalMass(w.physical, id),
    ownCash: ownCash(w, id), ownFood: ownFood(w, id), ownWood: ownWood(w, id),
    foodResource: siteId === "grove" ? w.resources.food.available - w.resources.food.reserved : undefined,
    woodResource: siteId === "grove" ? w.resources.wood.available - w.resources.wood.reserved : undefined,
    visibleOrder: order ? { id: order.id, day: order.day, quantity: order.quantity, bid: order.bid,
      carrierFee: order.carrierFee, salePrice: order.salePrice, status: order.status } : undefined,
    fundedOrderId: activeOrder && ["funded", "relayed", "farmer_accepted", "tendered", "purchased"].includes(activeOrder.status)
      ? activeOrder.id : undefined,
    tenderedOrderId: activeOrder?.status === "tendered" ? activeOrder.id : undefined,
    carriedFarmerFood, carriedSellerFood,
    visibleWoodBids: bids.map((bid) => ({ buyerId: bid.buyerId, price: bid.price })),
    visibleSale: quote ? { price: quote.price, stock: contentsQuantity(w.physical, "stock_S", "food") } : undefined,
    visiblePlants: Object.values(w.land.plants).filter((p) => p.siteId === siteId)
      .map((p) => ({ id: p.id, species: p.species, stage: p.stage, available: p.available })),
    farmingSkills: structuredClone(person.farmingSkills),
    ...(w.fixture.landEconomy ? { visiblePeople: ids.filter((other) =>
      siteOf(w.physical, other) === siteId) } : {}) };
}
function observe(w: VillageWorld, id: VillageId, c: VillageContext): VillageStimulus {
  const event = emit(w, "observed", [id], [], { siteId: c.siteId, x: c.cell.x, y: c.cell.y,
    hunger: c.hunger, cold: c.cold,
    ownCash: c.ownCash, ownFood: c.ownFood, ownWood: c.ownWood,
    foodResource: c.foodResource ?? -1, woodResource: c.woodResource ?? -1,
    orderId: c.visibleOrder?.id ?? "", quotePrice: c.visibleSale?.price ?? -1,
    stock: c.visibleSale?.stock ?? -1,
    bids: c.visibleWoodBids.map((b) => b.buyerId).join(","),
    plants: c.visiblePlants.map((p) => `${p.id}:${p.stage}:${p.available}`).join(","),
    ...(c.visiblePeople ? { people: c.visiblePeople.join(",") } : {}) });
  const person = w.people[id];
  if (c.visibleOrder && !person.receivedOrderIds.includes(c.visibleOrder.id)) person.receivedOrderIds.push(c.visibleOrder.id);
  for (const bid of Object.values(w.woodBids)) if (bid.day === c.day && !bid.filledEventId &&
    siteOf(w.physical, bid.buyerId) === c.siteId && !person.seenBidIds.includes(bid.id)) person.seenBidIds.push(bid.id);
  for (const quote of Object.values(w.saleQuotes)) if (quote.day === c.day && c.siteId === "market" &&
    !person.seenQuoteIds.includes(quote.id)) person.seenQuoteIds.push(quote.id);
  return { id: uid(w, "s"), kind: "observation", occurredAt: w.hour, receivedAt: w.hour,
    causeEventIds: [event.id] };
}
function growAndNeed(w: VillageWorld) {
  const day = dayAt(w.hour);
  if (day <= 1 || hourOfDay(w.hour) !== 1) return;
  for (const [kind, resource] of Object.entries(w.resources) as ["food" | "wood", VillageWorld["resources"]["food"]][]) {
    const amount = Math.min(resource.growthPerDay, resource.capacity - resource.available);
    if (amount) { resource.available += amount; resource.grown += amount;
      emit(w, "resource_grew", [], [], { kind, quantity: amount }); }
    if (kind === "food" && amount) {
      const berry = w.land.plants.wild_berry;
      berry.available += amount; berry.grown += amount; berry.ageHours = 0; berry.stage = "ripe";
      emit(w, "plant_grew", [], [], { plantId: berry.id, quantity: amount, stage: berry.stage });
    }
  }
  for (const [lotId, meta] of Object.entries(w.foodLots)) {
    if (day - meta.harvestedDay < w.fixture.foodShelfLifeDays) continue;
    const lot = w.physical.objects[lotId];
    if (!lot) { delete w.foodLots[lotId]; continue; }
    delete w.physical.objects[lotId]; delete w.foodLots[lotId]; w.spoiledFood += lot.quantity;
    emit(w, "food_spoiled", [], [lot.causeEventId], { lotId, quantity: lot.quantity,
      ownerId: lot.ownerId!, siteId: siteOf(w.physical, lot.parentId!) });
  }
  for (const id of ids) {
    const p = w.people[id]; p.hunger++; p.cold++;
    const event = emit(w, "body_need", [id], [], { hunger: p.hunger, cold: p.cold });
    send(w, id, { kind: "body", causeEventIds: [event.id] }, 0);
  }
}
export function advanceVillageWorld(w: VillageWorld, hours: number, model: VillageModel = ordinaryVillageModel) {
  if (!Number.isSafeInteger(hours) || hours < 0 || w.hour + hours > w.fixture.days * 24)
    throw Error("invalid village advance");
  for (let step = 0; step < hours; step++) {
    w.hour++;
    growAndNeed(w);
    for (const effect of advanceLandHour(w.land, w.grid, w.hour)) {
      if (effect.kind === "animal_moved") {
        const animalId = effect.animalId!, transitId = uid(w, "animal_transit");
        const moved = physicalTransaction(w.physical, { actorId: animalId, ownerIds: [] }, (t) => {
          t.depart({ id: transitId, typeId: "site", parentId: "world", quantity: 1,
            causeEventId: "animal_step" }, [animalId]);
          t.arrive(transitId, `tile_${effect.x}_${effect.y}`, [animalId]);
        });
        if (!moved.ok) throw Error(`animal movement failed: ${moved.reason}`);
        w.physical = moved.state;
      } else if (effect.kind === "animal_born") {
        const bornEvent = emit(w, "animal_born", [], [], { animalId: effect.animalId!,
          parentAnimalId: effect.parentAnimalId!, x: effect.x!, y: effect.y! });
        const born = physicalTransaction(w.physical,
          { actorId: effect.parentAnimalId!, ownerIds: [] }, (t) => t.add({
            id: effect.animalId!, typeId: "animal",
            parentId: `tile_${effect.x}_${effect.y}`, quantity: 1,
            causeEventId: bornEvent.id }));
        if (!born.ok) throw Error(`animal birth failed: ${born.reason}`);
        w.physical = born.state;
        continue;
      } else if (effect.kind === "animal_died") {
        const died = physicalTransaction(w.physical, { actorId: effect.animalId!, ownerIds: [] },
          (t) => t.destroy(effect.animalId!));
        if (!died.ok) throw Error(`animal death failed: ${died.reason}`);
        w.physical = died.state;
      }
      emit(w, effect.kind, [], [], { plantId: effect.plantId ?? "",
        animalId: effect.animalId ?? "", x: effect.x ?? -1, y: effect.y ?? -1,
        quantity: effect.quantity ?? 0, stage: effect.stage ?? "",
        ...(effect.parentAnimalId ? { parentAnimalId: effect.parentAnimalId } : {}) });
    }
    for (const command of w.terrainCommands) if (command.status === "queued" && command.at === w.hour) {
      const key = cellKey(command.cell);
      const forbidden = Object.values(w.grid.sites).some((p) => sameCell(p, command.cell)) ||
        Object.values(w.people).some((p) => sameCell(p.cell, command.cell)) ||
        Object.values(w.land.animals).some((a) => sameCell(a.cell, command.cell));
      if (command.blocked && forbidden) {
        const event = emit(w, "terrain_rejected", [], [], { commandId: command.id, cell: key,
          reason: "occupied or site cell" });
        command.eventId = event.id;
      } else {
        w.grid.blocked = w.grid.blocked.filter((c) => c !== key);
        if (command.blocked) w.grid.blocked.push(key);
        w.grid.blocked.sort();
        const event = emit(w, "terrain_changed", [], [], { commandId: command.id, cell: key,
          blocked: command.blocked ? 1 : 0 });
        w.terrainEventIds[key] = event.id; command.eventId = event.id;
      }
      command.status = "applied";
    }
    progressProcesses(w);
    for (const command of w.commands) if (command.status === "queued" && command.at === w.hour)
      w.people[command.actorId].nextWakeAt = Math.min(w.people[command.actorId].nextWakeAt, w.hour);
    wakeActors(w.hour, w.people, w.pending, (actorId, delivered) => {
      const id = actorId as VillageId, person = w.people[id];
      const command = w.commands.find((c) => c.status === "queued" && c.at === w.hour && c.actorId === id);
      const seenStimuli = new Set(person.receivedStimulusIds);
      const newStimuli = delivered.filter((s) => {
        if (seenStimuli.has(s.id)) return false;
        seenStimuli.add(s.id); return true;
      });
      const receiptIds = newStimuli.map((stimulus) => emit(w, "stimulus_received", [id],
        stimulus.causeEventIds, { stimulusId: stimulus.id, stimulusKind: stimulus.kind,
          occurredAt: stimulus.occurredAt, receivedAt: w.hour }).id);
      for (const stimulus of newStimuli) {
        person.receivedStimulusIds.push(stimulus.id);
        if (stimulus.kind === "order" && stimulus.order && !person.receivedOrderIds.includes(stimulus.order.id))
          person.receivedOrderIds.push(stimulus.order.id);
      }
      person.inbox.push(...newStimuli);
      if (person.activeProcessId) {
        const process = w.processes[person.activeProcessId];
        if (command) {
          if (command.attempt.kind === "redirect_travel" && process.kind === "travel") {
            const submitted = emit(w, "command_submitted", [id], [process.startEventId],
              { commandId: command.id, action: command.attempt.kind });
            const reason = redirectTravel(w, id, command.attempt.siteId, submitted.id);
            if (reason) {
              const rejected = emit(w, "attempt_rejected", [id], [submitted.id],
                { attempt: command.attempt.kind, reason });
              result(w, id, command.attempt.kind, rejected, false, reason);
            }
            command.status = "applied"; command.eventId = submitted.id;
          } else {
            const rejected = emit(w, "command_rejected", [id], [process.startEventId],
              { commandId: command.id, reason: "actor already working" });
            command.status = "applied"; command.eventId = rejected.id;
            result(w, id, command.attempt.kind, rejected, false, "actor already working");
          }
        }
        person.nextWakeAt = w.hour + Math.max(1, process.duration - process.progress);
        return;
      }
      const view = localView(w, id);
      const observation = observe(w, id, view);
      const stimuli = [...person.inbox, observation];
      person.inbox = [];
      const subjectiveBefore = structuredClone(person.memory);
      const response = model.decide({ actorId: id, at: w.hour, stimuli,
        subjectiveState: structuredClone(subjectiveBefore), knownContext: view });
      if (!Number.isSafeInteger(response.wait.at) || response.wait.at <= w.hour || response.attempts.length > 1)
        throw Error("invalid village response");
      person.nextWakeAt = response.wait.at;
      if (response.subjectiveUpdate) person.memory = structuredClone(response.subjectiveUpdate);
      const chosen = command?.attempt ?? response.attempts[0];
      const decision = emit(w, "person_decided", [id],
        [...receiptIds, ...stimuli.flatMap((s) => s.causeEventIds)],
        { attempt: chosen?.kind ?? "wait", source: command ? "command" : "personality" });
      w.decisions.push({ eventId: decision.id, actorId: id, hour: w.hour,
        stimuli: structuredClone(stimuli), knownContext: structuredClone(view),
        subjectiveBefore, response: structuredClone(response),
        chosen: chosen ? structuredClone(chosen) : undefined, commandId: command?.id });
      const causeId = command ? emit(w, "command_submitted", [id], [decision.id],
        { commandId: command.id, action: command.attempt.kind }).id : decision.id;
      if (command) { command.status = "applied"; command.eventId = causeId; }
      if (chosen) {
        const reason = attempt(w, id, chosen, causeId);
        if (reason) {
          const rejected = emit(w, "attempt_rejected", [id], [causeId],
            { attempt: chosen.kind, reason });
          result(w, id, chosen.kind, rejected, false, reason);
        }
      }
    });
  }
  checkVillageWorld(w); return w;
}
export function checkVillageWorld(w: VillageWorld) {
  if (w.schemaVersion !== 2 || w.mode !== "autonomous_village" || !Number.isSafeInteger(w.hour) || w.hour < 0 ||
    w.hour > w.fixture.days * 24 || !Number.isSafeInteger(w.nextId) || w.nextId < 1)
    throw Error("invalid village world");
  checkPhysical(w.physical);
  checkGridMap(w.grid); checkGridMap(w.initialGrid); checkLandEcology(w.land, w.grid);
  checkLandEcology(w.initialLand, w.initialGrid);
  for (const animal of Object.values(w.land.animals)) if (w.physical.objects[animal.id]?.typeId !== "animal" ||
    w.physical.objects[animal.id].parentId !== `tile_${animal.cell.x}_${animal.cell.y}`)
    throw Error("animal physical location");
  for (const animal of Object.values(w.physical.objects).filter((o) => o.typeId === "animal"))
    if (!w.land.animals[animal.id]) throw Error("orphan physical animal");
  const objects = Object.values(w.physical.objects);
  if (objects.filter((o) => o.typeId === "currency").length !== w.initialMoney ||
    objects.filter((o) => o.typeId === "food").reduce((n, o) => n + o.quantity, 0) !==
      w.harvestedFood - w.eatenFood - w.spoiledFood ||
    objects.filter((o) => o.typeId === "wood").reduce((n, o) => n + o.quantity, 0) !==
      w.harvestedWood - w.burnedWood ||
    objects.filter((o) => o.typeId === "seed").reduce((n, o) => n + o.quantity, 0) !==
      w.initialSeeds + w.seedsProduced - w.seedsUsed ||
    objects.some((o) => o.typeId === "food" && !w.foodLots[o.id]) ||
    Object.keys(w.foodLots).some((id) => w.physical.objects[id]?.typeId !== "food"))
    throw Error("village inventory conservation");
  if (w.fixture.landEconomy && Object.values(w.foodLots).some((lot) =>
    !lot.originPlantId || !w.land.plants[lot.originPlantId] ||
    lot.originSiteId !== w.land.plants[lot.originPlantId].siteId ||
    lot.species !== w.land.plants[lot.originPlantId].species ||
    !Number.isSafeInteger(lot.harvestedDay) || lot.harvestedDay < 1 ||
    lot.harvestedDay > dayAt(w.hour))) throw Error("village food provenance");
  for (const kind of ["food", "wood"] as const) {
    const r = w.resources[kind];
    const taken = kind === "food" ? w.harvestedFood - w.harvestedLandFood : w.harvestedWood;
    if (!Number.isSafeInteger(r.available) || r.available < 0 || r.available > r.capacity ||
      r.available !== r.initial + r.grown - taken ||
      r.reserved !== Object.values(w.processes).filter((p) => p.kind === "forage" && p.resource === kind)
        .reduce((n, p) => n + p.quantity!, 0) || r.reserved > r.available) throw Error("village resource conservation");
  }
  if (w.land.plants.wild_berry.available !== w.resources.food.available ||
    w.land.plants.wild_berry.grown !== w.resources.food.grown ||
    w.land.plants.wild_berry.personHarvested !== w.harvestedFood - w.harvestedLandFood)
    throw Error("village wild food mirror");
  const eventIds = new Set<string>();
  for (const event of w.events) {
    if (eventIds.has(event.id) || event.causes.some((id) => !eventIds.has(id)) ||
      event.actors.some((id) => !ids.includes(id as VillageId))) throw Error("village event graph");
    eventIds.add(event.id);
  }
  for (const id of ids) {
    const p = w.people[id];
    if (p?.id !== id || !Number.isSafeInteger(p.nextWakeAt) || p.nextWakeAt <= w.hour ||
      !Number.isSafeInteger(p.energy) || p.energy < 0 || p.energy > w.fixture.body.maxEnergy ||
      !Number.isSafeInteger(p.hunger) || p.hunger < 0 || !Number.isSafeInteger(p.cold) || p.cold < 0 ||
      p.activeProcessId && w.processes[p.activeProcessId]?.actorId !== id ||
      new Set(p.receivedStimulusIds).size !== p.receivedStimulusIds.length ||
      !inGrid(w.grid, p.cell) ||
      !siteOf(w.physical, id).startsWith("transit_") &&
        !sameCell(p.cell, w.grid.sites[siteOf(w.physical, id)]) ||
      w.physical.objects[id]?.typeId !== "person") throw Error("village person");
  }
  if (!Array.isArray(w.decisions)) throw Error("village decisions");
  for (const d of w.decisions) if (!w.people[d.actorId] || !eventIds.has(d.eventId) ||
    !Number.isSafeInteger(d.hour) || d.hour < 1 || d.hour > w.hour ||
    d.stimuli.some((s) => s.receivedAt > d.hour ||
      s.causeEventIds.some((causeId) => !eventIds.has(causeId))))
    throw Error("village decision record");
  for (const process of Object.values(w.processes)) if (!w.people[process.actorId] ||
    w.people[process.actorId].activeProcessId !== process.id || process.progress < 0 ||
    process.progress >= process.duration || !eventIds.has(process.startEventId) ||
    process.kind === "travel" && (!process.path || !Number.isSafeInteger(process.pathIndex) ||
      process.pathIndex! < 0 || process.pathIndex! >= process.path.length ||
      !sameCell(process.path[process.pathIndex!], w.people[process.actorId].cell) ||
      !sameCell(process.path.at(-1)!, w.grid.sites[process.destinationId!]) ||
      !Number.isSafeInteger(process.edgeProgress) || process.edgeProgress! < 0 ||
      process.edgeProgress! >= process.stepHours! *
        (w.grid.cost[cellKey(process.path[Math.min(process.pathIndex! + 1, process.path.length - 1)])] ?? 1)))
    throw Error("village process");
  for (const pending of w.pending) if (!w.people[pending.recipientId] ||
    pending.stimulus.receivedAt <= w.hour || pending.stimulus.occurredAt > w.hour ||
    pending.stimulus.causeEventIds.some((id) => !eventIds.has(id))) throw Error("village pending stimulus");
  if (!Array.isArray(w.commands) || new Set(w.commands.map((c) => c.id)).size !== w.commands.length)
    throw Error("village commands");
  for (const command of w.commands) if (!command.id || !w.people[command.actorId] ||
    !Number.isSafeInteger(command.at) || command.at < 1 || command.at > w.fixture.days * 24 ||
    !["queued", "applied"].includes(command.status) ||
    command.status === "queued" && command.at <= w.hour ||
    command.status === "applied" && (!command.eventId || !eventIds.has(command.eventId)))
    throw Error("village command");
  if (!Array.isArray(w.terrainCommands) || new Set(w.terrainCommands.map((c) => c.id)).size !==
    w.terrainCommands.length || Object.values(w.terrainEventIds).some((id) => !eventIds.has(id)))
    throw Error("village terrain commands");
  for (const command of w.terrainCommands) if (!command.id || !inGrid(w.grid, command.cell) ||
    !Number.isSafeInteger(command.at) || command.at < 1 || command.at > w.fixture.days * 24 ||
    !["queued", "applied"].includes(command.status) ||
    command.status === "queued" && command.at <= w.hour ||
    command.status === "applied" && (!command.eventId || !eventIds.has(command.eventId)))
    throw Error("village terrain command");
}
export function queueVillageCommand(w: VillageWorld, input: { id: string; actorId: VillageId; at: number;
  attempt: VillageAttempt }) {
  if (!input.id || !w.people[input.actorId] || !Number.isSafeInteger(input.at) || input.at <= w.hour ||
    input.at > w.fixture.days * 24 || w.commands.some((c) => c.id === input.id ||
      c.actorId === input.actorId && c.at === input.at)) throw Error("invalid village command");
  w.commands.push({ ...structuredClone(input), status: "queued" });
  return w;
}
export function queueVillageTerrainCommand(w: VillageWorld, input: { id: string; at: number;
  cell: GridPoint; blocked: boolean }) {
  if (!input.id || !inGrid(w.grid, input.cell) || !Number.isSafeInteger(input.at) ||
    input.at <= w.hour || input.at > w.fixture.days * 24 ||
    w.terrainCommands.some((c) => c.id === input.id)) throw Error("invalid terrain command");
  w.terrainCommands.push({ ...structuredClone(input), status: "queued" });
  return w;
}
export function saveVillageWorld(w: VillageWorld) { checkVillageWorld(w); return JSON.stringify(w); }
export function loadVillageWorld(json: string) { const w = JSON.parse(json) as VillageWorld; checkVillageWorld(w); return w; }
export function replayVillageWorld(seed: number, days: number, fixture?: VillageFixture,
  model: VillageModel = ordinaryVillageModel,
  commands: { id: string; actorId: VillageId; at: number; attempt: VillageAttempt }[] = []) {
  const w = newVillageWorld(seed, fixture);
  for (const command of commands) queueVillageCommand(w, command);
  return advanceVillageWorld(w, days * 24, model);
}
export function villageHash(w: VillageWorld) { return hash(w); }
export function villageSummary(w: VillageWorld) { return { day: w.hour ? dayAt(w.hour) : 0, hour: w.hour,
  harvestedFood: w.harvestedFood, eatenFood: w.eatenFood, spoiledFood: w.spoiledFood,
  harvestedWood: w.harvestedWood, burnedWood: w.burnedWood,
  ...(w.fixture.landEconomy ? { landEconomy: {
    cultivatedFood: Object.values(w.land.plants).filter((p) => p.species === "grain")
      .reduce((n, p) => n + p.personHarvested, 0),
    wildFood: w.land.plants.wild_berry.personHarvested,
    seedsHeld: contentsQuantity(w.physical, bag("F"), "seed"), seedsUsed: w.seedsUsed,
    seedsProduced: w.seedsProduced, season: w.land.season,
    animals: Object.keys(w.land.animals).length,
    animalBirths: w.land.animalBirths, animalDeaths: w.land.animalDeaths } } : {}),
  resource: Object.fromEntries(Object.entries(w.resources).map(([k, v]) => [k, v.available])),
  people: Object.fromEntries(ids.map((id) => [id, { site: siteOf(w.physical, id), cash: ownCash(w, id),
    hunger: w.people[id].hunger, cold: w.people[id].cold, energy: w.people[id].energy,
    meals: w.people[id].meals, fuelUsed: w.people[id].fuelUsed,
    food: ownFood(w, id), wood: ownWood(w, id) }])) }; }
