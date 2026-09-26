import { ordinaryLifeModel, type LifeModel, type LifeStimulus } from "../ai/individual-life";
import { hash } from "./core";
import { checkPhysical, contentsQuantity, physicalTransaction, siteOf, type PhysicalState } from "./physical";

export type LifeEvent = { id: string; hour: number; kind: string; actors: string[]; causes: string[]; data: Record<string, string | number> };
export type LifePerson = { id: string; hunger: number; energy: number; nextWakeAt: number; memory: { lastFailedSite?: string; failedAtDay?: number };
  journey?: { transitId: string; toId: string; arriveAt: number; causeEventId: string }; lastEventId?: string };
export type LifeWorld = { schemaVersion: 1; mode: "individual_life"; seed: number; hour: number; nextId: number;
  physical: PhysicalState; people: Record<string, LifePerson>;
  resources: Record<string, { id: string; siteId: string; available: number; capacity: number; dailyGrowth: number }>;
  events: LifeEvent[]; harvested: number; eaten: number; grown: number; initialResource: number };
export type LifeFixture = { sites: string[]; people: { id: string; siteId: string }[];
  resources: { id: string; siteId: string; available: number; capacity: number; dailyGrowth: number }[] };
const starter: LifeFixture = { sites: ["clearing", "grove"], people: [
  { id: "A", siteId: "clearing" }, { id: "B", siteId: "grove" }, { id: "C", siteId: "clearing" }],
resources: [{ id: "berries", siteId: "grove", available: 3, capacity: 3, dailyGrowth: 3 }] };
const bag = (id: string) => `bag_${id}`;
const uid = (w: LifeWorld, prefix: string) => `${prefix}_${String(w.nextId++).padStart(6, "0")}`;
function emit(w: LifeWorld, kind: string, actors: string[], causes: string[] = [], data: LifeEvent["data"] = {}) {
  if (causes.some((id) => !w.events.some((event) => event.id === id))) throw Error(`unknown life cause ${kind}`);
  const event: LifeEvent = { id: uid(w, "e"), hour: w.hour, kind, actors, causes, data };
  w.events.push(event); return event;
}
export function newLifeWorld(seed = 240924, fixture: LifeFixture = starter): LifeWorld {
  if (!Number.isSafeInteger(seed) || new Set(fixture.sites).size !== fixture.sites.length || !fixture.sites.length ||
    new Set(fixture.people.map((p) => p.id)).size !== fixture.people.length || !fixture.people.length ||
    fixture.people.some((p) => !fixture.sites.includes(p.siteId)) ||
    fixture.resources.some((r) => !fixture.sites.includes(r.siteId) || !Number.isSafeInteger(r.available) || r.available < 0 ||
      !Number.isSafeInteger(r.capacity) || r.capacity < r.available || !Number.isSafeInteger(r.dailyGrowth) || r.dailyGrowth < 0)) throw Error("invalid life fixture");
  const types: PhysicalState["types"] = {
    world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["site"] } },
    site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["person", "resource"] } },
    person: { id: "person", tags: ["person"], unitMass: 0, stackable: false, ownable: false,
      container: { acceptsTags: ["bag"], maxContentsMass: 4, maxQuantityByTag: { food: 4 } } },
    bag: { id: "bag", tags: ["bag"], unitMass: 0, stackable: false, ownable: true,
      container: { acceptsTags: ["food"], maxContentsMass: 4, maxQuantityByTag: { food: 4 } } },
    resource: { id: "resource", tags: ["resource"], unitMass: 0, stackable: false, ownable: false },
    food: { id: "food", tags: ["food"], unitMass: 1, stackable: true, ownable: true },
  };
  const objects: PhysicalState["objects"] = {};
  const add = (id: string, typeId: string, parentId: string | null, ownerId?: string) => {
    if (objects[id]) throw Error("duplicate life object");
    objects[id] = { id, typeId, parentId, ownerId, quantity: 1, causeEventId: "initial" };
  };
  add("world", "world", null);
  for (const site of fixture.sites) add(site, "site", "world");
  const people: LifeWorld["people"] = {};
  for (const person of fixture.people) { add(person.id, "person", person.siteId); add(bag(person.id), "bag", person.id, person.id);
    people[person.id] = { id: person.id, hunger: 1, energy: 10, nextWakeAt: 1, memory: {} }; }
  const resources: LifeWorld["resources"] = {};
  for (const resource of fixture.resources) { add(resource.id, "resource", resource.siteId); resources[resource.id] = { ...resource }; }
  const w: LifeWorld = { schemaVersion: 1, mode: "individual_life", seed, hour: 0, nextId: 1,
    physical: { types, objects, reservations: [] }, people, resources, events: [], harvested: 0, eaten: 0, grown: 0,
    initialResource: fixture.resources.reduce((n, r) => n + r.available, 0) };
  checkLifeWorld(w); return w;
}
function arrive(w: LifeWorld, person: LifePerson) {
  const j = person.journey!;
  const result = physicalTransaction(w.physical, { actorId: person.id, ownerIds: [] }, (t) => t.arrive(j.transitId, j.toId, [person.id]));
  if (!result.ok) throw Error(`life arrival: ${result.reason}`);
  w.physical = result.state; person.journey = undefined;
  person.lastEventId = emit(w, "arrived", [person.id], [j.causeEventId], { siteId: j.toId }).id;
}
function act(w: LifeWorld, person: LifePerson, attempt: ReturnType<LifeModel["decide"]>["attempts"][number], decisionId: string) {
  const site = siteOf(w.physical, person.id), personFood = contentsQuantity(w.physical, bag(person.id), "food");
  if (attempt.kind === "forage") {
    const resource = w.resources[attempt.resourceId];
    if (!resource || resource.siteId !== site || !Number.isSafeInteger(attempt.quantity) || attempt.quantity < 1 ||
      attempt.quantity > resource.available || person.energy < attempt.quantity * 2) return false;
    const lotId = uid(w, "food");
    const result = physicalTransaction(w.physical, { actorId: person.id, ownerIds: [] }, (t) =>
      t.add({ id: lotId, typeId: "food", parentId: bag(person.id), ownerId: person.id, quantity: attempt.quantity, causeEventId: decisionId }));
    if (!result.ok) return false;
    w.physical = result.state; resource.available -= attempt.quantity; w.harvested += attempt.quantity;
    person.energy -= attempt.quantity * 2;
    const e = emit(w, "foraged", [person.id], [decisionId], { resourceId: resource.id, quantity: attempt.quantity });
    w.physical.objects[lotId].causeEventId = e.id; person.lastEventId = e.id; return true;
  }
  if (attempt.kind === "eat") {
    const lot = Object.values(w.physical.objects).find((o) => o.parentId === bag(person.id) && o.typeId === "food" && o.ownerId === person.id);
    if (!lot || !person.hunger || !personFood) return false;
    const result = physicalTransaction(w.physical, { actorId: person.id, ownerIds: [] }, (t) => t.remove(lot.id, 1));
    if (!result.ok) return false;
    w.physical = result.state; w.eaten++; person.hunger--;
    person.lastEventId = emit(w, "ate", [person.id], [decisionId, lot.causeEventId], { quantity: 1 }).id; return true;
  }
  if (attempt.kind === "rest") {
    if (person.energy >= 10) return false;
    const before = person.energy; person.energy = Math.min(10, person.energy + 4);
    person.lastEventId = emit(w, "rested", [person.id], [decisionId], { before, after: person.energy }).id; return true;
  }
  if (attempt.kind === "travel") {
    if (person.journey || !w.physical.objects[attempt.siteId] || w.physical.objects[attempt.siteId].typeId !== "site" ||
      attempt.siteId === site || person.energy < 2) return false;
    const transitId = uid(w, "transit");
    const result = physicalTransaction(w.physical, { actorId: person.id, ownerIds: [] }, (t) =>
      t.depart({ id: transitId, typeId: "site", parentId: "world", quantity: 1, causeEventId: decisionId }, [person.id]));
    if (!result.ok) return false;
    w.physical = result.state; person.energy -= 2;
    const e = emit(w, "departed", [person.id], [decisionId], { from: site, to: attempt.siteId });
    person.journey = { transitId, toId: attempt.siteId, arriveAt: w.hour + 1, causeEventId: e.id };
    person.lastEventId = e.id; return true;
  }
  return false;
}
export function advanceLifeWorld(w: LifeWorld, hours: number, model: LifeModel = ordinaryLifeModel) {
  if (!Number.isSafeInteger(hours) || hours < 0 || w.hour + hours > 90 * 24) throw Error("invalid life advance");
  for (let step = 0; step < hours; step++) {
    w.hour++;
    if (w.hour % 24 === 1 && w.hour > 1) {
      for (const resource of Object.values(w.resources)) {
        const grown = Math.min(resource.dailyGrowth, resource.capacity - resource.available);
        if (grown) { resource.available += grown; w.grown += grown;
          emit(w, "resource_grew", [], [], { resourceId: resource.id, quantity: grown }); }
      }
      for (const person of Object.values(w.people)) { person.hunger++;
        emit(w, "hunger_increased", [person.id], [], { hunger: person.hunger }); }
    }
    for (const person of Object.values(w.people)) if (person.journey?.arriveAt === w.hour) arrive(w, person);
    for (const person of Object.values(w.people).sort((a, b) => a.id.localeCompare(b.id))) {
      if (person.nextWakeAt > w.hour) continue;
      const site = siteOf(w.physical, person.id);
      const visibleResources = Object.values(w.resources).filter((resource) => resource.siteId === site);
      const response = model.decide({ actorId: person.id, at: w.hour,
        stimuli: person.lastEventId ? [{ kind: "action_result", causeEventIds: [person.lastEventId] } satisfies LifeStimulus] : [],
        subjectiveState: person.memory,
        knownContext: { siteId: site, journeyTo: person.journey?.toId, hunger: person.hunger, energy: person.energy,
          carriedFood: contentsQuantity(w.physical, bag(person.id), "food"),
          visibleResources: visibleResources.map((resource) => ({ id: resource.id, available: resource.available })),
          knownResourceSites: [...new Set(Object.values(w.resources).map((resource) => resource.siteId))], restGain: 4 },
      });
      if (!Number.isSafeInteger(response.wait.at) || response.wait.at <= w.hour || response.attempts.length > 1) throw Error("invalid life response");
      person.nextWakeAt = response.wait.at;
      if (response.subjectiveUpdate) person.memory = structuredClone(response.subjectiveUpdate);
      const decision = emit(w, "person_decided", [person.id], person.lastEventId ? [person.lastEventId] : [],
        { attempt: response.attempts[0]?.kind ?? "wait" });
      if (response.attempts[0] && !act(w, person, response.attempts[0], decision.id))
        person.lastEventId = emit(w, "attempt_failed", [person.id], [decision.id], { attempt: response.attempts[0].kind }).id;
      else if (!response.attempts[0]) person.lastEventId = decision.id;
    }
  }
  checkLifeWorld(w); return w;
}
export function checkLifeWorld(w: LifeWorld) {
  if (w.schemaVersion !== 1 || w.mode !== "individual_life" || !Number.isSafeInteger(w.hour) || w.hour < 0 || w.hour > 90 * 24 ||
    !Number.isSafeInteger(w.nextId) || w.nextId < 1) throw Error("invalid life world");
  checkPhysical(w.physical);
  const food = Object.values(w.physical.objects).filter((o) => o.typeId === "food");
  if (food.reduce((n, o) => n + o.quantity, 0) !== w.harvested - w.eaten ||
    Object.values(w.resources).reduce((n, r) => n + r.available, 0) !== w.initialResource + w.grown - w.harvested ||
    food.some((o) => !w.people[o.ownerId!] || o.parentId !== bag(o.ownerId!))) throw Error("life food conservation");
  const ids = new Set<string>();
  for (const event of w.events) { if (ids.has(event.id) || event.causes.some((id) => !ids.has(id)) || event.actors.some((id) => !w.people[id])) throw Error("life event graph"); ids.add(event.id); }
  for (const resource of Object.values(w.resources)) if (!w.physical.objects[resource.id] || siteOf(w.physical, resource.id) !== resource.siteId ||
    !Number.isSafeInteger(resource.available) || resource.available < 0 || resource.available > resource.capacity) throw Error("life resource");
  for (const person of Object.values(w.people)) if (w.physical.objects[person.id]?.typeId !== "person" ||
    w.physical.objects[bag(person.id)]?.ownerId !== person.id || !Number.isSafeInteger(person.hunger) || person.hunger < 0 ||
    !Number.isSafeInteger(person.energy) || person.energy < 0 || person.energy > 10 || !Number.isSafeInteger(person.nextWakeAt) || person.nextWakeAt <= w.hour ||
    person.lastEventId && !ids.has(person.lastEventId) || person.journey && (person.journey.arriveAt <= w.hour || siteOf(w.physical, person.id) !== person.journey.transitId || !ids.has(person.journey.causeEventId)))
    throw Error("life person");
}
export function saveLifeWorld(w: LifeWorld) { checkLifeWorld(w); return JSON.stringify(w); }
export function loadLifeWorld(json: string) { const w = JSON.parse(json) as LifeWorld; checkLifeWorld(w); return w; }
export function replayLifeWorld(seed: number, hours: number, fixture?: LifeFixture) { return advanceLifeWorld(newLifeWorld(seed, fixture), hours); }
export function lifeSummary(w: LifeWorld) { return { hour: w.hour, available: Object.fromEntries(Object.values(w.resources).map((r) => [r.id, r.available])),
  harvested: w.harvested, eaten: w.eaten, people: Object.fromEntries(Object.values(w.people).map((p) => [p.id,
    { site: siteOf(w.physical, p.id), food: contentsQuantity(w.physical, bag(p.id), "food"), hunger: p.hunger, energy: p.energy }])) }; }
export function lifeHash(w: LifeWorld) { return hash(w); }
