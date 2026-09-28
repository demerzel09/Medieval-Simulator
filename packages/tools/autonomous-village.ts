import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { autonomousVillageV1 } from "../../fixtures/autonomous-village";
import { landEconomy90V1 } from "../../fixtures/land-economy-90";
import { spatialLandEconomy90V1 } from "../../fixtures/land-economy-spatial";
import { exploringLandEconomy90V1, wideLandEconomy90V1 } from "../../fixtures/land-economy-wide";
import { ordinaryVillageModel, type VillageModel } from "../ai/autonomous-world";
import { cultivatorVillageModel, exploringLandEconomyVillageModel, landEconomyVillageModel,
  spatialLandEconomyVillageModel } from "../ai/farming-skill";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand,
  queueVillageTerrainCommand, villageHash, villageSummary } from "../sim/autonomous-world";
import { defaultVillageGrid, exploringVillageGrid, spatialVillageGrid,
  wideVillageGrid } from "../sim/grid-path";
import { newLandEcology } from "../sim/land-ecology";
import { captureVillageRecording, compareVillageRecordings, replayVillageRecording,
  recordedVillageActorHistory, villageActorHistory, type VillageRecording } from "../sim/village-recording";

const args = process.argv.slice(2);
const readRecording = (path: string) => {
  const bytes = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")) as VillageRecording;
};
if (args[0] === "replay") {
  if (!args[1]) throw Error("replay requires a recording path");
  const w = replayVillageRecording(readRecording(args[1]));
  console.log(JSON.stringify({ verified: true, stateHash: villageHash(w),
    summary: villageSummary(w) }, null, 2));
  process.exit(0);
}
if (args[0] === "compare") {
  if (!args[1] || !args[2]) throw Error("compare requires two recording paths");
  console.log(JSON.stringify(compareVillageRecordings(readRecording(args[1]),
    readRecording(args[2])), null, 2));
  process.exit(0);
}
if (args[0] === "history") {
  if (!args[1] || !["S", "F", "C", "B1", "B2"].includes(args[2]))
    throw Error("history requires a recording path and person ID");
  const history = JSON.stringify(recordedVillageActorHistory(readRecording(args[1]),
    args[2] as "S" | "F" | "C" | "B1" | "B2"), null, 2);
  if (args[3]) {
    const absolute = resolve(args[3]);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, history);
    console.log(`Village history written: ${absolute}`);
  } else console.log(history);
  process.exit(0);
}

const days = Number(process.argv[2] ?? 90);
if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw Error("days must be 1..90");
const scenarioIndex = args.indexOf("--scenario");
const scenario = scenarioIndex < 0 ? "baseline" : args[scenarioIndex + 1];
const fixture = structuredClone(autonomousVillageV1);
let grid = defaultVillageGrid();
let land = newLandEcology(grid, fixture.resources.food.initial, fixture.resources.food.capacity);
let model: VillageModel = ordinaryVillageModel;
if (scenario === "low-capital") fixture.initialCash.S = 0;
else if (scenario === "scarce-wood") fixture.resources.wood.growthPerDay = 0;
else if (scenario === "late-information") fixture.informationDelayHours = 24;
else if (scenario === "carrier-refuses") model = { decide(input) {
  if (input.actorId === "C") return { attempts: [], wait: { at: input.at + 1 },
    subjectiveUpdate: input.subjectiveState };
  return ordinaryVillageModel.decide(input);
} };
else if (scenario === "cultivation") model = cultivatorVillageModel;
else if (["land-economy", "land-spatial", "land-wide", "land-explore", "land-few-plots", "land-few-seeds", "land-poor-yield",
  "land-long-field", "land-road-blocked", "land-farmer-refuses", "land-no-skill",
  "land-late-information", "land-starvation"].includes(scenario)) {
  Object.assign(fixture, structuredClone(landEconomy90V1.world));
  if (scenario === "land-spatial") {
    Object.assign(fixture, structuredClone(spatialLandEconomy90V1));
    grid = spatialVillageGrid();
  }
  if (scenario === "land-wide") {
    Object.assign(fixture, structuredClone(wideLandEconomy90V1));
    grid = wideVillageGrid();
  }
  if (scenario === "land-explore") {
    Object.assign(fixture, structuredClone(exploringLandEconomy90V1));
    grid = exploringVillageGrid();
  }
  if (scenario === "land-few-plots") fixture.landEconomy!.grainPlots = 3;
  if (scenario === "land-few-seeds") fixture.landEconomy!.initialSeeds = 2;
  if (scenario === "land-no-skill") fixture.landEconomy!.farmerGrainSkill = 0;
  if (scenario === "land-late-information") fixture.informationDelayHours = 24;
  if (scenario === "land-long-field" || scenario === "land-road-blocked") {
    grid.sites.field = { x: 4, y: 1 };
    grid.sites.meadow = { x: 4, y: 3 };
  }
  land = newLandEcology(grid, fixture.resources.food.initial, fixture.resources.food.capacity,
    fixture.landEconomy?.grainPlots, true,
    scenario === "land-wide" || scenario === "land-explore");
  if (scenario === "land-poor-yield") for (const patch of Object.values(land.plants))
    if (patch.species === "grain") patch.growthQuantity = 4;
  if (scenario === "land-starvation") for (const patch of Object.values(land.plants))
    if (patch.species === "grass" || patch.species === "herb") {
      patch.initialAvailable = 0; patch.available = 0; patch.growthQuantity = 0;
      patch.stage = "regrowing";
    }
  model = scenario === "land-explore" ? exploringLandEconomyVillageModel :
    scenario === "land-spatial" || scenario === "land-wide" ?
    spatialLandEconomyVillageModel :
    scenario === "land-farmer-refuses" ? { decide(input) {
    if (input.actorId === "F") return { attempts: [], wait: { at: input.at + 1 },
      subjectiveUpdate: input.subjectiveState };
    return landEconomyVillageModel.decide(input);
  } } : landEconomyVillageModel;
}
else if (scenario === "no-grass") {
  land.plants.grass_patch.available = 0; land.plants.grass_patch.initialAvailable = 0;
  land.plants.grass_patch.stage = "regrowing";
} else if (scenario === "rerouted-carrier") {
  grid.width = 8; grid.sites.market = { x: 0, y: 1 }; grid.sites.grove = { x: 6, y: 1 };
  grid.sites.home_B1 = { x: 0, y: 0 }; grid.sites.home_B2 = { x: 0, y: 2 };
  grid.sites.field = { x: 4, y: 3 }; grid.sites.meadow = { x: 7, y: 3 };
  land = newLandEcology(grid, fixture.resources.food.initial, fixture.resources.food.capacity);
} else if (scenario !== "baseline") throw Error("unknown village scenario");
const w = newVillageWorld(240924, fixture, grid, land);
if (scenario === "rerouted-carrier") {
  queueVillageCommand(w, { id: "carrier-route", actorId: "C", at: 1,
    attempt: { kind: "travel", siteId: "grove" } });
  queueVillageTerrainCommand(w, { id: "blocked-road", at: 3,
    cell: { x: 2, y: 0 }, blocked: true });
  queueVillageCommand(w, { id: "carrier-redirect", actorId: "C", at: 5,
    attempt: { kind: "redirect_travel", siteId: "field" } });
}
if (scenario === "land-road-blocked") {
  queueVillageTerrainCommand(w, { id: "field-north-road-closes", at: 5,
    cell: { x: 3, y: 0 }, blocked: true });
  queueVillageTerrainCommand(w, { id: "field-middle-road-closes", at: 5,
    cell: { x: 3, y: 1 }, blocked: true });
}
const snapshots: { summary: ReturnType<typeof villageSummary>; received: Record<string, number>;
  unfinished: { actorId: string; action: string; progress: number; duration: number }[] }[] = [];
if (process.argv.includes("--daily")) for (let day = 1; day <= days; day++) {
  advanceVillageWorld(w, 24, model);
  snapshots.push({ summary: villageSummary(w),
    received: Object.fromEntries(Object.entries(w.people).map(([id, p]) =>
      [id, p.receivedStimulusIds.length])),
    unfinished: Object.values(w.processes).map((p) => ({ actorId: p.actorId, action: p.kind,
      progress: p.progress, duration: p.duration })) });
} else advanceVillageWorld(w, days * 24, model);
const daily = snapshots.length ? snapshots.map((snapshot, i) => {
  const day = i + 1, events = w.events.filter((e) => e.day === day);
  const previous = snapshots[i - 1]?.received;
  return { day, state: snapshot.summary, unfinished: snapshot.unfinished,
  receivedStimuli: Object.fromEntries(Object.entries(snapshot.received).map(([id, n]) =>
    [id, n - (previous?.[id] ?? 0)])),
  meals: Object.fromEntries((["S", "F", "C", "B1", "B2"] as const).map((id) =>
    [id, events.filter((e) => e.kind === "ate" && e.actors.includes(id)).length])),
  harvestedFood: events.filter((e) => e.kind === "foraged" && e.data.resource === "food")
    .reduce((n, e) => n + Number(e.data.quantity), 0) +
    events.filter((e) => e.kind === "crop_harvested" || e.kind === "plant_gathered")
      .reduce((n, e) => n + Number(e.data.quantity), 0),
  mealsBySource: Object.fromEntries(["grain", "wild_berry", "fruit_tree", "herb", "unknown"]
    .map((kind) => [kind, events.filter((e) => e.kind === "ate" &&
      (e.data.species ?? "unknown") === kind).length])),
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
console.log(JSON.stringify({ mode: w.mode, seed: w.seed, scenario,
  summary: villageSummary(w), eventCount: w.events.length, stateHash: villageHash(w),
  daily, events: process.argv.includes("--events") ? w.events : undefined,
  history: (() => { const i = args.indexOf("--history");
    if (i < 0) return undefined;
    const id = args[i + 1];
    if (!["S", "F", "C", "B1", "B2"].includes(id)) throw Error("unknown history actor");
    return villageActorHistory(w, id as "S" | "F" | "C" | "B1" | "B2"); })() }, null, 2));
const recordIndex = args.indexOf("--record");
if (recordIndex >= 0) {
  const path = args[recordIndex + 1];
  if (!path) throw Error("--record requires a file path");
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const json = JSON.stringify(captureVillageRecording(w));
  writeFileSync(absolute, absolute.endsWith(".gz") ? gzipSync(json) : json);
  console.error(`Village recording written: ${absolute}`);
}
