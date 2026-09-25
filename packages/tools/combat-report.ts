import { writeFileSync } from "node:fs";
import { combatFixture } from "../../fixtures/combat";
const report = Object.fromEntries(
  (
    [
      "control",
      "highland",
      "hungry",
      "distant",
      "retreat_now",
      "retreat_late",
    ] as const
  ).map((k) => {
    const { battle } = combatFixture(k);
    return [
      k,
      {
        losses: battle.losses,
        winner: battle.winner ?? null,
        status: battle.status,
      },
    ];
  }),
);
report.highland_51min = {
  losses: combatFixture("highland", 51).battle.losses,
  winner: combatFixture("highland", 51).battle.winner ?? null,
  status: combatFixture("highland", 51).battle.status,
};
report.control_51min = {
  losses: combatFixture("control", 51).battle.losses,
  winner: combatFixture("control", 51).battle.winner ?? null,
  status: combatFixture("control", 51).battle.status,
};
console.log(report);
writeFileSync(
  "artifacts/combat-fixtures.json",
  JSON.stringify(report, null, 2),
);
