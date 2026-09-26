import { writeFileSync } from "node:fs";
import { hash } from "../sim/core";
import { advanceLocalV2, localV2Summary, newLocalWorldV2, submitLocalV2 } from "../sim/local-economy-v2";

const args = process.argv.slice(2);
const scenario = args[0] ?? "baseline";
const allowed = ["baseline", "carrier-absent", "buyer-no-money", "farmer-absent"];
if (!allowed.includes(scenario)) throw Error(`scenario must be ${allowed.join(" | ")}`);
const outputIndex = args.indexOf("--output");
if (outputIndex >= 0 && !args[outputIndex + 1]) throw Error("--output needs a file path");
const w = newLocalWorldV2();
if (scenario === "carrier-absent") submitLocalV2(w, "C", { kind: "ABSENT", personId: "C", day: 2 });
if (scenario === "buyer-no-money") submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 });
if (scenario === "farmer-absent") submitLocalV2(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 });
const days = [];
for (let day = 1; day <= 3; day++) {
  advanceLocalV2(w, 1440);
  days.push(localV2Summary(w));
}
const report = { scenario, seed: w.seed, contentHash: w.contentHash, worldHash: hash(w), days,
  shipments: w.shipments.map((s) => ({ day: s.day, status: s.status, quantity: s.quantity })),
  eventCount: w.events.length, taskCount: w.tasks.length };
if (outputIndex >= 0) writeFileSync(args[outputIndex + 1], JSON.stringify({ report, world: w }, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
