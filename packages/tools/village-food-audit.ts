import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeVillageDocument } from "../sim/shared-village-json";
import type { VillageRecording } from "../sim/village-recording";
import { auditVillageFoodRecording } from "../sim/village-food-audit";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw Error(`missing ${name} value`);
  return args.splice(index, 2)[1];
};
const output = option("--output"), until = option("--until-hour");
if (args.length !== 1) throw Error("provide one recording, optionally --until-hour N and --output PATH");
const source = args[0], bytes = readFileSync(source);
const recording = decodeVillageDocument<VillageRecording>(JSON.parse((source.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()), true);
const report = auditVillageFoodRecording(recording, until === undefined ? undefined : Number(until));
const text = JSON.stringify({ source, recordingStateHash: recording.finalStateHash, recordingEventHash: recording.finalEventHash, ...report }, null, 2) + "\n";
if (output) writeFileSync(output, text); else process.stdout.write(text);
