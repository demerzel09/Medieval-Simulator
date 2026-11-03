// 解決: 物理層の「要求 → 解決 → 適用」の真ん中の段。同じ刻みの要求が同じ資源を取り合うとき、それぞれをどれだけ通すかを決める。
// 決め方は資源のある場所に閉じ（局所性。資源ごとに独立で、どの順にも並列にもできる）、要求に載った物理量で決まる。
//   可分な負荷（移す、変える、費用）: 要求はもともと能力 × Δt なので、足りなければ比例で縮める（強く引く者が多く取る）。
//   不可分な負荷（付け替え、生む、消す、容量の使用）: 要求に載った力の大きい順に全か無か。同点は要求者の id、法則、相手の順。
//   消える事物: 消す要求が通れば、その事物に触れる他の束は落とす（消す側が勝ち、順序に依らない）。
// 持ち主の意思（好み、渡す）は解決の規則ではなく、持ち主自身の行為（法則）である。
// 取り合いの規則はこれまでに変わってきた（持ち主の好み → 要求の力）ので、世界の進行（world.ts）から分けてここに置く。

import type { Effect, Law, ThingId } from './types.js';

/** 一つの法則が一つの組に出した要求の束。不可分な効果を含めば全か無か。 */
export interface Bundle {
  lawIndex: number;
  law: Law;
  a: ThingId;
  b: ThingId;
  effects: Effect[];
}

/** 解決が世界から読むもの: 事物があるか、持ち主の資源の量（資源でなければ例外）、事物の量（消すときに使う）。 */
export interface Holdings {
  has(id: ThingId): boolean;
  amount(id: ThingId, res: string): number;
  quantity(id: ThingId): number | undefined;
}

/**
 * 要求が持ち主の資源に掛ける負荷。key は「持ち主|資源」で、同じ key の負荷どうしが取り合う。
 * force は要求者が提供した力で、不可分な物の取り合いの順になる。
 */
interface Claim {
  bundle: Bundle;
  owner: ThingId;
  key: string;
  amount: number;
  indivisible: boolean;
  force: number;
}

/** 束ごとの係数（1 は全部通す、0 は落とす、その間は比例で縮める）。束の係数は、その束の負荷の係数の最小。 */
export function resolve(bundles: Bundle[], holdings: Holdings): Map<Bundle, number> {
  const factor = new Map<Bundle, number>();
  for (const bundle of bundles) factor.set(bundle, 1);
  for (const [key, claims] of claimsByResource(bundles, holdings)) shareResource(key, claims, holdings, factor);
  dropTouchingDespawned(bundles, factor);
  return factor;
}

/** 効果を束の係数で縮める。不可分な効果は係数 1 のときだけ残る。 */
export function scaleEffect(e: Effect, f: number): Effect | undefined {
  if (f >= 1 - 1e-9) return e;
  switch (e.kind) {
    case 'transfer':
      return { ...e, amount: e.amount * f };
    case 'convert':
      return { ...e, amount: e.amount * f, produced: e.produced * f };
    case 'move':
      return { ...e, dx: e.dx * f, dy: e.dy * f, cost: e.cost * f };
    case 'use':
    case 'reassign':
    case 'spawn':
    case 'despawn':
    case 'relate':
    case 'die':
      return undefined;
  }
}

/** 負荷を資源ごと（key ごと）に集める。key の順に並べる。 */
function claimsByResource(bundles: Bundle[], holdings: Holdings): [string, Claim[]][] {
  const byKey = new Map<string, Claim[]>();
  for (const bundle of bundles) {
    for (const e of bundle.effects) {
      const c = claimOf(bundle, e, holdings);
      if (!c) continue;
      const list = byKey.get(c.key) ?? [];
      list.push(c);
      byKey.set(c.key, list);
    }
  }
  return [...byKey.entries()].sort(([k1], [k2]) => (k1 < k2 ? -1 : 1));
}

/** 効果が持ち主の資源に掛ける負荷。負荷の無い効果は無し。 */
function claimOf(bundle: Bundle, e: Effect, holdings: Holdings): Claim | undefined {
  switch (e.kind) {
    case 'transfer':
      return { bundle, owner: e.from, key: `${e.from}|${e.res}`, amount: e.amount, indivisible: false, force: 0 };
    case 'convert':
      return { bundle, owner: e.from, key: `${e.from}|${e.fromRes}`, amount: e.amount, indivisible: false, force: 0 };
    case 'move':
      return e.cost > 0 ? { bundle, owner: e.costFrom, key: `${e.costFrom}|${e.costRes}`, amount: e.cost, indivisible: false, force: 0 } : undefined;
    case 'use':
      return { bundle, owner: e.thing, key: `${e.thing}|cap:${e.capacity}`, amount: e.amount, indivisible: true, force: 0 };
    case 'reassign':
      return { bundle, owner: e.thing, key: `${e.thing}|attachedTo`, amount: 1, indivisible: true, force: e.force ?? 0 };
    case 'spawn':
      return { bundle, owner: e.from, key: `${e.from}|${e.fromRes}`, amount: e.amount, indivisible: true, force: 0 };
    case 'despawn':
      return { bundle, owner: e.thing, key: `${e.thing}|quantity`, amount: holdings.quantity(e.thing) ?? 1, indivisible: true, force: 0 };
  }
}

/** 一つの資源を取り合う負荷たちに、出せる量を配る。不可分を優先の順に全か無かで先に取り、残りを可分に比例で分ける。 */
function shareResource(key: string, claims: Claim[], holdings: Holdings, factor: Map<Bundle, number>): void {
  const owner = claims[0]!.owner;
  if (!holdings.has(owner)) return;
  let remaining = available(key, claims, owner, holdings);
  const ordered = [...claims].sort(byPriority);
  for (const c of ordered) {
    if (!c.indivisible) continue;
    if (c.amount <= remaining + 1e-9) remaining -= c.amount;
    else factor.set(c.bundle, 0);
  }
  const divisible = ordered.filter((c) => !c.indivisible && (factor.get(c.bundle) ?? 1) > 0);
  const demand = divisible.reduce((s, c) => s + c.amount, 0);
  if (demand > remaining + 1e-9 && demand > 0) {
    const f = Math.max(0, remaining) / demand;
    for (const c of divisible) factor.set(c.bundle, Math.min(factor.get(c.bundle) ?? 1, f));
  }
}

/** 資源の出せる量。容量はその刻みの能力 × Δt、付け替えは一つの物を一度だけ、ほかは持ち主の資源の量。 */
function available(key: string, claims: Claim[], owner: ThingId, holdings: Holdings): number {
  const res = key.slice(key.indexOf('|') + 1);
  if (res.startsWith('cap:')) return capacityOf(claims);
  if (res === 'attachedTo') return 1;
  return holdings.amount(owner, res);
}

/** 容量の要求から、その刻みの容量を読む（同じ持ち主・同じ能力の要求は同じ値を持つ）。 */
function capacityOf(claims: Claim[]): number {
  for (const c of claims) for (const e of c.bundle.effects) if (e.kind === 'use' && `${e.thing}|cap:${e.capacity}` === c.key) return e.available;
  return 0;
}

/** 不可分な物の取り合いの順: 力の大きい順、同点は要求者の id、法則、相手。 */
function byPriority(p: Claim, q: Claim): number {
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return q.force - p.force || cmp(p.bundle.a, q.bundle.a) || p.bundle.lawIndex - q.bundle.lawIndex || cmp(p.bundle.b, q.bundle.b);
}

/** 消える事物（消す要求が通ったもの）に触れる他の束を落とす。 */
function dropTouchingDespawned(bundles: Bundle[], factor: Map<Bundle, number>): void {
  const gone = new Set<ThingId>();
  for (const b of bundles) if ((factor.get(b) ?? 0) >= 1 - 1e-9) for (const e of b.effects) if (e.kind === 'despawn') gone.add(e.thing);
  if (gone.size === 0) return;
  for (const b of bundles) {
    if (b.effects.some((e) => e.kind === 'despawn' && gone.has(e.thing))) continue;
    if (b.effects.some((e) => participants(e).some((id) => gone.has(id)))) factor.set(b, 0);
  }
}

/** 効果が触れる事物の id。 */
function participants(e: Effect): ThingId[] {
  switch (e.kind) {
    case 'transfer':
      return [e.from, e.to];
    case 'convert':
      return [e.from, e.to, e.lossTo];
    case 'reassign':
      return [e.thing, e.to];
    case 'spawn':
      return [e.from];
    case 'despawn':
      return [e.thing, e.to, e.lossTo];
    case 'move':
      return [e.thing, e.costFrom, e.costTo];
    case 'use':
    case 'die':
      return [e.thing];
    case 'relate':
      return [e.thing, e.about];
  }
}
