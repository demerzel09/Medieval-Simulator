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
type QueueEntry = { key: string; point: GridPoint; g: number; f: number;
  turns?: number; direction?: string };
const before = (a: QueueEntry, b: QueueEntry) => a.f - b.f || a.g - b.g ||
  a.point.y - b.point.y || a.point.x - b.point.x;
class MinQueue {
  private heap: QueueEntry[] = [];
  constructor(private compare = before) {}
  get length() { return this.heap.length; }
  push(entry: QueueEntry) {
    const h = this.heap; h.push(entry);
    for (let i = h.length - 1; i > 0;) {
      const parent = Math.floor((i - 1) / 2);
      if (this.compare(h[parent], h[i]) <= 0) break;
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
        const next = right < h.length && this.compare(h[right], h[left]) < 0 ? right : left;
        if (this.compare(h[i], h[next]) <= 0) break;
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

/** Octile A*: geometric step costs, no corner cutting, fewer turns on equal-cost routes. */
export function findGridPathV2(map: GridMap, start: GridPoint, goal: GridPoint): GridPoint[] | undefined {
  const blocked = new Set(map.blocked);
  const passable = (p: GridPoint) => inGrid(map, p) && !blocked.has(cellKey(p));
  if (!passable(start) || !passable(goal)) return undefined;
  const estimate = (p: GridPoint) => {
    const dx = Math.abs(p.x - goal.x), dy = Math.abs(p.y - goal.y);
    return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
  };
  const startKey = cellKey(start), goalKey = cellKey(goal);
  const score = new Map([[startKey, 0]]), turns = new Map([[startKey, 0]]);
  const parent = new Map<string, string>();
  const open = new MinQueue((a, b) => a.f - b.f || b.g - a.g ||
    (a.turns ?? 0) - (b.turns ?? 0) || a.point.y - b.point.y || a.point.x - b.point.x);
  open.push({ key: startKey, point: start, g: 0, f: estimate(start), turns: 0 });
  while (open.length) {
    const current = open.pop();
    if (current.g !== score.get(current.key) || current.turns !== turns.get(current.key)) continue;
    if (current.key === goalKey) {
      const route: GridPoint[] = [];
      for (let key: string | undefined = goalKey; key; key = parent.get(key)) {
        const [x, y] = key.split(",").map(Number); route.push({ x, y });
      }
      return route.reverse();
    }
    for (const d of directions) {
      const next = { x: current.point.x + d.x, y: current.point.y + d.y };
      if (!passable(next) || d.x && d.y &&
        (!passable({ x: current.point.x + d.x, y: current.point.y }) ||
          !passable({ x: current.point.x, y: current.point.y + d.y }))) continue;
      const key = cellKey(next), direction = `${d.x},${d.y}`;
      const g = current.g + (d.x && d.y ? 14 : 10) * (map.cost[key] ?? 1);
      const turnCount = (current.turns ?? 0) +
        (current.direction && current.direction !== direction ? 1 : 0);
      if (g > (score.get(key) ?? Infinity) ||
        g === score.get(key) && turnCount >= (turns.get(key) ?? Infinity)) continue;
      parent.set(key, current.key); score.set(key, g); turns.set(key, turnCount);
      open.push({ key, point: next, g, f: g + estimate(next), turns: turnCount, direction });
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

/** Extra food patches are learned through the forager's local observation. */
export function exploringVillageGrid(): GridMap {
  const grid = wideVillageGrid();
  return { ...grid, sites: { ...grid.sites,
    herb_patch_2: { x: 12, y: 8 }, orchard_2: { x: 13, y: 16 },
  } };
}

/** Distinct harvest cells and enough crop plots for longer growth and fallow cycles. */
export function ecologicalVillageGrid(): GridMap {
  const grid = exploringVillageGrid();
  return { ...grid, sites: { ...grid.sites,
    berry_patch_1: { x: 14, y: 11 }, berry_patch_2: { x: 17, y: 10 },
    berry_patch_3: { x: 18, y: 13 }, berry_patch_4: { x: 14, y: 15 },
    herb_patch_3: { x: 13, y: 10 }, herb_patch_4: { x: 17, y: 8 },
    herb_patch_5: { x: 18, y: 10 }, herb_patch_6: { x: 18, y: 15 },
    herb_patch_7: { x: 15, y: 16 }, herb_patch_8: { x: 12, y: 12 },
    grass_patch_2: { x: 36, y: 18 }, grass_patch_3: { x: 34, y: 18 },
    grass_patch_4: { x: 37, y: 21 },
    grass_patch_5: { x: 33, y: 17 }, grass_patch_6: { x: 35, y: 17 },
    grass_patch_7: { x: 37, y: 17 }, grass_patch_8: { x: 33, y: 19 },
    grass_patch_9: { x: 34, y: 20 }, grass_patch_10: { x: 36, y: 20 },
    grain_plot_5: { x: 33, y: 3 }, grain_plot_6: { x: 34, y: 3 },
    grain_plot_7: { x: 35, y: 3 }, grain_plot_8: { x: 36, y: 3 },
    grain_plot_9: { x: 36, y: 4 }, grain_plot_10: { x: 37, y: 4 },
    grain_plot_11: { x: 36, y: 5 }, grain_plot_12: { x: 37, y: 5 },
  } };
}

/** Three separate fields, each with four crop cells and its own farmer. */
export function ownedFarmsVillageGrid(): GridMap {
  const grid = ecologicalVillageGrid();
  return { ...grid, sites: { ...grid.sites,
    field_B1: { x: 4, y: 6 }, field_B2: { x: 5, y: 19 },
    grain_plot_5: { x: 3, y: 5 }, grain_plot_6: { x: 4, y: 5 },
    grain_plot_7: { x: 3, y: 6 }, grain_plot_8: { x: 4, y: 7 },
    grain_plot_9: { x: 4, y: 18 }, grain_plot_10: { x: 5, y: 18 },
    grain_plot_11: { x: 4, y: 19 }, grain_plot_12: { x: 5, y: 20 },
  } };
}
