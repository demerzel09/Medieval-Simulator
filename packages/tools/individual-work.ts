import { advanceWorkWorld, newWorkWorld } from "../sim/individual-work";
import { contentsQuantity } from "../sim/physical";

const hours = Number(process.argv[2] ?? 8);
if (!Number.isSafeInteger(hours) || hours < 1 || hours > 90 * 24) throw Error("hours must be 1..2160");
const w = advanceWorkWorld(newWorkWorld(), hours);
console.log(JSON.stringify({ mode: w.mode, seed: w.seed, hour: w.hour, offer: w.offer,
  resource: w.resource, harvested: w.harvested,
  people: Object.fromEntries((["S", "F"] as const).map((id) => [id, {
    food: contentsQuantity(w.physical, `bag_${id}`, "food"),
    cash: contentsQuantity(w.physical, `wallet_${id}`, "currency"),
    belief: w.people[id].memory.stage,
  }])),
  events: process.argv.includes("--events") ? w.events : undefined }, null, 2));
