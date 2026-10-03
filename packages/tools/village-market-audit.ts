/** Read-only market visit audit. Event order distinguishes multiple actions in the same hour. */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import type { VillageContext, VillageId } from "../ai/autonomous-world";
import type { VillageDecisionRecord, VillageEvent } from "../sim/autonomous-world";
import type { VillageRecording } from "../sim/village-recording";
import { decodeVillageDocument } from "../sim/shared-village-json";

const [source = "fixtures/recordings/autonomous-village-sleep-regulation-90.v2.json.gz", actor = "F", output] = process.argv.slice(2);
if (!["S", "F", "C", "B1", "B2"].includes(actor)) throw Error("unknown village actor");
const actorId = actor as VillageId;
const bytes = readFileSync(source);
const recording = decodeVillageDocument<VillageRecording>(JSON.parse(
  (source.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")), true);
if (recording.formatVersion !== 2 || recording.worldSchemaVersion !== 2) throw Error("unsupported recording");
const events = recording.events;
const eventById = new Map(events.map((event, index) => [event.id, { event, index }]));
const decisions = recording.decisions.filter((decision) => decision.actorId === actorId);
const decisionById = new Map(decisions.map((decision) => [decision.eventId, decision]));
const salesAt = new Map(events.filter((event) => event.kind === "surplus_sold")
  .map((event) => [String(event.data.offerId), eventById.get(event.id)!.index]));
const grainOffers = events.filter((event) => event.kind === "surplus_offered" &&
  event.actors[0] === actorId && event.data.product === "grain");
const snapshot = (c: VillageContext, index: number) => ({
  site: c.siteId, energy: c.energy, cold: c.cold, hunger: c.hunger,
  mass: c.carriedMass, grain: c.grainCarried ?? 0, cash: c.ownCash,
  meals: c.edibleMeals ?? 0, sleepiness: c.needs?.sleep?.sleepiness,
  sleepDeficit: c.needs?.sleep?.deficitHours, visiblePeople: c.visiblePeople,
  grainLots: c.ownFoodLots?.filter((lot) => lot.product === "grain")
    .map(({ id, quantity, offered }) => ({ id, quantity, offered })),
  ownGrainOfferQuantities: grainOffers.flatMap((event) => {
    const lot = c.ownFoodLots?.find((lot) => lot.id === event.data.lotId);
    if (!lot || eventById.get(event.id)!.index >= index || (salesAt.get(String(event.data.offerId)) ?? Infinity) < index) return [];
    return [{ offerId: String(event.data.offerId), postedEventId: event.id, postedHour: event.hour,
      lotId: lot.id, offeredQuantity: Number(event.data.quantity), carriedQuantity: lot.quantity,
      quantitySufficient: lot.quantity >= Number(event.data.quantity) }];
  }),
});
const compactDecision = (d: VillageDecisionRecord) => ({
  eventId: d.eventId, hour: d.hour, ...snapshot(d.knownContext, eventById.get(d.eventId)!.index),
  chosen: d.chosen ?? null, reason: d.response.subjectiveUpdate?.anticipation?.reasoning?.reason ?? null,
});
const processDecision = (event: VillageEvent | undefined) => event && event.causes
  .map((id) => decisionById.get(id)).find((decision) => decision !== undefined);
const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort()
  .map((value) => [value, values.filter((item) => item === value).length]));

const visits = events.flatMap((arrival, index) => {
  if (arrival.kind !== "arrived" || arrival.data.siteId !== "market" || !arrival.actors.includes(actorId)) return [];
  const start = arrival.causes.map((id) => eventById.get(id)?.event)
    .find((event) => event?.kind === "process_started" && event.data.action === "travel");
  const incoming = processDecision(start);
  const departureOffset = events.slice(index + 1).findIndex((event) => event.kind === "process_started" &&
    event.actors.includes(actorId) && event.data.action === "travel");
  const departureIndex = departureOffset < 0 ? events.length : index + 1 + departureOffset;
  const departure = events[departureIndex];
  const leaving = processDecision(departure);
  const during = events.slice(index + 1, departureIndex);
  const localDecisions = during.map((event) => decisionById.get(event.id))
    .filter((d): d is VillageDecisionRecord => d !== undefined && d.knownContext.siteId === "market");
  const transactions = during.filter((event) => event.actors.includes(actorId) &&
    ["surplus_offered", "surplus_sold"].includes(event.kind));
  const sales = transactions.filter((event) => event.kind === "surplus_sold" &&
    event.actors[0] === actorId && event.data.product === "grain");
  const purchases = transactions.filter((event) => event.kind === "surplus_sold" &&
    event.actors[1] === actorId && event.data.product !== "grain");
  const first = localDecisions[0];
  const grainOnDeparture = incoming?.knownContext.grainCarried;
  const seenArrival = first?.knownContext.grainCarried;
  const nextArrival = departure && events.slice(departureIndex + 1).find((event) =>
    event.kind === "arrived" && event.actors.includes(actorId));
  const nextDecision = nextArrival && decisions.find((decision) =>
    eventById.get(decision.eventId)!.index > eventById.get(nextArrival.id)!.index);
  return [{
    arrivalEventId: arrival.id, arrivedHour: arrival.hour,
    grainOnIncomingDeparture: grainOnDeparture ?? null,
    // Nonperishable grain does not change during these uncommanded travel processes.
    // Retain both snapshots so a buyer acting before the first local decision stays visible.
    arrivedWithGrain: (grainOnDeparture ?? seenArrival ?? 0) > 0,
    incoming: incoming ? compactDecision(incoming) : null,
    arrivalObservation: first ? compactDecision(first) : null,
    departedHour: departure?.hour ?? null, departure: leaving ? compactDecision(leaving) : null,
    nextArrival: nextArrival ? { eventId: nextArrival.id, hour: nextArrival.hour, site: nextArrival.data.siteId,
      nextObservation: nextDecision ? compactDecision(nextDecision) : null } : null,
    newGrainOffers: transactions.filter((event) => event.kind === "surplus_offered" && event.data.product === "grain").length,
    grainSaleCount: sales.length, grainSold: sales.reduce((n, event) => n + Number(event.data.quantity), 0),
    revenue: sales.reduce((n, event) => n + Number(event.data.price), 0),
    ediblePurchaseCount: purchases.length,
    transactions: transactions.map(({ id, hour, kind, actors, data }) => ({ id, hour, kind, actors, data })),
    decisions: localDecisions.map(compactDecision),
  }];
});
const grainVisits = visits.filter((visit) => visit.arrivedWithGrain);
const noSales = grainVisits.filter((visit) => visit.grainSaleCount === 0);
const mismatches = new Map<string, ReturnType<typeof compactDecision>>();
for (const decision of decisions) {
  const compact = compactDecision(decision);
  for (const offer of compact.ownGrainOfferQuantities) if (!offer.quantitySufficient && !mismatches.has(offer.offerId))
    mismatches.set(offer.offerId, compact);
}
const report = {
  source, actorId, rulesetId: recording.rulesetId, seed: recording.seed, untilHour: recording.untilHour,
  finalStateHash: recording.finalStateHash, finalEventHash: recording.finalEventHash,
  definition: "A visit runs from an actual market arrival to the next accepted travel process, in Event order. Initial residence is excluded. New offers exclude offers retained from earlier visits. This reads the saved history; it does not run hypothetical alternatives.",
  totals: {
    marketVisits: visits.length, grainCarryingVisits: grainVisits.length,
    grainVisitsWithSale: grainVisits.length - noSales.length, grainVisitsWithoutSale: noSales.length,
    noSaleAndNoNewOffer: noSales.filter((visit) => visit.newGrainOffers === 0).length,
    noSaleWithNewOffer: noSales.filter((visit) => visit.newGrainOffers > 0).length,
    noSaleWithoutAnyTransaction: noSales.filter((visit) => visit.transactions.length === 0).length,
    noSaleWithGrainStillCarriedAtDeparture: noSales.filter((visit) => (visit.departure?.grain ?? 0) > 0).length,
    noSaleWithInsufficientOfferedQuantity: noSales.filter((visit) =>
      visit.arrivalObservation?.ownGrainOfferQuantities.some((offer) => !offer.quantitySufficient)).length,
    noSaleDepartureReasons: count(noSales.map((visit) => visit.departure?.reason ?? "open-or-unobserved")),
    grainSold: grainVisits.reduce((n, visit) => n + visit.grainSold, 0),
    grainRevenue: grainVisits.reduce((n, visit) => n + visit.revenue, 0),
    ediblePurchases: visits.reduce((n, visit) => n + visit.ediblePurchaseCount, 0),
  },
  firstOfferQuantityMismatches: [...mismatches.values()],
  visits,
};
const json = JSON.stringify(report, null, 2) + "\n";
if (output) { writeFileSync(resolve(output), json); console.log(JSON.stringify(report.totals, null, 2)); }
else process.stdout.write(json);
