import { writeFileSync, mkdirSync } from "node:fs";
import { newGame, tick } from "../sim/engine";
import { check, hash, save, submit } from "../sim/core";
const args = process.argv.slice(2);
const arg = (key: string, fallback: string) => {
  const i = args.indexOf(key);
  return i < 0 ? fallback : args[i + 1];
};
const scenario = arg("--scenario", "pass_and_harvest");
if (scenario !== "pass_and_harvest") throw Error("unknown scenario");
const w = newGame(Number(arg("--seed", "240924"))),
  path = arg("--path", "diplomacy");
if (path === "diplomacy")
  submit(w, "a_0000", {
    kind: "NEGOTIATE",
    amount: 3000,
    nonAggression: true,
    durationDays: 120,
  });
if (path === "military") {
  submit(w, "a_0000", {
    kind: "RECRUIT",
    count: 80,
    purpose: "expedition",
    termDays: 90,
    reward: 20,
  });
  tick(w, 1440);
  for (const u of Object.values(w.units).filter((u) => u.factionId === "a")) {
    submit(w, "a_0000", { kind: "DISPATCH_SUPPLY", unitId: u.id, amount: 250 });
    submit(w, "a_0000", {
      kind: "ISSUE_ORDER",
      unitId: u.id,
      intent: "attack",
      destination: "pass",
      fallback: "capital",
      retreatFood: 0,
    });
  }
}
const start = performance.now();
tick(w, Math.max(0, Number(arg("--days", "90")) * 1440 - w.minute));
check(w);
const result = {
  seed: w.seed,
  path,
  day: w.minute / 1440,
  outcome: w.outcome,
  population: w.population,
  dead: Object.values(w.people).filter((p) => !p.alive).length,
  passOwner: w.settlements.pass.factionId,
  treaties: w.treaties.length,
  battles: w.battles.map((b) => ({ winner: b.winner, losses: b.losses })),
  hash: hash(w),
  elapsedMs: Math.round(performance.now() - start),
};
const routineReportIds = new Set(
  w.events.filter((e) => e.kind === "unit_report").map((e) => e.id),
);
console.log(JSON.stringify(result, null, 2));
if (args.includes("--record")) {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    `artifacts/${path}-run.json`,
    JSON.stringify(
      {
        ...result,
        commands: w.commands,
        events: w.events.filter(
          (e) =>
            !["economy", "unit_report"].includes(e.kind) &&
            !(
              [
                "courier_assigned",
                "message_delivered",
                "message_missed",
              ].includes(e.kind) &&
              e.data.kind === "report" &&
              routineReportIds.has(e.causes[0])
            ) &&
            !(e.kind === "courier_assigned" && e.data.kind === "remittance") &&
            !(e.kind === "message_delivered" && e.data.kind === "remittance") &&
            !(e.kind === "message_missed" && e.data.kind === "remittance"),
        ),
      },
      null,
      2,
    ),
  );
  if (args.includes("--save"))
    writeFileSync(`artifacts/${path}-save.json`, save(w));
}
