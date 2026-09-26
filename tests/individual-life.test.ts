import { describe, expect, it } from "vitest";
import type { LifeModel } from "../packages/ai/individual-life";
import { physicalTransaction } from "../packages/sim/physical";
import { advanceLifeWorld, lifeHash, loadLifeWorld, newLifeWorld, replayLifeWorld, saveLifeWorld,
  type LifeFixture } from "../packages/sim/individual-life";

describe("life without households or markets", () => {
  it("lets three people move, forage, eat and rest from individual decisions over 30 days", () => {
    const w = newLifeWorld();
    advanceLifeWorld(w, 30 * 24);
    expect(w.harvested).toBe(90);
    expect(w.eaten).toBe(90);
    expect(Object.values(w.people).every((person) => person.hunger === 0)).toBe(true);
    expect(w.events.some((event) => event.kind === "departed" && event.actors.includes("A"))).toBe(true);
    expect(w.events.some((event) => event.kind === "rested")).toBe(true);
    expect(w.events.filter((event) => event.kind === "ate").every((event) => event.causes.some((id) =>
      w.events.some((cause) => cause.id === id && cause.kind === "foraged")))).toBe(true);
    expect(lifeHash(loadLifeWorld(saveLifeWorld(w)))).toBe(lifeHash(w));
    expect(lifeHash(replayLifeWorld(w.seed, 30 * 24))).toBe(lifeHash(w));
  });

  it("does not assign meals or harvests when every person declines to act", () => {
    const idle: LifeModel = { decide(input) { return { attempts: [], wait: { at: input.at + 1 } }; } };
    const w = newLifeWorld();
    advanceLifeWorld(w, 3 * 24, idle);
    expect(w.harvested).toBe(0);
    expect(w.eaten).toBe(0);
    expect(Object.values(w.people).map((person) => person.hunger)).toEqual([3, 3, 3]);
    expect(w.resources.berries.available).toBe(3);
  });

  it("keeps shortage visible and does not let a person consume another person's food", () => {
    const fixture: LifeFixture = { sites: ["camp", "thicket"], people: [
      { id: "M", siteId: "thicket" }, { id: "N", siteId: "thicket" }],
      resources: [{ id: "roots", siteId: "thicket", available: 1, capacity: 1, dailyGrowth: 1 }] };
    const w = newLifeWorld(7, fixture);
    advanceLifeWorld(w, 24);
    expect(w.eaten).toBe(1);
    expect(w.people.N.hunger).toBe(1);
    const other = newLifeWorld(7, fixture);
    advanceLifeWorld(other, 1);
    const lot = Object.values(other.physical.objects).find((object) => object.typeId === "food")!;
    expect(lot.ownerId).toBe("M");
    expect(physicalTransaction(other.physical, { actorId: "N", ownerIds: [] }, (tx) => tx.move(lot.id, "bag_N")).ok).toBe(false);
  });

  it("works with renamed people and moved resource sites", () => {
    const fixture: LifeFixture = { sites: ["west", "east", "middle"], people: [
      { id: "X", siteId: "west" }, { id: "Y", siteId: "middle" }],
      resources: [{ id: "nuts", siteId: "east", available: 2, capacity: 2, dailyGrowth: 2 }] };
    const w = newLifeWorld(9, fixture);
    advanceLifeWorld(w, 5 * 24);
    expect(w.eaten).toBe(10);
    expect(w.people.X.hunger).toBe(0);
    expect(w.people.Y.hunger).toBe(0);
    expect(lifeHash(replayLifeWorld(9, 5 * 24, fixture))).toBe(lifeHash(w));
  });

  it("tries another patch when the local one is empty, then retries after a new day", () => {
    const fixture: LifeFixture = { sites: ["home", "dry", "wet"], people: [{ id: "P", siteId: "dry" }],
      resources: [
        { id: "dry_roots", siteId: "dry", available: 0, capacity: 1, dailyGrowth: 0 },
        { id: "wet_roots", siteId: "wet", available: 1, capacity: 1, dailyGrowth: 1 },
      ] };
    const w = newLifeWorld(10, fixture);
    advanceLifeWorld(w, 24);
    expect(w.eaten).toBe(1);
    expect(w.events.some((event) => event.kind === "departed" && event.data.from === "dry" && event.data.to === "wet")).toBe(true);
    advanceLifeWorld(w, 24);
    expect(w.eaten).toBe(2);
    expect(lifeHash(replayLifeWorld(10, 48, fixture))).toBe(lifeHash(w));
  });
});
