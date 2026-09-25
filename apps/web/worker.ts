import { newGame, tick, observe } from "../../packages/sim/engine";
import { load, save, submit } from "../../packages/sim/core";
import { debugSnapshot } from "../../packages/sim/debug";
let world = newGame();
self.onmessage = ({ data }) => {
  try {
    let result: unknown;
    if (data.type === "new") world = newGame(data.seed);
    if (data.type === "advance") {
      let left = data.minutes;
      while (left > 0 && !world.outcome) {
        const before = world.people.a_0000.beliefs.length;
        const n = Math.min(60, left);
        tick(world, n);
        left -= n;
        if (
          data.stopReports &&
          world.people.a_0000.beliefs
            .slice(before)
            .some((r) =>
              [
                "battle_end",
                "treaty",
                "promise_breached",
                "order_response",
              ].includes(r.kind),
            )
        )
          break;
      }
    }
    if (data.type === "command") result = submit(world, "a_0000", data.action);
    if (data.type === "load") world = load(data.save);
    if (data.type === "save") {
      self.postMessage({ type: "saved", save: save(world) });
      return;
    }
    if (data.type === "debug") {
      self.postMessage({
        type: "debug",
        snapshot: debugSnapshot(world, data.query, data.personId, data.offset),
      });
      return;
    }
    self.postMessage({ type: "state", observation: observe(world), result });
  } catch (error) {
    self.postMessage({ type: "error", error: String(error) });
  }
};
