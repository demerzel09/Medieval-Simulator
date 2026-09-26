import { advanceA1, newA1World, offerA1 } from "../sim/autonomy-a1";

const world = newA1World(42);
for (const [id, workerId] of [["job_a", "worker_a"], ["job_b", "worker_b"]] as const) {
  const accepted = offerA1(world, { id, at: 0, issuerId: "manager", workerId, taskId: id, toolId: "tool", work: 3, deliveryMinutes: 0 });
  if (!accepted) throw Error(`offer rejected: ${id}`);
}
advanceA1(world, 6);
console.log(JSON.stringify({
  minute: world.minute,
  tasks: Object.values(world.tasks).map(({ id, workerId, status }) => ({ id, workerId, status })),
  energy: Object.fromEntries(Object.values(world.actors).map(({ id, energy }) => [id, energy])),
  events: world.events.map(({ minute, kind, actors, causes, data }) => ({ minute, kind, actors, causes, data })),
}, null, 2));
