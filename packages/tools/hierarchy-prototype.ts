import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  hierarchyV25,
  hierarchyRecoveryV25,
} from "../../fixtures/hierarchy-v25";
import { hierarchyVillageModel } from "../ai/hierarchy/village-adapter";
import {
  advanceVillageWorld,
  loadVillageWorld,
  newVillageWorld,
  saveVillageWorld,
  villageHash,
} from "../sim/autonomous-world";
import {
  captureVillageRecording,
  replayVillageRecording,
  type VillageRecording,
} from "../sim/village-recording";
import {
  encodeVillageDocument,
  decodeVillageDocument,
} from "../sim/shared-village-json";
import { hash } from "../sim/core";
const args = process.argv.slice(2),
  hours = Number(args[0] ?? 24);
if (!Number.isSafeInteger(hours) || hours < 2 || hours > 2160)
  throw Error("prototype hours must be 2..2160");
const w = newVillageWorld(
    240924,
    args.includes("--legacy") ? hierarchyV25 : hierarchyRecoveryV25,
  ),
  split = Math.floor(hours / 2);
advanceVillageWorld(w, split, hierarchyVillageModel);
const resumed = loadVillageWorld(saveVillageWorld(w));
advanceVillageWorld(w, hours - split, hierarchyVillageModel);
advanceVillageWorld(resumed, hours - split, hierarchyVillageModel);
if (villageHash(w) !== villageHash(resumed))
  throw Error("prototype resume mismatch");
function verifyDecisions(decisions: VillageRecording["decisions"]) {
  for (const d of decisions) {
    const actual = hierarchyVillageModel.decide({
      actorId: d.actorId,
      at: d.hour,
      stimuli: d.stimuli,
      knownContext: d.knownContext,
      subjectiveState: d.subjectiveBefore,
    });
    if (JSON.stringify(actual) !== JSON.stringify(d.response))
      throw Error(`prototype decision mismatch:${d.eventId}`);
  }
}
verifyDecisions(w.decisions);
const recording = captureVillageRecording(w);
const encoded = JSON.stringify(encodeVillageDocument(recording));
const decoded = decodeVillageDocument<VillageRecording>(
  JSON.parse(encoded),
  true,
);
verifyDecisions(decoded.decisions);
replayVillageRecording(decoded);
const report = {
  scope: "connection-prototype; temporary evaluation; not survival comparison",
  compositionVersion: w.fixture.hierarchyModel!.compositionVersion,
  hours,
  seed: w.seed,
  decisions: w.decisions.length,
  stateHash: villageHash(w),
  eventHash: hash(w.events),
  verified: {
    decisionRecomputation: true,
    sharedRecordingRecomputation: true,
    saveResume: true,
    recordingReplay: true,
  },
  actors: Object.fromEntries(
    Object.entries(w.people).map(([id, p]) => {
      const s = p.memory.hierarchy!;
      return [
        id,
        {
          alive: !p.death,
          death:
            w.events.find(
              (e) => e.kind === "person_died" && e.actors.includes(id),
            )?.data ?? null,
          rested: w.events.filter(
            (e) => e.kind === "rested" && e.actors.includes(id),
          ).length,
          maxObservedFatigue: Math.max(
            0,
            ...w.decisions
              .filter((d) => d.actorId === id)
              .map((d) => d.knownContext.effortBody?.fatigue ?? 0),
          ),
          meals: p.meals,
          updates: Object.fromEntries(
            Object.entries(s.models)
              .filter(([, m]) => m.revision)
              .map(([model, m]) => [model, m.revision]),
          ),
          choices: w.decisions.filter((d) => d.actorId === id).length,
          retainedChoices: s.choices.length,
          openTracking: s.tracking.filter((t) => !t.close).length,
          retainedFailures: s.failures,
          feedback: s.feedback,
          rngDraws: s.rng.draws,
        },
      ];
    }),
  ),
};
const output = args.indexOf("--output");
if (output >= 0) {
  if (!args[output + 1]) throw Error("missing output");
  writeFileSync(args[output + 1], JSON.stringify(report, null, 2) + "\n");
}
const record = args.indexOf("--record");
if (record >= 0) {
  if (!args[record + 1]) throw Error("missing record");
  writeFileSync(args[record + 1], gzipSync(encoded));
}
console.log(
  JSON.stringify({
    hours,
    decisions: report.decisions,
    stateHash: report.stateHash,
    eventHash: report.eventHash,
    survivors: Object.values(report.actors).filter((actor) => actor.alive)
      .length,
    deaths: Object.entries(report.actors).flatMap(([actor, value]) =>
      value.death
        ? [
            {
              actor,
              minute: value.death.atMinute,
              fatigue: value.death.fatigue,
              reserve: value.death.reserve,
            },
          ]
        : [],
    ),
    verified: report.verified,
  }),
);
