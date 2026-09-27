import { advanceVillageWorld, newVillageWorld, villageHash, villageSummary } from "../sim/autonomous-world";

const days = Number(process.argv[2] ?? 90);
if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw Error("days must be 1..90");
const w = newVillageWorld();
const snapshots: { summary: ReturnType<typeof villageSummary>; received: Record<string, number>;
  unfinished: { actorId: string; action: string; progress: number; duration: number }[] }[] = [];
if (process.argv.includes("--daily")) for (let day = 1; day <= days; day++) {
  advanceVillageWorld(w, 24);
  snapshots.push({ summary: villageSummary(w),
    received: Object.fromEntries(Object.entries(w.people).map(([id, p]) =>
      [id, p.receivedStimulusIds.length])),
    unfinished: Object.values(w.processes).map((p) => ({ actorId: p.actorId, action: p.kind,
      progress: p.progress, duration: p.duration })) });
} else advanceVillageWorld(w, days * 24);
const daily = snapshots.length ? snapshots.map((snapshot, i) => {
  const day = i + 1, events = w.events.filter((e) => e.day === day);
  const previous = snapshots[i - 1]?.received;
  return { day, state: snapshot.summary, unfinished: snapshot.unfinished,
  receivedStimuli: Object.fromEntries(Object.entries(snapshot.received).map(([id, n]) =>
    [id, n - (previous?.[id] ?? 0)])),
  meals: Object.fromEntries((["S", "F", "C", "B1", "B2"] as const).map((id) =>
    [id, events.filter((e) => e.kind === "ate" && e.actors.includes(id)).length])),
  harvestedFood: events.filter((e) => e.kind === "foraged" && e.data.resource === "food")
    .reduce((n, e) => n + Number(e.data.quantity), 0),
  harvestedWood: events.filter((e) => e.kind === "foraged" && e.data.resource === "wood")
    .reduce((n, e) => n + Number(e.data.quantity), 0),
  deliveries: events.filter((e) => e.kind === "food_delivered").length,
  acceptedOrders: events.filter((e) => e.kind === "food_order_accepted").length,
  purchases: events.filter((e) => e.kind === "crop_bought").length,
  fundedCarriages: events.filter((e) => e.kind === "carriage_funded").length,
  processesStarted: events.filter((e) => e.kind === "process_started").length,
  processesCompleted: events.filter((e) => e.kind === "process_completed").length,
  foodSales: events.filter((e) => e.kind === "food_sold").length,
  woodSales: events.filter((e) => e.kind === "wood_sold").length,
  rejected: events.filter((e) => e.kind === "attempt_rejected" || e.kind === "process_failed")
    .map((e) => ({ actor: e.actors[0], reason: e.data.reason })) };
}) : undefined;
console.log(JSON.stringify({ mode: w.mode, seed: w.seed, fixture: "autonomousVillageV1",
  summary: villageSummary(w), eventCount: w.events.length, stateHash: villageHash(w),
  daily, events: process.argv.includes("--events") ? w.events : undefined }, null, 2));
