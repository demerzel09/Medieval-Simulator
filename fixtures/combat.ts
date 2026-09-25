import { newGame } from "../packages/sim/engine";
import { beginBattle, battleTick } from "../packages/sim/military";
export function combatFixture(
  change:
    | "control"
    | "highland"
    | "hungry"
    | "distant"
    | "retreat_now"
    | "retreat_late",
  minutes = 90,
) {
  const w = newGame(2);
  const a = Object.values(w.units).find((u) => u.factionId === "a")!,
    b = Object.values(w.units).find((u) => u.factionId === "b")!;
  const battle = beginBattle(w, "pass", [a.id, b.id], w.events[0].id);
  a.x = 29;
  b.x = 30;
  a.y = b.y = 32;
  if (change === "highland") battle.terrain[a.y * 64 + a.x] = "highland";
  if (change === "hungry")
    for (const id of a.memberIds) w.people[id].hunger = 3;
  if (change === "distant") a.x = 0;
  if (change === "retreat_now") a.intent = "retreat";
  for (let i = 0; i < minutes; i++) {
    w.minute++;
    if (change === "retreat_late" && i === 60) a.intent = "retreat";
    battleTick(w);
  }
  return { world: w, battle };
}
