import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { breadStorage90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel, VillageAttempt } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand } from "../packages/sim/autonomous-world";
import { replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function harvest() {
  const w = newVillageWorld(240924, breadStorage90V1);
  const act = (attempt: VillageAttempt, hours = 1) => {
    queueVillageCommand(w, { id: `command-${w.hour}`, actorId: "B1", at: w.hour + 1, attempt });
    advanceVillageWorld(w, hours, idle);
  };
  act({ kind: "travel", siteId: "grain_plot_5" });
  act({ kind: "harvest_plot", plantId: "grain_plot_5" }, 2);
  const lotId = Object.keys(w.foodLots).find((id) => w.foodLots[id].species === "grain")!;
  expect(lotId).toBeTruthy();
  return { w, act, lotId };
}
describe("grain storage and perishable bread", () => {
  it("rejects raw grain meals and baking from carried grain, and requires an owned local granary", () => {
    const { w, act, lotId } = harvest();
    act({ kind: "eat" });
    expect(w.people.B1.meals).toBe(0);
    expect(w.eatenFood).toBe(0);
    act({ kind: "bake_bread", lotId });
    act({ kind: "store_grain", lotId, storeId: "granary_home_B1" });
    expect(w.physical.objects[lotId].parentId).toBe("bag_B1");
    act({ kind: "travel", siteId: "market" });
    act({ kind: "store_grain", lotId, storeId: "granary_market_F" });
    expect(w.physical.objects[lotId].parentId).toBe("bag_B1");
    act({ kind: "store_grain", lotId, storeId: "granary_market_B1" });
    expect(w.physical.objects[lotId].parentId).toBe("granary_market_B1");
    expect(w.events.filter((e) => e.kind === "attempt_rejected")).toHaveLength(4);
  });
  it("consumes stored grain atomically after two hours and dates bread expiry from manufacture", () => {
    const { w, act, lotId } = harvest();
    act({ kind: "travel", siteId: "home_B1" });
    act({ kind: "store_grain", lotId, storeId: "granary_home_B1" });
    const quantity = w.physical.objects[lotId].quantity;
    advanceVillageWorld(w, 217 - w.hour, idle);
    expect(w.physical.objects[lotId].quantity).toBe(quantity);
    act({ kind: "bake_bread", lotId });
    expect(w.bakedBread).toBe(0);
    expect(w.physical.objects[lotId].quantity).toBe(quantity);
    advanceVillageWorld(w, 2, idle);
    const breadId = Object.keys(w.foodLots).find((id) => w.foodLots[id].product === "bread")!;
    expect(w.physical.objects[lotId].quantity).toBe(quantity - 1);
    expect(w.foodLots[breadId]).toMatchObject({ product: "bread", harvestedDay: 1, producedDay: 10, originPlantId: "grain_plot_5" });
    expect(w.processedGrain).toBe(1);
    expect(w.bakedBread).toBe(1);
    advanceVillageWorld(w, 288 - w.hour, idle);
    expect(w.physical.objects[breadId]).toBeDefined();
    advanceVillageWorld(w, 1, idle);
    expect(w.physical.objects[breadId]).toBeUndefined();
    expect(w.spoiledFood).toBe(1);
    expect(w.physical.objects[lotId].quantity).toBe(quantity - 1);
  });
  it("replays 90 days with only processed grain meals and every person's daily meal", () => {
    const recording = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-bread-90.v2.json.gz")).toString()) as VillageRecording;
    expect(recording.rulesetId).toBe("autonomous-village-bread-storage-v11");
    const w = replayVillageRecording(recording);
    const meals = w.events.filter((e) => e.kind === "ate");
    expect(meals.filter((e) => e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    expect(w.bakedBread).toBe(275);
    expect(meals.filter((e) => e.data.product === "bread")).toHaveLength(269);
    for (const id of ["S", "F", "C", "B1", "B2"]) for (let day = 1; day <= 90; day++)
      expect(meals.some((e) => e.day === day && e.actors.includes(id))).toBe(true);
    expect(w.events.filter((e) => e.kind === "grain_stored")).toHaveLength(102);
    expect(w.events.filter((e) => e.kind === "attempt_rejected")).toHaveLength(0);
  }, 60000);
});
