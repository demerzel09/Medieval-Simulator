import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ownedFarms90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

const idle: VillageModel = { decide(input) { return { attempts: [],
  subjectiveUpdate: input.subjectiveState, wait: { at: input.at + 1 } }; } };

describe("independent farm owners", () => {
  it("separates three four-cell farms with seed and crop skills for each owner", () => {
    const w = newVillageWorld(240924, ownedFarms90V1);
    for (const id of ["F", "B1", "B2"] as const) {
      const crops = Object.values(w.land.plants).filter((p) => p.ownerId === id);
      expect(crops).toHaveLength(4);
      expect(crops.every((p) => p.useRightHolderId === id && p.farmId === `farm_${id}`)).toBe(true);
      expect(w.people[id].role).toBe("farmer");
      expect(w.people[id].farmingSkills.grain).toBe(2);
      expect(w.physical.objects[`grain_seed_initial_${id}`]).toMatchObject({ ownerId: id, quantity: 4 });
    }
    expect(w.initialSeeds).toBe(12);
  });

  it("rejects another farmer's tilling, sowing and harvest even with crop skill", () => {
    const w = newVillageWorld(240924, ownedFarms90V1);
    queueVillageCommand(w, { id: "visit", actorId: "B2", at: 1,
      attempt: { kind: "travel", siteId: "grain_plot_5" } });
    ["till_plot", "sow_plot", "harvest_plot"].forEach((kind, i) => queueVillageCommand(w,
      { id: `foreign-${i}`, actorId: "B2", at: i + 2,
        attempt: { kind: kind as "till_plot" | "sow_plot" | "harvest_plot", plantId: "grain_plot_5" } }));
    advanceVillageWorld(w, 6, idle);
    expect(w.events.filter((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "land use right denied")).toHaveLength(3);
    expect(w.land.plants.grain_plot_5.available).toBe(5);
    expect(w.harvestedFood).toBe(0);
  });

  it("keeps harvested grain beyond shelf life while ordinary wild food still spoils", () => {
    const w = newVillageWorld(240924, ownedFarms90V1);
    queueVillageCommand(w, { id: "own-plot", actorId: "B1", at: 1,
      attempt: { kind: "travel", siteId: "grain_plot_5" } });
    queueVillageCommand(w, { id: "own-harvest", actorId: "B1", at: 2,
      attempt: { kind: "harvest_plot", plantId: "grain_plot_5" } });
    queueVillageCommand(w, { id: "wild-food", actorId: "F", at: 1,
      attempt: { kind: "forage_route", plantId: "herb_patch" } });
    advanceVillageWorld(w, 10 * 24, idle);
    const grainLots = Object.keys(w.foodLots).filter((id) => w.foodLots[id].species === "grain");
    expect(grainLots).toHaveLength(1);
    expect(w.physical.objects[grainLots[0]]).toMatchObject({ quantity: 5, ownerId: "B1" });
    expect(w.events.filter((e) => e.kind === "food_spoiled")).toHaveLength(1);
    expect(w.spoiledFood).toBe(2);
    const saved = captureVillageRecording(w);
    expect(captureVillageRecording(replayVillageRecording(saved)).finalStateHash).toBe(saved.finalStateHash);
  });

  it("replays ninety days of independent food production without employment or wood", () => {
    const recording = JSON.parse(gunzipSync(readFileSync(
      "fixtures/recordings/autonomous-village-owned-farms-90.v2.json.gz")).toString("utf8")) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(recording.rulesetId).toBe("autonomous-village-owned-farms-v8");
    expect(w.spoiledFood).toBe(0);
    expect(w.burnedWood).toBe(0);
    for (const id of ["F", "B1", "B2"] as const) {
      expect(w.people[id].meals).toBe(90);
      for (let day = 1; day <= 90; day++) expect(w.events.some((e) =>
        e.kind === "ate" && e.day === day && e.actors.includes(id))).toBe(true);
      for (const kind of ["plot_tilled", "plot_sown", "crop_harvested"]) {
        const work = w.events.filter((e) => e.kind === kind && e.actors.includes(id));
        expect(work.length).toBeGreaterThan(0);
        expect(work.every((e) => w.land.plants[String(e.data.plantId)].ownerId === id)).toBe(true);
      }
    }
    expect(w.people.S.meals).toBeLessThan(90);
    expect(w.people.C.meals).toBeLessThan(90);
  }, 60000);
});
