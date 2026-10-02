import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeStorage90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageId, VillageModel } from "../packages/ai/autonomous-world";
import { trackedNeedsVillageModel } from "../packages/ai/tracked-needs";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand, loadVillageWorld, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { villagePersonStatus, bodilyDiscomfort } from "../packages/sim/village-status";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function setup(capacity = 40, baker = false) {
  const fixture = structuredClone(homeStorage90V1);
  fixture.homeStorage!.capacity = capacity;
  if (baker) fixture.foodMarket!.initialBakingSkills.B1 = 1;
  const w = newVillageWorld(240924, fixture);
  const act = (id: VillageId, attempt: VillageAttempt) => {
    queueVillageCommand(w, { id: `${id}:${w.hour}`, actorId: id, at: w.hour + 1, attempt });
    advanceVillageWorld(w, 1, idle);
    let remaining = 24;
    while (w.people[id].activeProcessId && remaining-- > 0) advanceVillageWorld(w, 1, idle);
    expect(w.people[id].activeProcessId).toBeUndefined();
  };
  return { w, act };
}
describe("home storage and physical status v15", () => {
  it("stores and retrieves real coins only at the owner's home, preserving cash across a save and replay", () => {
    const { w, act } = setup();
    act("S", { kind: "store_home_cash", quantity: 12 });
    expect(villagePersonStatus(w, "S").carried.cash).toBe(20);
    act("S", { kind: "travel", siteId: "home_S" });
    act("S", { kind: "store_home_cash", quantity: 12 });
    expect(villagePersonStatus(w, "S")).toMatchObject({ carried: { cash: 8 }, home: { cash: 12 } });
    act("S", { kind: "take_home_cash", quantity: 5 });
    expect(villagePersonStatus(w, "S")).toMatchObject({ carried: { cash: 13 }, home: { cash: 7 } });
    act("S", { kind: "take_home_cash", quantity: 8 });
    expect(villagePersonStatus(w, "S").home.cash).toBe(7);
    act("B1", { kind: "take_home_cash", quantity: 1 });
    expect(villagePersonStatus(w, "B1").carried.cash).toBe(0);
    expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency")).toHaveLength(26);
    expect(villageHash(loadVillageWorld(saveVillageWorld(w)))).toBe(villageHash(w));
    const damaged = JSON.parse(saveVillageWorld(w));
    delete damaged.physical.objects.home_chest_B1;
    expect(() => loadVillageWorld(JSON.stringify(damaged))).toThrow("invalid home chest");
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  });
  it("splits owned ingredients without duplicating them and refuses overflow or another person's property", () => {
    const { w, act } = setup(1);
    act("B1", { kind: "travel", siteId: "grain_plot_5" });
    act("B1", { kind: "harvest_plot", plantId: "grain_plot_5" });
    const lotId = Object.keys(w.foodLots)[0];
    act("B1", { kind: "travel", siteId: "home_B1" });
    const before = w.physical.objects[lotId].quantity;
    act("B1", { kind: "store_home", objectId: lotId, quantity: 2 });
    expect(w.physical.objects[lotId].quantity).toBe(before);
    expect(villagePersonStatus(w, "B1").home.items).toHaveLength(0);
    act("B1", { kind: "store_home", objectId: lotId, quantity: 1 });
    const stored = villagePersonStatus(w, "B1").home.items[0];
    expect(stored).toMatchObject({ quantity: 1, mass: 1, ownerId: "B1", kind: "grain" });
    expect(w.foodLots[stored.id]).toEqual(w.foodLots[lotId]);
    act("B2", { kind: "take_home", objectId: stored.id, quantity: 1 });
    expect(w.physical.objects[stored.id].parentId).toBe("home_chest_B1");
    act("B1", { kind: "take_home", objectId: stored.id, quantity: 1 });
    expect(villagePersonStatus(w, "B1").home.items).toHaveLength(0);
    expect(villagePersonStatus(w, "B1").carried.items.filter((o) => o.kind === "grain").reduce((n, o) => n + o.quantity, 0)).toBe(before);
    act("B1", { kind: "eat" }); expect(w.people.B1.meals).toBe(0);
    act("B1", { kind: "store_grain", lotId, storeId: "granary_home_B1" });
    act("B1", { kind: "take_home", objectId: lotId, quantity: 1 });
    expect(w.events.filter((e) => e.kind === "home_item_taken").at(-1)!.data.storeId).toBe("granary_home_B1");
  });
  it("keeps manufactured bread expiry when deposited at home", () => {
    const { w, act } = setup(40, true);
    act("B1", { kind: "travel", siteId: "grain_plot_5" });
    act("B1", { kind: "harvest_plot", plantId: "grain_plot_5" });
    const grainId = Object.keys(w.foodLots)[0];
    act("B1", { kind: "travel", siteId: "market" });
    act("B1", { kind: "store_grain", lotId: grainId, storeId: "granary_market_B1" });
    act("B1", { kind: "bake_bread", lotId: grainId });
    const breadId = Object.keys(w.foodLots).find((id) => w.foodLots[id].product === "bread")!;
    act("B1", { kind: "travel", siteId: "home_B1" });
    act("B1", { kind: "store_home", objectId: breadId, quantity: 1 });
    const expiry = w.foodLots[breadId].producedDay! + w.fixture.breadEconomy!.shelfLifeDays;
    expect(villagePersonStatus(w, "B1").home.items[0]).toMatchObject({ kind: "bread", expiresDay: expiry });
    const expiresAt = (expiry - 1) * 24 + 1;
    advanceVillageWorld(w, expiresAt - 1 - w.hour, idle);
    expect(w.physical.objects[breadId]).toBeDefined();
    advanceVillageWorld(w, 1, idle);
    expect(villagePersonStatus(w, "B1").home.items).toHaveLength(0);
    expect(w.events.some((e) => e.kind === "food_spoiled" && e.data.lotId === breadId && e.data.siteId === "home_B1")).toBe(true);
  });
  it("records actual end-of-hour bodies and possessions, keeping home food perishable and resume deterministic", () => {
    const w = newVillageWorld(240924, homeStorage90V1);
    advanceVillageWorld(w, 5 * 24, trackedNeedsVillageModel);
    const restored = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 5 * 24, trackedNeedsVillageModel);
    advanceVillageWorld(restored, 5 * 24, trackedNeedsVillageModel);
    expect(villageHash(restored)).toBe(villageHash(w));
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      const recorded = JSON.parse(String(w.events.filter((e) => e.kind === "person_status" && e.actors[0] === id).at(-1)!.data.status));
      expect(recorded).toEqual(villagePersonStatus(w, id));
      const needs = bodilyDiscomfort(recorded.body);
      expect(needs.comfort + needs.discomfort).toBe(100);
    }
    expect(w.events.some((e) => e.kind === "home_cash_stored")).toBe(true);
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  }, 120000);
  it("replays the 90-day archive with real home transfers and exact final status", () => {
    const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-home-storage-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(r);
    expect(r.rulesetId).toBe("autonomous-village-home-storage-v15");
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      const recorded = JSON.parse(String(r.events.filter((e) => e.kind === "person_status" && e.actors[0] === id).at(-1)!.data.status));
      expect(recorded).toEqual(villagePersonStatus(w, id));
    }
    expect(w.events.some((e) => e.kind === "home_cash_stored")).toBe(true);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
  }, 240000);
});
