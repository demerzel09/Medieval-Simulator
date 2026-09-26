/** UI/network-free physical inventory. A transaction is the only mutation boundary. */
export type PhysicalType = {
  id: string;
  tags: string[];
  unitMass: number;
  stackable: boolean;
  ownable: boolean;
  container?: {
    acceptsTags: string[];
    maxContentsMass?: number;
    maxDirectChildren?: number;
    maxQuantityByTag?: Record<string, number>;
  };
};
export type PhysicalObject = {
  id: string;
  typeId: string;
  parentId: string | null;
  quantity: number;
  ownerId?: string;
  causeEventId: string;
};
export type PhysicalReservation = { id: string; objectId: string; quantity: number; claimantId: string };
export type PhysicalState = {
  types: Record<string, PhysicalType>;
  objects: Record<string, PhysicalObject>;
  reservations: PhysicalReservation[];
};
export type PhysicalAuthority = { actorId: string; ownerIds: string[]; consentingPersonIds?: string[]; claimIds?: string[] };

const fail = (reason: string): never => { throw Error(reason); };
const object = (s: PhysicalState, id: string) => s.objects[id] ?? fail(`missing object ${id}`);
const typeOf = (s: PhysicalState, o: PhysicalObject) => s.types[o.typeId] ?? fail(`missing type ${o.typeId}`);
const children = (s: PhysicalState, id: string) => Object.values(s.objects).filter((o) => o.parentId === id);
export function totalMass(s: PhysicalState, id: string): number {
  const o = object(s, id);
  return typeOf(s, o).unitMass * o.quantity + children(s, id).reduce((n, c) => n + totalMass(s, c.id), 0);
}
export function contentsQuantity(s: PhysicalState, id: string, tag: string): number {
  return children(s, id).reduce((n, c) => n + (typeOf(s, c).tags.includes(tag) ? c.quantity : 0) + contentsQuantity(s, c.id, tag), 0);
}
export function capacityReport(s: PhysicalState, id: string) {
  const c = typeOf(s, object(s, id)).container;
  return {
    massUsed: children(s, id).reduce((n, o) => n + totalMass(s, o.id), 0),
    massMax: c?.maxContentsMass,
    directChildrenUsed: children(s, id).length,
    directChildrenMax: c?.maxDirectChildren,
    tagUsed: Object.fromEntries(Object.keys(c?.maxQuantityByTag ?? {}).map((tag) => [tag, contentsQuantity(s, id, tag)])),
    tagMax: c?.maxQuantityByTag ?? {},
  };
}
export function siteOf(s: PhysicalState, id: string): string {
  let o = object(s, id);
  const seen = new Set<string>();
  while (o.parentId !== null) {
    if (seen.has(o.id)) fail("physical cycle");
    seen.add(o.id);
    if (typeOf(s, o).tags.includes("site")) return o.id;
    o = object(s, o.parentId);
  }
  return o.id;
}
export function checkPhysical(s: PhysicalState): void {
  const all = Object.values(s.objects);
  if (new Set(all.map((o) => o.id)).size !== all.length || !s.objects.world || s.objects.world.parentId !== null) fail("invalid physical root or IDs");
  for (const t of Object.values(s.types)) {
    if (t.id !== s.types[t.id]?.id || !Number.isSafeInteger(t.unitMass) || t.unitMass < 0 ||
      (t.container?.maxContentsMass !== undefined && (!Number.isSafeInteger(t.container.maxContentsMass) || t.container.maxContentsMass < 0)) ||
      (t.container?.maxDirectChildren !== undefined && (!Number.isSafeInteger(t.container.maxDirectChildren) || t.container.maxDirectChildren < 0)) ||
      Object.values(t.container?.maxQuantityByTag ?? {}).some((n) => !Number.isSafeInteger(n) || n < 0)) fail("invalid physical type");
  }
  for (const o of all) {
    const t = typeOf(s, o);
    if (o.id !== s.objects[o.id]?.id || !Number.isSafeInteger(o.quantity) || o.quantity < 1 ||
      (!t.stackable && o.quantity !== 1) || (t.ownable && !o.ownerId) || (!t.ownable && o.ownerId) ||
      (t.stackable && children(s, o.id).length)) fail(`invalid object ${o.id}`);
    if (o.id !== "world" && o.parentId === null) fail("orphan physical object");
    const visited = new Set<string>();
    let cursor = o;
    while (cursor.parentId !== null) {
      if (visited.has(cursor.id)) fail("physical cycle");
      visited.add(cursor.id);
      cursor = object(s, cursor.parentId);
    }
    if (cursor.id !== "world") fail("detached physical tree");
    if (o.parentId !== null) {
      const parent = typeOf(s, object(s, o.parentId)).container;
      if (!parent || !t.tags.some((tag) => parent.acceptsTags.includes(tag))) fail(`invalid physical parent ${o.id}`);
    }
    if (t.container) {
      const r = capacityReport(s, o.id);
      if ((r.massMax !== undefined && r.massUsed > r.massMax) ||
        (r.directChildrenMax !== undefined && r.directChildrenUsed > r.directChildrenMax) ||
        Object.entries(r.tagMax).some(([tag, max]) => r.tagUsed[tag] > max)) fail(`physical capacity ${o.id}`);
    }
  }
  const ids = new Set<string>();
  for (const r of s.reservations) {
    if (ids.has(r.id) || !Number.isSafeInteger(r.quantity) || r.quantity < 1 || !r.claimantId) fail("invalid reservation");
    ids.add(r.id);
    object(s, r.objectId);
  }
  for (const o of all) if (s.reservations.filter((r) => r.objectId === o.id).reduce((n, r) => n + r.quantity, 0) > o.quantity) fail("over-reserved object");
}
function authorized(o: PhysicalObject, auth: PhysicalAuthority): boolean {
  return o.id === auth.actorId || !!o.ownerId && (o.ownerId === auth.actorId || auth.ownerIds.includes(o.ownerId)) ||
    auth.consentingPersonIds?.includes(o.id) === true;
}
export function physicalTransaction<T>(state: PhysicalState, auth: PhysicalAuthority, operation: (tx: PhysicalTransaction) => T): { ok: true; state: PhysicalState; result: T } | { ok: false; reason: string } {
  const draft = structuredClone(state);
  try {
    checkPhysical(draft);
    object(draft, auth.actorId);
    const result = operation(new PhysicalTransaction(draft, auth));
    checkPhysical(draft);
    return { ok: true, state: draft, result };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
export class PhysicalTransaction {
  constructor(private readonly s: PhysicalState, private readonly auth: PhysicalAuthority) {}
  move(id: string, parentId: string): void {
    const o = object(this.s, id), parent = object(this.s, parentId);
    if (!authorized(o, this.auth)) fail("physical authority denied");
    if (siteOf(this.s, this.auth.actorId) !== siteOf(this.s, id) || siteOf(this.s, id) !== siteOf(this.s, parentId)) fail("physical objects not co-located");
    if (this.s.reservations.some((r) => r.objectId === id)) fail("reserved physical object");
    o.parentId = parent.id;
    checkPhysical(this.s);
  }
  split(id: string, newId: string, quantity: number, causeEventId: string): void {
    const o = object(this.s, id);
    if (!authorized(o, this.auth)) fail("physical authority denied");
    if (siteOf(this.s, this.auth.actorId) !== siteOf(this.s, id)) fail("physical objects not co-located");
    if (!typeOf(this.s, o).stackable || this.s.objects[newId] || !Number.isSafeInteger(quantity) || quantity < 1 || quantity >= o.quantity) fail("invalid physical split");
    const reserved = this.s.reservations.filter((r) => r.objectId === id).reduce((n, r) => n + r.quantity, 0);
    if (o.quantity - quantity < reserved) fail("reserved physical quantity");
    o.quantity -= quantity;
    this.s.objects[newId] = { ...o, id: newId, quantity, causeEventId };
    checkPhysical(this.s);
  }
  merge(sourceId: string, targetId: string): void {
    const source = object(this.s, sourceId), target = object(this.s, targetId);
    if (sourceId === targetId || !authorized(source, this.auth) || !authorized(target, this.auth) ||
      source.typeId !== target.typeId || source.ownerId !== target.ownerId || source.parentId !== target.parentId ||
      !typeOf(this.s, source).stackable || siteOf(this.s, this.auth.actorId) !== siteOf(this.s, sourceId) ||
      this.s.reservations.some((r) => r.objectId === sourceId || r.objectId === targetId) ||
      !Number.isSafeInteger(source.quantity + target.quantity)) fail("physical merge denied");
    target.quantity += source.quantity;
    delete this.s.objects[sourceId];
    checkPhysical(this.s);
  }
  reserve(id: string, reservationId: string, quantity: number, claimantId: string): void {
    const o = object(this.s, id);
    if (!authorized(o, this.auth)) fail("physical authority denied");
    if (siteOf(this.s, this.auth.actorId) !== siteOf(this.s, id)) fail("physical objects not co-located");
    if (this.s.reservations.some((r) => r.id === reservationId)) fail("duplicate reservation");
    this.s.reservations.push({ id: reservationId, objectId: id, quantity, claimantId });
    checkPhysical(this.s);
  }
  release(reservationId: string): void {
    const r = this.s.reservations.find((item) => item.id === reservationId);
    if (!r || r.claimantId !== this.auth.actorId && !this.auth.claimIds?.includes(reservationId)) fail("reservation authority denied");
    this.s.reservations = this.s.reservations.filter((item) => item.id !== reservationId);
  }
  changeOwner(id: string, ownerId: string): void {
    const o = object(this.s, id);
    if (!authorized(o, this.auth) || !typeOf(this.s, o).ownable || !ownerId || siteOf(this.s, this.auth.actorId) !== siteOf(this.s, id) ||
      this.s.reservations.some((r) => r.objectId === id)) fail("ownership change denied");
    o.ownerId = ownerId;
  }
  add(o: PhysicalObject): void {
    if (this.s.objects[o.id]) fail("duplicate physical ID");
    if (o.parentId && siteOf(this.s, o.parentId) !== siteOf(this.s, this.auth.actorId)) fail("remote physical creation");
    this.s.objects[o.id] = o;
    checkPhysical(this.s);
  }
  remove(id: string, quantity: number): void {
    const o = object(this.s, id);
    if (!authorized(o, this.auth) || !typeOf(this.s, o).stackable || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > o.quantity ||
      this.s.reservations.some((r) => r.objectId === id) || siteOf(this.s, this.auth.actorId) !== siteOf(this.s, id)) fail("physical consumption denied");
    if (quantity === o.quantity) delete this.s.objects[id]; else o.quantity -= quantity;
  }
  depart(transit: PhysicalObject, participantIds: string[]): void {
    if (this.s.objects[transit.id] || transit.parentId !== "world" || !typeOf(this.s, transit).tags.includes("site") ||
      !participantIds.includes(this.auth.actorId) || new Set(participantIds).size !== participantIds.length) fail("invalid departure");
    const from = siteOf(this.s, this.auth.actorId);
    for (const id of participantIds) if (!authorized(object(this.s, id), this.auth) || siteOf(this.s, id) !== from ||
      this.s.reservations.some((r) => r.objectId === id && !this.auth.claimIds?.includes(r.id))) fail("departure participant unavailable");
    for (const id of participantIds) {
      let parentId = object(this.s, id).parentId;
      while (parentId !== null) {
        if (participantIds.includes(parentId)) fail("nested departure participant");
        parentId = object(this.s, parentId).parentId;
      }
    }
    this.s.objects[transit.id] = transit;
    for (const id of participantIds) object(this.s, id).parentId = transit.id;
    checkPhysical(this.s);
  }
  arrive(transitId: string, destinationId: string, participantIds: string[]): void {
    const transit = object(this.s, transitId), destination = object(this.s, destinationId);
    if (transitId === destinationId || !typeOf(this.s, transit).tags.includes("site") || !typeOf(this.s, destination).tags.includes("site") ||
      siteOf(this.s, this.auth.actorId) !== transitId || !participantIds.includes(this.auth.actorId)) fail("invalid arrival");
    for (const id of participantIds) if (!authorized(object(this.s, id), this.auth) || object(this.s, id).parentId !== transitId) fail("arrival participant unavailable");
    if (children(this.s, transitId).length !== participantIds.length) fail("transit still occupied");
    for (const id of participantIds) object(this.s, id).parentId = destinationId;
    delete this.s.objects[transitId];
    checkPhysical(this.s);
  }
}
