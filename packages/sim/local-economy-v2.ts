import { economyE1V2 } from "../content/economy-e1-v2";
import { hash } from "./core";
import { capacityReport, checkPhysical, contentsQuantity, physicalTransaction, siteOf, type PhysicalObject, type PhysicalState } from "./physical";
import { proposeFoodDelivery, type FoodDeliveryProposal } from "./transport-capability";
import type { LocalAction, LocalCommand, LocalEvent, LocalTask } from "./local-economy";

const c = economyE1V2;
const tm = c.times;
const dayOf = (minute: number) => Math.floor(minute / 1440) + 1;
const baseOf = (day: number) => (day - 1) * 1440;
const home = (id: string) => `house:${id}`;
const chest = (id: string) => `chest_${id}`;
const pouch = (id: string) => `pouch_${id}`;
const bag = (id: string) => `bag_${id}`;
const store = (id: string) => `store_${id}`;
type PersonV2 = { id: string; householdId: string; role: string; hunger: number; energy: number; journey?: { transitId: string; fromId: string; toId: string; depart: number; arrive: number; mode: "walk" | "cart"; effortCost: number; distanceKm: number; causeEventId: string } };
type LocalTaskV2 = Omit<LocalTask, "capability"> & { capability: LocalTask["capability"] | "rest" };
type OrderV2 = { id: string; day: number; householdId: string; buyerId: string; quantity: number; status: "requested" | "sale_reserved" | "settled" | "expired"; requestEventId: string; reservationEventId?: string; allocations: { lotId: string; quantity: number; reservationId: string }[]; moneyReservationId?: string };
type ShipmentV2 = { id: string; day: number; carrierId: string; status: "requested" | "assigned" | "in_transit" | "delivered" | "failed"; requestedQuantity: number; quantity: number; requestEventId: string; lastEventId: string; proposal?: FoodDeliveryProposal };
export type LocalWorldV2 = {
  schemaVersion: 3; economicMode: "local_food_v2"; engineVersion: "0.4.1-e1";
  seed: number; contentHash: string; minute: number; nextId: number;
  physical: PhysicalState; people: Record<string, PersonV2>;
  capabilities: Record<string, { id: string; definitionId: string; version: number; bearerId: string }>;
  households: Record<string, { id: string; memberIds: string[]; buyerId: string }>;
  tasks: LocalTaskV2[]; orders: OrderV2[]; shipments: ShipmentV2[];
  cartCondition: number;
  events: LocalEvent[]; commands: LocalCommand[];
  absences: { personId: string; day: number }[];
  extraOrders: { householdId: string; day: number; amount: number; commandEventId: string }[];
  producedFood: number; consumedFood: number; lostFood: number; initialMoney: number;
};

function uid(w: LocalWorldV2, prefix: string) { return `${prefix}_${String(w.nextId++).padStart(6, "0")}`; }
function emit(w: LocalWorldV2, kind: string, actors: string[], causes: string[] = [], data: LocalEvent["data"] = {}) {
  const known = new Set(w.events.map((e) => e.id));
  if (causes.some((id) => !known.has(id))) throw Error(`unknown cause for ${kind}`);
  const e: LocalEvent = { id: uid(w, "e"), minute: w.minute, kind, actors, causes: [...causes], data };
  w.events.push(e); return e;
}
function at(w: LocalWorldV2, id: string) { return siteOf(w.physical, id); }
function amount(w: LocalWorldV2, parentId: string, tag: string) { return contentsQuantity(w.physical, parentId, tag); }
function lots(w: LocalWorldV2, parentId: string, typeId: "food" | "currency", ownerId?: string) {
  return Object.values(w.physical.objects).filter((o) => o.parentId === parentId && o.typeId === typeId && (!ownerId || o.ownerId === ownerId));
}
function absent(w: LocalWorldV2, id: string, day: number) { return w.absences.some((a) => a.personId === id && a.day === day); }
function tx(w: LocalWorldV2, actorId: string, ownerIds: string[], operation: Parameters<typeof physicalTransaction>[2], claimIds?: string[], consentingPersonIds?: string[]) {
  const result = physicalTransaction(w.physical, { actorId, ownerIds, claimIds, consentingPersonIds }, operation);
  if (result.ok) w.physical = result.state;
  return result;
}
function addObject(objects: PhysicalState["objects"], id: string, typeId: string, parentId: string | null, ownerId?: string, quantity = 1) {
  objects[id] = { id, typeId, parentId, ownerId, quantity, causeEventId: "initial" };
}
export function newLocalWorldV2(seed = 240924): LocalWorldV2 {
  if (!Number.isSafeInteger(seed)) throw Error("invalid seed");
  const objects: PhysicalState["objects"] = {}, people: LocalWorldV2["people"] = {}, households: LocalWorldV2["households"] = {};
  addObject(objects, "world", "world", null);
  addObject(objects, "town", "site", "world"); addObject(objects, "farm", "site", "world"); addObject(objects, "market", "site", "town");
  addObject(objects, store("farm"), "foodStoreFarm", "farm", "cooperative");
  addObject(objects, store("market"), "foodStoreMarket", "market", "cooperative");
  addObject(objects, "cart_1", "cart", "market", "cooperative");
  addObject(objects, "till_cooperative", "till", "market", "cooperative");
  addObject(objects, "box_reserve", "chest", home("H0"), "reserve");
  for (const h of c.households) {
    const members = [...h.farmers, h.buyer, ...h.other];
    households[h.id] = { id: h.id, memberIds: members, buyerId: h.buyer };
    addObject(objects, home(h.id), "site", "town");
    addObject(objects, store(h.id), "foodStoreHouse", home(h.id), h.id);
    addObject(objects, chest(h.id), "chest", home(h.id), h.id);
    addObject(objects, `initial_coins_${h.id}`, "currency", chest(h.id), h.id, c.initialHouseholdMoney);
    for (const id of members) {
      addObject(objects, id, "person", home(h.id));
      people[id] = { id, householdId: h.id,
        role: h.farmers.includes(id) ? "farmer" : id === h.buyer ? "buyer" : id === c.roles.seller ? "seller" : id === c.roles.carrier ? "carrier" : "dependent",
        hunger: 0, energy: c.limits.personEnergy };
    }
    addObject(objects, pouch(h.buyer), "pouch", h.buyer, h.id);
    addObject(objects, bag(h.buyer), "bag", h.buyer, h.id);
  }
  const w: LocalWorldV2 = {
    schemaVersion: 3, economicMode: "local_food_v2", engineVersion: "0.4.1-e1", seed,
    contentHash: hash(c), minute: 0, nextId: 1,
    physical: { types: structuredClone(c.physicalTypes), objects, reservations: [] }, people, households,
    capabilities: { carry_C: { id: "carry_C", definitionId: "transport.food.v1", version: 1, bearerId: c.roles.carrier } },
    tasks: [], orders: [], shipments: [], cartCondition: 100, events: [], commands: [], absences: [], extraOrders: [],
    producedFood: 0, consumedFood: 0, lostFood: 0, initialMoney: c.initialHouseholdMoney * c.households.length,
  };
  checkLocalV2(w); return w;
}

function offerTask(w: LocalWorldV2, personId: string, capability: LocalTaskV2["capability"], start: number, end: number, causes: string[] = []) {
  const routine = capability === "rest" ? { id: "life.rest", version: 1 } : c.routines.find((r) => r.capability === capability)!;
  const offer = emit(w, "task_offered", [personId], causes, { routineId: routine.id, capability, start, end });
  const overlap = w.tasks.some((task) => task.personId === personId && task.status !== "refused" && start < task.end && task.start < end);
  const unavailable = capability !== "eat_food" && capability !== "rest" && absent(w, personId, dayOf(start));
  const status = unavailable || overlap ? "refused" : "accepted";
  const answer = emit(w, status === "accepted" ? "task_accepted" : "task_refused", [personId], [offer.id], { reason: unavailable ? "absent" : overlap ? "busy" : "ordinary_role" });
  const task: LocalTaskV2 = { id: uid(w, "task"), personId, routineId: routine.id, routineVersion: routine.version, capability, start, end, status, offerEventId: offer.id, answerEventId: answer.id };
  w.tasks.push(task); return task;
}
function taskAt(w: LocalWorldV2, personId: string, capability: LocalTaskV2["capability"], day: number) {
  return w.tasks.find((task) => task.personId === personId && task.capability === capability && dayOf(task.start) === day && task.status === "accepted");
}
function completeTask(w: LocalWorldV2, task: LocalTaskV2, kind: string, causes: string[] = [], data: LocalEvent["data"] = {}) {
  const e = emit(w, kind, [task.personId], [task.answerEventId, ...causes], data);
  task.status = "completed"; task.resultEventId = e.id; return e;
}
function workEffort(w: LocalWorldV2, personId: string, work: string, effort: number, causes: string[]) {
  const person = w.people[personId], before = person.energy;
  if (before < effort) {
    emit(w, "work_blocked", [personId], causes, { work, effort, energy: before });
    return undefined;
  }
  person.energy -= effort;
  return emit(w, "work_effort_paid", [personId], causes, { work, effort, energyBefore: before, energyAfter: person.energy });
}
function travel(w: LocalWorldV2, personId: string, toId: string, arrive: number, causes: string[] = [], cart = false) {
  const p = w.people[personId], fromId = at(w, personId);
  if (p.journey || arrive <= w.minute) throw Error("invalid journey");
  if (fromId === toId) return true;
  const foodLoad = cart ? amount(w, "cart_1", "food") : amount(w, personId, "food");
  const cashLoad = amount(w, personId, "currency");
  const distanceKm = fromId === "farm" || toId === "farm" ? c.roadKm : c.limits.townKm;
  const effortCost = cart ? Math.ceil(distanceKm * (c.limits.cartEffortPerKm + Math.ceil(foodLoad / 5) * c.limits.cartExtraEffortPerFiveFoodKm)) :
    Math.ceil(distanceKm * (c.limits.walkEffortPerKm + foodLoad + Math.ceil(cashLoad / 10)));
  const wear = cart ? Math.ceil(distanceKm * c.labor.cartWearPerKm) : 0;
  const reason = cart && at(w, "cart_1") !== fromId ? "cart_not_here" : p.energy < effortCost ? "exhausted" :
    cart && w.cartCondition < wear ? "cart_unfit" :
    foodLoad > (cart ? c.cartCapacity : c.limits.personFood) ? "food_capacity" : cashLoad > c.limits.personCash ? "cash_capacity" : "";
  if (reason) { emit(w, "journey_blocked", [personId], causes, { to: toId, reason, foodLoad, cashLoad, effortCost, energy: p.energy }); return false; }
  const transitId = uid(w, "transit");
  const result = tx(w, personId, cart ? ["cooperative"] : [], (t) => t.depart(
    { id: transitId, typeId: "site", parentId: "world", quantity: 1, causeEventId: causes.at(-1) ?? "initial" },
    cart ? [personId, "cart_1"] : [personId]));
  if (!result.ok) { emit(w, "journey_blocked", [personId], causes, { to: toId, reason: result.reason, foodLoad, cashLoad, effortCost, energy: p.energy }); return false; }
  p.energy -= effortCost;
  const e = emit(w, "journey_started", [personId], causes, { from: fromId, to: toId, arrive, mode: cart ? "cart" : "walk", distanceKm, effortCost, foodLoad, cashLoad });
  if (cart) {
    const before = w.cartCondition;
    w.cartCondition -= wear;
    emit(w, "vehicle_worn", [personId], [e.id], { vehicleId: "cart_1", wear, conditionBefore: before, conditionAfter: w.cartCondition });
  }
  p.journey = { transitId, fromId, toId, depart: w.minute, arrive, mode: cart ? "cart" : "walk", effortCost, distanceKm, causeEventId: e.id };
  return true;
}
function arrive(w: LocalWorldV2, personId: string) {
  const p = w.people[personId], j = p.journey!;
  const result = tx(w, personId, j.mode === "cart" ? ["cooperative"] : [], (t) => t.arrive(j.transitId, j.toId, j.mode === "cart" ? [personId, "cart_1"] : [personId]));
  if (!result.ok) throw Error(`arrival failed: ${result.reason}`);
  p.journey = undefined;
  const e = emit(w, "journey_arrived", [personId], [j.causeEventId], { place: j.toId });
  if (j.toId !== home(p.householdId)) return;
  for (const lot of lots(w, bag(personId), "food")) {
    const moved = tx(w, personId, [p.householdId], (t) => t.move(lot.id, store(p.householdId)));
    if (!moved.ok) throw Error(`home delivery failed: ${moved.reason}`);
    const brought = emit(w, "food_brought_home", [personId], [e.id, lot.causeEventId], { lotId: lot.id, quantity: lot.quantity });
    w.physical.objects[lot.id].causeEventId = brought.id;
  }
  for (const lot of lots(w, pouch(personId), "currency")) {
    const moved = tx(w, personId, [p.householdId], (t) => t.move(lot.id, chest(p.householdId)));
    if (!moved.ok) throw Error(`cash return failed: ${moved.reason}`);
    emit(w, "cash_moved", [personId], [e.id], { from: pouch(personId), to: chest(p.householdId), amount: lot.quantity });
  }
}

function createOrder(w: LocalWorldV2, householdId: string, day: number, quantity: number, causes: string[]) {
  const h = w.households[householdId];
  const e = emit(w, "purchase_requested", [h.buyerId], causes, { householdId, quantity });
  const order: OrderV2 = { id: uid(w, "order"), day, householdId, buyerId: h.buyerId, quantity, status: "requested", requestEventId: e.id, allocations: [] };
  w.orders.push(order); return order;
}
function buyerDepart(w: LocalWorldV2, order: OrderV2) {
  const p = w.people[order.buyerId], fromId = at(w, p.id), cost = order.quantity * c.price;
  const available = lots(w, chest(order.householdId), "currency", order.householdId).find((o) => o.quantity >= cost);
  if (!available) return travel(w, p.id, "market", w.minute + 15, [order.requestEventId]);
  const loadedCash = amount(w, pouch(p.id), "currency") + cost;
  const effortCost = Math.ceil(c.limits.townKm * (c.limits.walkEffortPerKm + Math.ceil(loadedCash / 10)));
  if (p.energy < effortCost) {
    emit(w, "journey_blocked", [p.id], [order.requestEventId], { to: "market", reason: "exhausted", effortCost, energy: p.energy }); return false;
  }
  const transitId = uid(w, "transit"), coinId = cost < available.quantity ? uid(w, "coin") : available.id;
  const result = tx(w, p.id, [order.householdId], (t) => {
    if (coinId !== available.id) t.split(available.id, coinId, cost, order.requestEventId);
    t.move(coinId, pouch(p.id));
    t.depart({ id: transitId, typeId: "site", parentId: "world", quantity: 1, causeEventId: order.requestEventId }, [p.id]);
  });
  if (!result.ok) { emit(w, "journey_blocked", [p.id], [order.requestEventId], { to: "market", reason: result.reason }); return false; }
  const moved = emit(w, "cash_moved", [p.id], [order.requestEventId], { from: chest(order.householdId), to: pouch(p.id), amount: cost });
  p.energy -= effortCost;
  const e = emit(w, "journey_started", [p.id], [moved.id], { from: fromId, to: "market", arrive: w.minute + 15, mode: "walk", distanceKm: c.limits.townKm, effortCost, foodLoad: 0, cashLoad: loadedCash });
  p.journey = { transitId, fromId, toId: "market", depart: w.minute, arrive: w.minute + 15, mode: "walk", effortCost, distanceKm: c.limits.townKm, causeEventId: e.id };
  return true;
}
export function reservePurchaseV2(w: LocalWorldV2, orderId: string): boolean {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "requested" || at(w, order.buyerId) !== "market" || at(w, c.roles.seller) !== "market" ||
    !taskAt(w, c.roles.seller, "market_sale", order.day)) return false;
  const cost = order.quantity * c.price;
  const coin = lots(w, pouch(order.buyerId), "currency", order.householdId).find((o) => o.quantity >= cost);
  if (!coin || order.quantity + amount(w, bag(order.buyerId), "food") > c.limits.personFood ||
    amount(w, "till_cooperative", "currency") + cost > c.limits.marketTillCash) return false;
  const allocations: OrderV2["allocations"] = [];
  let remaining = order.quantity;
  for (const lot of lots(w, store("market"), "food", "cooperative")) {
    const available = lot.quantity - w.physical.reservations.filter((r) => r.objectId === lot.id).reduce((n, r) => n + r.quantity, 0);
    const n = Math.min(remaining, available);
    if (n > 0) { allocations.push({ lotId: lot.id, quantity: n, reservationId: uid(w, "reserve") }); remaining -= n; }
    if (!remaining) break;
  }
  if (remaining) return false;
  const moneyReservationId = uid(w, "reserve");
  const result = tx(w, order.buyerId, ["cooperative", order.householdId], (t) => {
    for (const a of allocations) t.reserve(a.lotId, a.reservationId, a.quantity, order.id);
    t.reserve(coin.id, moneyReservationId, cost, order.id);
  });
  if (!result.ok) return false;
  order.allocations = allocations; order.moneyReservationId = moneyReservationId; order.status = "sale_reserved";
  const e = emit(w, "sale_reserved", [order.buyerId, c.roles.seller], [order.requestEventId, ...allocations.map((a) => w.physical.objects[a.lotId].causeEventId)], { orderId, quantity: order.quantity, cost });
  order.reservationEventId = e.id; return true;
}
export function cancelPurchaseV2(w: LocalWorldV2, orderId: string): boolean {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || !["requested", "sale_reserved"].includes(order.status)) return false;
  if (order.status === "sale_reserved") {
    const ids = [...order.allocations.map((a) => a.reservationId), order.moneyReservationId!];
    const result = tx(w, order.buyerId, [], (t) => { for (const id of ids) t.release(id); }, ids);
    if (!result.ok) throw Error(`cancel failed: ${result.reason}`);
  }
  order.status = "expired"; order.allocations = []; order.moneyReservationId = undefined;
  emit(w, "sale_expired", [order.buyerId], [order.requestEventId], { orderId }); return true;
}
export function settlePurchaseV2(w: LocalWorldV2, orderId: string): boolean {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "sale_reserved" || !order.moneyReservationId || at(w, order.buyerId) !== "market" || at(w, c.roles.seller) !== "market" ||
    w.people[order.buyerId].energy < c.labor.purchaseEffort ||
    !w.tasks.some((t) => t.personId === order.buyerId && t.capability === "buy_food" && t.status === "accepted" && t.end === w.minute)) return false;
  const cost = order.quantity * c.price, coin = lots(w, pouch(order.buyerId), "currency", order.householdId)[0];
  if (!coin || amount(w, "till_cooperative", "currency") + cost > c.limits.marketTillCash) return false;
  const claims = [...order.allocations.map((a) => a.reservationId), order.moneyReservationId];
  const sourceEvents = order.allocations.map((a) => w.physical.objects[a.lotId].causeEventId);
  const boughtIds: string[] = [];
  const result = tx(w, order.buyerId, ["cooperative", order.householdId], (t) => {
    for (const id of claims) t.release(id);
    for (const a of order.allocations) {
      const source = w.physical.objects[a.lotId];
      const id = a.quantity === source.quantity ? source.id : uid(w, "lot");
      if (id !== source.id) t.split(source.id, id, a.quantity, order.reservationEventId!);
      t.changeOwner(id, order.householdId); t.move(id, bag(order.buyerId)); boughtIds.push(id);
    }
    const coinId = coin.quantity === cost ? coin.id : uid(w, "coin");
    if (coinId !== coin.id) t.split(coin.id, coinId, cost, order.reservationEventId!);
    t.changeOwner(coinId, "cooperative"); t.move(coinId, "till_cooperative");
  }, claims);
  if (!result.ok) return false;
  const labor = workEffort(w, order.buyerId, "purchase_food", c.labor.purchaseEffort, [order.reservationEventId!])!;
  const payment = emit(w, "cash_moved", [order.buyerId, c.roles.seller], [order.reservationEventId!], { from: pouch(order.buyerId), to: "till_cooperative", amount: cost });
  const e = emit(w, "sale_settled", [order.buyerId, c.roles.seller], [order.reservationEventId!, labor.id, payment.id, ...sourceEvents], { orderId, householdId: order.householdId, quantity: order.quantity, cost });
  for (const id of boughtIds) w.physical.objects[id].causeEventId = e.id;
  order.status = "settled"; order.allocations = []; order.moneyReservationId = undefined; return true;
}

function phase(w: LocalWorldV2) {
  const day = dayOf(w.minute), base = baseOf(day), local = w.minute - base;
  for (const p of Object.values(w.people)) if (p.journey?.arrive === w.minute) arrive(w, p.id);
  if (local === 0 && w.minute > 0) for (const p of Object.values(w.people)) {
    const task = w.tasks.find((t) => t.personId === p.id && t.capability === "rest" && t.end === w.minute && t.status === "accepted");
    if (!task) continue;
    const before = p.energy, atHome = at(w, p.id) === home(p.householdId) && !p.journey;
    if (atHome) p.energy = Math.min(c.limits.personEnergy, before + c.labor.overnightRecovery);
    completeTask(w, task, atHome ? "rest_completed" : "rest_missed", [], { energyBefore: before, energyAfter: p.energy, recovered: p.energy - before });
  }
  if (day > 3) return;
  if (local === tm.orders) {
    for (const h of Object.values(w.households)) offerTask(w, h.buyerId, "buy_food", w.minute, base + tm.notice);
    if (!absent(w, c.roles.seller, day)) travel(w, c.roles.seller, "market", base + tm.notice);
  }
  if (local === tm.notice) {
    for (const h of Object.values(w.households)) {
      const task = taskAt(w, h.buyerId, "buy_food", day);
      if (!task) continue;
      const e = completeTask(w, task, "order_posted", [], { householdId: h.id });
      createOrder(w, h.id, day, h.memberIds.length * c.foodPerPerson, [e.id]);
    }
    for (const extra of w.extraOrders.filter((o) => o.day === day)) createOrder(w, extra.householdId, day, extra.amount, [extra.commandEventId]);
    if (at(w, c.roles.seller) === "market") offerTask(w, c.roles.seller, "market_sale", w.minute, base + tm.assignment);
  }
  if (local === tm.assignment) {
    const sellerTask = taskAt(w, c.roles.seller, "market_sale", day);
    const request = sellerTask ? completeTask(w, sellerTask, "replenishment_requested", w.orders.filter((o) => o.day === day).map((o) => o.requestEventId), { maxQuantity: c.cartCapacity }) : undefined;
    if (request) {
      const s: ShipmentV2 = { id: uid(w, "ship"), day, carrierId: c.roles.carrier, status: "requested", requestedQuantity: c.cartCapacity, quantity: 0, requestEventId: request.id, lastEventId: request.id };
      w.shipments.push(s);
      const task = offerTask(w, s.carrierId, "carry_food", base + tm.cartDepart, base + tm.unloadEnd, [request.id]);
      if (task.status === "refused") {
        s.status = "failed"; s.lastEventId = emit(w, "shipment_failed", [s.carrierId], [request.id, task.answerEventId], { shipmentId: s.id, reason: "carrier_unavailable" }).id;
      } else {
        s.status = "assigned"; s.lastEventId = task.answerEventId;
        s.proposal = proposeFoodDelivery({ taskId: task.id, personId: s.carrierId, capabilityId: "carry_C", cartId: "cart_1",
          requestedQuantity: s.requestedQuantity, cartCapacity: c.cartCapacity, roadKm: c.roadKm,
          cartEffortPerKm: c.limits.cartEffortPerKm, extraEffortPerFiveFoodKm: c.limits.cartExtraEffortPerFiveFoodKm,
          expectedFinishAt: base + tm.unloadEnd, evidenceEventIds: [request.id, task.answerEventId] });
        s.lastEventId = emit(w, "delivery_proposed", [s.carrierId], s.proposal.evidenceEventIds, { shipmentId: s.id, quantity: s.proposal.quantity, capabilityId: s.proposal.capabilityId }).id;
        if (!travel(w, s.carrierId, "market", base + tm.cartDepart, [task.answerEventId])) {
          s.status = "failed"; s.lastEventId = completeTask(w, task, "carry_failed", [request.id], { reason: "travel_cost" }).id;
        }
      }
    }
    const farmers = Object.values(w.people).filter((p) => p.role === "farmer").sort((a, b) => a.id.localeCompare(b.id));
    for (const p of farmers.slice(0, c.farmersOnShift[day - 1])) {
      const task = offerTask(w, p.id, "work_shift", w.minute, base + tm.loadEnd, request ? [request.id] : []);
      if (task.status === "accepted" && !travel(w, p.id, "farm", base + tm.farmArrive, [task.answerEventId])) completeTask(w, task, "farm_shift_failed", [], { reason: "travel_cost" });
    }
  }
  if (local === tm.cartDepart) {
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s && !travel(w, s.carrierId, "farm", base + tm.cartFarmArrive, [s.lastEventId], true)) {
      s.status = "failed"; s.lastEventId = emit(w, "shipment_failed", [s.carrierId], [s.lastEventId], { shipmentId: s.id, reason: "travel_cost" }).id;
      const task = taskAt(w, s.carrierId, "carry_food", day);
      if (task) completeTask(w, task, "carry_failed", [s.lastEventId], { reason: "travel_cost" });
    }
  }
  if (local === tm.cartFarmArrive) {
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s) s.lastEventId = emit(w, absent(w, c.roles.farmManager, day) ? "request_missed_farm" : "request_delivered_farm",
      absent(w, c.roles.farmManager, day) ? [s.carrierId] : [s.carrierId, c.roles.farmManager], [s.lastEventId], { shipmentId: s.id }).id;
  }
  if (local === tm.farmEnd) for (const p of Object.values(w.people).filter((p) => p.role === "farmer")) {
    const task = taskAt(w, p.id, "work_shift", day);
    if (!task || at(w, p.id) !== "farm") continue;
    const labor = workEffort(w, p.id, "farm_shift", c.labor.farmShiftEffort, [task.answerEventId]);
    if (!labor) {
      completeTask(w, task, "farm_shift_failed", [], { reason: "exhausted" });
      travel(w, p.id, home(p.householdId), base + tm.loadEnd, [task.resultEventId!]);
      continue;
    }
    const e = emit(w, "food_produced", [p.id], [task.answerEventId, labor.id], { quantity: c.farmOutputPerShift });
    const lotId = uid(w, "lot");
    const result = tx(w, p.id, ["cooperative"], (t) => t.add({ id: lotId, typeId: "food", parentId: store("farm"), quantity: c.farmOutputPerShift, ownerId: "cooperative", causeEventId: e.id }));
    if (!result.ok) throw Error(`production failed: ${result.reason}`);
    w.producedFood += c.farmOutputPerShift;
    travel(w, p.id, home(p.householdId), base + tm.loadEnd, [e.id]);
  }
  if (local === tm.loadEnd) {
    for (const p of Object.values(w.people).filter((p) => p.role === "farmer")) {
      const task = taskAt(w, p.id, "work_shift", day);
      if (task) completeTask(w, task, "farm_shift_completed", [], { quantity: c.farmOutputPerShift });
    }
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s) {
      const carrier = w.people[s.carrierId];
      if (at(w, carrier.id) !== "farm") {
        s.status = "failed"; s.lastEventId = emit(w, "shipment_failed", [carrier.id], [s.lastEventId], { shipmentId: s.id, reason: "carrier_not_at_farm" }).id;
      } else {
        // The accepted carrier's rule capability proposes a load from observed farm stock.
        s.proposal = proposeFoodDelivery({ taskId: taskAt(w, carrier.id, "carry_food", day)!.id, personId: carrier.id,
          capabilityId: "carry_C", cartId: "cart_1", requestedQuantity: s.requestedQuantity,
          cartCapacity: c.cartCapacity - amount(w, "cart_1", "food"), observedStock: amount(w, store("farm"), "food"),
          roadKm: c.roadKm, cartEffortPerKm: c.limits.cartEffortPerKm,
          extraEffortPerFiveFoodKm: c.limits.cartExtraEffortPerFiveFoodKm,
          expectedFinishAt: base + tm.unloadEnd, evidenceEventIds: [s.lastEventId] });
        const quantity = s.proposal.quantity;
        s.lastEventId = emit(w, "delivery_replanned", [carrier.id], s.proposal.evidenceEventIds,
          { shipmentId: s.id, quantity, capabilityId: s.proposal.capabilityId }).id;
        const source = lots(w, store("farm"), "food", "cooperative");
        const effort = s.proposal.expectedEffort;
        const loadEffort = Math.ceil(quantity / 5) * c.labor.loadEffortPerFiveFood;
        const wear = Math.ceil(c.roadKm * c.labor.cartWearPerKm);
        const reason = quantity && carrier.energy < effort + loadEffort ? "exhausted" : at(w, "cart_1") !== "farm" ? "cart_not_here" :
          w.cartCondition < wear ? "cart_unfit" : "";
        if (reason) emit(w, "journey_blocked", [carrier.id], [s.lastEventId], { to: "market", reason, foodLoad: quantity, cashLoad: 0, effortCost: effort, energy: carrier.energy });
        if (reason || !quantity) {
          s.status = "failed"; s.lastEventId = emit(w, "shipment_failed", [carrier.id], [s.lastEventId], { shipmentId: s.id, reason: reason || "no_stock" }).id;
          if (!quantity && !reason) travel(w, carrier.id, "market", base + tm.cartMarketArrive, [s.lastEventId], true);
          const task = taskAt(w, carrier.id, "carry_food", day);
          if (task && reason) completeTask(w, task, "carry_failed", [s.lastEventId], { reason });
        } else {
          const transitId = uid(w, "transit"), loadedIds: string[] = [];
          const result = tx(w, carrier.id, ["cooperative"], (t) => {
            let remaining = quantity;
            for (const lot of source) {
              const n = Math.min(remaining, lot.quantity);
              if (!n) continue;
              const id = n === lot.quantity ? lot.id : uid(w, "lot");
              if (id !== lot.id) t.split(lot.id, id, n, s.lastEventId);
              t.move(id, "cart_1"); loadedIds.push(id); remaining -= n;
              if (!remaining) break;
            }
            if (remaining) throw Error("insufficient observed food");
            t.depart({ id: transitId, typeId: "site", parentId: "world", quantity: 1, causeEventId: s.lastEventId }, [carrier.id, "cart_1"]);
          });
          if (!result.ok) {
            s.status = "failed"; s.lastEventId = emit(w, "shipment_failed", [carrier.id], [s.lastEventId], { shipmentId: s.id, reason: result.reason }).id;
          } else {
            const labor = workEffort(w, carrier.id, "load_food", loadEffort, [s.lastEventId])!;
            carrier.energy -= effort; s.quantity = quantity; s.status = "in_transit";
            const loaded = emit(w, "shipment_loaded", [carrier.id], [s.lastEventId, labor.id, ...source.map((l) => l.causeEventId)], { shipmentId: s.id, quantity, laborEffort: loadEffort });
            s.lastEventId = loaded.id;
            const e = emit(w, "journey_started", [carrier.id], [loaded.id], { from: "farm", to: "market", arrive: base + tm.cartMarketArrive, mode: "cart", distanceKm: c.roadKm, effortCost: effort, foodLoad: quantity, cashLoad: 0 });
            const conditionBefore = w.cartCondition;
            w.cartCondition -= wear;
            emit(w, "vehicle_worn", [carrier.id], [e.id], { vehicleId: "cart_1", wear, conditionBefore, conditionAfter: w.cartCondition });
            carrier.journey = { transitId, fromId: "farm", toId: "market", depart: w.minute, arrive: base + tm.cartMarketArrive, mode: "cart", effortCost: effort, distanceKm: c.roadKm, causeEventId: e.id };
            for (const id of loadedIds) w.physical.objects[id].causeEventId = loaded.id;
          }
        }
      }
    }
  }
  if (local === tm.unloadEnd) {
    const s = w.shipments.find((s) => s.day === day && s.status === "in_transit");
    if (s) {
      const cargo = lots(w, "cart_1", "food", "cooperative");
      const unloadEffort = Math.ceil(s.quantity / 5) * c.labor.unloadEffortPerFiveFood;
      if (w.people[s.carrierId].energy < unloadEffort) {
        const blocked = workEffort(w, s.carrierId, "unload_food", unloadEffort, [s.lastEventId]);
        if (blocked) throw Error("unload effort preflight mismatch");
        s.status = "failed";
        s.lastEventId = emit(w, "shipment_failed", [s.carrierId], [s.lastEventId], { shipmentId: s.id, reason: "unload_exhausted" }).id;
        const task = taskAt(w, s.carrierId, "carry_food", day);
        if (task) completeTask(w, task, "carry_failed", [s.lastEventId], { reason: "unload_exhausted" });
      } else {
        const result = tx(w, s.carrierId, ["cooperative"], (t) => { for (const lot of cargo) t.move(lot.id, store("market")); });
        if (!result.ok) throw Error(`unload failed: ${result.reason}`);
        const labor = workEffort(w, s.carrierId, "unload_food", unloadEffort, [s.lastEventId])!;
        s.status = "delivered";
        const delivered = emit(w, "shipment_delivered", [s.carrierId, c.roles.seller], [s.lastEventId, labor.id], { shipmentId: s.id, quantity: s.quantity, laborEffort: unloadEffort });
        s.lastEventId = delivered.id;
        for (const lot of cargo) w.physical.objects[lot.id].causeEventId = delivered.id;
        const task = taskAt(w, s.carrierId, "carry_food", day)!;
        completeTask(w, task, "carry_completed", [delivered.id], { quantity: s.quantity });
      }
    }
    const empty = w.shipments.find((s) => s.day === day && s.status === "failed" && w.events.find((e) => e.id === s.lastEventId)?.data.reason === "no_stock" && at(w, s.carrierId) === "market");
    if (empty) { const task = taskAt(w, empty.carrierId, "carry_food", day); if (task) completeTask(w, task, "carry_empty_return", [empty.lastEventId]); }
    if (s || empty) travel(w, c.roles.carrier, home(w.people[c.roles.carrier].householdId), w.minute + 15, [s?.lastEventId ?? empty!.lastEventId]);
    if (at(w, c.roles.seller) === "market") {
      const task = offerTask(w, c.roles.seller, "market_sale", w.minute, base + tm.marketEnd, s && s.status === "delivered" ? [s.lastEventId] : []);
      if (task.status === "accepted" && !workEffort(w, c.roles.seller, "market_shift", c.labor.marketShiftEffort, [task.answerEventId]))
        completeTask(w, task, "market_shift_failed", [], { reason: "exhausted" });
    }
  }
  // Buyers walk to market in successive 15-minute slots.
  if (local >= tm.unloadEnd - 15 && local < tm.marketEnd - 15 && (local - (tm.unloadEnd - 15)) % 15 === 0) {
    const index = (local - (tm.unloadEnd - 15)) / 15;
    const h = Object.values(w.households).sort((a, b) => a.id.localeCompare(b.id))[index];
    const order = h && w.orders.find((o) => o.day === day && o.householdId === h.id && o.status === "requested");
    if (order) buyerDepart(w, order);
  }
  if (local >= tm.unloadEnd && local < tm.marketEnd && (local - tm.unloadEnd) % 15 === 0) {
    const index = (local - tm.unloadEnd) / 15;
    const h = Object.values(w.households).sort((a, b) => a.id.localeCompare(b.id))[index];
    const order = h && w.orders.find((o) => o.day === day && o.householdId === h.id && o.status === "requested");
    if (order) {
      const task = offerTask(w, h.buyerId, "buy_food", w.minute, w.minute + 15, [order.requestEventId]);
      if (task.status === "accepted" && at(w, h.buyerId) === "market") reservePurchaseV2(w, order.id);
    }
  }
  if (local > tm.unloadEnd && local <= tm.marketEnd && (local - tm.unloadEnd) % 15 === 0) {
    const index = (local - tm.unloadEnd) / 15 - 1;
    const h = Object.values(w.households).sort((a, b) => a.id.localeCompare(b.id))[index];
    if (h) {
      const order = w.orders.find((o) => o.day === day && o.householdId === h.id && o.status !== "expired");
      const task = w.tasks.find((t) => t.personId === h.buyerId && t.capability === "buy_food" && t.end === w.minute && t.status === "accepted");
      if (task) {
        const settled = order?.status === "sale_reserved" && settlePurchaseV2(w, order.id);
        const e = completeTask(w, task, settled ? "purchase_completed" : "purchase_failed", order ? [order.requestEventId] : [], { householdId: h.id });
        if (at(w, h.buyerId) === "market") travel(w, h.buyerId, home(h.id), w.minute + 15, [e.id]);
      }
    }
  }
  if (local === tm.marketEnd) {
    const task = w.tasks.find((t) => t.personId === c.roles.seller && t.capability === "market_sale" && t.end === w.minute && t.status === "accepted");
    if (task) { const e = completeTask(w, task, "market_shift_completed"); travel(w, c.roles.seller, home(w.people[c.roles.seller].householdId), w.minute + 15, [e.id]); }
    for (const order of w.orders.filter((o) => o.day === day && (o.status === "requested" || o.status === "sale_reserved"))) cancelPurchaseV2(w, order.id);
  }
  if (local === tm.meal) for (const p of Object.values(w.people)) offerTask(w, p.id, "eat_food", w.minute, w.minute + 60);
  if (local === tm.meal + 60) for (const p of Object.values(w.people)) {
    const task = taskAt(w, p.id, "eat_food", day);
    if (!task) continue;
    const lot = at(w, p.id) === home(p.householdId) ? lots(w, store(p.householdId), "food", p.householdId)[0] : undefined;
    if (lot) {
      const result = tx(w, p.id, [p.householdId], (t) => t.remove(lot.id, 1));
      if (!result.ok) throw Error(`meal failed: ${result.reason}`);
      w.consumedFood++; p.hunger = Math.max(0, p.hunger - 1);
    } else p.hunger++;
    completeTask(w, task, lot ? "meal_eaten" : "meal_missed", lot ? [lot.causeEventId] : [], { householdId: p.householdId, hunger: p.hunger });
  }
  if (local === 1320) for (const p of Object.values(w.people)) offerTask(w, p.id, "rest", w.minute, base + 1440);
}

export function advanceLocalV2(w: LocalWorldV2, minutes: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || w.minute + minutes > 4320) throw Error("invalid E1 v2 advance");
  for (let i = 0; i < minutes; i++) { w.minute++; phase(w); }
  checkLocalV2(w); return w;
}
export function submitLocalV2(w: LocalWorldV2, actorId: string, action: LocalAction, id = `command_${w.commands.length + 1}`) {
  if (!w.people[actorId] || w.commands.some((command) => command.id === id)) return false;
  if (action.kind === "ABSENT") {
    if (action.personId !== actorId || !Number.isSafeInteger(action.day) || action.day < dayOf(w.minute) || action.day > 3 || w.minute >= baseOf(action.day) + tm.orders) return false;
  } else if (action.kind === "EXTRA_ORDER") {
    if (w.households[action.householdId]?.buyerId !== actorId || !Number.isSafeInteger(action.day) || action.day < dayOf(w.minute) || action.day > 3 || w.minute >= baseOf(action.day) + tm.orders || !Number.isSafeInteger(action.amount) || action.amount < 1) return false;
  } else {
    if (w.households[action.from]?.buyerId !== actorId || !Number.isSafeInteger(action.amount) || action.amount < 0 ||
      !w.households[action.from] || action.to !== "reserve" && !w.households[action.to]) return false;
    const destination = action.to === "reserve" ? "box_reserve" : chest(action.to);
    if (at(w, actorId) !== at(w, chest(action.from)) || at(w, actorId) !== at(w, destination) ||
      amount(w, chest(action.from), "currency") < action.amount ||
      amount(w, destination, "currency") + action.amount > capacityReport(w.physical, destination).massMax!) return false;
  }
  const command: LocalCommand = { id, actorId, issuedAt: w.minute, action: structuredClone(action) };
  w.commands.push(command);
  const e = emit(w, "local_command", [actorId], [], { commandId: id, action: action.kind });
  if (action.kind === "ABSENT") w.absences.push({ personId: actorId, day: action.day });
  else if (action.kind === "EXTRA_ORDER") w.extraOrders.push({ householdId: action.householdId, day: action.day, amount: action.amount, commandEventId: e.id });
  else if (action.amount) {
    const destination = action.to === "reserve" ? "box_reserve" : chest(action.to), ownerId = action.to === "reserve" ? "reserve" : action.to;
    const source = lots(w, chest(action.from), "currency", action.from).find((o) => o.quantity >= action.amount)!;
    const movedId = source.quantity === action.amount ? source.id : uid(w, "coin");
    const result = tx(w, actorId, [action.from, ownerId], (t) => {
      if (movedId !== source.id) t.split(source.id, movedId, action.amount, e.id);
      t.changeOwner(movedId, ownerId); t.move(movedId, destination);
    });
    if (!result.ok) throw Error(`validated transfer failed: ${result.reason}`);
    const moved = emit(w, "cash_moved", [actorId], [e.id], { from: chest(action.from), to: destination, amount: action.amount });
    w.physical.objects[movedId].causeEventId = moved.id;
  }
  checkLocalV2(w); return true;
}
export function saveLocalV2(w: LocalWorldV2) { checkLocalV2(w); return JSON.stringify(w); }
export function loadLocalV2(serialized: string): LocalWorldV2 {
  const w = JSON.parse(serialized) as LocalWorldV2;
  if (w.schemaVersion !== 3 || w.economicMode !== "local_food_v2" || w.engineVersion !== "0.4.1-e1" || w.contentHash !== hash(c)) throw Error("incompatible E1 v2 save");
  checkLocalV2(w); return w;
}
export function replayLocalV2(seed: number, commands: LocalCommand[], until: number) {
  const w = newLocalWorldV2(seed);
  for (const { command } of commands.map((command, index) => ({ command, index })).sort((a, b) => a.command.issuedAt - b.command.issuedAt || a.index - b.index)) {
    advanceLocalV2(w, command.issuedAt - w.minute);
    if (!submitLocalV2(w, command.actorId, command.action, command.id)) throw Error(`replay rejected ${command.id}`);
  }
  advanceLocalV2(w, until - w.minute); return w;
}
export function checkLocalV2(w: LocalWorldV2) {
  if (w.schemaVersion !== 3 || w.economicMode !== "local_food_v2" || w.engineVersion !== "0.4.1-e1" || w.contentHash !== hash(c) ||
    !Number.isSafeInteger(w.minute) || w.minute < 0 || w.minute > 4320 ||
    !Number.isSafeInteger(w.cartCondition) || w.cartCondition < 0 || w.cartCondition > 100) throw Error("invalid E1 v2 world");
  checkPhysical(w.physical);
  if (hash(w.physical.types) !== hash(c.physicalTypes) || w.capabilities.carry_C?.bearerId !== c.roles.carrier ||
    w.capabilities.carry_C.definitionId !== "transport.food.v1" || w.capabilities.carry_C.version !== 1) throw Error("E1 v2 capability or type mismatch");
  if (Object.keys(w.people).length !== 20 || Object.keys(w.households).length !== 4 ||
    Object.values(w.households).flatMap((h) => h.memberIds).length !== 20 ||
    new Set(Object.values(w.households).flatMap((h) => h.memberIds)).size !== 20) throw Error("E1 v2 population mismatch");
  for (const p of Object.values(w.people)) {
    if (!w.households[p.householdId]?.memberIds.includes(p.id) || w.physical.objects[p.id]?.typeId !== "person" ||
      !Number.isSafeInteger(p.energy) || p.energy < 0 || p.energy > c.limits.personEnergy || !Number.isSafeInteger(p.hunger) || p.hunger < 0 ||
      (p.journey && (at(w, p.id) !== p.journey.transitId || p.journey.arrive <= w.minute)) ||
      (!p.journey && !["farm", "market", home(p.householdId)].includes(at(w, p.id)))) throw Error("invalid E1 v2 person");
  }
  for (const h of Object.values(w.households)) if (w.physical.objects[home(h.id)]?.parentId !== "town" ||
    w.physical.objects[store(h.id)]?.parentId !== home(h.id) || w.physical.objects[store(h.id)]?.typeId !== "foodStoreHouse" || w.physical.objects[store(h.id)]?.ownerId !== h.id ||
    w.physical.objects[chest(h.id)]?.parentId !== home(h.id) || w.physical.objects[chest(h.id)]?.typeId !== "chest" || w.physical.objects[chest(h.id)]?.ownerId !== h.id ||
    w.physical.objects[pouch(h.buyerId)]?.parentId !== h.buyerId || w.physical.objects[pouch(h.buyerId)]?.typeId !== "pouch" || w.physical.objects[pouch(h.buyerId)]?.ownerId !== h.id ||
    w.physical.objects[bag(h.buyerId)]?.parentId !== h.buyerId || w.physical.objects[bag(h.buyerId)]?.typeId !== "bag" || w.physical.objects[bag(h.buyerId)]?.ownerId !== h.id) throw Error("invalid E1 v2 household placement");
  if (w.physical.objects.cart_1?.typeId !== "cart" || w.physical.objects.cart_1.ownerId !== "cooperative" ||
    w.physical.objects[store("farm")]?.typeId !== "foodStoreFarm" || w.physical.objects[store("farm")]?.ownerId !== "cooperative" ||
    w.physical.objects[store("market")]?.typeId !== "foodStoreMarket" || w.physical.objects[store("market")]?.ownerId !== "cooperative" ||
    w.physical.objects.till_cooperative?.typeId !== "till" || w.physical.objects.till_cooperative?.ownerId !== "cooperative" ||
    w.physical.objects.box_reserve?.typeId !== "chest" || w.physical.objects.box_reserve?.ownerId !== "reserve") throw Error("invalid E1 v2 shared assets");
  const cash = Object.values(w.physical.objects).filter((o) => o.typeId === "currency");
  const food = Object.values(w.physical.objects).filter((o) => o.typeId === "food");
  if (cash.reduce((n, o) => n + o.quantity, 0) !== w.initialMoney ||
    food.reduce((n, o) => n + o.quantity, 0) !== w.producedFood - w.consumedFood - w.lostFood) throw Error("E1 v2 asset conservation");
  for (const o of cash) if (!["cooperative", "reserve", ...Object.keys(w.households)].includes(o.ownerId!) ||
    !["till_cooperative", "box_reserve", ...Object.keys(w.households).map(chest), ...Object.values(w.households).map((h) => pouch(h.buyerId))].includes(o.parentId!)) throw Error("E1 v2 cash placement");
  for (const o of cash) {
    const expectedOwner = o.parentId === "till_cooperative" ? "cooperative" : o.parentId === "box_reserve" ? "reserve" :
      o.parentId?.startsWith("chest_") ? o.parentId.slice(6) : Object.values(w.households).find((h) => pouch(h.buyerId) === o.parentId)?.id;
    if (o.ownerId !== expectedOwner) throw Error("E1 v2 cash owner");
  }
  for (const o of food) if (!["cooperative", ...Object.keys(w.households)].includes(o.ownerId!) ||
    ![store("farm"), store("market"), "cart_1", ...Object.keys(w.households).map(store), ...Object.values(w.households).map((h) => bag(h.buyerId))].includes(o.parentId!)) throw Error("E1 v2 food placement");
  for (const o of food) {
    const expectedOwner = [store("farm"), store("market"), "cart_1"].includes(o.parentId!) ? "cooperative" :
      o.parentId?.startsWith("store_") ? o.parentId.slice(6) : Object.values(w.households).find((h) => bag(h.buyerId) === o.parentId)?.id;
    if (o.ownerId !== expectedOwner) throw Error("E1 v2 food owner");
  }
  const eventIds = new Set<string>();
  for (const e of w.events) {
    if (eventIds.has(e.id) || e.causes.some((cause) => !eventIds.has(cause)) || e.actors.some((id) => !w.people[id])) throw Error("E1 v2 event graph");
    eventIds.add(e.id);
  }
  for (const o of [...food, ...cash]) if (o.causeEventId !== "initial" && !eventIds.has(o.causeEventId)) throw Error("E1 v2 asset cause");
  for (const t of w.tasks) if (!w.people[t.personId] || !eventIds.has(t.offerEventId) || !eventIds.has(t.answerEventId) ||
    t.status === "completed" && !eventIds.has(t.resultEventId!)) throw Error("E1 v2 task cause");
  const acceptedTasks = w.tasks.filter((t) => t.status !== "refused");
  for (let i = 0; i < acceptedTasks.length; i++) for (let j = i + 1; j < acceptedTasks.length; j++)
    if (acceptedTasks[i].personId === acceptedTasks[j].personId && acceptedTasks[i].start < acceptedTasks[j].end && acceptedTasks[j].start < acceptedTasks[i].end) throw Error("E1 v2 time overlap");
  for (const p of Object.values(w.people)) if (p.journey && !eventIds.has(p.journey.causeEventId)) throw Error("E1 v2 journey cause");
  for (const o of w.orders) {
    if (!w.households[o.householdId] || !eventIds.has(o.requestEventId)) throw Error("E1 v2 order");
    if (o.status === "sale_reserved") {
      if (!o.moneyReservationId || !o.reservationEventId || !eventIds.has(o.reservationEventId) ||
        !w.physical.reservations.some((r) => r.id === o.moneyReservationId && r.claimantId === o.id) ||
        o.allocations.some((a) => !w.physical.reservations.some((r) => r.id === a.reservationId && r.objectId === a.lotId && r.quantity === a.quantity && r.claimantId === o.id))) throw Error("E1 v2 reservation");
    } else if (o.moneyReservationId || o.allocations.length) throw Error("E1 v2 stale reservation");
  }
  for (const r of w.physical.reservations) if (!w.orders.some((o) => o.id === r.claimantId && o.status === "sale_reserved")) throw Error("E1 v2 orphan reservation");
  for (const s of w.shipments) if (!w.people[s.carrierId] || !eventIds.has(s.requestEventId) || !eventIds.has(s.lastEventId) ||
    s.proposal && (s.proposal.personId !== s.carrierId || s.proposal.capabilityId !== "carry_C" || s.proposal.cartId !== "cart_1" || s.proposal.quantity < 0)) throw Error("E1 v2 shipment cause");
}

export function localV2Summary(w: LocalWorldV2) {
  const ownerMoney: Record<string, number> = {};
  for (const o of Object.values(w.physical.objects).filter((o) => o.typeId === "currency")) ownerMoney[o.ownerId!] = (ownerMoney[o.ownerId!] ?? 0) + o.quantity;
  return {
    day: Math.ceil(w.minute / 1440), producedFood: w.producedFood, consumedFood: w.consumedFood,
    farmFood: amount(w, store("farm"), "food"), marketFood: amount(w, store("market"), "food"),
    cooperativeMoney: ownerMoney.cooperative ?? 0, ownerMoney,
    hungryPeople: Object.values(w.people).filter((p) => p.hunger > 0).length,
    settledOrders: w.orders.filter((o) => o.status === "settled").length,
  };
}
