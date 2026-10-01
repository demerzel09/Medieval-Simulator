import type { VillageFixture } from "../../fixtures/autonomous-village";
import type { VillageAttempt, VillageId, VillageModel } from "../ai/autonomous-world";
import { hash } from "./core";
import type { GridMap, GridPoint } from "./grid-path";
import type { LandEcology } from "./land-ecology";
import { advanceVillageWorld, checkVillageWorld, newVillageWorld, queueVillageCommand,
  queueVillageTerrainCommand, villageHash, type VillageDecisionRecord, type VillageEvent,
  type VillageWorld } from "./autonomous-world";

export type VillageRecording = { formatVersion: 2; worldSchemaVersion: 2;
  rulesetId: "autonomous-village-grid-land-v1" | "autonomous-village-land-economy-v2" |
    "autonomous-village-spatial-land-v3" | "autonomous-village-wide-land-v4" |
    "autonomous-village-exploring-land-v5" | "autonomous-village-ecological-land-v6" | "autonomous-village-wood-paused-v7" | "autonomous-village-owned-farms-v8" | "autonomous-village-wild-food-market-v9"; seed: number;
  fixture: VillageFixture; initialGrid: GridMap; initialLand: LandEcology; untilHour: number;
  commands: { id: string; actorId: VillageId; at: number; attempt: VillageAttempt }[];
  terrainCommands: { id: string; at: number; cell: GridPoint; blocked: boolean }[];
  decisions: VillageDecisionRecord[]; events: VillageEvent[];
  finalStateHash: string; finalEventHash: string };

function actorHistory(events: VillageEvent[], records: VillageDecisionRecord[], actorId: VillageId) {
  if (!["S", "F", "C", "B1", "B2"].includes(actorId)) throw Error("unknown village actor");
  const decisions = new Map(records.map((d) => [d.eventId, d]));
  return events.filter((e) => e.actors.includes(actorId)).map((event) => ({
    event: structuredClone(event), decision: decisions.get(event.id) ?
      structuredClone(decisions.get(event.id)) : undefined,
  }));
}
export function villageActorHistory(w: VillageWorld, actorId: VillageId) {
  return actorHistory(w.events, w.decisions, actorId);
}
export function recordedVillageActorHistory(recording: VillageRecording, actorId: VillageId) {
  return actorHistory(recording.events, recording.decisions, actorId);
}
export function captureVillageRecording(w: VillageWorld): VillageRecording {
  checkVillageWorld(w);
  return structuredClone({ formatVersion: 2, worldSchemaVersion: 2,
    rulesetId: w.fixture.publicForaging ? "autonomous-village-wild-food-market-v9" :
      w.fixture.landEconomy?.farms ? "autonomous-village-owned-farms-v8" :
      w.fixture.woodEnabled === false ? "autonomous-village-wood-paused-v7" :
      w.fixture.landEconomy?.physicalGrowth ? "autonomous-village-ecological-land-v6" :
      w.fixture.landEconomy?.exploreWildPlants ? "autonomous-village-exploring-land-v5" :
      w.fixture.landEconomy?.wideWorld ? "autonomous-village-wide-land-v4" :
      w.fixture.landEconomy?.spatialGrid ? "autonomous-village-spatial-land-v3" :
      w.fixture.landEconomy ? "autonomous-village-land-economy-v2" :
      "autonomous-village-grid-land-v1", seed: w.seed,
    fixture: w.fixture, initialGrid: w.initialGrid, initialLand: w.initialLand,
    untilHour: w.hour,
    commands: w.commands.map(({ id, actorId, at, attempt }) => ({ id, actorId, at, attempt })),
    terrainCommands: w.terrainCommands.map(({ id, at, cell, blocked }) => ({ id, at, cell, blocked })),
    decisions: w.decisions, events: w.events,
    finalStateHash: villageHash(w), finalEventHash: hash(w.events) });
}
export function replayVillageRecording(recording: VillageRecording): VillageWorld {
  if (recording.formatVersion !== 2 || recording.worldSchemaVersion !== 2 ||
    recording.rulesetId !== (recording.fixture.publicForaging ? "autonomous-village-wild-food-market-v9" :
      recording.fixture.landEconomy?.farms ? "autonomous-village-owned-farms-v8" :
      recording.fixture.woodEnabled === false ? "autonomous-village-wood-paused-v7" :
      recording.fixture.landEconomy?.physicalGrowth ?
      "autonomous-village-ecological-land-v6" : recording.fixture.landEconomy?.exploreWildPlants ?
      "autonomous-village-exploring-land-v5" : recording.fixture.landEconomy?.wideWorld ?
      "autonomous-village-wide-land-v4" : recording.fixture.landEconomy?.spatialGrid ?
      "autonomous-village-spatial-land-v3" : recording.fixture.landEconomy ?
        "autonomous-village-land-economy-v2" : "autonomous-village-grid-land-v1") ||
    !Number.isSafeInteger(recording.untilHour) || recording.untilHour < 0 ||
    hash(recording.events) !== recording.finalEventHash)
    throw Error("unsupported village recording");
  const w = newVillageWorld(recording.seed, recording.fixture, recording.initialGrid,
    recording.initialLand);
  for (const c of recording.commands) queueVillageCommand(w, c);
  for (const c of recording.terrainCommands) queueVillageTerrainCommand(w, c);
  let index = 0;
  const playback: VillageModel = { decide(input) {
    const d = recording.decisions[index++];
    if (!d || d.actorId !== input.actorId || d.hour !== input.at ||
      JSON.stringify(d.stimuli) !== JSON.stringify(input.stimuli) ||
      JSON.stringify(d.knownContext) !== JSON.stringify(input.knownContext) ||
      JSON.stringify(d.subjectiveBefore) !== JSON.stringify(input.subjectiveState))
      throw Error(`village recording diverged at ${input.at}:${input.actorId}`);
    return structuredClone(d.response);
  } };
  advanceVillageWorld(w, recording.untilHour, playback);
  if (index !== recording.decisions.length || villageHash(w) !== recording.finalStateHash ||
    hash(w.events) !== recording.finalEventHash) throw Error("village recording final mismatch");
  return w;
}
export function compareVillageRecordings(a: VillageRecording, b: VillageRecording) {
  if (hash(a.events) !== a.finalEventHash || hash(b.events) !== b.finalEventHash)
    throw Error("invalid village recording events");
  const count = Math.max(a.events.length, b.events.length);
  let firstDifference: { index: number; left?: VillageEvent; right?: VillageEvent } | undefined;
  for (let index = 0; index < count; index++) if (JSON.stringify(a.events[index]) !==
    JSON.stringify(b.events[index])) { firstDifference = { index, left: a.events[index],
      right: b.events[index] }; break; }
  const setupEqual = a.rulesetId === b.rulesetId &&
    JSON.stringify(a.fixture) === JSON.stringify(b.fixture) &&
    JSON.stringify(a.initialGrid) === JSON.stringify(b.initialGrid) &&
    JSON.stringify(a.initialLand) === JSON.stringify(b.initialLand) &&
    JSON.stringify(a.commands) === JSON.stringify(b.commands) &&
    JSON.stringify(a.terrainCommands) === JSON.stringify(b.terrainCommands);
  return { equal: setupEqual && a.finalStateHash === b.finalStateHash && !firstDifference,
    leftHash: a.finalStateHash, rightHash: b.finalStateHash, firstDifference,
    rulesetEqual: a.rulesetId === b.rulesetId,
    fixtureEqual: JSON.stringify(a.fixture) === JSON.stringify(b.fixture),
    gridEqual: JSON.stringify(a.initialGrid) === JSON.stringify(b.initialGrid),
    landEqual: JSON.stringify(a.initialLand) === JSON.stringify(b.initialLand),
    commandsEqual: JSON.stringify(a.commands) === JSON.stringify(b.commands) &&
      JSON.stringify(a.terrainCommands) === JSON.stringify(b.terrainCommands),
    leftEvents: a.events.length, rightEvents: b.events.length };
}
