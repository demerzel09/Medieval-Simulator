import { describe, expect, it } from "vitest";
import { capacityReport, checkPhysical, contentsQuantity, physicalTransaction, siteOf, totalMass, type PhysicalState } from "../packages/sim/physical";
import { checkHaul, executeHaul, proposeHaul, type HaulContext, type HaulRequest } from "../packages/sim/transport-capability";

function village(): PhysicalState {
  const types: PhysicalState["types"] = {
    world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["site"] } },
    site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["person", "vehicle", "store", "horse"] } },
    person: { id: "person", tags: ["person"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["wallet", "bag"], maxContentsMass: 25, maxQuantityByTag: { food: 5, currency: 20 } } },
    wallet: { id: "wallet", tags: ["wallet"], unitMass: 0, stackable: false, ownable: true, container: { acceptsTags: ["currency"], maxContentsMass: 20, maxQuantityByTag: { currency: 20 } } },
    bag: { id: "bag", tags: ["bag"], unitMass: 0, stackable: false, ownable: true, container: { acceptsTags: ["food"], maxContentsMass: 5, maxQuantityByTag: { food: 5 } } },
    store: { id: "store", tags: ["store"], unitMass: 0, stackable: false, ownable: true, container: { acceptsTags: ["food", "currency"], maxContentsMass: 500 } },
    cart: { id: "cart", tags: ["vehicle"], unitMass: 30, stackable: false, ownable: true, container: { acceptsTags: ["food"], maxContentsMass: 100, maxQuantityByTag: { food: 100 } } },
    horse: { id: "horse", tags: ["horse"], unitMass: 0, stackable: false, ownable: true },
    food: { id: "food", tags: ["food"], unitMass: 1, stackable: true, ownable: true },
    currency: { id: "currency", tags: ["currency"], unitMass: 1, stackable: true, ownable: true },
  };
  const objects: PhysicalState["objects"] = {};
  const add = (id: string, typeId: string, parentId: string | null, quantity = 1, ownerId?: string) => {
    objects[id] = { id, typeId, parentId, quantity, ownerId, causeEventId: "fixture" };
  };
  add("world", "world", null); add("farm", "site", "world"); add("market", "site", "world");
  for (const id of ["C", "driverA", "driverB", "loader", "buyer"]) add(id, "person", "farm");
  add("wallet", "wallet", "buyer", 1, "house"); add("bagA", "bag", "buyer", 1, "house"); add("bagB", "bag", "buyer", 1, "house");
  add("coins", "currency", "wallet", 10, "house");
  add("store", "store", "farm", 1, "cooperative"); add("food", "food", "store", 150, "cooperative");
  for (const id of ["cartA", "cartB"]) add(id, "cart", "farm", 1, "cooperative");
  for (const id of ["horseX", "horseY"]) add(id, "horse", "farm", 1, "cooperative");
  return { types, objects, reservations: [] };
}

const auth = { actorId: "C", ownerIds: ["cooperative"], consentingPersonIds: ["driverA", "driverB", "loader"] };

describe("L0 physical object contract", () => {
  it("derives nested location and mass, preserving ownership during movement", () => {
    const s = village(); checkPhysical(s);
    expect(totalMass(s, "wallet")).toBe(10);
    expect(contentsQuantity(s, "buyer", "currency")).toBe(10);
    expect(capacityReport(s, "buyer").massUsed).toBe(10);
    const moved = physicalTransaction(s, { actorId: "buyer", ownerIds: ["house"] }, (tx) =>
      tx.depart({ id: "transit", typeId: "site", parentId: "world", quantity: 1, causeEventId: "depart" }, ["buyer"]));
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(siteOf(moved.state, "coins")).toBe("transit");
    expect(moved.state.objects.coins.parentId).toBe("wallet");
    expect(moved.state.objects.coins.ownerId).toBe("house");
    const arrived = physicalTransaction(moved.state, { actorId: "buyer", ownerIds: ["house"] }, (tx) => tx.arrive("transit", "market", ["buyer"]));
    expect(arrived.ok).toBe(true);
    if (arrived.ok) expect(siteOf(arrived.state, "coins")).toBe("market");
  });

  it("rejects cycles, remote transfer, theft and over-capacity without changing state", () => {
    const s = village(), before = JSON.stringify(s);
    expect(physicalTransaction(s, { actorId: "buyer", ownerIds: ["house"] }, (tx) => tx.move("wallet", "wallet")).ok).toBe(false);
    expect(physicalTransaction(s, { actorId: "buyer", ownerIds: ["house"] }, (tx) => tx.move("coins", "market")).ok).toBe(false);
    expect(physicalTransaction(s, { actorId: "buyer", ownerIds: [] }, (tx) => tx.move("food", "bagA")).ok).toBe(false);
    expect(physicalTransaction(s, auth, (tx) => tx.move("food", "cartA")).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("allows same-person rebagging, but enforces the outer person's combined load", () => {
    const s = village();
    const moved = physicalTransaction(s, { actorId: "buyer", ownerIds: ["house", "cooperative"] }, (tx) => {
      tx.split("food", "meal", 5, "split"); tx.changeOwner("meal", "house"); tx.move("meal", "bagA");
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const rebag = physicalTransaction(moved.state, { actorId: "buyer", ownerIds: ["house"] }, (tx) => tx.move("meal", "bagB"));
    expect(rebag.ok).toBe(true);
    if (rebag.ok) expect(capacityReport(rebag.state, "buyer").massUsed).toBe(15);
    const overloaded = physicalTransaction(moved.state, { actorId: "buyer", ownerIds: ["cooperative", "house"] }, (tx) => {
      tx.split("food", "more", 11, "split"); tx.changeOwner("more", "house"); tx.move("more", "bagB");
    });
    expect(overloaded.ok).toBe(false);
    const outer = village();
    outer.types.person.container!.maxQuantityByTag!.currency = 40;
    outer.objects.wallet2 = { id: "wallet2", typeId: "wallet", parentId: "buyer", quantity: 1, ownerId: "house", causeEventId: "fixture" };
    outer.objects.extraCoins = { id: "extraCoins", typeId: "currency", parentId: "store", quantity: 16, ownerId: "house", causeEventId: "fixture" };
    checkPhysical(outer);
    const tooHeavy = physicalTransaction(outer, { actorId: "buyer", ownerIds: ["house"] }, (tx) => tx.move("extraCoins", "wallet2"));
    expect(tooHeavy.ok).toBe(false); // both wallets fit individually; person would carry 26
  });

  it("keeps reserved goods exclusive and commits sale of food and money together", () => {
    const s = village();
    const held = physicalTransaction(s, auth, (tx) => tx.reserve("food", "order1", 3, "C"));
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const doubleUse = physicalTransaction(held.state, auth, (tx) => { tx.split("food", "other", 148, "split"); tx.move("other", "cartA"); });
    expect(doubleUse.ok).toBe(false);
    const sale = physicalTransaction(held.state, { actorId: "buyer", ownerIds: ["house", "cooperative"] }, (tx) => {
      tx.release("order1"); tx.split("food", "purchase", 3, "sale"); tx.changeOwner("purchase", "house"); tx.move("purchase", "bagA");
      tx.split("coins", "payment", 6, "sale"); tx.changeOwner("payment", "cooperative"); tx.move("payment", "store");
    });
    expect(sale.ok).toBe(false); // buyer cannot release C's hold
    const missingMoney = physicalTransaction(held.state, { actorId: "buyer", ownerIds: ["house", "cooperative"], claimIds: ["order1"] }, (tx) => {
      tx.release("order1"); tx.split("food", "purchase", 3, "sale"); tx.changeOwner("purchase", "house"); tx.move("purchase", "bagA");
      tx.split("coins", "payment", 11, "sale");
    });
    expect(missingMoney.ok).toBe(false);
    expect(held.state.objects.food.quantity).toBe(150);
    expect(held.state.objects.purchase).toBeUndefined();
    expect(held.state.reservations).toHaveLength(1);
    const settled = physicalTransaction(held.state, { actorId: "buyer", ownerIds: ["house", "cooperative"], claimIds: ["order1"] }, (tx) => {
      tx.release("order1");
      tx.split("food", "purchase", 3, "sale"); tx.changeOwner("purchase", "house"); tx.move("purchase", "bagA");
      tx.split("coins", "payment", 6, "sale"); tx.changeOwner("payment", "cooperative"); tx.move("payment", "store");
    });
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.state.objects.purchase.ownerId).toBe("house");
      expect(settled.state.objects.payment.ownerId).toBe("cooperative");
      expect(Object.values(settled.state.objects).filter((o) => o.typeId === "food").reduce((n, o) => n + o.quantity, 0)).toBe(150);
      expect(Object.values(settled.state.objects).filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0)).toBe(10);
    }
  });
});

function haulCase() {
  const s = village();
  const request: HaulRequest = { taskId: "haul", personId: "C", cargoId: "food", quantity: 150, fromId: "farm", toId: "market", deadline: 200, causeEventIds: ["request"] };
  const context: HaulContext = {
    knownCartIds: [{ id: "cartA", knownAvailable: true }, { id: "cartB", knownAvailable: true }],
    knownHorseIds: [{ id: "horseX", knownAvailable: true }, { id: "horseY", knownAvailable: true }],
    knownDriverIds: [{ id: "driverA", knownAvailable: true }, { id: "driverB", knownAvailable: true }],
    knownLoaderIds: [{ id: "loader", knownAvailable: true }],
    estimatedTowByHorse: { horseX: 120, horseY: 120 }, estimatedCartTare: { cartA: 30, cartB: 30 },
    estimatedCartSpace: { cartA: 100, cartB: 100 }, loadMinutesPerCart: 10, travelMinutes: 60, now: 0,
  };
  const truth = { state: s, now: 0, deadline: 200, travelMinutes: 60, loadMinutesPerCart: 10,
    towByHorse: { horseX: 120, horseY: 120 }, acceptedTaskIds: ["haul"], workingPersonIds: ["C", "loader", "driverA", "driverB"] };
  return { s, request, context, truth };
}

describe("L0 transport capability", () => {
  it("plans 90+60, then validates real carts, horses, workers and road", () => {
    const { request, context, truth } = haulCase();
    const p = proposeHaul(request, context);
    expect(p?.assignments.map((a) => a.quantity)).toEqual([90, 60]);
    expect(checkHaul(p!, truth).ok).toBe(true);
    expect(proposeHaul(request, { ...context, knownHorseIds: context.knownHorseIds.slice(0, 1) })).toBeUndefined();
    expect(proposeHaul(request, { ...context, knownLoaderIds: [] })).toBeUndefined();
    expect(checkHaul(p!, { ...truth, towByHorse: { horseX: 100, horseY: 100 } }).ok).toBe(false);
    expect(checkHaul(p!, { ...truth, workingPersonIds: ["C", "driverA", "driverB"] }).ok).toBe(false);
    const departed = executeHaul(p!, truth, "transit_haul");
    expect(departed.ok).toBe(true);
    if (departed.ok) {
      expect(departed.loadedIds.length).toBe(2);
      expect(contentsQuantity(departed.state, "cartA", "food")).toBe(90);
      expect(contentsQuantity(departed.state, "cartB", "food")).toBe(60);
      expect(siteOf(departed.state, "food")).toBe("transit_haul");
      expect(departed.state.objects.food.ownerId).toBe("cooperative");
      checkPhysical(departed.state);
      const arrived = physicalTransaction(departed.state, auth, (tx) => tx.arrive("transit_haul", "market",
        ["C", "cartA", "horseX", "driverA", "cartB", "horseY", "driverB"]));
      expect(arrived.ok).toBe(true);
      if (arrived.ok) {
        expect(siteOf(arrived.state, "food")).toBe("market");
        expect(contentsQuantity(arrived.state, "cartA", "food") + contentsQuantity(arrived.state, "cartB", "food")).toBe(150);
        expect(arrived.state.objects.transit_haul).toBeUndefined();
      }
    }
  });
});
