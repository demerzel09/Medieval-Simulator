import { advanceLifeWorld, lifeSummary, newLifeWorld } from "../sim/individual-life";

const days = Number(process.argv[2] ?? 30);
if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw Error("days must be 1..90");
const w = newLifeWorld();
const daily = [];
for (let day = 1; day <= days; day++) { advanceLifeWorld(w, 24); daily.push({ day, ...lifeSummary(w) }); }
console.log(JSON.stringify({ mode: w.mode, seed: w.seed, days, daily }, null, 2));
