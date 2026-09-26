import { describe, expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { advanceA1, checkA1, loadA1, newA1World, offerA1, ordinaryA1Model, replayA1, saveA1, type A1ActorModel, type A1Command } from "../packages/sim/autonomy-a1";

function offer(id: string, workerId: string, deliveryMinutes = 0): A1Command {
  return { id, at: 0, issuerId: "manager", workerId, taskId: id, toolId: "tool", work: 3, deliveryMinutes };
}

describe("A1 actor-led work", () => {
  it("does not act before an offer reaches the worker, then spends time and energy", () => {
    const w = newA1World();
    expect(offerA1(w, offer("job_a", "worker_a", 2))).toBe(true);
    expect(w.actors.worker_a.knownTaskIds).toEqual([]);
    expect(w.processes).toEqual({});
    advanceA1(w, 1);
    expect(w.processes).toEqual({});
    advanceA1(w, 1);
    expect(w.tasks.job_a.status).toBe("working");
    expect(w.actors.worker_a.energy).toBe(10);
    advanceA1(w, 2);
    expect(Object.values(w.processes)[0].remaining).toBe(1);
    expect(w.actors.worker_a.energy).toBe(8);
    advanceA1(w, 1);
    expect(w.tasks.job_a.status).toBe("completed");
    expect(w.physical.reservations).toEqual([]);
    expect(w.actors.worker_a.energy).toBe(7);
    expect(w.actors.worker_a.knownTaskIds).toEqual([]);
    const completed = w.events.find((e) => e.kind === "work_completed")!;
    const byId = new Map(w.events.map((e) => [e.id, e]));
    const ancestors = (eventId: string, seen = new Set<string>()): string[] => {
      for (const cause of byId.get(eventId)?.causes ?? []) if (!seen.has(cause)) { seen.add(cause); ancestors(cause, seen); }
      return [...seen];
    };
    const kinds = ancestors(completed.id).map((id) => byId.get(id)!.kind);
    expect(kinds).toContain("actor_decided");
    expect(kinds).toContain("work_offered");
    checkA1(w);
  });

  it("lets the second worker wait for a tool, then redecide on release", () => {
    const w = newA1World();
    offerA1(w, offer("job_a", "worker_a"));
    offerA1(w, offer("job_b", "worker_b"));
    expect(w.tasks.job_a.status).toBe("working");
    expect(w.tasks.job_b.status).toBe("offered");
    expect(w.physical.reservations).toHaveLength(1);
    expect(w.events.some((e) => e.kind === "attempt_rejected" && e.actors.includes("worker_b"))).toBe(true);
    advanceA1(w, 3);
    expect(w.tasks.job_a.status).toBe("completed");
    expect(w.tasks.job_b.status).toBe("working");
    expect(w.physical.reservations).toHaveLength(1);
    expect(w.physical.reservations[0].claimantId).toBe("worker_b");
    advanceA1(w, 3);
    expect(w.tasks.job_b.status).toBe("completed");
    expect(w.physical.reservations).toEqual([]);
    expect(w.events.filter((e) => e.kind === "work_completed")).toHaveLength(2);
  });

  it("does not let the scheduler do work when the personality declines", () => {
    const passive: A1ActorModel = { decide(input) { return { knownTaskIds: [...input.knownTaskIds, ...input.stimuli.filter((s) => s.kind === "work_offer").map((s) => s.taskId!)], attempts: [], wait: { forKinds: ["work_offer"] } }; } };
    const w = newA1World();
    offerA1(w, offer("job_a", "worker_a"), passive);
    advanceA1(w, 20, passive);
    expect(w.tasks.job_a.status).toBe("offered");
    expect(w.processes).toEqual({});
    expect(w.actors.worker_a.energy).toBe(10);
  });

  it("resumes an active process and reproduces the same event chain from commands", () => {
    const w = newA1World(42);
    offerA1(w, offer("job_a", "worker_a"));
    offerA1(w, offer("job_b", "worker_b"));
    advanceA1(w, 1);
    const resumed = loadA1(saveA1(w));
    advanceA1(w, 6); advanceA1(resumed, 6);
    const replayed = replayA1(42, w.commands, 7);
    expect(hash(resumed)).toBe(hash(w));
    expect(hash(replayed)).toBe(hash(w));
    expect(() => loadA1(JSON.stringify({ ...w, engineVersion: "old" }))).toThrow("incompatible");
    const broken = structuredClone(w); broken.physical.reservations.push({ id: "orphan", objectId: "tool", quantity: 1, claimantId: "worker_a" });
    expect(() => checkA1(broken)).toThrow();
  });
});
