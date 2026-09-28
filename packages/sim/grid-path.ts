/** Deterministic A* on a rectangular, eight-neighbour grid. Every step costs at least one. */
export type GridPoint = { x: number; y: number };
export type GridMap = { width: number; height: number; blocked: string[];
  cost: Record<string, number>; sites: Record<string, GridPoint> };
export const cellKey = ({ x, y }: GridPoint) => `${x},${y}`;
export const sameCell = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
export function inGrid(map: GridMap, p: GridPoint) {
  return Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && p.x >= 0 && p.y >= 0 &&
    p.x < map.width && p.y < map.height;
}
export function traversable(map: GridMap, p: GridPoint) {
  return inGrid(map, p) && !map.blocked.includes(cellKey(p));
}
const heuristic = (a: GridPoint, b: GridPoint) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
type QueueEntry = { key: string; point: GridPoint; g: number; f: number };
const before = (a: QueueEntry, b: QueueEntry) => a.f - b.f || a.g - b.g ||
  a.point.y - b.point.y || a.point.x - b.point.x;
class MinQueue {
  private heap: QueueEntry[] = [];
  get length() { return this.heap.length; }
  push(entry: QueueEntry) {
    const h = this.heap; h.push(entry);
    for (let i = h.length - 1; i > 0;) {
      const parent = Math.floor((i - 1) / 2);
      if (before(h[parent], h[i]) <= 0) break;
      [h[parent], h[i]] = [h[i], h[parent]]; i = parent;
    }
  }
  pop(): QueueEntry {
    const h = this.heap, result = h[0], tail = h.pop()!;
    if (h.length) {
      h[0] = tail;
      for (let i = 0;;) {
        const left = i * 2 + 1, right = left + 1;
        if (left >= h.length) break;
        const next = right < h.length && before(h[right], h[left]) < 0 ? right : left;
        if (before(h[i], h[next]) <= 0) break;
        [h[i], h[next]] = [h[next], h[i]]; i = next;
      }
    }
    return result;
  }
}
const directions = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
export function checkGridMap(map: GridMap) {
  if (!Number.isSafeInteger(map.width) || !Number.isSafeInteger(map.height) || map.width < 1 ||
    map.height < 1 || map.width * map.height > 65536 ||
    new Set(map.blocked).size !== map.blocked.length ||
    map.blocked.some((key) => { const [x, y] = key.split(",").map(Number);
      return !inGrid(map, { x, y }) || cellKey({ x, y }) !== key; }) ||
    Object.entries(map.cost).some(([key, cost]) => { const [x, y] = key.split(",").map(Number);
      return !inGrid(map, { x, y }) || cellKey({ x, y }) !== key ||
        !Number.isSafeInteger(cost) || cost < 1; }) ||
    Object.values(map.sites).some((p) => !traversable(map, p))) throw Error("invalid grid map");
}
export function findGridPath(map: GridMap, start: GridPoint, goal: GridPoint): GridPoint[] | undefined {
  if (!traversable(map, start) || !traversable(map, goal)) return undefined;
  const startKey = cellKey(start), goalKey = cellKey(goal);
  const open = new MinQueue(), g = new Map([[startKey, 0]]), parent = new Map<string, string>();
  open.push({ key: startKey, point: start, g: 0, f: heuristic(start, goal) });
  while (open.length) {
    const current = open.pop(), key = current.key;
    if (current.g !== g.get(key)) continue; // A cheaper entry superseded this one.
    if (key === goalKey) {
      const route: GridPoint[] = [];
      for (let cursor: string | undefined = key; cursor; cursor = parent.get(cursor)) {
        const [x, y] = cursor.split(",").map(Number); route.push({ x, y });
      }
      return route.reverse();
    }
    const { x, y } = current.point;
    for (const d of directions) {
      const next = { x: x + d.x, y: y + d.y }, nextKey = cellKey(next);
      if (!traversable(map, next)) continue;
      if (d.x && d.y && (!traversable(map, { x: x + d.x, y }) ||
        !traversable(map, { x, y: y + d.y }))) continue;
      const tentative = g.get(key)! + (map.cost[nextKey] ?? 1);
      if (tentative >= (g.get(nextKey) ?? Infinity)) continue;
      parent.set(nextKey, key); g.set(nextKey, tentative);
      open.push({ key: nextKey, point: next, g: tentative,
        f: tentative + heuristic(next, goal) });
    }
  }
  return undefined;
}
export function defaultVillageGrid(): GridMap {
  return { width: 5, height: 5, blocked: [], cost: {}, sites: {
    market: { x: 2, y: 2 }, grove: { x: 2, y: 1 },
    home_B1: { x: 1, y: 2 }, home_B2: { x: 3, y: 2 },
    field: { x: 1, y: 1 }, meadow: { x: 3, y: 1 },
  } };
}

/** 40×24 cells at 32 pixels per cell: a 1280×768 physical playfield. */
export function spatialVillageGrid(): GridMap {
  const blocked: string[] = [];
  const rectangle = (left: number, top: number, width: number, height: number) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++)
      blocked.push(`${x},${y}`);
  };
  rectangle(7, 5, 5, 3);    // rocks
  rectangle(25, 4, 8, 4);   // ridge
  rectangle(29, 14, 5, 5);  // boulders
  rectangle(15, 15, 2, 2);  // building footprint
  return { width: 40, height: 24, blocked, cost: {}, sites: {
    market: { x: 18, y: 12 }, grove: { x: 19, y: 11 },
    home_B1: { x: 18, y: 11 }, home_B2: { x: 19, y: 12 },
    field: { x: 20, y: 11 }, meadow: { x: 22, y: 12 },
    orchard: { x: 23, y: 11 }, herb_patch: { x: 19, y: 10 },
    grass_patch: { x: 23, y: 12 },
    rock_west: { x: 6, y: 6 }, ridge_east: { x: 34, y: 6 },
    grain_plot: { x: 20, y: 10 }, grain_plot_2: { x: 21, y: 10 },
    grain_plot_3: { x: 21, y: 11 }, grain_plot_4: { x: 21, y: 12 },
  } };
}

/** The working village uses the full 40×24 field, with obstacles between its sites. */
export function wideVillageGrid(): GridMap {
  const blocked: string[] = [];
  const rectangle = (left: number, top: number, width: number, height: number) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++)
      blocked.push(`${x},${y}`);
  };
  rectangle(8, 10, 4, 5);   // rock wall between market and grove
  rectangle(21, 6, 5, 8);   // ridge between grove and field
  rectangle(27, 14, 5, 5);  // boulders between field and meadow
  rectangle(6, 3, 3, 3);    // outbuilding
  return { width: 40, height: 24, blocked, cost: {}, sites: {
    market: { x: 4, y: 12 }, grove: { x: 16, y: 12 },
    home_B1: { x: 2, y: 4 }, home_B2: { x: 3, y: 20 },
    field: { x: 34, y: 5 }, meadow: { x: 35, y: 19 },
    orchard: { x: 34, y: 8 }, herb_patch: { x: 15, y: 9 },
    grass_patch: { x: 31, y: 21 },
    rock_west: { x: 7, y: 8 }, ridge_east: { x: 37, y: 7 },
    grain_plot: { x: 34, y: 4 }, grain_plot_2: { x: 35, y: 4 },
    grain_plot_3: { x: 35, y: 5 }, grain_plot_4: { x: 35, y: 6 },
  } };
}
