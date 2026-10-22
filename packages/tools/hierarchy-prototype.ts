import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { hierarchyV25 } from "../../fixtures/hierarchy-v25";
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
} from "../sim/village-recording";
import { encodeVillageDocument } from "../sim/shared-village-json";
import { hash } from "../sim/core";
const args = process.argv.slice(2),
  hours = Number(args[0] ?? 24);
if (!Number.isSafeInteger(hours) || hours < 2 || hours > 240)
  throw Error("prototype hours must be 2..240");
const w = newVillageWorld(240924, hierarchyV25),
  split = Math.floor(hours / 2);
advanceVillageWorld(w, split, hierarchyVillageModel);
const resumed = loadVillageWorld(saveVillageWorld(w));
advanceVillageWorld(w, hours - split, hierarchyVillageModel);
advanceVillageWorld(resumed, hours - split, hierarchyVillageModel);
if (villageHash(w) !== villageHash(resumed))
  throw Error("prototype resume mismatch");
for (const d of w.decisions) {
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
const recording = captureVillageRecording(w);
replayVillageRecording(recording);
const report = {
  scope: "connection-prototype; temporary-goal-v1; not survival comparison",
  hours,
  seed: w.seed,
  decisions: w.decisions.length,
  stateHash: villageHash(w),
  eventHash: hash(w.events),
  verified: {
    decisionRecomputation: true,
    saveResume: true,
    recordingReplay: true,
  },
  actors: Object.fromEntries(
    Object.entries(w.people).map(([id, p]) => {
      const s = p.memory.hierarchy!;
      return [
        id,
        {
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
  writeFileSync(
    args[record + 1],
    gzipSync(JSON.stringify(encodeVillageDocument(recording))),
  );
}
console.log(
  JSON.stringify({
    hours,
    decisions: report.decisions,
    stateHash: report.stateHash,
    eventHash: report.eventHash,
    verified: report.verified,
  }),
);
