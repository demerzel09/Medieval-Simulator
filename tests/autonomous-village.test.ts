import { describe, expect, it } from "vitest";
import { autonomousVillageV1 } from "../fixtures/autonomous-village";
import { ordinaryVillageModel, type VillageModel } from "../packages/ai/autonomous-world";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld,
  queueVillageCommand, replayVillageWorld, saveVillageWorld, villageHash, villageSummary } from "../packages/sim/autonomous-world";
import { siteOf } from "../packages/sim/physical";

const absent = (actorId: string): VillageModel => ({ decide(input) {
  if (input.actorId === actorId) return { attempts: [], wait: { at: input.at + 1 },
    subjectiveUpdate: input.subjectiveState };
  return ordinaryVillageModel.decide(input);
} });
const count = (w: ReturnType<typeof newVillageWorld>, kind: string, from = 1) =>
  w.events.filter((e) => e.kind === kind && e.day >= from).length;

describe("autonomous village", () => {
  it("sustains five individual lives and physical trade for 90 days", () => {
    const w = newVillageWorld(); advanceVillageWorld(w, 90 * 24);
    const s = villageSummary(w);
    expect([w.harvestedFood, w.eatenFood, w.harvestedWood, w.burnedWood, w.spoiledFood])
      .toEqual([450, 450, 450, 450, 0]);
    expect([w.resources.food.available, w.resources.wood.available]).toEqual([3, 3]);
    for (const id of ["S", "F", "C", "B1", "B2"] as const) {
      expect(w.people[id]).toMatchObject({ meals: 90, fuelUsed: 90, hunger: 0, cold: 0 });
      for (let day = 1; day <= 90; day++)
        expect(w.events.filter((e) => e.kind === "ate" && e.day === day && e.actors.includes(id))).toHaveLength(1);
    }
    expect(Object.values(s.people).reduce((n, p) => n + p.cash, 0)).toBe(26);
    for (const kind of ["foraged", "food_tendered", "crop_bought", "food_delivered", "food_sold",
      "wood_sold", "ate", "wood_burned"]) expect(count(w, kind, 61)).toBeGreaterThan(0);
    expect(count(w, "food_order_posted")).toBe(90);
    expect(count(w, "food_sold")).toBe(270);
    expect(count(w, "wood_sold")).toBe(270);
    expect(w.events.filter((e) => e.kind === "person_decided").every((e) => e.causes.length > 0)).toBe(true);
    checkVillageWorld(w);
  }, 20000);

  it("saves in transit, resumes and replays the same seed and external Command", () => {
    const command = { id: "inspect-travel", actorId: "B1" as const, at: 1,
      attempt: { kind: "travel" as const, siteId: "grove" } };
    const a = newVillageWorld(7); queueVillageCommand(a, command);
    advanceVillageWorld(a, 1);
    expect(siteOf(a.physical, "B1")).toMatch(/^transit_/);
    expect(a.commands[0].status).toBe("applied");
    const b = loadVillageWorld(saveVillageWorld(a));
    advanceVillageWorld(a, 3 * 24 - 1); advanceVillageWorld(b, 3 * 24 - 1);
    expect(villageHash(b)).toBe(villageHash(a));
    const c = replayVillageWorld(7, 3, undefined, ordinaryVillageModel, [command]);
    expect(villageHash(c)).toBe(villageHash(a));
  });

  it("does not substitute a refusing or absent participant", () => {
    for (const id of ["C", "F", "B1"] as const) {
      const w = newVillageWorld(); advanceVillageWorld(w, 3 * 24, absent(id));
      expect(w.events.some((e) => e.kind === "person_decided" && e.actors.includes(id) &&
        e.data.attempt !== "wait")).toBe(false);
      if (id === "C" || id === "F") expect(count(w, "food_delivered")).toBe(0);
      if (id === "B1") expect(w.people.B1.meals).toBeLessThan(3);
      checkVillageWorld(w);
    }
  });

  it("records insufficient capital, low regrowth and delayed information as failures", () => {
    const cash = structuredClone(autonomousVillageV1); cash.initialCash.S = 0;
    const noCash = newVillageWorld(1, cash); advanceVillageWorld(noCash, 3 * 24);
    expect(count(noCash, "food_order_posted")).toBe(0);
    expect(noCash.people.S.hunger).toBeGreaterThan(0);
    const wood = structuredClone(autonomousVillageV1); wood.resources.wood.growthPerDay = 0;
    const depleted = newVillageWorld(1, wood); advanceVillageWorld(depleted, 7 * 24);
    expect(depleted.people.B1.cold + depleted.people.B2.cold).toBeGreaterThan(0);
    const delay = structuredClone(autonomousVillageV1); delay.informationDelayHours = 24;
    const late = newVillageWorld(1, delay); advanceVillageWorld(late, 24);
    expect(count(late, "food_order_accepted")).toBe(0);
    expect(late.people.F.receivedOrderIds).toEqual([]);
    const load = structuredClone(autonomousVillageV1); load.carryingCapacity.carrierTotalMass = 17;
    const overloaded = newVillageWorld(1, load); advanceVillageWorld(overloaded, 24);
    expect(overloaded.events.some((e) => e.kind === "process_failed" &&
      e.data.reason === "carrier overloaded")).toBe(true);
    expect(count(overloaded, "food_delivered")).toBe(0);
  });

  it("rejects a guessed order before delivery and a harvest outside the actor's rights", () => {
    const w = newVillageWorld();
    const guesses: VillageModel = { decide(input) {
      if (input.actorId === "F" && w.orders[Object.keys(w.orders)[0]] &&
        !w.people.F.receivedOrderIds.length)
        return { attempts: [{ kind: "accept_food_order", orderId: Object.keys(w.orders)[0] }],
          wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState };
      return ordinaryVillageModel.decide(input);
    } };
    advanceVillageWorld(w, 10, guesses);
    expect(w.events.some((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "farmer has not received offer")).toBe(true);
    const x = newVillageWorld(); queueVillageCommand(x, { id: "wrong-right", actorId: "B1", at: 2,
      attempt: { kind: "forage", resource: "food", quantity: 1 } });
    advanceVillageWorld(x, 2);
    expect(x.events.some((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "harvest right denied")).toBe(true);
  });

  it("applies a duplicate delivered stimulus only once", () => {
    const w = newVillageWorld(); advanceVillageWorld(w, 1);
    const pending = w.pending.find((p) => p.recipientId === "S")!;
    w.pending.push(structuredClone(pending));
    advanceVillageWorld(w, 1);
    expect(w.people.S.receivedStimulusIds.filter((id) => id === pending.stimulus.id)).toHaveLength(1);
    checkVillageWorld(w);
  });

  it("will not spend entrusted coins before a contracted physical tender", () => {
    const w = newVillageWorld(); advanceVillageWorld(w, 5);
    const orderId = Object.keys(w.orders)[0];
    queueVillageCommand(w, { id: "early-pay", actorId: "C", at: 6,
      attempt: { kind: "purchase_food", orderId } });
    advanceVillageWorld(w, 1);
    expect(w.events.some((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "crop purchase unavailable")).toBe(true);
    expect(w.events.some((e) => e.kind === "crop_bought")).toBe(false);
    expect(Object.values(w.physical.objects).filter((o) => o.parentId === "wallet_C" &&
      o.ownerId === "S" && o.typeId === "currency")).toHaveLength(4);
    checkVillageWorld(w);
  });

  it("keeps ownership and quantity when F tenders only part of a lot", () => {
    const w = newVillageWorld();
    const partial: VillageModel = { decide(input) {
      const response = ordinaryVillageModel.decide(input);
      if (input.actorId === "F" && response.attempts[0]?.kind === "tender_food")
        return { ...response, attempts: [{ ...response.attempts[0], quantity: 2 }] };
      return response;
    } };
    advanceVillageWorld(w, 12, partial);
    const tender = w.events.find((e) => e.kind === "food_tendered");
    expect(tender?.data.quantity).toBe(2);
    expect(w.physical.objects[String(tender?.data.lotId)]?.quantity).toBe(2);
    queueVillageCommand(w, { id: "part-buy", actorId: "C", at: 13,
      attempt: { kind: "purchase_food", orderId: String(tender?.data.orderId) } });
    advanceVillageWorld(w, 1, partial);
    expect(w.events.find((e) => e.kind === "crop_bought")?.data.cost).toBe(2);
    checkVillageWorld(w);
  });

  it("reserves contested resources in actor order without creating extra wood", () => {
    const fixture = structuredClone(autonomousVillageV1);
    fixture.resources.wood.initial = 5;
    const w = newVillageWorld(1, fixture);
    for (const id of ["B1", "B2"] as const) {
      queueVillageCommand(w, { id: `travel-${id}`, actorId: id, at: 1,
        attempt: { kind: "travel", siteId: "grove" } });
      queueVillageCommand(w, { id: `forage-${id}`, actorId: id, at: 2,
        attempt: { kind: "forage", resource: "wood", quantity: 3 } });
    }
    advanceVillageWorld(w, 2);
    expect(w.resources.wood.reserved).toBe(3);
    expect(w.events.filter((e) => e.kind === "attempt_rejected" &&
      e.data.reason === "resource unavailable")).toHaveLength(1);
    advanceVillageWorld(w, 3);
    expect(w.harvestedWood).toBe(5);
    expect(w.resources.wood.available).toBe(0);
    checkVillageWorld(w);
  });
});
