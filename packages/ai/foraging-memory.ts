import type { VillageContext } from "./autonomous-world";
import { personalChoiceOrder } from "./personal-choice";

type Place = { siteId: string; x: number; y: number; seenAt: number; available: number; ripe: boolean;
  checkAt: number; visitedAt?: number };
export type ForagingMemory = { places: Record<string, Place> };
/** Remember delivered local observations; a distant remembered plant is a place to check, not guaranteed food. */
export function rememberForaging(m: ForagingMemory, c: VillageContext, at: number) {
  for (const p of c.visiblePlants) if (["herb", "wild_berry", "fruit_tree"].includes(p.species) && p.cell && p.siteId) {
    const previous = m.places[p.id];
    m.places[p.id] = { siteId: p.siteId, x: p.cell.x, y: p.cell.y, seenAt: at, available: p.available,
      ripe: p.stage === "ripe" && p.available >= (p.species === "herb" ? 2 : 1),
      checkAt: p.stage === "ripe" ? at : at + 24,
      ...(c.siteId === p.siteId ? { visitedAt: at } : previous?.visitedAt === undefined ? {} : { visitedAt: previous.visitedAt }) };
  }
  while (Object.keys(m.places).length > 12) delete m.places[Object.keys(m.places).sort((a, b) =>
    m.places[a].seenAt - m.places[b].seenAt || a.localeCompare(b))[0]];
}
export function forageDestination(m: ForagingMemory, c: VillageContext, at: number, actorId?: string) {
  const distance = (p: Place) => Math.max(Math.abs(p.x - c.cell.x), Math.abs(p.y - c.cell.y));
  const order = (a: Place, b: Place) => (actorId ? personalChoiceOrder(actorId, a.siteId) - personalChoiceOrder(actorId, b.siteId) : 0) || a.siteId.localeCompare(b.siteId);
  const candidates = Object.values(m.places).filter((p) => p.siteId !== c.siteId && (p.visitedAt === undefined || at - p.visitedAt >= 12));
  const food = candidates.filter((p) => p.ripe && p.checkAt <= at).sort((a, b) => distance(a) - distance(b) || order(a, b))[0];
  if (food) return { siteId: food.siteId, reason: "revisit personally observed food cell; confirm availability on arrival" };
  // Move to a known edge of the depleted patch so the next local observation covers other cells.
  const explore = candidates.sort((a, b) => a.seenAt - b.seenAt || distance(b) - distance(a) || order(a, b))[0];
  return explore ? { siteId: explore.siteId, reason: "explore beyond locally depleted food cells" } : undefined;
}
export function checkForagingMemory(m: ForagingMemory, at: number) {
  if (Object.keys(m.places).length > 12 || Object.values(m.places).some((p) => !p.siteId ||
    !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || !Number.isSafeInteger(p.seenAt) || p.seenAt < 0 || p.seenAt > at ||
    !Number.isSafeInteger(p.available) || p.available < 0 || !Number.isSafeInteger(p.checkAt) || p.checkAt < p.seenAt ||
    p.visitedAt !== undefined && (!Number.isSafeInteger(p.visitedAt) || p.visitedAt < 0 || p.visitedAt > at))) throw Error("invalid foraging memory");
}
