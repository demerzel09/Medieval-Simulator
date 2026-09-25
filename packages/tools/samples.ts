import { writeFileSync } from "node:fs";
import { newGame, tick } from "../sim/engine";
import { submit, save, check } from "../sim/core";
const peace = newGame();
submit(peace, "a_0000", {
  kind: "NEGOTIATE",
  amount: 3000,
  nonAggression: true,
  durationDays: 120,
});
submit(peace, "a_0000", {
  kind: "PROPOSE_PROMISE",
  beneficiaries: ["a_0002"],
  amount: 40,
  dueDay: 5,
  trigger: "always",
  promiseKind: "family",
  escrow: true,
  inherited: true,
});
tick(peace, 3 * 1440);
check(peace);
writeFileSync("artifacts/sample-day3.json", save(peace));
const war = newGame();
submit(war, "a_0000", {
  kind: "RECRUIT",
  count: 80,
  purpose: "expedition",
  termDays: 90,
  reward: 20,
});
tick(war, 1440);
for (const u of Object.values(war.units).filter((u) => u.factionId === "a")) {
  submit(war, "a_0000", { kind: "DISPATCH_SUPPLY", unitId: u.id, amount: 250 });
  submit(war, "a_0000", {
    kind: "ISSUE_ORDER",
    unitId: u.id,
    intent: "attack",
    destination: "pass",
    fallback: "capital",
    retreatFood: 0,
  });
}
tick(war, 3 * 1440);
check(war);
writeFileSync("artifacts/sample-war-day4.json", save(war));
console.log("Sample saves written (days 3 and 4).");
