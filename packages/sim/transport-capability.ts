import { PhysicalState, capacityReport, checkPhysical, physicalTransaction, siteOf, totalMass } from "./physical";

export type HaulResource = { id: string; knownAvailable: boolean };
export type HaulRequest = {
  taskId: string; personId: string; cargoId: string; quantity: number;
  fromId: string; toId: string; deadline: number; causeEventIds: string[];
};
export type HaulContext = {
  knownCartIds: HaulResource[]; knownHorseIds: HaulResource[];
  knownDriverIds: HaulResource[]; knownLoaderIds: HaulResource[];
  estimatedTowByHorse: Record<string, number>;
  estimatedCartTare: Record<string, number>;
  estimatedCartSpace: Record<string, number>;
  loadMinutesPerCart: number; travelMinutes: number; now: number;
};
export type HaulAssignment = { cartId: string; horseId: string; driverId: string; quantity: number };
export type HaulProposal = {
  taskId: string; personId: string; cargoId: string; quantity: number;
  fromId: string; toId: string; assignments: HaulAssignment[];
  loaderId: string; expectedFinishAt: number; causeEventIds: string[];
};

/** A rule implementation of a person's planning port. Inputs are perceived estimates, not world truth. */
export function proposeHaul(r: HaulRequest, c: HaulContext): HaulProposal | undefined {
  const available = (xs: HaulResource[]) => xs.filter((x) => x.knownAvailable).map((x) => x.id).sort();
  const carts = available(c.knownCartIds), horses = available(c.knownHorseIds), drivers = available(c.knownDriverIds), loaders = available(c.knownLoaderIds);
  if (!loaders.length || !Number.isSafeInteger(r.quantity) || r.quantity < 1) return undefined;
  let remaining = r.quantity;
  const assignments: HaulAssignment[] = [];
  for (let i = 0; i < Math.min(carts.length, horses.length, drivers.length) && remaining > 0; i++) {
    const cartId = carts[i], horseId = horses[i];
    const max = Math.min(c.estimatedCartSpace[cartId] ?? 0, (c.estimatedTowByHorse[horseId] ?? 0) - (c.estimatedCartTare[cartId] ?? 0));
    const quantity = Math.min(remaining, Math.floor(max));
    if (quantity > 0) { assignments.push({ cartId, horseId, driverId: drivers[i], quantity }); remaining -= quantity; }
  }
  const expectedFinishAt = c.now + assignments.length * c.loadMinutesPerCart + c.travelMinutes;
  if (remaining || expectedFinishAt > r.deadline) return undefined;
  return { taskId: r.taskId, personId: r.personId, cargoId: r.cargoId, quantity: r.quantity,
    fromId: r.fromId, toId: r.toId, assignments, loaderId: loaders[0], expectedFinishAt, causeEventIds: [...r.causeEventIds] };
}

export type HaulTruth = {
  state: PhysicalState; now: number; deadline: number; travelMinutes: number;
  loadMinutesPerCart: number; towByHorse: Record<string, number>;
  acceptedTaskIds: string[]; workingPersonIds: string[];
};
/** Sim-side preflight. A proposed plan cannot create capacity, labour, or ownership. */
export function checkHaul(p: HaulProposal, truth: HaulTruth): { ok: true } | { ok: false; reason: string } {
  try {
    checkPhysical(truth.state);
    const { state: s } = truth;
    if (!truth.acceptedTaskIds.includes(p.taskId) || !truth.workingPersonIds.includes(p.personId) || !truth.workingPersonIds.includes(p.loaderId)) throw Error("worker unavailable");
    if (p.expectedFinishAt > truth.deadline || truth.now + p.assignments.length * truth.loadMinutesPerCart + truth.travelMinutes > truth.deadline) throw Error("deadline missed");
    if (siteOf(s, p.personId) !== p.fromId || siteOf(s, p.loaderId) !== p.fromId || siteOf(s, p.cargoId) !== p.fromId) throw Error("cargo or worker absent");
    const ids = new Set<string>();
    let sum = 0;
    for (const a of p.assignments) {
      for (const id of [a.cartId, a.horseId, a.driverId]) { if (ids.has(id)) throw Error("double-booked resource"); ids.add(id); }
      if (!truth.workingPersonIds.includes(a.driverId) || [a.cartId, a.horseId, a.driverId].some((id) => siteOf(s, id) !== p.fromId)) throw Error("vehicle or crew absent");
      const cargoMass = a.quantity * s.types[s.objects[p.cargoId].typeId].unitMass;
      if (!Number.isSafeInteger(a.quantity) || a.quantity < 1 || cargoMass > (capacityReport(s, a.cartId).massMax ?? 0) - capacityReport(s, a.cartId).massUsed ||
        totalMass(s, a.cartId) + cargoMass > (truth.towByHorse[a.horseId] ?? 0)) throw Error("load or tow capacity exceeded");
      sum += a.quantity;
    }
    if (sum !== p.quantity || p.quantity > s.objects[p.cargoId]?.quantity) throw Error("cargo quantity unavailable");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** One sim-side load-and-depart action. Failure returns the original state untouched. */
export function executeHaul(p: HaulProposal, truth: HaulTruth, transitId: string): { ok: true; state: PhysicalState; loadedIds: string[] } | { ok: false; reason: string } {
  const checked = checkHaul(p, truth);
  if (!checked.ok) return checked;
  const cargo = truth.state.objects[p.cargoId];
  const loadedIds: string[] = [];
  const result = physicalTransaction(truth.state, {
    actorId: p.personId, ownerIds: cargo.ownerId ? [cargo.ownerId] : [],
    consentingPersonIds: p.assignments.map((a) => a.driverId),
  }, (tx) => {
    let remaining = cargo.quantity;
    for (const [i, a] of p.assignments.entries()) {
      const lotId = a.quantity === remaining ? cargo.id : `${transitId}_cargo_${i}`;
      if (lotId !== cargo.id) tx.split(cargo.id, lotId, a.quantity, p.causeEventIds.at(-1) ?? p.taskId);
      tx.move(lotId, a.cartId);
      loadedIds.push(lotId);
      remaining -= a.quantity;
    }
    tx.depart({ id: transitId, typeId: "site", parentId: "world", quantity: 1, causeEventId: p.causeEventIds.at(-1) ?? p.taskId },
      [p.personId, ...p.assignments.flatMap((a) => [a.cartId, a.horseId, a.driverId])]);
  });
  return result.ok ? { ok: true, state: result.state, loadedIds } : result;
}
