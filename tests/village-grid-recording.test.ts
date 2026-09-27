import { describe, expect, it } from "vitest";
import { ordinaryVillageModel, type VillageModel } from "../packages/ai/autonomous-world";
import { cellKey, defaultVillageGrid, findGridPath } from "../packages/sim/grid-path";
import { advanceVillageWorld, checkVillageWorld, loadVillageWorld, newVillageWorld,
  queueVillageCommand, queueVillageTerrainCommand, saveVillageWorld, villageHash } from
  "../packages/sim/autonomous-world";
import { captureVillageRecording, compareVillageRecordings, replayVillageRecording,
  recordedVillageActorHistory, villageActorHistory } from "../packages/sim/village-recording";

const idle: VillageModel = { decide(input) { return { attempts: [],
  wait: { at: input.at + 1 }, subjectiveUpdate: input.subjectiveState }; } };

describe("grid paths and village recordings", () => {
  it("finds a deterministic A* route around walls without cutting blocked corners", () => {
    const grid = defaultVillageGrid();
    grid.blocked = ["2,1", "2,2", "2,3"];
    delete grid.sites.grove; delete grid.sites.market;
    const route = findGridPath(grid, { x: 1, y: 2 }, { x: 3, y: 2 })!;
    expect(route[0]).toEqual({ x: 1, y: 2 });
    expect(route.at(-1)).toEqual({ x: 3, y: 2 });
    expect(route.every((cell) => !grid.blocked.includes(cellKey(cell)))).toBe(true);
    expect(route.length).toBeGreaterThan(3);
    expect(findGridPath(grid, { x: 2, y: 1 }, { x: 3, y: 2 })).toBeUndefined();
    const weighted = defaultVillageGrid();
    weighted.cost["2,1"] = 100;
    expect(findGridPath(weighted, { x: 1, y: 1 }, { x: 3, y: 1 })!
      .some((cell) => cellKey(cell) === "2,1")).toBe(false);
  });

  it("replans around a new obstruction and accepts a mid-route destination change", () => {
    const grid = defaultVillageGrid();
    grid.width = 8; grid.sites.market = { x: 0, y: 1 }; grid.sites.grove = { x: 6, y: 1 };
    grid.sites.home_B1 = { x: 0, y: 0 }; grid.sites.home_B2 = { x: 0, y: 2 };
    grid.sites.field = { x: 4, y: 3 }; grid.sites.meadow = { x: 7, y: 3 };
    const w = newVillageWorld(17, undefined, grid);
    queueVillageCommand(w, { id: "go", actorId: "C", at: 1,
      attempt: { kind: "travel", siteId: "grove" } });
    queueVillageTerrainCommand(w, { id: "wall", at: 3, cell: { x: 2, y: 0 }, blocked: true });
    queueVillageCommand(w, { id: "turn", actorId: "C", at: 5,
      attempt: { kind: "redirect_travel", siteId: "field" } });
    advanceVillageWorld(w, 4, idle);
    expect(w.events.some((e) => e.kind === "travel_replanned" && e.actors.includes("C"))).toBe(true);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 10, idle); advanceVillageWorld(resumed, 10, idle);
    expect(villageHash(w)).toBe(villageHash(resumed));
    expect(w.events.some((e) => e.kind === "travel_redirected" && e.actors.includes("C"))).toBe(true);
    expect(w.people.C.cell).toEqual(grid.sites.field);
    expect(w.physical.objects.C.parentId).toBe("field");
    expect(villageHash(replayVillageRecording(captureVillageRecording(w)))).toBe(villageHash(w));
    checkVillageWorld(w);
  });

  it("stores each actor's observations, choices and consequences for verified playback", () => {
    const w = newVillageWorld(5); advanceVillageWorld(w, 2 * 24);
    const history = villageActorHistory(w, "F");
    const choice = history.find((entry) => entry.decision?.chosen?.kind === "accept_food_order");
    expect(choice?.decision?.stimuli.some((s) => s.kind === "order")).toBe(true);
    expect(history.some((entry) => entry.event.kind === "stimulus_received")).toBe(true);
    const recording = JSON.parse(JSON.stringify(captureVillageRecording(w)));
    expect(recordedVillageActorHistory(recording, "F")).toEqual(history);
    const replayed = replayVillageRecording(recording);
    expect(villageHash(replayed)).toBe(villageHash(w));
    expect(compareVillageRecordings(recording, captureVillageRecording(replayed)).equal).toBe(true);
    const other = newVillageWorld(5);
    const refusing: VillageModel = { decide(input) {
      if (input.actorId === "C") return idle.decide(input);
      return ordinaryVillageModel.decide(input);
    } };
    advanceVillageWorld(other, 2 * 24, refusing);
    const difference = compareVillageRecordings(recording, captureVillageRecording(other));
    expect(difference.equal).toBe(false);
    expect(difference.firstDifference).toBeDefined();
  });
});
