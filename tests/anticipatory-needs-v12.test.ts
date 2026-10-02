import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { anticipatoryNeeds90V1 } from "../fixtures/land-economy-wide";
import { anticipatoryNeedsVillageModel, forecastCold, updateEstimate, type AnticipationMemory } from "../packages/ai/anticipatory-needs";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { advanceNeedsBody, needsTemperature } from "../packages/sim/needs-body";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording, type VillageRecording } from "../packages/sim/village-recording";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
const empty = (): AnticipationMemory => ({ experiences: [], coldRates: {}, temperatures: {}, sleepRecovery: {}, travelTimes: {},
  sales: { visits: 0, sales: 0, failures: 0, retryAt: 0 } });
function input() {
  const w = newVillageWorld(240924, anticipatoryNeeds90V1);
  advanceVillageWorld(w, 1, idle);
  const d = w.decisions.find((d) => d.actorId === "B1")!;
  const context = structuredClone(d.knownContext);
  context.siteId = "grain_plot_5"; context.cell = w.grid.sites.grain_plot_5;
  context.edibleMeals = 2; context.ownFood = 2; context.grainStores![0].grain = 12;
  context.cold = 0; context.energy = 24; context.needs!.sleepDebt = 4;
  context.needs!.sheltered = false; context.needs!.temperature = 14;
  return { actorId: "B1", at: 18, stimuli: [], subjectiveState: structuredClone(d.subjectiveBefore), knownContext: context };
}

describe("anticipation and physical needs", () => {
  it("applies local temperature, distinguishes activity recovery from sleep, and counts hunger by elapsed hours", () => {
    const cfg = anticipatoryNeeds90V1.needs!;
    expect(needsTemperature(4, cfg, false)).toBe(8);
    expect(needsTemperature(16, cfg, false)).toBe(22);
    expect(needsTemperature(4, cfg, true)).toBe(18);
    const resting = { sleepDebt: 16, mealHours: 23, exposureHours: 0, sleptHours: 0 };
    const r = advanceNeedsBody(resting, 0, 10, 26, 18, 16, "rest", true);
    expect(r).toMatchObject({ energy: 12, mealDue: true });
    expect(resting).toMatchObject({ sleepDebt: 17, mealHours: 0, sleptHours: 0 });
    const sleeping = { ...resting };
    advanceNeedsBody(sleeping, 0, 10, 26, 18, 16, "sleep", true);
    expect(sleeping.sleepDebt).toBe(15);
    expect(sleeping.sleptHours).toBe(1);
    const outdoor = { ...resting };
    expect(advanceNeedsBody(outdoor, 7, 10, 26, 8, 16, "sleep", false)).toMatchObject({ cold: 9, energy: 10 });
    expect(outdoor.sleepDebt).toBe(16);
    expect(outdoor.exposureHours).toBe(1);
    const sleepDeprived = { sleepDebt: 28, mealHours: 3, exposureHours: 0, sleptHours: 0 };
    const fatigued = advanceNeedsBody(sleepDeprived, 0, 10, 26, 22, 16, undefined, false);
    expect(fatigued.energy).toBe(9);
    expect(sleepDeprived.sleepDebt).toBe(29);
  });
  it("chooses prevention before discomfort using learned experience, with no access to world forecasts", () => {
    const experienced = input(), calm = input();
    experienced.knownContext.needs!.temperature = 20; calm.knownContext.needs!.temperature = 20;
    experienced.subjectiveState.anticipation = empty(); calm.subjectiveState.anticipation = empty();
    for (const key of ["outside:day", "outside:night"]) {
      experienced.subjectiveState.anticipation.coldRates[key] = { count: 8, mean: 2, m2: 0 };
      calm.subjectiveState.anticipation.coldRates[key] = { count: 8, mean: 0, m2: 0 };
    }
    const risk = anticipatoryNeedsVillageModel.decide(experienced);
    const safe = anticipatoryNeedsVillageModel.decide(calm);
    expect(experienced.knownContext.cold).toBe(0);
    expect(risk.attempts).toEqual([{ kind: "travel", siteId: "home_B1" }]);
    expect(safe.attempts).toEqual([]);
    expect(risk.subjectiveUpdate!.anticipation!.reasoning!.forecastCold).toBeGreaterThan(8);
    expect(experienced.subjectiveState.anticipation.goal).toBeUndefined(); // input remains immutable
  });
  it("uses travel experience and allows safe outdoor sleep when home is far away", () => {
    const i = input(); i.knownContext.needs!.sleepDebt = 18; i.knownContext.needs!.temperature = 24;
    i.subjectiveState.anticipation = empty();
    const m = i.subjectiveState.anticipation;
    m.travelTimes["grain_plot_5>home_B1"] = { count: 4, mean: 5, m2: 0 };
    for (const key of ["outside:day", "outside:night"]) m.coldRates[key] = { count: 8, mean: 0, m2: 0 };
    expect(anticipatoryNeedsVillageModel.decide(i).attempts).toEqual([{ kind: "sleep" }]);
  });
  it("forecasts the exposure of leaving a warm house rather than assuming the current shelter continues", () => {
    const i = input(); i.at = 20; i.knownContext.siteId = "home_B1";
    i.knownContext.needs!.sheltered = true; i.knownContext.needs!.temperature = 18;
    i.knownContext.grainStores![0].grain = 0;
    i.subjectiveState.anticipation = empty();
    const out = anticipatoryNeedsVillageModel.decide(i);
    expect(out.attempts).toEqual([]);
    expect(out.subjectiveUpdate!.anticipation!.reasoning!.reason).toContain("defer exposed trip");
    const warm = structuredClone(i);
    for (let hour = 0; hour < 24; hour++) warm.subjectiveState.anticipation!.temperatures[String(hour)] =
      { count: 4, mean: 24, m2: 0 };
    for (const key of ["outside:night", "outside:day"]) warm.subjectiveState.anticipation!.coldRates[key] =
      { count: 4, mean: 0, m2: 0 };
    expect(anticipatoryNeedsVillageModel.decide(warm).attempts[0]?.kind).toBe("travel");
  });
  it("learns actual outcomes and positive recovery, and keeps prediction evidence bounded", () => {
    const i = input(); i.at = 12; i.knownContext.siteId = "home_B1";
    i.knownContext.needs!.sheltered = true; i.knownContext.needs!.sleepDebt = 4;
    i.subjectiveState.anticipation = empty();
    i.subjectiveState.anticipation.last = { at: 4, site: "home_B1", cold: 8, energy: 8,
      debt: 20, sheltered: true, phase: "night", temperature: 18 };
    i.subjectiveState.anticipation.lastAction = "sleep";
    const out = anticipatoryNeedsVillageModel.decide(i).subjectiveUpdate!.anticipation!;
    expect(out.sleepRecovery.inside).toMatchObject({ count: 1, mean: 2 });
    expect(out.experiences[0]).toMatchObject({ action: "sleep", salience: 16 });
    const cold = empty(); cold.coldRates["outside:night"] = updateEstimate(undefined, 2);
    const before = forecastCold(cold, 0, 20, 4, false).peak;
    for (let n = 0; n < 8; n++) cold.coldRates["outside:night"] = updateEstimate(cold.coldRates["outside:night"], 0);
    expect(forecastCold(cold, 0, 20, 4, false).peak).toBeLessThan(before);
  });
  it("preserves partial sleep across save/reload and interruption, and rejects another person's home", () => {
    const w = newVillageWorld(240924, anticipatoryNeeds90V1);
    queueVillageCommand(w, { id: "sleep", actorId: "B1", at: 1, attempt: { kind: "sleep" } });
    queueVillageCommand(w, { id: "wake", actorId: "B1", at: 4, attempt: { kind: "wake_up" } });
    advanceVillageWorld(w, 3, idle);
    expect(w.people.B1.needs!.sleptHours).toBe(2);
    const restored = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 1, idle); advanceVillageWorld(restored, 1, idle);
    expect(villageHash(restored)).toBe(villageHash(w));
    expect(w.events.some((e) => e.kind === "sleep_interrupted")).toBe(true);
    expect(w.people.B1.needs!.sleptHours).toBe(3);
    expect(w.people.B1.activeProcessId).toBeUndefined();
    queueVillageCommand(w, { id: "to-other", actorId: "B1", at: 5, attempt: { kind: "travel", siteId: "home_B2" } });
    advanceVillageWorld(w, 2, idle);
    queueVillageCommand(w, { id: "other-sleep", actorId: "B1", at: 7, attempt: { kind: "sleep" } });
    advanceVillageWorld(w, 1, idle);
    expect(w.events.some((e) => e.kind === "attempt_rejected" && e.data.reason === "sleep place unavailable")).toBe(true);
  });
  it("integrates local work and needs with deterministic recording, bounded reserves and no raw grain meals", () => {
    const w = newVillageWorld(240924, anticipatoryNeeds90V1);
    advanceVillageWorld(w, 10 * 24, anticipatoryNeedsVillageModel);
    const replay = replayVillageRecording(captureVillageRecording(w));
    expect(villageHash(replay)).toBe(villageHash(w));
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      expect(w.people[id].meals).toBe(10);
      expect(w.people[id].needs!.sleptHours).toBeGreaterThan(0);
      expect(w.people[id].memory.anticipation!.experiences.length).toBeLessThanOrEqual(24);
    }
    expect(w.events.some((e) => e.kind === "slept")).toBe(true);
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
  }, 120000);
  it("replays the 90-day archive and checks daily meals, real sleep and bounded grain reserves", () => {
    const recording = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-needs-90.v2.json.gz")).toString()) as VillageRecording;
    const w = replayVillageRecording(recording);
    expect(recording.rulesetId).toBe("autonomous-village-anticipatory-needs-v12");
    const meals = w.events.filter((e) => e.kind === "ate");
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      for (let day = 1; day <= 90; day++) expect(meals.some((e) => e.day === day && e.actors.includes(id))).toBe(true);
      expect(w.people[id].needs!.sleptHours).toBeGreaterThan(0);
      expect(w.people[id].memory.anticipation!.sleepRecovery.inside.count).toBeGreaterThan(0);
    }
    for (const id of ["F", "B1", "B2"]) {
      const raw = Object.entries(w.foodLots).reduce((n, [lotId, lot]) => n +
        (lot.species === "grain" && lot.product !== "bread" && w.physical.objects[lotId].ownerId === id ?
          w.physical.objects[lotId].quantity : 0), 0);
      expect(raw).toBeLessThanOrEqual(16);
    }
    expect(meals.filter((e) => e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    expect(w.events.some((e) => e.kind === "attempt_rejected")).toBe(false);
  }, 240000);

});
