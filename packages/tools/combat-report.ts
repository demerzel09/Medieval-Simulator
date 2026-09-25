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
console.log(report);
writeFileSync(
  "artifacts/combat-fixtures.json",
  JSON.stringify(report, null, 2),
);
