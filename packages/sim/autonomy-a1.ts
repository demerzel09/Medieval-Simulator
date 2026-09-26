import { checkPhysical, physicalTransaction, siteOf, type PhysicalState } from "./physical";
import type { ActorInput, ActorResponse, PersonalityModel } from "../ai/personality";

export type A1Stimulus = {
  id: string; recipientId: string; kind: "work_offer" | "tool_available" | "attempt_rejected" | "work_completed" | "work_failed";
  occurredAt: number; receivedAt: number; causeEventIds: string[]; taskId?: string;
};
export type A1Actor = {
  id: string; energy: number; knownTaskIds: string[]; inbox: A1Stimulus[];
  wait: { until?: number; forKinds: A1Stimulus["kind"][] };
};
export type A1Task = { id: string; issuerId: string; workerId: string; toolId: string; work: number; status: "offered" | "working" | "completed" | "failed"; offerEventId: string };
export type A1Process = { id: string; taskId: string; actorId: string; toolId: string; claimId: string; remaining: number; lastEventId: string };
export type A1Event = { id: string; minute: number; kind: string; actors: string[]; causes: string[]; data: Record<string, string | number> };
export type A1Command = { id: string; at: number; issuerId: string; workerId: string; taskId: string; toolId: string; work: number; deliveryMinutes: number };
export type A1World = {
  schemaVersion: 1; engineVersion: "0.1-a1"; seed: number; minute: number; nextId: number;
  physical: PhysicalState; actors: Record<string, A1Actor>; tasks: Record<string, A1Task>;
  processes: Record<string, A1Process>; pending: A1Stimulus[]; events: A1Event[]; commands: A1Command[];
};

type A1Context = {
  energy: number; ownProcess?: { taskId: string; remaining: number };
  knownTasks: Pick<A1Task, "id" | "toolId" | "work">[];
};
type A1SubjectiveState = { knownTaskIds: string[] };
type A1Attempt = { kind: "start_work"; taskId: string };
export type A1ActorInput = ActorInput<A1Context, A1SubjectiveState, A1Stimulus>;
export type A1ActorResponse = ActorResponse<A1Attempt, A1SubjectiveState, A1Actor["wait"]>;
export type A1ActorModel = PersonalityModel<A1ActorInput, A1ActorResponse>;

/** The first personality implementation: a task is attempted if the actor has enough energy. */
export const ordinaryA1Model: A1ActorModel = {
  decide(input) {
    const known = new Set(input.subjectiveState.knownTaskIds);
    for (const stimulus of input.stimuli) {
      if (stimulus.kind === "work_offer" && stimulus.taskId) known.add(stimulus.taskId);
      if ((stimulus.kind === "work_completed" || stimulus.kind === "work_failed") && stimulus.taskId) known.delete(stimulus.taskId);
    }
    const task = input.knownContext.knownTasks.find((item) => known.has(item.id) && input.knownContext.energy >= item.work);
    if (input.knownContext.ownProcess) return { subjectiveUpdate: { knownTaskIds: [...known] }, attempts: [], wait: { forKinds: ["work_completed", "work_failed"] } };
    if (task) return { subjectiveUpdate: { knownTaskIds: [...known] }, attempts: [{ kind: "start_work", taskId: task.id }], wait: { until: input.at + 10, forKinds: ["tool_available", "work_offer", "work_completed", "work_failed"] } };
    return { subjectiveUpdate: { knownTaskIds: [...known] }, attempts: [], wait: { until: known.size ? input.at + 10 : undefined, forKinds: ["work_offer", "tool_available", "work_completed", "work_failed"] } };
  },
};

function id(w: A1World, prefix: string) { return `${prefix}_${w.nextId++}`; }
function emit(w: A1World, kind: string, actors: string[], causes: string[] = [], data: A1Event["data"] = {}) {
  if (causes.some((cause) => !w.events.some((event) => event.id === cause))) throw Error("unknown cause");
  const event: A1Event = { id: id(w, "event"), minute: w.minute, kind, actors, causes, data };
  w.events.push(event); return event;
}
function send(w: A1World, recipientId: string, kind: A1Stimulus["kind"], causeEventIds: string[], taskId?: string, delay = 0) {
  w.pending.push({ id: id(w, "stimulus"), recipientId, kind, occurredAt: w.minute, receivedAt: w.minute + delay, causeEventIds, taskId });
}

export function newA1World(seed = 1): A1World {
  if (!Number.isSafeInteger(seed)) throw Error("invalid seed");
  const physical: PhysicalState = {
    types: {
      world: { id: "world", tags: ["world"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["site"] } },
      site: { id: "site", tags: ["site"], unitMass: 0, stackable: false, ownable: false, container: { acceptsTags: ["person", "tool"] } },
      person: { id: "person", tags: ["person"], unitMass: 1, stackable: false, ownable: false },
      tool: { id: "tool", tags: ["tool"], unitMass: 2, stackable: false, ownable: true },
    },
    objects: Object.fromEntries([
      ["world", "world", null], ["workshop", "site", "world"],
      ["manager", "person", "workshop"], ["worker_a", "person", "workshop"], ["worker_b", "person", "workshop"],
      ["tool", "tool", "workshop"],
    ].map(([objectId, typeId, parentId]) => [objectId, { id: objectId, typeId, parentId, quantity: 1, ownerId: objectId === "tool" ? "guild" : undefined, causeEventId: "initial" }])),
    reservations: [],
  };
  checkPhysical(physical);
  return {
    schemaVersion: 1, engineVersion: "0.1-a1", seed, minute: 0, nextId: 1, physical,
    actors: Object.fromEntries(["manager", "worker_a", "worker_b"].map((actorId) => [actorId, {
      id: actorId, energy: 10, knownTaskIds: [], inbox: [], wait: { forKinds: ["work_offer", "tool_available", "work_completed", "work_failed"] },
    }])),
    tasks: {}, processes: {}, pending: [], events: [], commands: [],
  };
}

function startWork(w: A1World, actorId: string, taskId: string, decisionId: string) {
  const task = w.tasks[taskId], actor = w.actors[actorId];
  if (!task || task.workerId !== actorId || task.status !== "offered" || !actor.knownTaskIds.includes(taskId)) return false;
  if (Object.values(w.processes).some((process) => process.actorId === actorId) || actor.energy < task.work) return false;
  if (siteOf(w.physical, actorId) !== siteOf(w.physical, task.toolId)) return false;
  const claimId = id(w, "claim");
  const held = physicalTransaction(w.physical, { actorId, ownerIds: ["guild"] }, (tx) => tx.reserve(task.toolId, claimId, 1, actorId));
  if (!held.ok) {
    const rejection = emit(w, "attempt_rejected", [actorId], [decisionId], { taskId, reason: held.reason });
    send(w, actorId, "attempt_rejected", [rejection.id], taskId);
    return false;
  }
  w.physical = held.state;
  const event = emit(w, "work_started", [actorId], [decisionId], { taskId, toolId: task.toolId });
  const processId = id(w, "process");
  w.processes[processId] = { id: processId, taskId, actorId, toolId: task.toolId, claimId, remaining: task.work, lastEventId: event.id };
  task.status = "working";
  return true;
}

function deliver(w: A1World) {
  const due = w.pending.filter((stimulus) => stimulus.receivedAt <= w.minute).sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id));
  w.pending = w.pending.filter((stimulus) => stimulus.receivedAt > w.minute);
  for (const stimulus of due) {
    w.actors[stimulus.recipientId].inbox.push(stimulus);
    emit(w, "stimulus_received", [stimulus.recipientId], stimulus.causeEventIds, { stimulusId: stimulus.id, kind: stimulus.kind });
  }
}

function decideReady(w: A1World, model: A1ActorModel) {
  for (const actor of Object.values(w.actors).sort((a, b) => a.id.localeCompare(b.id))) {
    const ready = actor.inbox.some((stimulus) => actor.wait.forKinds.includes(stimulus.kind)) || actor.wait.until !== undefined && actor.wait.until <= w.minute;
    if (!ready) continue;
    const stimuli = actor.inbox.splice(0);
    const process = Object.values(w.processes).find((item) => item.actorId === actor.id);
    const knownIds = [...new Set([...actor.knownTaskIds, ...stimuli.filter((item) => item.kind === "work_offer").map((item) => item.taskId).filter((item): item is string => !!item)])];
    const input: A1ActorInput = {
      actorId: actor.id, at: w.minute, stimuli, subjectiveState: { knownTaskIds: actor.knownTaskIds },
      knownContext: {
        energy: actor.energy, ownProcess: process ? { taskId: process.taskId, remaining: process.remaining } : undefined,
        knownTasks: knownIds.map((taskId) => w.tasks[taskId]).filter((task): task is A1Task => !!task).map(({ id, toolId, work }) => ({ id, toolId, work })),
      },
    };
    const response = model.decide(input);
    if (response.subjectiveUpdate) actor.knownTaskIds = response.subjectiveUpdate.knownTaskIds;
    actor.wait = response.wait;
    const causes = stimuli.flatMap((stimulus) => stimulus.causeEventIds);
    const decision = emit(w, "actor_decided", [actor.id], causes, { attempts: response.attempts.length });
    for (const attempt of response.attempts.slice(0, 2)) {
      if (attempt.kind !== "start_work") continue;
      const started = startWork(w, actor.id, attempt.taskId, decision.id);
      if (!started) emit(w, "actor_waited", [actor.id], [decision.id], { taskId: attempt.taskId });
    }
  }
}

function progress(w: A1World) {
  for (const process of Object.values(w.processes).sort((a, b) => a.id.localeCompare(b.id))) {
    const actor = w.actors[process.actorId];
    if (actor.energy < 1) {
      const failed = emit(w, "work_failed", [actor.id], [process.lastEventId], { taskId: process.taskId });
      w.tasks[process.taskId].status = "failed";
      release(w, process, failed.id);
      send(w, actor.id, "work_failed", [failed.id], process.taskId);
      continue;
    }
    actor.energy -= 1;
    process.remaining -= 1;
    const step = emit(w, "work_progressed", [actor.id], [process.lastEventId], { taskId: process.taskId, remaining: process.remaining, energy: actor.energy });
    process.lastEventId = step.id;
    if (process.remaining === 0) {
      const done = emit(w, "work_completed", [actor.id], [step.id], { taskId: process.taskId });
      w.tasks[process.taskId].status = "completed";
      release(w, process, done.id);
      send(w, actor.id, "work_completed", [done.id], process.taskId);
    }
  }
}

function release(w: A1World, process: A1Process, causeEventId: string) {
  const result = physicalTransaction(w.physical, { actorId: process.actorId, ownerIds: ["guild"] }, (tx) => tx.release(process.claimId));
  if (!result.ok) throw Error(`release failed: ${result.reason}`);
  w.physical = result.state;
  delete w.processes[process.id];
  const event = emit(w, "tool_released", [process.actorId], [causeEventId], { toolId: process.toolId });
  for (const actor of Object.values(w.actors)) {
    if (actor.id !== process.actorId && actor.wait.forKinds.includes("tool_available") && siteOf(w.physical, actor.id) === siteOf(w.physical, process.toolId))
      send(w, actor.id, "tool_available", [event.id]);
  }
}

export function offerA1(w: A1World, command: A1Command, model: A1ActorModel = ordinaryA1Model) {
  if (command.at !== w.minute || w.commands.some((item) => item.id === command.id) || w.tasks[command.taskId] ||
    command.issuerId !== "manager" || !w.actors[command.workerId] || !w.physical.objects[command.toolId] ||
    !Number.isSafeInteger(command.work) || command.work < 1 || !Number.isSafeInteger(command.deliveryMinutes) || command.deliveryMinutes < 0) return false;
  w.commands.push(structuredClone(command));
  const event = emit(w, "work_offered", [command.issuerId], [], { taskId: command.taskId, workerId: command.workerId });
  w.tasks[command.taskId] = { id: command.taskId, issuerId: command.issuerId, workerId: command.workerId, toolId: command.toolId, work: command.work, status: "offered", offerEventId: event.id };
  send(w, command.workerId, "work_offer", [event.id], command.taskId, command.deliveryMinutes);
  deliver(w); decideReady(w, model); checkA1(w);
  return true;
}

export function advanceA1(w: A1World, minutes: number, model: A1ActorModel = ordinaryA1Model) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw Error("invalid time");
  for (let step = 0; step < minutes; step++) {
    w.minute++;
    progress(w); deliver(w); decideReady(w, model);
  }
  checkA1(w); return w;
}

export function checkA1(w: A1World) {
  if (w.schemaVersion !== 1 || w.engineVersion !== "0.1-a1" || !Number.isSafeInteger(w.minute) || w.minute < 0) throw Error("incompatible A1 world");
  checkPhysical(w.physical);
  const eventIds = new Set(w.events.map((event) => event.id));
  if (eventIds.size !== w.events.length || w.events.some((event) => event.causes.some((cause) => !eventIds.has(cause)))) throw Error("invalid event chain");
  for (const actor of Object.values(w.actors)) if (!w.physical.objects[actor.id] || !Number.isSafeInteger(actor.energy) || actor.energy < 0) throw Error("invalid actor");
  for (const process of Object.values(w.processes)) {
    if (w.tasks[process.taskId]?.status !== "working" || !w.actors[process.actorId] || process.remaining < 1 ||
      !eventIds.has(process.lastEventId) || !w.physical.reservations.some((claim) => claim.id === process.claimId && claim.objectId === process.toolId && claim.claimantId === process.actorId)) throw Error("invalid process");
  }
  for (const claim of w.physical.reservations)
    if (!Object.values(w.processes).some((process) => process.claimId === claim.id && process.toolId === claim.objectId && process.actorId === claim.claimantId)) throw Error("orphan claim");
  if (new Set(Object.values(w.processes).map((process) => process.actorId)).size !== Object.keys(w.processes).length) throw Error("actor double booked");
  for (const task of Object.values(w.tasks)) if (task.status === "working" && !Object.values(w.processes).some((process) => process.taskId === task.id)) throw Error("orphan task");
  for (const stimulus of [...w.pending, ...Object.values(w.actors).flatMap((actor) => actor.inbox)])
    if (!w.actors[stimulus.recipientId] || stimulus.causeEventIds.some((cause) => !eventIds.has(cause))) throw Error("invalid stimulus");
}

export function saveA1(w: A1World) { checkA1(w); return JSON.stringify(w); }
export function loadA1(serialized: string): A1World { const w = JSON.parse(serialized) as A1World; checkA1(w); return w; }
export function replayA1(seed: number, commands: A1Command[], until: number) {
  const w = newA1World(seed);
  for (const command of commands) {
    advanceA1(w, command.at - w.minute);
    if (!offerA1(w, command)) throw Error("invalid replay command");
  }
  advanceA1(w, until - w.minute); return w;
}
