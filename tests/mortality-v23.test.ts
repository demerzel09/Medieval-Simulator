import { expect, it } from "vitest";
import { mortality90V1 } from "../fixtures/land-economy-wide";
import type { VillageAttempt, VillageModel } from "../packages/ai/autonomous-world";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld, queueVillageCommand, saveVillageWorld, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { ingestEffort } from "../packages/sim/effort-body";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";
import { villagePersonStatus } from "../packages/sim/village-status";
import { VillageStatusReplay } from "../apps/web/village-status-replay";

const idle: VillageModel = { decide(i) { return { attempts: [], wait: { at: i.at + 1 }, subjectiveUpdate: i.subjectiveState }; } };
function action(w: VillageWorld, attempt: VillageAttempt) {
  queueVillageCommand(w, { id: `test-${w.hour}`, actorId: "F", at: w.hour + 1, attempt });
  advanceVillageWorld(w, 1, idle);
  while (w.people.F.activeProcessId) advanceVillageWorld(w, 1, idle);
}
function deplete(w: VillageWorld, id: "F" | "B1") {
  const b = w.people[id].effort!;
  b.consumed += b.reserve - 125; b.reserve = 125;
}

it("marks an initially exhausted person dead before any decision or recovery", () => {
  const fixture = structuredClone(mortality90V1); fixture.body.initialEnergy = 0;
  const w = newVillageWorld(240924, fixture);
  expect(Object.values(w.people).every((p) => p.death?.atMinute === 0)).toBe(true);
  advanceVillageWorld(w, 1, idle);
  expect(w.decisions).toHaveLength(0); expect(w.events.filter((e) => e.kind === "person_died")).toHaveLength(5);
  checkVillageWorld(w);
});

it("dies at the actual quarter, freezes the body and preserves ownership despite pending digestion", () => {
  const fixture = structuredClone(mortality90V1);
  fixture.effortBody!.initialReserve = 500; fixture.body.initialEnergy = fixture.body.maxEnergy;
  const w = newVillageWorld(240924, fixture);
  ingestEffort(w.people.F.effort!, fixture.effortBody!, 0, 36000, w.events[0].id);
  advanceVillageWorld(w, 1, idle);
  expect(w.people.F.death?.atMinute).toBe(30);
  expect(w.people.F.effort!.absorbed).toBe(0);
  expect(w.events.filter((e) => e.kind === "person_died")).toHaveLength(5);
  expect(w.decisions).toHaveLength(0);
  const effort = structuredClone(w.people.F.effort), body = villagePersonStatus(w, "F").body;
  const estate = structuredClone(w.physical.objects.grain_seed_initial_F);
  queueVillageCommand(w, { id: "after-death", actorId: "F", at: 2, attempt: { kind: "travel", siteId: "market" } });
  advanceVillageWorld(w, 24, idle);
  expect(w.people.F.effort).toEqual(effort); expect(villagePersonStatus(w, "F").body).toEqual(body);
  expect(w.physical.objects.grain_seed_initial_F).toEqual(estate);
  expect(w.events.filter((e) => e.kind === "person_died")).toHaveLength(5);
  expect(w.events.find((e) => e.kind === "command_rejected")?.data.reason).toBe("actor deceased");
  expect(w.pending).toHaveLength(0); checkVillageWorld(w);
});

it("cancels travel and sleep at death, without later movement or a stale sleep mode", () => {
  const w = newVillageWorld(240924, mortality90V1);
  queueVillageCommand(w, { id: "travel", actorId: "F", at: 1, attempt: { kind: "travel", siteId: "market" } });
  queueVillageCommand(w, { id: "sleep", actorId: "B1", at: 1, attempt: { kind: "sleep" } });
  advanceVillageWorld(w, 1, idle);
  expect(w.people.F.activeProcessId).toBeTruthy(); expect(w.people.B1.sleep!.mode).not.toBe("awake");
  deplete(w, "F"); deplete(w, "B1"); advanceVillageWorld(w, 1, idle);
  expect(w.people.F.death?.atMinute).toBe(75); expect(w.people.B1.death?.atMinute).toBe(75);
  expect(w.people.F.activeProcessId).toBeUndefined(); expect(w.people.B1.activeProcessId).toBeUndefined();
  expect(w.people.B1.sleep!.mode).toBe("awake"); expect(w.people.F.execution).toBeUndefined();
  const cell = structuredClone(w.people.F.cell), saved = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 5, idle); advanceVillageWorld(saved, 5, idle);
  expect(w.people.F.cell).toEqual(cell); expect(villageHash(saved)).toBe(villageHash(w));
  expect(w.events.some((e) => e.kind === "sleep_interrupted" && e.causes.includes(w.people.B1.death!.eventId))).toBe(true);
});

it("withdraws a deceased seller's actual offer and keeps its material and money", () => {
  const w = newVillageWorld(240924, mortality90V1);
  action(w, { kind: "travel", siteId: "market" });
  action(w, { kind: "post_surplus_offer", lotId: "grain_seed_initial_F", quantity: 3, price: 2 });
  const offer = Object.values(w.foodOffers!)[0], inventory = structuredClone(villagePersonStatus(w, "F").carried);
  expect(offer.cancelledEventId).toBeUndefined(); deplete(w, "F"); advanceVillageWorld(w, 1, idle);
  expect(offer.cancelledEventId).toBeTruthy(); expect(offer.purchasedEventId).toBeUndefined();
  const cancellation = w.events.find((e) => e.id === offer.cancelledEventId)!;
  expect(cancellation.data.reason).toBe("seller died"); expect(cancellation.data.atMinute).toBe(w.people.F.death!.atMinute);
  expect(cancellation.causes).toContain(w.people.F.death!.eventId);
  expect(villagePersonStatus(w, "F").carried.cash).toBe(inventory.cash);
  expect(w.physical.objects.grain_seed_initial_F.quantity).toBe(4);
  expect(w.pending.some((p) => p.recipientId === "F")).toBe(false); checkVillageWorld(w);
});

it("also applies the literal zero-capacity rule when work exhausts fatigue with nutrition remaining", () => {
  const w = newVillageWorld(240924, mortality90V1);
  action(w, { kind: "set_down", objectId: "grain_seed_initial_F", quantity: 4 });
  queueVillageCommand(w, { id: "unloaded-travel", actorId: "F", at: w.hour + 1, attempt: { kind: "travel", siteId: "market" } });
  advanceVillageWorld(w, 1, idle);
  w.people.F.effort!.fatigue = 961500;
  advanceVillageWorld(w, 1, idle);
  expect(w.people.F.energy).toBe(0); expect(w.people.F.effort!.reserve).toBeGreaterThan(0);
  expect(w.people.F.death?.atMinute).toBe(w.hour * 60); checkVillageWorld(w);
});

it("saves, resumes and replays terminal states and projects death and estate before hourly checkpoints", () => {
  const w = newVillageWorld(240924, mortality90V1); advanceVillageWorld(w, 120, learningNeedsVillageModel);
  const saved = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 120, learningNeedsVillageModel); advanceVillageWorld(saved, 120, learningNeedsVillageModel);
  expect(villageHash(saved)).toBe(villageHash(w)); expect(w.people.B1.death).toBeTruthy();
  for (const d of w.decisions) {
    expect(d.hour * 60).toBeLessThan(w.people[d.actorId].death?.atMinute ?? Infinity);
    expect(learningNeedsVillageModel.decide({ actorId: d.actorId, at: d.hour, knownContext: d.knownContext,
      subjectiveState: d.subjectiveBefore, stimuli: d.stimuli })).toEqual(d.response);
  }
  const projection = new VillageStatusReplay(w.fixture);
  for (const event of w.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const actual = JSON.parse(String(event.data.status)), previous = projection.statuses[event.actors[0] as "F"]!;
      for (const k of ["carried", "home", "market", "field", "ground"] as const) expect(previous[k], `${event.id} ${k}`).toEqual(actual[k]);
      if (actual.body.life.alive === false) expect(previous.body, event.id).toEqual(actual.body);
      else expect(previous.body.effort, event.id).toEqual(actual.body.effort);
    }
    projection.apply(event);
  }
  const recording = captureVillageRecording(w);
  expect(recording.rulesetId).toBe("autonomous-village-mortality-v23");
  expect(villageHash(replayVillageRecording(recording))).toBe(villageHash(w));
}, 120000);
