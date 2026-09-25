import type { Command } from "../contracts";
import { newGame, tick } from "./engine";
import { submit } from "./core";
/** Recorded external commands plus the initial seed reconstruct the ordinary AI run. */
export function replay(seed: number, commands: Command[], until: number) {
  const w = newGame(seed);
  for (const c of commands
    .filter((c) => c.origin !== "ordinary_ai")
    .sort((a, b) => a.issuedAt - b.issuedAt || a.sequence - b.sequence)) {
    if (c.issuedAt > until) break;
    if (c.issuedAt < w.minute) throw Error("command history out of order");
    tick(w, c.issuedAt - w.minute);
    const result = submit(w, c.actorId, c.action, c.id, c.origin);
    if (!result.ok) throw Error(`replay rejected: ${result.reason}`);
  }
  tick(w, until - w.minute);
  return w;
}
