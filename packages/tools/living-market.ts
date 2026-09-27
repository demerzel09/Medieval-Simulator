import { advanceMarketDay, livingMarketSummary, newLivingMarketWorld } from "../sim/individual-market";

const days = Number(process.argv[2] ?? 30);
if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw Error("days must be 1..90");
const w = newLivingMarketWorld();
const daily = [];
for (let day = 0; day < days; day++) { advanceMarketDay(w); daily.push(livingMarketSummary(w)); }
console.log(JSON.stringify({ mode: "living_market", seed: w.seed, daily,
  events: process.argv.includes("--events") ? w.events : undefined }, null, 2));
