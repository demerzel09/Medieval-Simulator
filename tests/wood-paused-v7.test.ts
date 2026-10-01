import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { woodPausedLandEconomy90V1 } from "../fixtures/land-economy-wide";
import { ecologicalLandEconomyVillageModel } from "../packages/ai/farming-skill";
import { advanceVillageWorld, newVillageWorld, queueVillageCommand } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";

describe("wood suspension", () => {
  it("rejects wood commands at the world gateway and removes supply and fuel demand", () => {
    const w = newVillageWorld(240924, woodPausedLandEconomy90V1);
    const attempts = [{ kind: "post_wood_bid", price: 4 },
      { kind: "forage", resource: "wood", quantity: 1 },
      { kind: "sell_wood", buyerId: "S" }, { kind: "burn_wood" }] as const;
    attempts.forEach((attempt, index) => queueVillageCommand(w, {
      id: `wood-${index}`, actorId: "B1", at: index + 1, attempt,
    }));
    advanceVillageWorld(w, 48, ecologicalLandEconomyVillageModel);
    expect(w.physical.objects.wood_patch).toBeUndefined();
    expect(w.resources.wood).toMatchObject({ available: 0, initial: 0, grown: 0, reserved: 0 });
    expect(w.events.filter((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "wood feature paused")).toHaveLength(4);
    for (const p of Object.values(w.people)) expect(p.cold).toBe(0);
    const saved = captureVillageRecording(w);
    expect(saved.rulesetId).toBe("autonomous-village-wood-paused-v7");
    expect(captureVillageRecording(replayVillageRecording(saved)).finalStateHash).toBe(saved.finalStateHash);
  });

  it("replays the ninety-day control without disguising the loss of income", () => {
    const recording = JSON.parse(gunzipSync(readFileSync(
      "fixtures/recordings/autonomous-village-wood-paused-90.v2.json.gz")).toString("utf8")) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(w.harvestedWood).toBe(0);
    expect(w.burnedWood).toBe(0);
    expect(Object.keys(w.woodBids)).toHaveLength(0);
    expect(w.events.some((e) => e.kind === "wood_sold" || e.kind === "wood_burned" ||
      e.kind === "resource_grew" && e.data.kind === "wood")).toBe(false);
    expect(w.events.some((e) => e.kind === "travel_step" &&
      e.actors.some((id) => id === "B1" || id === "B2"))).toBe(false);
    expect(w.people.B1.meals).toBe(0);
    expect(w.people.B2.meals).toBe(0);
    expect(w.people.F.meals).toBeLessThan(90);
    expect(w.initialMoney).toBe(26);
    expect(recording.decisions.some((d) => d.chosen?.kind === "forage" &&
      d.chosen.resource === "wood" || ["post_wood_bid", "sell_wood", "burn_wood"].includes(d.chosen?.kind ?? "")))
      .toBe(false);
  }, 60000);
});
