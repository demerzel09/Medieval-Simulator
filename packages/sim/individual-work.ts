import { ordinaryWorkModel, type WorkAttempt, type WorkMemory, type WorkModel, type WorkStimulus } from "../ai/individual-work";
import { hash } from "./core";
import { checkPhysical, contentsQuantity, physicalTransaction, siteOf, type PhysicalState } from "./physical";

export type WorkEvent = { id: string; hour: number; kind: string; actors: string[]; causes: string[];
  data: Record<string, string | number> };
type WorkPerson = { id: "S" | "F"; nextWakeAt: number; memory: WorkMemory; receivedOfferIds: string[];
  receivedDeliveryIds: string[] };
type WorkOffer = { id: string; price: number; quantity: number; postedEventId: string; acceptedEventId?: string; harvestedEventId?: string;
  deliveredEventId?: string; paidEventId?: string };
export type WorkWorld = { schemaVersion: 1; mode: "individual_work"; seed: number; hour: number; nextId: number;
  physical: PhysicalState; people: Record<"S" | "F", WorkPerson>; resource: { available: number };
  offer?: WorkOffer; events: WorkEvent[]; pending: { recipientId: "S" | "F"; stimulus: WorkStimulus }[];
  harvested: number; initialBerries: number; initialCash: number };
const bag = (id: string) => `bag_${id}`;
const wallet = (id: string) => `wallet_${id}`;
const uid = (w: WorkWorld, prefix: string) => `${prefix}_${String(w.nextId++).padStart(6, "0")}`;
function emit(w: WorkWorld, kind: string, actors: string[], causes: string[] = [], data: WorkEvent["data"] = {}) {
  if (causes.some((id) => !w.events.some((e) => e.id === id))) throw Error(`unknown work cause ${kind}`);
  const event = { id: uid(w, "e"), hour: w.hour, kind, actors, causes, data };
  w.events.push(event); return event;
}
function notify(w: WorkWorld, recipientId: "S" | "F", kind: WorkStimulus["kind"], event: WorkEvent, offerId?: string,
  delay = 1) {
  const terms = kind === "offer" ? { price: w.offer?.price, quantity: w.offer?.quantity } : {};
  w.pending.push({ recipientId, stimulus: { id: uid(w, "s"), kind, occurredAt: w.hour, receivedAt: w.hour + delay,
    causeEventIds: [event.id], offerId, ...terms } });
}
const owned = (w: WorkWorld, parentId: string, typeId: string, ownerId: string) =>
  Object.values(w.physical.objects).filter((o) => o.parentId === parentId && o.typeId === typeId && o.ownerId === ownerId);
function tx(w: WorkWorld, actorId: string, operation: Parameters<typeof physicalTransaction>[2]) {
  const result = physicalTransaction(w.physical, { actorId, ownerIds: [] }, operation);
  if (!result.ok) return result.reason;
  w.physical = result.state; return undefined;
}
export function newWorkWorld(seed = 240924, sellerCash = 1, berries = 1): WorkWorld {
  if (![seed, sellerCash, berries].every(Number.isSafeInteger) || sellerCash < 0 || sellerCash > 20 || berries < 0 || berries > 20)
    throw Error("invalid work fixture");
  const types: PhysicalState["types"] = {
    world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["site"] } },
    site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["person", "resource"] } },
    person: { id: "person", tags: ["person"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["bag", "wallet"] } },
    bag: { id: "bag", tags: ["bag"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food"], maxContentsMass: 4 } },
    wallet: { id: "wallet", tags: ["wallet"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["currency"], maxContentsMass: 20 } },
    resource: { id: "resource", tags: ["resource"], unitMass: 0, stackable: false, ownable: false },
    food: { id: "food", tags: ["food"], unitMass: 1, stackable: true, ownable: true },
    currency: { id: "currency", tags: ["currency"], unitMass: 1, stackable: true, ownable: true },
  };
  const objects: PhysicalState["objects"] = {};
  const add = (id: string, typeId: string, parentId: string | null, ownerId?: string) => {
    objects[id] = { id, typeId, parentId, ownerId, quantity: 1, causeEventId: "initial" };
  };
  add("world", "world", null); add("grove", "site", "world"); add("berries", "resource", "grove");
  for (const id of ["S", "F"]) { add(id, "person", "grove"); add(bag(id), "bag", id, id); add(wallet(id), "wallet", id, id); }
  for (let i = 0; i < sellerCash; i++) add(`coin_${i}`, "currency", wallet("S"), "S");
  const memory = (): WorkMemory => ({ stage: "new", receivedIds: [] });
  const w: WorkWorld = { schemaVersion: 1, mode: "individual_work", seed, hour: 0, nextId: 1,
    physical: { types, objects, reservations: [] }, people: { S: { id: "S", nextWakeAt: 1, memory: memory(),
      receivedOfferIds: [], receivedDeliveryIds: [] },
      F: { id: "F", nextWakeAt: 1, memory: memory(), receivedOfferIds: [], receivedDeliveryIds: [] } },
    resource: { available: berries }, events: [], pending: [],
    harvested: 0, initialBerries: berries, initialCash: sellerCash };
  checkWorkWorld(w); return w;
}
function act(w: WorkWorld, actorId: "S" | "F", attempt: WorkAttempt, decisionId: string) {
  const offer = w.offer;
  if (attempt.kind === "post_offer") {
    if (actorId !== "S" || offer || !contentsQuantity(w.physical, wallet("S"), "currency")) return "cannot post offer";
    const id = uid(w, "offer"), posted = emit(w, "offer_posted", ["S"], [decisionId], { offerId: id, price: 1 });
    w.offer = { id, price: 1, quantity: 1, postedEventId: posted.id };
    notify(w, "S", "posted", posted, id); notify(w, "F", "offer", posted, id, 2); return undefined;
  }
  if (!offer || attempt.offerId !== offer.id) return "unknown offer";
  if (attempt.kind === "accept_offer") {
    if (actorId !== "F" || offer.acceptedEventId || !w.people.F.receivedOfferIds.includes(offer.id) ||
      offer.price !== 1 || offer.quantity !== 1)
      return "offer unavailable";
    const event = emit(w, "offer_accepted", ["F"], [decisionId, offer.postedEventId], { offerId: offer.id });
    offer.acceptedEventId = event.id; notify(w, "F", "accepted", event, offer.id); notify(w, "S", "accepted", event, offer.id);
    return undefined;
  }
  if (attempt.kind === "forage") {
    if (actorId !== "F" || !offer.acceptedEventId || offer.harvestedEventId || w.resource.available < 1)
      return "harvest unavailable";
    const lotId = uid(w, "food");
    const reason = tx(w, "F", (t) => t.add({ id: lotId, typeId: "food", parentId: bag("F"), ownerId: "F",
      quantity: 1, causeEventId: decisionId }));
    if (reason) return reason;
    w.resource.available--; w.harvested++;
    const event = emit(w, "foraged", ["F"], [decisionId, offer.acceptedEventId], { lotId, quantity: 1 });
    w.physical.objects[lotId].causeEventId = event.id; offer.harvestedEventId = event.id;
    notify(w, "F", "foraged", event, offer.id); return undefined;
  }
  if (attempt.kind === "tender") {
    const lot = owned(w, bag("F"), "food", "F")[0];
    if (actorId !== "F" || !offer.harvestedEventId || offer.deliveredEventId || !lot) return "delivery unavailable";
    const reason = tx(w, "F", (t) => { t.move(lot.id, bag("S")); t.changeOwner(lot.id, "S"); });
    if (reason) return reason;
    const event = emit(w, "food_delivered", ["F", "S"], [decisionId, offer.harvestedEventId], { lotId: lot.id });
    offer.deliveredEventId = event.id; notify(w, "F", "delivered", event, offer.id);
    notify(w, "S", "delivered", event, offer.id); return undefined;
  }
  if (attempt.kind === "pay") {
    const coin = owned(w, wallet("S"), "currency", "S")[0];
    if (actorId !== "S" || !offer.deliveredEventId || offer.paidEventId || !coin ||
      !w.people.S.receivedDeliveryIds.includes(offer.deliveredEventId)) return "payment unavailable";
    const reason = tx(w, "S", (t) => { t.move(coin.id, wallet("F")); t.changeOwner(coin.id, "F"); });
    if (reason) return reason;
    const event = emit(w, "paid", ["S", "F"], [decisionId, offer.deliveredEventId], { amount: 1 });
    offer.paidEventId = event.id; notify(w, "S", "paid", event, offer.id); notify(w, "F", "paid", event, offer.id);
    return undefined;
  }
  return "invalid attempt";
}
export function advanceWorkWorld(w: WorkWorld, hours: number, model: WorkModel = ordinaryWorkModel) {
  if (!Number.isSafeInteger(hours) || hours < 0 || w.hour + hours > 90 * 24) throw Error("invalid work advance");
  for (let i = 0; i < hours; i++) {
    w.hour++;
    for (const id of ["F", "S"] as const) {
      const person = w.people[id];
      const stimuli = w.pending.filter((p) => p.recipientId === id && p.stimulus.receivedAt <= w.hour).map((p) => p.stimulus);
      if (person.nextWakeAt > w.hour && !stimuli.length) continue;
      w.pending = w.pending.filter((p) => !(p.recipientId === id && p.stimulus.receivedAt <= w.hour));
      for (const stimulus of stimuli) if (stimulus.kind === "offer" && stimulus.offerId &&
        !person.receivedOfferIds.includes(stimulus.offerId)) person.receivedOfferIds.push(stimulus.offerId);
      for (const stimulus of stimuli) if (stimulus.kind === "delivered" && id === "S" &&
        !person.receivedDeliveryIds.includes(stimulus.causeEventIds[0]))
        person.receivedDeliveryIds.push(stimulus.causeEventIds[0]);
      const response = model.decide({ actorId: id, at: w.hour, stimuli, subjectiveState: structuredClone(person.memory),
        knownContext: { siteId: siteOf(w.physical, id), ownFood: contentsQuantity(w.physical, bag(id), "food"),
          ownCash: contentsQuantity(w.physical, wallet(id), "currency"),
          visibleBerries: siteOf(w.physical, id) === "grove" ? w.resource.available : 0 } });
      if (!Number.isSafeInteger(response.wait.at) || response.wait.at <= w.hour || response.attempts.length > 1)
        throw Error("invalid work response");
      person.nextWakeAt = response.wait.at;
      if (response.subjectiveUpdate) person.memory = structuredClone(response.subjectiveUpdate);
      const decision = emit(w, "person_decided", [id], stimuli.flatMap((s) => s.causeEventIds),
        { attempt: response.attempts[0]?.kind ?? "wait" });
      if (response.attempts[0]) {
        const reason = act(w, id, response.attempts[0], decision.id);
        if (reason) { const rejected = emit(w, "attempt_rejected", [id], [decision.id], { reason });
          notify(w, id, "rejected", rejected, w.offer?.id); }
      }
    }
  }
  checkWorkWorld(w); return w;
}
export function checkWorkWorld(w: WorkWorld) {
  if (w.schemaVersion !== 1 || w.mode !== "individual_work" || !Number.isSafeInteger(w.hour) || w.hour < 0 ||
    w.hour > 90 * 24 || !Number.isSafeInteger(w.nextId) || w.nextId < 1 ||
    !Number.isSafeInteger(w.resource.available) || w.resource.available < 0 ||
    w.resource.available + w.harvested !== w.initialBerries) throw Error("invalid work world");
  checkPhysical(w.physical);
  const all = Object.values(w.physical.objects);
  if (all.filter((o) => o.typeId === "food").reduce((n, o) => n + o.quantity, 0) !== w.harvested ||
    all.filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0) !== w.initialCash ||
    all.some((o) => o.typeId === "food" && o.parentId !== bag(o.ownerId!) ||
      o.typeId === "currency" && o.parentId !== wallet(o.ownerId!))) throw Error("work conservation");
  const ids = new Set<string>();
  for (const event of w.events) {
    if (ids.has(event.id) || event.causes.some((id) => !ids.has(id)) ||
      event.actors.some((id) => !w.people[id as "S" | "F"])) throw Error("work event graph");
    ids.add(event.id);
  }
  for (const id of ["S", "F"] as const) {
    const p = w.people[id];
    if (p?.id !== id || p.nextWakeAt <= w.hour || !Number.isSafeInteger(p.nextWakeAt) ||
      w.physical.objects[id]?.typeId !== "person" || w.physical.objects[bag(id)]?.ownerId !== id ||
      w.physical.objects[wallet(id)]?.ownerId !== id || !Array.isArray(p.memory.receivedIds) ||
      new Set(p.memory.receivedIds).size !== p.memory.receivedIds.length ||
      !Array.isArray(p.receivedOfferIds) || new Set(p.receivedOfferIds).size !== p.receivedOfferIds.length ||
      p.receivedOfferIds.some((offerId) => offerId !== w.offer?.id) || !Array.isArray(p.receivedDeliveryIds) ||
      new Set(p.receivedDeliveryIds).size !== p.receivedDeliveryIds.length ||
      p.receivedDeliveryIds.some((eventId) => eventId !== w.offer?.deliveredEventId)) throw Error("invalid work person");
  }
  for (const { recipientId, stimulus } of w.pending) if (!w.people[recipientId] || stimulus.receivedAt <= w.hour ||
    stimulus.occurredAt > w.hour || stimulus.receivedAt <= stimulus.occurredAt ||
    stimulus.causeEventIds.some((id) => !ids.has(id))) throw Error("invalid work stimulus");
  if (w.offer && (w.offer.price !== 1 || w.offer.quantity !== 1 || !ids.has(w.offer.postedEventId) ||
    [w.offer.acceptedEventId, w.offer.harvestedEventId, w.offer.deliveredEventId, w.offer.paidEventId]
      .some((id) => id && !ids.has(id)))) throw Error("invalid work offer");
}
export function saveWorkWorld(w: WorkWorld) { checkWorkWorld(w); return JSON.stringify(w); }
export function loadWorkWorld(json: string) { const w = JSON.parse(json) as WorkWorld; checkWorkWorld(w); return w; }
export function replayWorkWorld(seed: number, hours: number, sellerCash = 1, berries = 1) {
  return advanceWorkWorld(newWorkWorld(seed, sellerCash, berries), hours);
}
export function workHash(w: WorkWorld) { return hash(w); }
