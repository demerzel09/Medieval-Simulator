import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { localWork90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand } from "../packages/sim/autonomous-world";
import { replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(input) { return { attempts: [], subjectiveUpdate: input.subjectiveState,
  wait: { at: input.at + 1 } }; } };

describe("work at plant cells", () => {
  it("requires arrival, takes gathering time, and stays at the plant through a meal", () => {
    const w = newVillageWorld(240924, localWork90V1);
    queueVillageCommand(w, { id: "too-far", actorId: "C", at: 1,
      attempt: { kind: "gather_plant", plantId: "herb_patch", quantity: 2 } });
    queueVillageCommand(w, { id: "to-herb", actorId: "S", at: 1,
      attempt: { kind: "travel", siteId: "herb_patch" } });
    queueVillageCommand(w, { id: "gather", actorId: "S", at: 2,
      attempt: { kind: "gather_plant", plantId: "herb_patch", quantity: 2 } });
    advanceVillageWorld(w, 2, idle);
    expect(w.people.S.cell).toEqual(w.grid.sites.herb_patch);
    expect(w.harvestedFood).toBe(0);
    expect(w.events.some((e) => e.kind === "attempt_rejected" && e.actors.includes("C") &&
      e.data.reason === "plant worksite unavailable")).toBe(true);
    advanceVillageWorld(w, 2, idle);
    expect(w.harvestedFood).toBe(2);
    expect(w.people.S.cell).toEqual(w.grid.sites.herb_patch);
    queueVillageCommand(w, { id: "eat", actorId: "S", at: 5, attempt: { kind: "eat" } });
    advanceVillageWorld(w, 1, idle);
    expect(w.people.S.meals).toBe(1);
    expect(w.people.S.cell).toEqual(w.grid.sites.herb_patch);
    expect(w.events.some((e) => e.kind === "travel_step" && e.actors.includes("S") &&
      e.data.destinationId === "grove")).toBe(false);
  });

  it("replays real movement and stationary gathering without returning farmers to field labels", () => {
    const recording = JSON.parse(gunzipSync(readFileSync(
      "fixtures/recordings/autonomous-village-local-work-90.v2.json.gz")).toString("utf8")) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(recording.rulesetId).toBe("autonomous-village-local-work-v10");
    expect(w.decisions.some((d) => d.chosen?.kind === "forage_route")).toBe(false);
    expect(w.events.some((e) => e.kind === "plant_gathered" && e.actors.includes("S"))).toBe(true);
    for (const e of w.events.filter((e) => e.kind === "plant_gathered")) {
      const plant = w.land.plants[String(e.data.plantId)];
      const arrivals = w.events.filter((a) => a.hour <= e.hour && a.kind === "arrived" &&
        a.actors.includes(e.actors[0]));
      expect(arrivals.at(-1)?.data.siteId).toBe(plant.siteId);
    }
    for (const id of ["F", "B1", "B2"] as const) {
      expect(w.events.some((e) => e.kind === "crop_harvested" && e.actors.includes(id))).toBe(true);
      expect(w.decisions.some((d) => d.actorId === id && d.chosen?.kind === "travel" &&
        ["field", "field_B1", "field_B2"].includes(d.chosen.siteId))).toBe(false);
    }
    for (const id of ["S", "F", "C", "B1", "B2"] as const) for (let day = 1; day <= 90; day++)
      expect(w.events.some((e) => e.kind === "ate" && e.day === day && e.actors.includes(id))).toBe(true);
  }, 60000);
});
