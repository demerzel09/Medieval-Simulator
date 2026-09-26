import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { ordinaryFarmerModel, type FarmerModel } from "../packages/ai/local-farmer";
import { advanceLocalV2, loadLocalA2, localV2Summary, newLocalWorldA2, replayLocalA2, saveLocalA2, submitLocalV2 } from "../packages/sim/local-economy-v2";

describe("A2 farmer-led food production", () => {
  it("requires each rostered farmer to accept, harvest, and finish a shift", () => {
    const w = newLocalWorldA2();
    advanceLocalV2(w, 4320);
    expect(localV2Summary(w).producedFood).toBe(60);
    expect(localV2Summary(w).consumedFood).toBe(60);
    expect(w.events.filter((event) => event.kind === "farmer_decided" && event.data.action === "start_shift")).toHaveLength(20);
    expect(w.events.filter((event) => event.kind === "farmer_decided" && event.data.action === "harvest,return_home")).toHaveLength(20);
    expect(w.events.filter((event) => event.kind === "farmer_decided" && event.data.action === "finish_shift")).toHaveLength(20);
    for (const crop of w.events.filter((event) => event.kind === "food_produced"))
      expect(crop.causes.some((id) => w.events.some((event) => event.id === id && event.kind === "farmer_decided" && event.data.action === "harvest,return_home"))).toBe(true);
  });

  it("does not invent work or crops when the farmer model declines", () => {
    const passive: FarmerModel = { decide(input) { return { attempts: [], wait: { at: input.knownContext.nextDayWorkAt } }; } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 1440, undefined, undefined, passive);
    expect(w.tasks.filter((task) => task.capability === "work_shift")).toHaveLength(0);
    expect(w.producedFood).toBe(0);
    expect(localV2Summary(w).settledOrders).toBe(0);
    expect(localV2Summary(w).hungryPeople).toBe(20);
  });

  it("does not harvest merely because a shift was accepted", () => {
    const idleAtHarvest: FarmerModel = { decide(input) {
      if (input.at === input.knownContext.harvestAt)
        return { attempts: [], wait: { at: input.knownContext.nextDayWorkAt } };
      return ordinaryFarmerModel.decide(input);
    } };
    const w = newLocalWorldA2();
    advanceLocalV2(w, 720, undefined, undefined, idleAtHarvest);
    expect(w.tasks.filter((task) => task.capability === "work_shift" && task.status === "accepted")).toHaveLength(7);
    expect(w.producedFood).toBe(0);
    expect(w.events.filter((event) => event.kind === "food_produced")).toHaveLength(0);
  });

  it("loses the absent farmer's actual harvest without replacing the person", () => {
    const w = newLocalWorldA2();
    expect(submitLocalV2(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 })).toBe(true);
    advanceLocalV2(w, 2880);
    expect(w.producedFood).toBe(39);
    expect(w.events.some((event) => event.kind === "food_produced" && event.actors.includes("F6") && event.minute >= 1440)).toBe(false);
    expect(w.shipments[1].quantity).toBe(18);
  });

  it("blocks harvest when a present farmer lacks energy", () => {
    const w = newLocalWorldA2();
    w.people.F0.energy = 7;
    advanceLocalV2(w, 720);
    expect(w.producedFood).toBe(18);
    expect(w.events.some((event) => event.kind === "work_blocked" && event.actors.includes("F0") && event.data.work === "farm_shift")).toBe(true);
    expect(w.events.some((event) => event.kind === "food_produced" && event.actors.includes("F0"))).toBe(false);
  });

  it("restores farmer intent and reproduces its causal events", () => {
    const w = newLocalWorldA2(114);
    advanceLocalV2(w, 600);
    const resumed = loadLocalA2(saveLocalA2(w));
    advanceLocalV2(w, 840); advanceLocalV2(resumed, 840);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayLocalA2(114, w.commands, 1440))).toBe(hash(w));
    expect(() => loadLocalA2(JSON.stringify({ ...w, farmerActors: undefined }))).toThrow();
    expect(() => loadLocalA2(JSON.stringify({ ...w, engineVersion: "0.5.1-a2" }))).toThrow("incompatible");
  });
});
