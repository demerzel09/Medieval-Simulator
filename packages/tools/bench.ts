import { writeFileSync } from "node:fs";
import os from "node:os";
import { newGame, arrivals, apply, runAI } from "../sim/engine";
import { advance, check } from "../sim/core";
import { dailyEconomy } from "../sim/economy";
import { battleTick, militaryHour } from "../sim/military";
const args = process.argv.slice(2);
const arg = (key: string, def: string) => {
  const i = args.indexOf(key);
  return i < 0 ? def : args[i + 1];
};
const profile = arg("--profile", "world-1000");
if (profile !== "world-1000")
  throw Error(
    "world-30000はM6未実装。人数を縮小して成功と報告しません。--profile world-1000 を指定してください。",
  );
const days = Number(arg("--days", "100")),
  warmup = Number(arg("--warmup-days", "10"));
if (
  !Number.isSafeInteger(days) ||
  days < 1 ||
  !Number.isSafeInteger(warmup) ||
  warmup < 0
)
  throw Error("invalid duration");
const samples: number[] = [];
for (const seed of [240924, 42, 71]) {
  const w = newGame(seed);
  for (let i = 0; i < warmup + days; i++) {
    const start = performance.now();
    advance(w, 1440, {
      arrivals,
      apply,
      battle: battleTick,
      hour: militaryHour,
      day: (w) => {
        dailyEconomy(w);
        runAI(w);
      },
    });
    const elapsed = performance.now() - start;
    if (i >= warmup) samples.push(elapsed);
  }
  check(w);
}
samples.sort((a, b) => a - b);
const result = {
  profile,
  population: 1000,
  seeds: [240924, 42, 71],
  warmupDays: warmup,
  measuredDays: days,
  samples: samples.length,
  p50Ms: samples[Math.floor(samples.length * 0.5)],
  p95Ms: samples[Math.floor(samples.length * 0.95)],
  maxMs: samples.at(-1),
  rssMB: process.memoryUsage().rss / 1024 / 1024,
  environment: {
    cpu: os.cpus()[0].model,
    ramGB: os.totalmem() / 1024 ** 3,
    os: os.release(),
    node: process.version,
  },
  note: "日全体のheadless処理。M6やブラウザfpsの受入結果ではない。90日終了条件のみベンチでは無効。",
};
writeFileSync("artifacts/benchmark.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
