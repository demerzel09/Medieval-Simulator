import { economyE1 } from "../content/economy-e1";
import { hash } from "./core";

export type Place = "farm" | "market" | `house:${string}` | `cargo:${string}` | `carried:${string}`;
export type Journey = { from: Place; to: Place; depart: number; arrive: number; causeEventId: string };
type Capability = (typeof economyE1.routines)[number]["capability"];
type OrderStatus = "requested" | "sale_reserved" | "settled" | "expired";
type ShipmentStatus = "requested" | "assigned" | "loaded" | "in_transit" | "delivered" | "failed";
export type LocalAction =
  | { kind: "ABSENT"; personId: string; day: number }
  | { kind: "TRANSFER_MONEY"; from: string; to: string; amount: number }
  | { kind: "EXTRA_ORDER"; householdId: string; day: number; amount: number };
export type LocalCommand = { id: string; actorId: string; issuedAt: number; action: LocalAction };
export type LocalEvent = {
  id: string; minute: number; kind: string; actors: string[]; causes: string[];
  data: Record<string, string | number | boolean | null>;
};
export type FoodLot = {
  id: string; ownerId: string; place: Place; quantity: number;
  reserved: number; causeEventId: string;
};
export type LocalTask = {
  id: string; personId: string; routineId: string; routineVersion: number;
  capability: Capability; start: number; end: number;
  status: "accepted" | "completed" | "refused";
  offerEventId: string; answerEventId: string; resultEventId?: string;
};
export type PurchaseOrder = {
  id: string; householdId: string; buyerId: string; day: number;
  quantity: number; status: OrderStatus; requestEventId: string;
  holdId?: string; allocations: { lotId: string; quantity: number }[];
  reservationEventId?: string; settlementEventId?: string;
};
export type LocalShipment = {
  id: string; day: number; carrierId: string; status: ShipmentStatus;
  requestedQuantity: number; quantity: number; lotIds: string[];
  requestEventId: string; lastEventId: string;
};
export type LocalWorld = {
  schemaVersion: 2; economicMode: "local_food_v1"; engineVersion: "0.3.0-e1";
  seed: number; contentHash: string; minute: number; nextId: number;
  people: Record<string, { id: string; householdId: string; role: string; location: Place; journey?: Journey; hunger: number }>;
  households: Record<string, { id: string; memberIds: string[]; buyerId: string }>;
  wallets: Record<string, number>; initialMoney: number;
  lots: FoodLot[]; producedFood: number; consumedFood: number; lostFood: number;
  holds: { id: string; accountId: string; amount: number; orderId: string }[];
  orders: PurchaseOrder[]; shipments: LocalShipment[]; tasks: LocalTask[];
  events: LocalEvent[]; commands: LocalCommand[];
  absences: { personId: string; day: number }[];
  extraOrders: { householdId: string; day: number; amount: number; commandEventId: string }[];
};

const t = economyE1.times;
const dayOf = (minute: number) => Math.floor(minute / 1440) + 1;
const dayStart = (day: number) => (day - 1) * 1440;
const uid = (w: LocalWorld, prefix: string) => `${prefix}_${String(w.nextId++).padStart(6, "0")}`;
function emit(w: LocalWorld, kind: string, actors: string[], causes: string[] = [], data: LocalEvent["data"] = {}) {
  const existing = new Set(w.events.map((e) => e.id));
  if (causes.some((id) => !existing.has(id))) throw Error(`unknown event cause for ${kind}`);
  const event: LocalEvent = { id: uid(w, "e"), minute: w.minute, kind, actors, causes: [...causes], data };
  w.events.push(event);
  return event;
}
const moneyAvailable = (w: LocalWorld, id: string) =>
  w.wallets[id] - w.holds.filter((h) => h.accountId === id).reduce((n, h) => n + h.amount, 0);
const absent = (w: LocalWorld, id: string, day: number) =>
  w.absences.some((a) => a.personId === id && a.day === day);
const routineFor = (capability: Capability) => {
  const routine = economyE1.routines.find((r) => r.capability === capability);
  if (!routine) throw Error(`missing routine ${capability}`);
  return routine;
};
const home = (householdId: string): Place => `house:${householdId}`;
function startJourney(w: LocalWorld, personId: string, to: Place, arrive: number, causes: string[] = []) {
  const person = w.people[personId];
  if (person.journey || arrive <= w.minute || person.location === to) throw Error("invalid E1 journey start");
  const e = emit(w, "journey_started", [personId], causes, { from: person.location, to, arrive });
  person.journey = { from: person.location, to, depart: w.minute, arrive, causeEventId: e.id };
}
function finishJourney(w: LocalWorld, personId: string) {
  const person = w.people[personId], j = person.journey;
  if (!j || j.arrive !== w.minute) throw Error("invalid E1 journey arrival");
  person.location = j.to;
  person.journey = undefined;
  const e = emit(w, "journey_arrived", [personId], [j.causeEventId], { place: j.to });
  if (j.to === home(person.householdId))
    for (const lot of w.lots.filter((lot) => lot.place === `carried:${personId}`)) {
      lot.place = j.to;
      lot.causeEventId = emit(w, "food_brought_home", [personId], [e.id, lot.causeEventId], { lotId: lot.id, quantity: lot.quantity }).id;
    }
  return e;
}

export function newLocalWorld(seed = 240924): LocalWorld {
  if (!Number.isSafeInteger(seed)) throw Error("invalid seed");
  const people: LocalWorld["people"] = {}, households: LocalWorld["households"] = {};
  const wallets: Record<string, number> = { cooperative: 0, reserve: 0 };
  for (const h of economyE1.households) {
    const members = [...h.farmers, h.buyer, ...h.other];
    households[h.id] = { id: h.id, memberIds: members, buyerId: h.buyer };
    wallets[h.id] = economyE1.initialHouseholdMoney;
    for (const id of members)
      people[id] = {
        id, householdId: h.id,
        role: h.farmers.includes(id) ? "farmer" : id === h.buyer ? "buyer" :
          id === economyE1.roles.seller ? "seller" : id === economyE1.roles.carrier ? "carrier" : "dependent",
        location: home(h.id), hunger: 0,
      };
  }
  const w: LocalWorld = {
    schemaVersion: 2, economicMode: "local_food_v1", engineVersion: "0.3.0-e1",
    seed, contentHash: hash(economyE1), minute: 0, nextId: 1,
    people, households, wallets, initialMoney: Object.values(wallets).reduce((a,b)=>a+b,0),
    lots: [], producedFood: 0, consumedFood: 0, lostFood: 0,
    holds: [], orders: [], shipments: [], tasks: [], events: [], commands: [],
    absences: [], extraOrders: [],
  };
  checkLocal(w);
  return w;
}

function offerTask(w: LocalWorld, personId: string, capability: Capability, start: number, end: number, causes: string[] = []) {
  const routine = routineFor(capability);
  const offer = emit(w, "task_offered", [personId], causes, { routineId: routine.id, capability, start, end });
  const overlap = w.tasks.some((task) => task.personId === personId && task.status !== "refused" && start < task.end && task.start < end);
  const unavailable = capability !== "eat_food" && absent(w, personId, dayOf(start));
  const status = unavailable || overlap ? "refused" : "accepted";
  const answer = emit(w, status === "accepted" ? "task_accepted" : "task_refused", [personId], [offer.id], {
    reason: unavailable ? "absent" : overlap ? "busy" : "ordinary_role",
  });
  const task: LocalTask = {
    id: uid(w, "task"), personId, routineId: routine.id, routineVersion: routine.version,
    capability, start, end, status, offerEventId: offer.id, answerEventId: answer.id,
  };
  w.tasks.push(task);
  return task;
}
function completeTask(w: LocalWorld, task: LocalTask, kind: string, causes: string[] = [], data: LocalEvent["data"] = {}) {
  if (task.status !== "accepted") throw Error("task not accepted");
  const e = emit(w, kind, [task.personId], [task.answerEventId, ...causes], data);
  task.status = "completed";
  task.resultEventId = e.id;
  return e;
}
function taskAt(w: LocalWorld, personId: string, capability: Capability, day: number) {
  return w.tasks.find((task) => task.personId === personId && task.capability === capability && dayOf(task.start) === day && task.status === "accepted");
}
function marketLots(w: LocalWorld) {
  return w.lots.filter((lot) => lot.ownerId === "cooperative" && lot.place === "market" && lot.quantity > lot.reserved);
}
function allocateLots(w: LocalWorld, quantity: number) {
  const allocations: { lotId: string; quantity: number }[] = [];
  let remaining = quantity;
  for (const lot of marketLots(w)) {
    const n = Math.min(remaining, lot.quantity - lot.reserved);
    if (n) { allocations.push({ lotId: lot.id, quantity: n }); remaining -= n; }
    if (!remaining) break;
  }
  return remaining ? [] : allocations;
}
export function reservePurchase(w: LocalWorld, orderId: string) {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "requested") return false;
  const local = w.minute % 1440;
  if (local < t.unloadEnd || local >= t.marketEnd || order.day !== dayOf(w.minute) ||
      !w.tasks.some((task) => task.personId === economyE1.roles.seller && task.capability === "market_sale" && task.status === "accepted" && task.start <= w.minute && w.minute < task.end)) return false;
  const cost = order.quantity * economyE1.price;
  const allocations = allocateLots(w, order.quantity);
  if (!allocations.length || moneyAvailable(w, order.householdId) < cost) return false;
  for (const a of allocations) w.lots.find((lot) => lot.id === a.lotId)!.reserved += a.quantity;
  const hold = { id: uid(w, "hold"), accountId: order.householdId, amount: cost, orderId };
  w.holds.push(hold); order.holdId = hold.id; order.allocations = allocations;
  order.status = "sale_reserved";
  order.reservationEventId = emit(w, "sale_reserved", [order.buyerId, economyE1.roles.seller], [order.requestEventId, ...allocations.map((a) => w.lots.find((lot) => lot.id === a.lotId)!.causeEventId)], { orderId, quantity: order.quantity, cost }).id;
  checkLocal(w);
  return true;
}
export function cancelPurchase(w: LocalWorld, orderId: string) {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || !["requested", "sale_reserved"].includes(order.status)) return false;
  for (const a of order.allocations) w.lots.find((lot) => lot.id === a.lotId)!.reserved -= a.quantity;
  w.holds = w.holds.filter((hold) => hold.id !== order.holdId);
  order.status = "expired"; order.allocations = []; order.holdId = undefined;
  emit(w, "sale_expired", [order.buyerId], [order.requestEventId], { orderId });
  checkLocal(w);
  return true;
}
export function settlePurchase(w: LocalWorld, orderId: string) {
  const order = w.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "sale_reserved" || !order.holdId) return false;
  if (!w.tasks.some((task) => task.personId === order.buyerId && task.capability === "buy_food" && task.status === "accepted" && task.end === w.minute)) return false;
  const hold = w.holds.find((h) => h.id === order.holdId)!;
  if (!hold || w.wallets[hold.accountId] < hold.amount) throw Error("invalid reserved money");
  const sourceEvents = order.allocations.map((a) => w.lots.find((lot) => lot.id === a.lotId)!.causeEventId);
  for (const a of order.allocations) {
    const lot = w.lots.find((l) => l.id === a.lotId)!;
    lot.quantity -= a.quantity; lot.reserved -= a.quantity;
  }
  w.wallets[hold.accountId] -= hold.amount;
  w.wallets.cooperative += hold.amount;
  w.holds = w.holds.filter((h) => h.id !== hold.id);
  const e = emit(w, "sale_settled", [order.buyerId, economyE1.roles.seller], [order.reservationEventId!, ...sourceEvents], {
    orderId, householdId: order.householdId, quantity: order.quantity, cost: hold.amount,
  });
  w.lots.push({ id: uid(w, "lot"), ownerId: order.householdId, place: `carried:${order.buyerId}`, quantity: order.quantity, reserved: 0, causeEventId: e.id });
  order.status = "settled"; order.settlementEventId = e.id;
  order.holdId = undefined; order.allocations = [];
  checkLocal(w);
  return true;
}

function createOrder(w: LocalWorld, householdId: string, day: number, quantity: number, causes: string[]) {
  const h = w.households[householdId];
  const e = emit(w, "purchase_requested", [h.buyerId], causes, { householdId, quantity });
  const order: PurchaseOrder = { id: uid(w, "order"), householdId, buyerId: h.buyerId, day, quantity, status: "requested", requestEventId: e.id, allocations: [] };
  w.orders.push(order);
  return order;
}
function phase(w: LocalWorld) {
  const day = dayOf(w.minute), base = dayStart(day), local = w.minute - base;
  for (const p of Object.values(w.people)) if (p.journey?.arrive === w.minute) finishJourney(w, p.id);
  if (day > 3) return;
  if (local === t.orders) {
    for (const h of Object.values(w.households))
      offerTask(w, h.buyerId, "buy_food", w.minute, base + t.notice);
    if (!absent(w, economyE1.roles.seller, day))
      startJourney(w, economyE1.roles.seller, "market", base + t.notice);
  }
  if (local === t.notice) {
    for (const h of Object.values(w.households)) {
      const task = taskAt(w, h.buyerId, "buy_food", day);
      if (!task) continue;
      const e = completeTask(w, task, "order_posted", [], { householdId: h.id });
      createOrder(w, h.id, day, h.memberIds.length * economyE1.foodPerPerson, [e.id]);
    }
    for (const extra of w.extraOrders.filter((o) => o.day === day))
      createOrder(w, extra.householdId, day, extra.amount, [extra.commandEventId]);
    offerTask(w, economyE1.roles.seller, "market_sale", w.minute, base + t.assignment);
  }
  if (local === t.assignment) {
    const seller = taskAt(w, economyE1.roles.seller, "market_sale", day);
    const request = seller ? completeTask(w, seller, "replenishment_requested", w.orders.filter((o) => o.day === day).map((o) => o.requestEventId), { maxQuantity: economyE1.cartCapacity }) : undefined;
    if (request) {
      const shipment: LocalShipment = { id: uid(w, "ship"), day, carrierId: economyE1.roles.carrier, status: "requested", requestedQuantity: economyE1.cartCapacity, quantity: 0, lotIds: [], requestEventId: request.id, lastEventId: request.id };
      w.shipments.push(shipment);
      const task = offerTask(w, shipment.carrierId, "carry_food", base + t.cartDepart, base + t.unloadEnd, [request.id]);
      if (task.status === "refused") {
        shipment.status = "failed";
        shipment.lastEventId = emit(w, "shipment_failed", [shipment.carrierId], [request.id, task.answerEventId], { shipmentId: shipment.id, reason: "carrier_unavailable" }).id;
      } else {
        shipment.status = "assigned";
        shipment.lastEventId = task.answerEventId;
        startJourney(w, shipment.carrierId, "market", base + t.cartDepart, [task.answerEventId]);
      }
    }
    const farmers = Object.values(w.people).filter((p) => p.role === "farmer").sort((a,b) => a.id.localeCompare(b.id));
    for (const p of farmers.slice(0, economyE1.farmersOnShift[day - 1])) {
      const task = offerTask(w, p.id, "work_shift", w.minute, base + t.loadEnd, request ? [request.id] : []);
      if (task.status === "accepted") startJourney(w, p.id, "farm", base + t.farmArrive, [task.answerEventId]);
    }
  }
  if (local === t.cartDepart) {
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s) startJourney(w, s.carrierId, "farm", base + t.cartFarmArrive, [s.lastEventId]);
  }
  if (local === t.cartFarmArrive) {
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s) {
      const managerAvailable = !absent(w, economyE1.roles.farmManager, day);
      s.lastEventId = emit(w, managerAvailable ? "request_delivered_farm" : "request_missed_farm", managerAvailable ? [s.carrierId, economyE1.roles.farmManager] : [s.carrierId], [s.lastEventId], { shipmentId: s.id }).id;
    }
  }
  if (local === t.farmEnd)
    for (const p of Object.values(w.people).filter((p) => p.role === "farmer")) {
      const task = taskAt(w, p.id, "work_shift", day);
      if (!task) continue;
      const e = emit(w, "food_produced", [p.id], [task.answerEventId], { quantity: economyE1.farmOutputPerShift });
      w.lots.push({ id: uid(w, "lot"), ownerId: "cooperative", place: "farm", quantity: economyE1.farmOutputPerShift, reserved: 0, causeEventId: e.id });
      w.producedFood += economyE1.farmOutputPerShift;
      startJourney(w, p.id, home(p.householdId), base + t.loadEnd, [e.id]);
    }
  if (local === t.loadEnd) {
    for (const p of Object.values(w.people).filter((p) => p.role === "farmer")) {
      const task = taskAt(w, p.id, "work_shift", day);
      if (task) completeTask(w, task, "farm_shift_completed", [], { quantity: economyE1.farmOutputPerShift });
    }
    const s = w.shipments.find((s) => s.day === day && s.status === "assigned");
    if (s) {
      let remaining = Math.min(s.requestedQuantity, economyE1.cartCapacity);
      for (const lot of w.lots.filter((l) => l.ownerId === "cooperative" && l.place === "farm" && l.quantity > 0)) {
        const n = Math.min(lot.quantity, remaining);
        if (!n) continue;
        if (n < lot.quantity) {
          lot.quantity -= n;
          const split: FoodLot = { id: uid(w, "lot"), ownerId: "cooperative", place: `cargo:${s.id}`, quantity: n, reserved: 0, causeEventId: lot.causeEventId };
          w.lots.push(split); s.lotIds.push(split.id);
        } else { lot.place = `cargo:${s.id}`; s.lotIds.push(lot.id); }
        s.quantity += n; remaining -= n;
        if (!remaining) break;
      }
      if (!s.quantity) {
        s.status = "failed";
        s.lastEventId = emit(w, "shipment_failed", [s.carrierId], [s.lastEventId], { shipmentId: s.id, reason: "no_stock" }).id;
      } else {
        s.status = "in_transit";
        s.lastEventId = emit(w, "shipment_loaded", [s.carrierId], [s.lastEventId, ...s.lotIds.map((id) => w.lots.find((l) => l.id === id)!.causeEventId)], { shipmentId: s.id, quantity: s.quantity }).id;
      }
      startJourney(w, s.carrierId, "market", base + t.cartMarketArrive, [s.lastEventId]);
    }
  }
  if (local === t.unloadEnd) {
    const s = w.shipments.find((s) => s.day === day && s.status === "in_transit");
    if (s) {
      for (const id of s.lotIds) w.lots.find((l) => l.id === id)!.place = "market";
      s.status = "delivered";
      s.lastEventId = emit(w, "shipment_delivered", [s.carrierId, economyE1.roles.seller], [s.lastEventId], { shipmentId: s.id, quantity: s.quantity }).id;
      for (const id of s.lotIds) w.lots.find((l) => l.id === id)!.causeEventId = s.lastEventId;
      const task = taskAt(w, s.carrierId, "carry_food", day)!;
      completeTask(w, task, "carry_completed", [s.lastEventId], { quantity: s.quantity });
    }
    const empty = w.shipments.find((s) => s.day === day && s.status === "failed" && w.people[s.carrierId].location === "market");
    if (empty) {
      const task = taskAt(w, empty.carrierId, "carry_food", day);
      if (task) completeTask(w, task, "carry_empty_return", [empty.lastEventId]);
    }
    if (s || empty) {
      const carrier = w.people[economyE1.roles.carrier];
      startJourney(w, carrier.id, home(carrier.householdId), w.minute + 15, [s?.lastEventId ?? empty!.lastEventId]);
    }
    offerTask(w, economyE1.roles.seller, "market_sale", w.minute, base + t.marketEnd, s ? [s.lastEventId] : []);
  }
  if (local >= t.unloadEnd - 15 && local < t.marketEnd - 15 && (local - (t.unloadEnd - 15)) % 15 === 0) {
    const index = (local - (t.unloadEnd - 15)) / 15;
    const h = Object.values(w.households).sort((a,b) => a.id.localeCompare(b.id))[index];
    if (h && w.orders.some((o) => o.day === day && o.householdId === h.id && o.status === "requested"))
      startJourney(w, h.buyerId, "market", w.minute + 15);
  }
  if (local >= t.unloadEnd && local < t.marketEnd && (local - t.unloadEnd) % 15 === 0) {
    const index = (local - t.unloadEnd) / 15;
    const h = Object.values(w.households).sort((a,b) => a.id.localeCompare(b.id))[index];
    if (h) {
      const order = w.orders.find((o) => o.day === day && o.householdId === h.id && o.status === "requested");
      if (order) {
        const task = offerTask(w, h.buyerId, "buy_food", w.minute, w.minute + 15, [order.requestEventId]);
        if (task.status === "accepted") reservePurchase(w, order.id);
      }
    }
  }
  if (local > t.unloadEnd && local <= t.marketEnd && (local - t.unloadEnd) % 15 === 0) {
    const index = (local - t.unloadEnd) / 15 - 1;
    const h = Object.values(w.households).sort((a,b) => a.id.localeCompare(b.id))[index];
    if (h) {
      const order = w.orders.find((o) => o.day === day && o.householdId === h.id && o.status !== "expired");
      const task = w.tasks.find((task) => task.personId === h.buyerId && task.capability === "buy_food" && task.end === w.minute && task.status === "accepted");
      if (task) {
        const settled = order?.status === "sale_reserved" && settlePurchase(w, order.id);
        completeTask(w, task, settled ? "purchase_completed" : "purchase_failed", order ? [order.requestEventId] : [], { householdId: h.id });
        startJourney(w, h.buyerId, home(h.id), w.minute + 15, [task.resultEventId!]);
      }
    }
  }
  if (local === t.marketEnd) {
    const sellerTask = w.tasks.find((task) => task.personId === economyE1.roles.seller && task.capability === "market_sale" && task.end === w.minute && task.status === "accepted");
    if (sellerTask) {
      const e = completeTask(w, sellerTask, "market_shift_completed");
      startJourney(w, economyE1.roles.seller, home(w.people[economyE1.roles.seller].householdId), w.minute + 15, [e.id]);
    }
    for (const o of w.orders.filter((o) => o.day === day && (o.status === "requested" || o.status === "sale_reserved"))) cancelPurchase(w, o.id);
  }
  if (local === t.meal)
    for (const p of Object.values(w.people)) offerTask(w, p.id, "eat_food", w.minute, w.minute + 60);
  if (local === t.meal + 60)
    for (const p of Object.values(w.people)) {
      const task = taskAt(w, p.id, "eat_food", day);
      if (!task) continue;
      const lot = w.lots.find((l) => l.ownerId === p.householdId && l.place === home(p.householdId) && l.quantity > l.reserved);
      if (lot) { lot.quantity--; w.consumedFood++; p.hunger = Math.max(0,p.hunger-1); }
      else p.hunger++;
      completeTask(w, task, lot ? "meal_eaten" : "meal_missed", lot ? [lot.causeEventId] : [], { householdId: p.householdId, hunger: p.hunger });
    }
}

export function advanceLocal(w: LocalWorld, minutes: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || w.minute + minutes > 3 * 1440) throw Error("invalid E1 advance");
  for (let i = 0; i < minutes; i++) { w.minute++; phase(w); }
  checkLocal(w);
  return w;
}
export function submitLocal(w: LocalWorld, actorId: string, action: LocalAction, id = `command_${w.commands.length + 1}`) {
  if (!w.people[actorId] || w.commands.some((c) => c.id === id)) return false;
  if (action.kind === "ABSENT") {
    if (action.personId !== actorId || !Number.isSafeInteger(action.day) || action.day < dayOf(w.minute) || action.day > 3 || w.minute >= dayStart(action.day) + t.orders) return false;
    w.absences.push({ personId: actorId, day: action.day });
  } else if (action.kind === "TRANSFER_MONEY") {
    if (w.households[action.from]?.buyerId !== actorId || !(action.to in w.wallets) ||
        !Number.isSafeInteger(action.amount) || action.amount < 0 || moneyAvailable(w, action.from) < action.amount) return false;
    w.wallets[action.from] -= action.amount; w.wallets[action.to] += action.amount;
  } else {
    if (w.households[action.householdId]?.buyerId !== actorId || !Number.isSafeInteger(action.day) || action.day < dayOf(w.minute) || action.day > 3 || w.minute >= dayStart(action.day) + t.orders || !Number.isSafeInteger(action.amount) || action.amount < 1) return false;
  }
  const c = { id, actorId, issuedAt: w.minute, action: structuredClone(action) };
  w.commands.push(c);
  const e = emit(w, "local_command", [actorId], [], { commandId: id, action: action.kind });
  if (action.kind === "EXTRA_ORDER") w.extraOrders.push({ householdId: action.householdId, day: action.day, amount: action.amount, commandEventId: e.id });
  checkLocal(w);
  return true;
}
export function saveLocal(w: LocalWorld) { checkLocal(w); return JSON.stringify(w); }
export function loadLocal(serialized: string): LocalWorld {
  const w = JSON.parse(serialized) as LocalWorld;
  if (w.schemaVersion !== 2 || w.economicMode !== "local_food_v1" || w.engineVersion !== "0.3.0-e1" || w.contentHash !== hash(economyE1)) throw Error("incompatible E1 save");
  checkLocal(w); return w;
}
export function replayLocal(seed: number, commands: LocalCommand[], until: number) {
  const w = newLocalWorld(seed);
  for (const { c } of commands.map((c, index) => ({ c, index })).sort((a,b) => a.c.issuedAt-b.c.issuedAt || a.index-b.index)) {
    advanceLocal(w, c.issuedAt - w.minute);
    if (!submitLocal(w, c.actorId, c.action, c.id)) throw Error(`replay rejected ${c.id}`);
  }
  advanceLocal(w, until - w.minute);
  return w;
}
export function checkLocal(w: LocalWorld) {
  if (w.schemaVersion !== 2 || w.economicMode !== "local_food_v1" || !Number.isSafeInteger(w.minute) || w.minute < 0 || w.minute > 4320) throw Error("invalid E1 world");
  if (Object.keys(w.people).length !== 20 || Object.keys(w.households).length !== 4 ||
      Object.values(w.households).flatMap((h) => h.memberIds).length !== 20 ||
      new Set(Object.values(w.households).flatMap((h) => h.memberIds)).size !== 20) throw Error("E1 population ownership");
  if (Object.values(w.wallets).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      Object.values(w.wallets).reduce((a,b)=>a+b,0) !== w.initialMoney) throw Error("E1 money conservation");
  for (const wallet of Object.keys(w.wallets)) if (moneyAvailable(w,wallet) < 0) throw Error("E1 money over-reserved");
  const ids = new Set<string>();
  for (const lot of w.lots) {
    if (ids.has(lot.id) || !Number.isSafeInteger(lot.quantity) || lot.quantity < 0 || !Number.isSafeInteger(lot.reserved) || lot.reserved < 0 || lot.reserved > lot.quantity || !(lot.ownerId === "cooperative" || w.households[lot.ownerId]) ||
        (lot.place !== "farm" && lot.place !== "market" &&
          !w.shipments.some((s) => lot.place === `cargo:${s.id}` && s.lotIds.includes(lot.id)) &&
          !(w.households[lot.ownerId] && lot.place === home(lot.ownerId)) &&
          !Object.values(w.people).some((p) => lot.place === `carried:${p.id}` && p.householdId === lot.ownerId)) ||
        (lot.place === "farm" && lot.ownerId !== "cooperative") ||
        (lot.place.startsWith("house:") && lot.place !== home(lot.ownerId))) throw Error("invalid E1 lot");
    ids.add(lot.id);
  }
  if (w.lots.reduce((n,l)=>n+l.quantity,0) !== w.producedFood - w.consumedFood - w.lostFood) throw Error("E1 food conservation");
  const events = new Set<string>();
  for (const e of w.events) {
    if (events.has(e.id) || e.causes.some((id) => !events.has(id)) || e.actors.some((id) => !w.people[id])) throw Error("invalid E1 event graph");
    events.add(e.id);
  }
  for (const lot of w.lots) if (!events.has(lot.causeEventId)) throw Error("E1 lot without cause");
  for (const p of Object.values(w.people)) {
    if (!w.households[p.householdId]?.memberIds.includes(p.id) ||
        (p.location !== "farm" && p.location !== "market" && p.location !== home(p.householdId))) throw Error("invalid E1 person place");
    if (p.journey && (p.journey.from !== p.location || p.journey.depart > w.minute ||
        p.journey.arrive <= w.minute || !events.has(p.journey.causeEventId))) throw Error("invalid E1 journey");
  }
  for (const task of w.tasks) {
    if (!w.people[task.personId] || task.start >= task.end || !events.has(task.offerEventId) || !events.has(task.answerEventId)) throw Error("invalid E1 task");
    if (task.status === "completed" && !task.resultEventId) throw Error("missing task result");
  }
  const accepted = w.tasks.filter((task) => task.status !== "refused");
  for (let i = 0; i < accepted.length; i++) for (let j = i+1; j < accepted.length; j++)
    if (accepted[i].personId === accepted[j].personId && accepted[i].start < accepted[j].end && accepted[j].start < accepted[i].end) throw Error("E1 time overlap");
  if (new Set(w.holds.map((h) => h.id)).size !== w.holds.length) throw Error("duplicate money hold");
  for (const hold of w.holds) if (!w.orders.some((o) => o.id === hold.orderId && o.status === "sale_reserved" && o.holdId === hold.id && o.householdId === hold.accountId && hold.amount === o.quantity * economyE1.price)) throw Error("orphan money hold");
  const allocated = new Map<string, number>();
  for (const order of w.orders) if (!w.households[order.householdId] || !events.has(order.requestEventId) ||
      (order.status === "sale_reserved" && (!order.holdId || order.allocations.reduce((n,a)=>n+a.quantity,0) !== order.quantity))) throw Error("invalid E1 order");
  for (const order of w.orders) {
    if (order.status !== "sale_reserved" && (order.holdId || order.allocations.length)) throw Error("stale E1 reservation");
    if (order.status === "sale_reserved" && !w.holds.some((h) => h.id === order.holdId)) throw Error("missing E1 hold");
    for (const a of order.allocations) {
      const lot = w.lots.find((l) => l.id === a.lotId);
      if (!lot || lot.ownerId !== "cooperative" || lot.place !== "market" || !Number.isSafeInteger(a.quantity) || a.quantity <= 0) throw Error("invalid E1 allocation");
      allocated.set(a.lotId, (allocated.get(a.lotId) ?? 0) + a.quantity);
    }
  }
  for (const lot of w.lots) if (lot.reserved !== (allocated.get(lot.id) ?? 0)) throw Error("E1 food over-reserved");
  for (const shipment of w.shipments) if (!w.people[shipment.carrierId] || !events.has(shipment.requestEventId) || !events.has(shipment.lastEventId)) throw Error("invalid E1 shipment");
}
