import { expect, it } from "vitest";
import { foodAcquisition90V1 } from "../fixtures/land-economy-wide";
import type { VillageModel } from "../packages/ai/autonomous-world";
import { learningNeedsVillageModel } from "../packages/ai/learning-needs";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld,
  saveVillageWorld, villageHash, type VillageWorld } from "../packages/sim/autonomous-world";
import { physicalTransaction } from "../packages/sim/physical";
import { captureVillageRecording, replayVillageRecording } from "../packages/sim/village-recording";
import { VillageStatusReplay } from "../apps/web/village-status-replay";

const idle: VillageModel = { decide(i) { return { attempts: [], wait: { at: i.at + 1 } }; } };
const eat: VillageModel = { decide(i) {
  return { attempts: i.actorId === "F" ? [{ kind: "eat" }] : [], wait: { at: i.at + 1 } };
} };

let prefix: VillageWorld | undefined;
/** Real v24 travel/gathering prefix; no food, body or knowledge is injected. */
function beforeMeal() {
  if (!prefix) {
    const w = newVillageWorld(240924, foodAcquisition90V1);
    while (!w.people.F.meals && w.hour < 24) {
      const previous = structuredClone(w);
      advanceVillageWorld(w, 1, learningNeedsVillageModel);
      if (w.people.F.meals) prefix = previous;
    }
    if (!prefix) throw Error("natural first meal was not reached");
  }
  return structuredClone(prefix);
}
const ownMeals = (w: VillageWorld) => w.events.filter((e) => e.kind === "ate" && e.actors[0] === "F");

it("keeps world evidence and experience independent of personality input mutation", () => {
  const actual = beforeMeal(), expected = beforeMeal();
  let editedExperience = false;
  const mutating: VillageModel = { decide(i) {
    const response = eat.decide(i);
    i.knownContext.energy = 999;
    i.knownContext.cell.x = -999;
    i.knownContext.ownFoodLots?.splice(0);
    if (i.knownContext.effortBody) i.knownContext.effortBody.nutritionNeed = 999;
    i.subjectiveState.done.push("uncommitted memory");
    for (const s of i.stimuli) {
      s.causeEventIds.push("forged cause");
      if (s.experience) { s.experience.after.energy = 999; editedExperience = true; }
    }
    return response;
  } };
  advanceVillageWorld(expected, 1, eat);
  advanceVillageWorld(actual, 1, mutating);
  expect(editedExperience).toBe(true);
  expect(villageHash(actual)).toBe(villageHash(expected));
  expect(ownMeals(actual)).toHaveLength(1);
  expect(actual.people.F.memory.done).not.toContain("uncommitted memory");
});

it("uses the same meal law for different decision implementations and detaches retained data", () => {
  const actual = beforeMeal(), expected = beforeMeal();
  const retained: (() => void)[] = [];
  const alternate: VillageModel = { decide(i) {
    const response = structuredClone(eat.decide(i));
    response.subjectiveUpdate = i.subjectiveState;
    retained.push(() => {
      i.knownContext.cell.x = -1;
      i.subjectiveState.done.push("late mutation");
      response.attempts.splice(0);
      response.wait.at = 999;
    });
    return response;
  } };
  advanceVillageWorld(actual, 1, alternate);
  advanceVillageWorld(expected, 1, eat);
  expect(actual.physical).toEqual(expected.physical);
  expect(actual.people.F.effort).toEqual(expected.people.F.effort);
  expect(ownMeals(actual)).toEqual(ownMeals(expected));
  const committed = villageHash(actual);
  retained.forEach((mutate) => mutate());
  expect(villageHash(actual)).toBe(committed);
});

it("delivers meal evidence, advances delayed absorption while waiting, and remembers only an inference", () => {
  const w = beforeMeal();
  const observer: VillageModel = { decide(i) {
    if (i.actorId !== "F") return idle.decide(i);
    const m = i.subjectiveState, c = i.knownContext;
    expect(c).not.toHaveProperty("physical");
    expect(c).not.toHaveProperty("people");
    for (const hidden of ["reserve", "absorbed", "intake", "digestion", "absorptionMinutes"])
      expect(c.effortBody).not.toHaveProperty(hidden);
    // Local vegetation is an observation, not the full ecology table.
    expect(c.visiblePlants.length).toBeLessThan(Object.keys(w.land.plants).length);
    for (const s of i.stimuli) if (s.kind === "result" && s.action === "eat" && s.success)
      m.done.push(`meal-result:${s.causeEventIds[0]}`);
    if (c.effortBody!.digesting && !m.done.includes("felt-digesting")) m.done.push("felt-digesting");
    if (m.done.includes("felt-digesting") && !c.effortBody!.digesting && !m.done.includes("inferred-absorption"))
      m.done.push("inferred-absorption");
    const attempts = m.done.includes("requested-meal") ? [] : [{ kind: "eat" as const }];
    if (attempts.length) m.done.push("requested-meal");
    return { attempts, subjectiveUpdate: m, wait: { at: i.at + 10 } };
  } };
  advanceVillageWorld(w, 1, observer);
  const meal = ownMeals(w)[0], b = w.people.F.effort!, pending = structuredClone(b.digestion[0]);
  expect(meal.causes).toContain(w.decisions.find((d) => d.actorId === "F" && d.hour === w.hour)!.eventId);
  expect(pending.causeId).toBe(meal.id);
  expect(pending.dueMinute).toBe(w.hour * 60 + 120);
  expect(b.absorbed).toBe(0);
  expect(b.intake).toBe(pending.amount);
  expect(w.people.F.memory.done).not.toContain(`meal-result:${meal.id}`);
  expect(w.pending.find((p) => p.recipientId === "F" && p.stimulus.action === "eat")?.stimulus.receivedAt).toBe(w.hour + 1);
  const saved = loadVillageWorld(saveVillageWorld(w));
  advanceVillageWorld(w, 1, observer);
  expect(w.people.F.effort!.absorbed).toBe(0);
  expect(w.people.F.memory.done).toContain(`meal-result:${meal.id}`);
  const decisions = w.decisions.length, reserve = w.people.F.effort!.reserve;
  advanceVillageWorld(w, 1, observer);
  expect(w.people.F.effort!.absorbed).toBe(pending.amount);
  expect(w.people.F.effort!.digestion).toHaveLength(0);
  expect(w.people.F.effort!.reserve).toBeGreaterThan(reserve);
  // A body update does not require another decision by F.
  expect(w.decisions.slice(decisions).filter((d) => d.actorId === "F")).toHaveLength(0);
  advanceVillageWorld(w, 10, observer);
  expect(w.people.F.memory.done).toContain("inferred-absorption");
  expect(ownMeals(w)).toHaveLength(1);
  expect(w.people.F.effort!.absorbed).toBe(pending.amount);
  advanceVillageWorld(saved, 12, observer);
  expect(villageHash(saved)).toBe(villageHash(w));
  expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
  const projection = new VillageStatusReplay(w.fixture);
  for (const event of w.events) {
    if (event.kind === "person_status" && event.hour > 0) {
      const status = JSON.parse(String(event.data.status));
      expect(projection.statuses[event.actors[0] as "F"]!.body.effort).toEqual(status.body.effort);
    }
    projection.apply(event);
  }
  checkVillageWorld(w);
});

it("rejects a competing physical reservation without consuming food or scheduling nutrition", () => {
  const w = beforeMeal();
  // Finish the real gathering before introducing an explicit competing claim.
  advanceVillageWorld(w, 1, idle);
  const lot = Object.values(w.physical.objects).find((o) => o.parentId === "bag_F" && w.foodLots[o.id]?.species === "fruit_tree")!;
  const claim = physicalTransaction(w.physical, { actorId: "F", ownerIds: [] },
    (t) => t.reserve(lot.id, "competing-meal", lot.quantity, "B1"));
  if (!claim.ok) throw Error(claim.reason);
  w.physical = claim.state;
  const food = w.eatenFood, intake = w.people.F.effort!.intake;
  advanceVillageWorld(w, 1, eat);
  expect(w.events.some((e) => e.kind === "attempt_rejected" && e.actors[0] === "F" && e.data.reason === "physical consumption denied")).toBe(true);
  expect(ownMeals(w)).toHaveLength(0);
  expect(w.eatenFood).toBe(food);
  expect(w.physical.objects[lot.id].quantity).toBe(lot.quantity);
  expect(w.people.F.effort!.intake).toBe(intake);
  expect(w.people.F.effort!.digestion).toHaveLength(0);
  const failure = w.pending.find((p) => p.recipientId === "F" && p.stimulus.action === "eat")!.stimulus;
  expect(failure.success).toBe(false);
  expect(w.events.find((e) => e.id === failure.causeEventIds[0])?.kind).toBe("attempt_rejected");
  checkVillageWorld(w);
});

it("does not duplicate consumption or intake on a repeated meal attempt", () => {
  const w = beforeMeal();
  advanceVillageWorld(w, 1, eat);
  const food = w.eatenFood, intake = w.people.F.effort!.intake;
  advanceVillageWorld(w, 1, eat);
  expect(ownMeals(w)).toHaveLength(1);
  expect(w.eatenFood).toBe(food);
  expect(w.people.F.effort!.intake).toBe(intake);
  expect(w.people.F.effort!.digestion).toHaveLength(1);
  expect(w.events.some((e) => e.kind === "attempt_rejected" && e.actors[0] === "F" && e.data.reason === "meal unavailable")).toBe(true);
});

it("does not create a meal from nonedible grain or a subjective success claim", () => {
  const w = newVillageWorld(240924, foodAcquisition90V1);
  while (!w.people.F.hunger && w.hour < 24) advanceVillageWorld(w, 1, idle);
  expect(w.people.F.hunger).toBeGreaterThan(0);
  const imagined: VillageModel = { decide(i) {
    i.knownContext.hunger = 10;
    i.knownContext.edibleMeals = 100;
    i.subjectiveState.done.push("imagined meal success");
    return { ...eat.decide(i), subjectiveUpdate: i.subjectiveState };
  } };
  const grain = structuredClone(w.physical.objects.grain_seed_initial_F);
  advanceVillageWorld(w, 1, imagined);
  expect(w.people.F.memory.done).toContain("imagined meal success");
  expect(w.physical.objects.grain_seed_initial_F).toEqual(grain);
  expect(ownMeals(w)).toHaveLength(0);
  expect(w.people.F.effort!.intake).toBe(0);
  expect(w.people.F.effort!.digestion).toHaveLength(0);
  expect(w.events.some((e) => e.kind === "attempt_rejected" && e.actors[0] === "F")).toBe(true);
});
