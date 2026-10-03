import { expect, it } from "vitest";
import { energyEffort90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageContext, VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { auditVillageFoodRecording, inspectVillageFoodAccess, inspectVillageFoodSupply } from "../packages/sim/village-food-audit";
import { captureVillageRecording } from "../packages/sim/village-recording";

const contexts: Record<string, VillageContext> = {};
const idle: VillageModel = { decide(input) {
  contexts[input.actorId] = input.knownContext;
  return { attempts: [], subjectiveUpdate: input.subjectiveState, wait: { at: input.at + 1 } };
} };
function command(w: VillageWorld, attempt: VillageAttempt) {
  queueVillageCommand(w, { id: `probe-${w.hour}`, actorId: "F", at: w.hour + 1, attempt });
  advanceVillageWorld(w, 1, idle);
  while (w.people.F.activeProcessId) advanceVillageWorld(w, 1, idle);
}

it("does not treat growing plants, leftover unripe fruit or unprocessed bulk grain as ready food", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  for (const p of Object.values(w.land.plants)) if (p.species !== "grain") p.stage = "regrowing";
  const supply = inspectVillageFoodSupply(w);
  expect(supply.readyNutrition).toBe(0);
  expect(supply.rawGrain.storedQuantity).toBe(12);
  expect(supply.rawGrain.ripeCropQuantity).toBeGreaterThan(0);
});

it("distinguishes a real harvested edible meal from other owners' unoffered inventories without changing the world", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  command(w, { kind: "travel", siteId: "berry_patch_1" });
  command(w, { kind: "gather_plant", plantId: "wild_berry", quantity: 2 });
  advanceVillageWorld(w, 1, idle);
  const before = villageHash(w), supply = inspectVillageFoodSupply(w);
  expect(supply.edible.find((l) => l.ownerId === "F")?.nutrition).toBe(48);
  expect(inspectVillageFoodAccess(w, "F", contexts.F!, supply).ownReadyNutrition).toBe(48);
  const carrier = inspectVillageFoodAccess(w, "C", contexts.C!, supply);
  expect(carrier.ownReadyNutrition).toBe(0);
  expect(carrier.offers).toEqual([]);
  expect(villageHash(w)).toBe(before);
  command(w, { kind: "eat" });
  expect(w.events.some((e) => e.kind === "ate" && e.actors[0] === "F")).toBe(true);
  expect(w.people.F.effort!.digestion.length).toBe(1);
});

it("keeps supply, path access and current capacity separate", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  advanceVillageWorld(w, 1, idle);
  const c = structuredClone(contexts.F!);
  c.energy = 0;
  const weak = inspectVillageFoodAccess(w, "F", c);
  expect(weak.plants.length).toBeGreaterThan(0);
  expect(weak.plants.every((p) => !p.initialCapacityCoversWork)).toBe(true);
  const target = w.land.plants.orchard.cell;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy)
    w.grid.blocked.push(`${target.x + dx},${target.y + dy}`);
  const blocked = inspectVillageFoodAccess(w, "F", contexts.F!);
  expect(blocked.plants.find((p) => p.id === "orchard")!.travelHours).toBeNull();
  expect(inspectVillageFoodSupply(w).plants.some((p) => p.id === "orchard")).toBe(true);
});

it("detects depletion despite remaining food and rejects a recording with different decision evidence", () => {
  const w = newVillageWorld(240924, energyEffort90V1);
  advanceVillageWorld(w, 72, idle);
  const r = captureVillageRecording(w), original = villageHash(w), report = auditVillageFoodRecording(r);
  expect(report.eventPrefixMatched).toBe(true);
  expect(report.noReadyFoodHours).toBe(0);
  expect(report.people.F.depletedDecisions).toBeGreaterThan(0);
  expect(report.people.F.readyFoodExists).toBe(report.people.F.depletedDecisions);
  expect(report.people.F.firstEmpty!.access.ownReadyNutrition).toBe(0);
  expect(report.people.F.firstEmpty!.access.plants.every((p) => !p.initialCapacityCoversWork)).toBe(true);
  expect(villageHash(w)).toBe(original);
  r.decisions[0].knownContext.ownCash++;
  expect(() => auditVillageFoodRecording(r)).toThrow(/replay diverged/);
}, 30000);

it("separately reports depletion during a genuine gap in ready food, even when raw grain exists", () => {
  const initial = structuredClone(newVillageWorld(240924, energyEffort90V1).initialLand);
  for (const plant of Object.values(initial.plants)) if (plant.species !== "grain") {
    plant.stage = "regrowing"; plant.ageHours = 0;
  }
  const w = newVillageWorld(240924, energyEffort90V1, undefined, initial);
  advanceVillageWorld(w, 66, idle);
  const report = auditVillageFoodRecording(captureVillageRecording(w));
  expect(report.noReadyFoodHours).toBe(66);
  expect(report.people.F.depletedDecisions).toBeGreaterThan(0);
  expect(report.people.F.noReadyFood).toBe(report.people.F.depletedDecisions);
  expect(report.people.F.readyFoodExists).toBe(0);
  expect(report.people.F.firstEmpty!.supply.rawGrain.storedQuantity).toBe(12);
}, 30000);
