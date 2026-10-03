import { describe, expect, it } from "vitest";
import { sleepRegulation90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { advanceVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash } from "../packages/sim/autonomous-world";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";
import { bodilyDiscomfort, villagePersonStatus } from "../packages/sim/village-status";
import { VillageStatusReplay } from "../apps/web/village-status-replay";
import { decodeVillageDocument, encodeVillageDocument } from "../packages/sim/shared-village-json";
import type { VillageRecording } from "../packages/sim/village-recording";
import { checkSleepForecast, observeSleep, predictSleepAction } from "../packages/ai/sleep-forecast";
import { actionObservation } from "../packages/ai/action-learning";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const idle: VillageModel = { decide(i) { return { attempts: [], subjectiveUpdate: i.subjectiveState, wait: { at: i.at + 1 } }; } };
function depleted() {
  const f = structuredClone(sleepRegulation90V1);
  f.sleepRegulation!.initialHistory = [{ from: -1440, to: 0, quality: 0 }];
  f.sleepRegulation!.initialPressure = 900000;
  return f;
}
describe("sleep regulation v20 integration", () => {
  it("saves and resumes settling, actual sleep and an early personal reservation exactly", () => {
    const w = newVillageWorld(240924, depleted());
    queueVillageCommand(w, { id: "sleep", actorId: "S", at: 1, attempt: { kind: "sleep", wakeAtMinute: 135 } });
    advanceVillageWorld(w, 1, idle); expect(w.people.S.sleep!.mode).toBe("settling");
    const settling = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 1, idle); advanceVillageWorld(settling, 1, idle);
    expect(villageHash(settling)).toBe(villageHash(w)); expect(w.people.S.sleep!.mode).toBe("asleep");
    const asleep = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 1, idle); advanceVillageWorld(asleep, 1, idle);
    expect(villageHash(asleep)).toBe(villageHash(w));
    expect(w.events.find((e) => e.kind === "sleep_started")!.data.atMinute).toBe(75);
    expect(w.events.find((e) => e.kind === "sleep_woke")!.data).toMatchObject({ atMinute: 135, sleepMinutes: 60, waitMinutes: 15 });
    expect(w.people.S.sleep!.totalSleepMinutes).toBe(60);
    expect(w.decisions.find((d) => d.actorId === "S" && d.hour === 3)!.stimuli.find((s) => s.experience?.sleep)!.experience)
      .toMatchObject({ elapsedHours: 1.25, sleep: { actualHours: 1, waitHours: .25, endedMinute: 135 } });
    expect(captureVillageRecording(w).rulesetId).toBe("autonomous-village-sleep-regulation-v20");
    const replayed = replayVillageRecording(decodeVillageDocument<VillageRecording>(
      JSON.parse(JSON.stringify(encodeVillageDocument(captureVillageRecording(w)))), true));
    expect(villageHash(replayed)).toBe(villageHash(w));
  });
  it("accepts a wake command while actually sleeping and records only elapsed sleep", () => {
    const w = newVillageWorld(240924, depleted());
    queueVillageCommand(w, { id: "sleep", actorId: "S", at: 1, attempt: { kind: "sleep" } });
    queueVillageCommand(w, { id: "wake", actorId: "S", at: 3, attempt: { kind: "wake_up" } });
    advanceVillageWorld(w, 3, idle);
    expect(w.people.S.sleep!.mode).toBe("awake");
    expect(w.events.find((e) => e.kind === "sleep_interrupted")!.data).toMatchObject({ atMinute: 180, sleepMinutes: 105, reason: "personal wake command" });
  });
  it("separates failed onset from sleeping in status replay and preserves old status inputs", () => {
    const w = newVillageWorld(240924, sleepRegulation90V1);
    queueVillageCommand(w, { id: "sleep", actorId: "S", at: 1, attempt: { kind: "sleep" } });
    advanceVillageWorld(w, 3, idle);
    expect(w.events.some((e) => e.kind === "sleep_unavailable")).toBe(true);
    expect(w.people.S.sleep!.totalSleepMinutes).toBe(0);
    const projection = new VillageStatusReplay(w.fixture);
    w.events.forEach((e) => projection.apply(e));
    expect(projection.statuses.S).toEqual(villagePersonStatus(w, "S"));
    const status = villagePersonStatus(w, "S"); status.body.sleep!.sleepiness = .42;
    expect(bodilyDiscomfort(status.body).sleepiness).toBe(42);
    delete status.body.sleep; status.body.sleepDebt = 12;
    expect(bodilyDiscomfort(status.body).sleepiness).toBe(50);
  });
  it("exposes personal signals and sleep times without private pressure, quality or another person's history", () => {
    const w = newVillageWorld(240924, sleepRegulation90V1);
    advanceVillageWorld(w, 1, idle);
    for (const d of w.decisions) {
      expect(d.knownContext.needs!.sleep).toMatchObject({ minute: 60, deficitHours: 0, mode: "awake" });
      expect(Object.keys(d.knownContext.needs!.sleep!).sort()).toEqual(["actualHours", "awakeHours", "deficitHours", "effectiveHours", "minute", "mode", "ownSleeps", "sleepiness"]);
      expect(d.knownContext.needs!.sleep!.ownSleeps).toEqual([{ from: -360, to: 0 }]);
    }
  });
  it("recomputes every decision, matches sleep outcomes, and replays a resumed ten-day run", () => {
    const w = newVillageWorld(240924, sleepRegulation90V1);
    advanceVillageWorld(w, 120, learningNeedsVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 120, learningNeedsVillageModel); advanceVillageWorld(resumed, 120, learningNeedsVillageModel);
    expect(villageHash(resumed)).toBe(villageHash(w));
    for (const d of w.decisions) expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour,
      knownContext: d.knownContext, subjectiveState: d.subjectiveBefore, stimuli: d.stimuli })).toEqual(d.response);
    const shared = decodeVillageDocument<VillageRecording>(JSON.parse(JSON.stringify(encodeVillageDocument(captureVillageRecording(w)))), true);
    const replayed = replayVillageRecording(shared);
    expect(villageHash(replayed)).toBe(villageHash(w));
    for (const p of Object.values(w.people)) {
      expect(p.memory.anticipation!.sleep!.matched).toBeGreaterThan(0);
      expect(Object.entries(p.memory.anticipation!.sleep!.models).filter(([key]) => key.startsWith("sleep:"))
        .reduce((n, [, model]) => n + model.count, 0)).toBeGreaterThan(0);
      expect(p.sleep!.totalSleepMinutes).toBeGreaterThan(45 * 60);
      expect(p.needs!.sleepDebt).toBe(0);
    }
    expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
    advanceVillageWorld(w, 6, learningNeedsVillageModel); advanceVillageWorld(replayed, 6, learningNeedsVillageModel);
    expect(villageHash(replayed)).toBe(villageHash(w));
  }, 120000);
});

it("updates a frozen personal forecast only against its matching observed outcome", () => {
  const w = newVillageWorld(240924, sleepRegulation90V1); advanceVillageWorld(w, 1, idle);
  const c = structuredClone(w.decisions[0].knownContext);
  const m = observeSleep(c, undefined, [], 1);
  predictSleepAction(c, m, undefined);
  const frozen = structuredClone(m.pending!);
  c.needs!.sleep!.minute = 120; c.needs!.sleep!.sleepiness = .4;
  observeSleep(c, m, [], 2);
  expect(m.matched).toBe(1); expect(m.last!.expected).not.toBe(m.last!.actual);
  expect(m.last!.error).toBeCloseTo(m.last!.actual - m.last!.expected);
  expect(frozen.energy).toBe(w.decisions[0].knownContext.energy);
  predictSleepAction(c, m, { kind: "sleep" }, "sleep-proposal");
  const before = actionObservation(c);
  observeSleep(c, m, [{ id: "replaced", kind: "result", action: "sleep", success: false, occurredAt: 2, receivedAt: 2,
    causeEventIds: [], experience: { predictionId: "sleep-proposal", phase: "superseded", attemptEventId: "command", startedAt: 2,
      elapsedHours: 0, before, after: before } }], 2);
  expect(m.matched).toBe(1); expect(m.excluded).toBe(1); expect(m.pending).toBeUndefined();
  checkSleepForecast(m, 2);
  predictSleepAction(c, m, undefined); c.needs!.sleep!.minute = 240;
  observeSleep(c, m, [], 4); expect(m.matched).toBe(1); expect(m.excluded).toBe(2);
  predictSleepAction(c, m, undefined); m.pending!.pressure = NaN;
  expect(() => checkSleepForecast(m, 4)).toThrow("invalid sleep forecast memory");
});
it("obtains affordable observed food before sleeping when the complete journey is still safe", () => {
  const w = newVillageWorld(240924, sleepRegulation90V1); advanceVillageWorld(w, 1, idle);
  const d = w.decisions.find((v) => v.actorId === "F")!, c = structuredClone(d.knownContext);
  Object.assign(c, { hourOfDay: 13, ownCash: 2, hunger: 1, energy: 26, cold: 0, siteId: "home_F", cell: c.needs!.home.cell,
    visiblePlants: [], ownFoodLots: [], carriedInventory: [], carriedMass: 0, grainCarried: 0, edibleMeals: 0, homeStorage: { cash: 0, freeMass: 40, items: [] },
    visibleFoodOffers: [{ id: "edible", sellerId: "S", species: "grain", product: "bread", quantity: 1, price: 1, expiresDay: 4 }] });
  Object.assign(c.needs!, { sheltered: true, temperature: 32, mealHours: 24, needClockHours: 0 });
  Object.assign(c.needs!.sleep!, { minute: 720, sleepiness: .75, actualHours: 1.5, effectiveHours: 1.5, deficitHours: 4.5,
    ownSleeps: [{ from: 540, to: 630 }] });
  const response = learningNeedsVillageModel.decide({ actorId: "F", at: 12, knownContext: c, subjectiveState: d.subjectiveBefore, stimuli: [] });
  expect(response.attempts[0]).toMatchObject({ kind: "buy_surplus", offerId: "edible" });
});
it("interrupts actual sleep in a cold world without crediting the remaining planned duration", () => {
  const f = depleted(); Object.assign(f.needs!, { dayTemperature: 0, nightTemperature: 0, homeInsulation: 0 });
  const w = newVillageWorld(240924, f);
  queueVillageCommand(w, { id: "sleep", actorId: "S", at: 1, attempt: { kind: "sleep" } });
  advanceVillageWorld(w, 8, idle);
  const event = w.events.find((e) => e.kind === "sleep_interrupted" && e.actors[0] === "S")!;
  expect(event.data.reason).toBe("cold exposure");
  expect(Number(event.data.sleepMinutes)).toBeLessThan(360);
  expect(w.people.S.sleep!.totalSleepMinutes).toBe(event.data.sleepMinutes);
  expect(w.people.S.sleep!.mode).toBe("awake");
  const loaded = JSON.parse(saveVillageWorld(w));
  const corrupted = decodeVillageDocument<import("../packages/sim/autonomous-world").VillageWorld>(loaded);
  corrupted.fixture.sleepRegulation!.requiredMinutes = 0;
  expect(() => loadVillageWorld(JSON.stringify(corrupted))).toThrow("invalid sleep regulation config");
});

it("replays the compact ninety-day recording with conserved money, actual sleep and personal learning", () => {
  const r = decodeVillageDocument<VillageRecording>(JSON.parse(gunzipSync(readFileSync(
    "fixtures/recordings/autonomous-village-sleep-regulation-90.v2.json.gz")).toString()), true);
  const w = replayVillageRecording(r);
  expect(r.rulesetId).toBe("autonomous-village-sleep-regulation-v20");
  expect(Object.values(w.physical.objects).filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0)).toBe(26);
  for (const p of Object.values(w.people)) {
    expect(p.sleep!.totalSleepMinutes / 60).toBeGreaterThan(480);
    expect(p.sleep!.totalSleepMinutes / 60).toBeLessThan(650);
    const finished = w.events.filter((e) => e.actors[0] === p.id && ["sleep_woke", "sleep_interrupted", "sleep_unavailable"].includes(e.kind));
    expect(finished.reduce((n, e) => n + Number(e.data.sleepMinutes), 0) +
      (p.sleep!.mode === "asleep" ? p.sleep!.episodeSleepMinutes : 0)).toBe(p.sleep!.totalSleepMinutes);
    expect(Object.entries(p.memory.anticipation!.sleep!.models).filter(([k]) => k.startsWith("sleep:"))
      .reduce((n, [, model]) => n + model.count, 0)).toBeGreaterThan(50);
  }
  expect(w.events.some((e) => ["sleep_interrupted", "sleep_unavailable", "process_failed"].includes(e.kind))).toBe(false);
  expect(w.events.filter((e) => e.kind === "ate" && e.data.species === "grain").every((e) => e.data.product === "bread")).toBe(true);
}, 240000);
