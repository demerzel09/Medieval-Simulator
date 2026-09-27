import { describe, expect, it } from "vitest";
import { landEconomy90V1 } from "../fixtures/land-economy-90";
import { landEconomyVillageModel } from "../packages/ai/farming-skill";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld,
  queueVillageCommand, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";

const fixture = () => structuredClone(landEconomy90V1.world);
const eventCount = (w: ReturnType<typeof newVillageWorld>, kind: string, from = 1) =>
  w.events.filter((e) => e.kind === kind && e.day >= from).length;

describe("land economy in the five-person world", () => {
  it("moves crop food through real farmer, carrier, market and meals with local rights", () => {
    const w = newVillageWorld(240924, fixture());
    advanceVillageWorld(w, 7 * 24, landEconomyVillageModel);
    expect(eventCount(w, "plot_sown")).toBe(7);
    expect(eventCount(w, "crop_harvested")).toBe(4);
    expect(eventCount(w, "food_tendered")).toBe(7);
    expect(eventCount(w, "food_delivered")).toBe(7);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain")).toHaveLength(20);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "wild_berry")).toHaveLength(15);
    expect(w.events.filter((e) => e.kind === "food_sold" && e.data.originPlantId)).toHaveLength(21);
    expect(w.resources.food.available).toBe(5);
    expect(w.harvestedLandFood).toBe(20);
    for (const id of ["S", "F", "C", "B1", "B2"] as const)
      expect(w.people[id]).toMatchObject({ meals: 7, hunger: 0, fuelUsed: 7, cold: 0 });
    expect(w.events.filter((e) => e.kind === "attempt_rejected" || e.kind === "process_failed"))
      .toHaveLength(0);
    checkVillageWorld(w);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
    const mid = newVillageWorld(240924, fixture());
    advanceVillageWorld(mid, 82, landEconomyVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(mid));
    advanceVillageWorld(resumed, 7 * 24 - 82, landEconomyVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
  }, 30000);

  it("sustains crop-based meals and real trade through day 90", () => {
    const w = newVillageWorld(240924, fixture());
    advanceVillageWorld(w, 90 * 24, landEconomyVillageModel);
    expect([w.harvestedFood, w.harvestedLandFood, w.eatenFood, w.spoiledFood])
      .toEqual([450, 435, 450, 0]);
    expect([w.resources.food.available, w.harvestedWood, w.burnedWood]).toEqual([5, 450, 450]);
    expect(eventCount(w, "crop_harvested")).toBe(87);
    expect(eventCount(w, "food_delivered")).toBe(90);
    expect(eventCount(w, "food_sold")).toBe(270);
    expect(w.events.filter((e) => e.kind === "ate" && e.day >= 61 && e.data.species === "grain"))
      .toHaveLength(150);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      expect(w.people[id]).toMatchObject({ meals: 90, fuelUsed: 90, hunger: 0, cold: 0 });
      for (let day = 1; day <= 90; day++)
        expect(w.events.filter((e) => e.kind === "ate" && e.day === day && e.actors.includes(id)))
          .toHaveLength(1);
    }
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency")).toHaveLength(26);
    checkVillageWorld(w);
  }, 30000);

  it("rejects remote, unskilled and unlicensed crop work", () => {
    const w = newVillageWorld(24, fixture());
    queueVillageCommand(w, { id: "remote", actorId: "F", at: 1,
      attempt: { kind: "till_plot", plantId: "grain_plot" } });
    queueVillageCommand(w, { id: "b-travel", actorId: "B1", at: 1,
      attempt: { kind: "travel", siteId: "field" } });
    advanceVillageWorld(w, 2, landEconomyVillageModel);
    w.people.B1.farmingSkills.grain = 2;
    queueVillageCommand(w, { id: "b-till", actorId: "B1", at: 3,
      attempt: { kind: "till_plot", plantId: "grain_plot" } });
    advanceVillageWorld(w, 1, landEconomyVillageModel);
    expect(w.events.filter((e) => e.kind === "attempt_rejected").map((e) => e.data.reason))
      .toEqual(["plant worksite unavailable", "land use right denied"]);
    const noSkill = newVillageWorld(25, { ...fixture(), landEconomy: {
      ...fixture().landEconomy!, farmerGrainSkill: 0 } });
    queueVillageCommand(noSkill, { id: "travel", actorId: "F", at: 1,
      attempt: { kind: "travel", siteId: "field" } });
    queueVillageCommand(noSkill, { id: "till", actorId: "F", at: 2,
      attempt: { kind: "till_plot", plantId: "grain_plot" } });
    advanceVillageWorld(noSkill, 2, landEconomyVillageModel);
    expect(noSkill.events.some((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "crop skill denied")).toBe(true);
  });
});
