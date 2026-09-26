import { advanceLocalV2, localV2Summary, newLocalWorldA2 } from "../sim/local-economy-v2";

const world = newLocalWorldA2(240924);
const days = [];
for (let day = 1; day <= 3; day++) {
  advanceLocalV2(world, 1440);
  days.push(localV2Summary(world));
}
console.log(JSON.stringify({
  mode: world.economicMode,
  days,
  buyerDecisions: world.events.filter((event) => event.kind === "buyer_decided").map((event) => ({
    minute: event.minute, actorId: event.actors[0], action: event.data.action, causes: event.causes,
  })),
  purchaseResults: world.events.filter((event) => ["purchase_completed", "purchase_failed"].includes(event.kind)).map((event) => ({
    minute: event.minute, actorId: event.actors[0], kind: event.kind, causes: event.causes,
  })),
}, null, 2));
