import { advanceMarketDay, marketSummary, newMarketWorld } from "../sim/individual-market";

const days = Number(process.argv[2] ?? 7);
if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw Error("days must be 1..90");
const w = newMarketWorld();
const daily = [];
for (let day = 0; day < days; day++) { advanceMarketDay(w); daily.push(marketSummary(w)); }
console.log(JSON.stringify({ mode: w.mode, seed: w.seed, daily,
  events: process.argv.includes("--events") ? w.events : undefined }, null, 2));
