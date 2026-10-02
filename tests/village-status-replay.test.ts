import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { VillageStatusReplay } from "../apps/web/village-status-replay";
import type { VillageRecording } from "../packages/sim/village-recording";
import type { VillageId } from "../packages/ai/autonomous-world";
import type { PersonStatus } from "../packages/sim/village-status";

it.each(["experience-learning", "bulk-transport", "home-storage"])(
  "event-by-event inventories match every %s checkpoint over 90 days", (scenario) => {
  const recording = JSON.parse(gunzipSync(readFileSync(
    `fixtures/recordings/autonomous-village-${scenario}-90.v2.json.gz`)).toString()) as VillageRecording;
  const replay = new VillageStatusReplay(recording.fixture);
  let checkpoints = 0;
  for (const event of recording.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const actual = JSON.parse(String(event.data.status)) as PersonStatus;
      const projected = replay.statuses[event.actors[0] as VillageId]!;
      for (const inventory of ["carried", "home", "market", "field"] as const)
        expect(projected[inventory], `${event.id}: ${event.hour}h ${event.actors[0]} ${inventory}`).toEqual(actual[inventory]);
      checkpoints++;
    }
    replay.apply(event);
  }
  expect(checkpoints).toBe(2160 * 5);
}, 60000);
