import { writeFileSync } from "node:fs";
import { hash } from "../sim/core";
import { advanceLocal, newLocalWorld, submitLocal } from "../sim/local-economy";

const args = process.argv.slice(2);
const scenario = args[0] ?? "baseline";
const allowed = ["baseline", "carrier-absent", "buyer-no-money", "farmer-absent"];
if (!allowed.includes(scenario)) throw Error(`scenario must be ${allowed.join(" | ")}`);
const outputIndex = args.indexOf("--output");
if (outputIndex >= 0 && !args[outputIndex + 1]) throw Error("--output needs a file path");
const w = newLocalWorld();
if (scenario === "carrier-absent") submitLocal(w, "C", { kind: "ABSENT", personId: "C", day: 2 });
if (scenario === "buyer-no-money") submitLocal(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 });
if (scenario === "farmer-absent") submitLocal(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 });
const days = [];
for (let day = 1; day <= 3; day++) {
  advanceLocal(w, 1440);
  days.push({
    day,
    producedFood: w.producedFood,
    consumedFood: w.consumedFood,
    farmFood: w.lots.filter((l) => l.place === "farm").reduce((n, l) => n + l.quantity, 0),
    marketFood: w.lots.filter((l) => l.place === "market" && l.ownerId === "cooperative").reduce((n, l) => n + l.quantity, 0),
    cooperativeMoney: w.wallets.cooperative,
    hungryPeople: Object.values(w.people).filter((p) => p.hunger > 0).length,
    settledOrders: w.orders.filter((o) => o.status === "settled").length,
  });
}
const report = { scenario, seed: w.seed, contentHash: w.contentHash, worldHash: hash(w), days,
  shipments: w.shipments.map((s) => ({ day: s.day, status: s.status, quantity: s.quantity })),
  eventCount: w.events.length, taskCount: w.tasks.length };
if (outputIndex >= 0) writeFileSync(args[outputIndex + 1], JSON.stringify({ report, world: w }, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
