// いちばん小さな生活の環: 果実を採って食べる。
// 事物: 自然、木、木に付いた実（一つずつが事物）、人物。すべて位置と範囲を持つ。
// 法則: 実る、腐る、知覚、移動、採る、食べる、消化、消耗。Δt ごとに速度 × Δt。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Binding, Effect, Knowledge, Law, Mind, ThingId, ThingSnapshot, WorldView } from './types.js';
import { World } from './world.js';

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const DT = 10 * MINUTE;

const num = (t: ThingSnapshot | undefined, a: string): number => {
  const v = t?.attrs[a];
  return typeof v === 'number' ? v : 0;
};
const str = (t: ThingSnapshot | undefined, a: string): string => {
  const v = t?.attrs[a];
  return typeof v === 'string' ? v : '';
};
const alive = (t: ThingSnapshot | undefined): boolean => str(t, 'alive') === 'yes';
const persons = (w: WorldView) => w.query((t) => t.kind === 'person' && alive(t));
const fruitsOn = (w: WorldView, holder: ThingId) => w.query((t) => t.kind === 'fruit' && str(t, 'attachedTo') === holder);

// ---- 法則 ----

/** 自然 → 木: 実る。育ちが 1 たまるごとに、上限まで、実という事物を木に付ける。実の量は自然の蓄えから引く。 */
export const ripen: Law = {
  id: 'ripen',
  version: 'tick-1',
  scope: (w) => w.query((t) => t.kind === 'tree').map((t) => ({ tree: t.id })),
  flow: (b, dt, w) => {
    const tree = w.thing(b['tree']!)!;
    const rate = num(tree, 'ripenPerHour') / HOUR; // 実/分
    const effects: Effect[] = [];
    const growth = num(tree, 'growth') + rate * dt;
    const attached = fruitsOn(w, tree.id).length;
    let whole = Math.floor(growth);
    const room = Math.max(0, num(tree, 'cap') - attached);
    whole = Math.min(whole, room);
    // 育ちは木の属性として自然から移す（釣り合い）。実る分だけ実に変える。
    effects.push({ kind: 'transfer', attr: 'growth', from: 'nature', to: tree.id, amount: rate * dt });
    for (let i = 0; i < whole; i++) {
      effects.push({ kind: 'convert', from: tree.id, fromAttr: 'growth', amount: 1, to: 'nature', toAttr: 'growthSpent', produced: 1, lossTo: 'nature', lossAttr: 'growthSpent' });
      effects.push({
        kind: 'spawn',
        id: (w as World).nextSpawnId('fruit'),
        thingKind: 'fruit',
        attrs: { attachedTo: tree.id, freshness: num(tree, 'fruitFreshness'), visibility: num(tree, 'fruitVisibility'), odor: num(tree, 'fruitOdor') },
        from: 'nature',
        fromAttr: 'fruitStock',
        amount: 1,
      });
    }
    return effects;
  },
};

/** 自然 ↔ 実: 腐る。鮮度が速度で下がり、尽きた実は廃棄になる。木に付いていても人が持っていても同じ。 */
export const rot: Law = {
  id: 'rot',
  version: 'tick-1',
  scope: (w) => w.query((t) => t.kind === 'fruit').map((t) => ({ fruit: t.id })),
  flow: (b, dt, w) => {
    const fruit = w.thing(b['fruit']!)!;
    const rate = num(w.thing('nature'), 'rotPerHour') / HOUR;
    if (num(fruit, 'freshness') - rate * dt <= 1e-9) {
      return [{ kind: 'despawn', thing: fruit.id, to: 'nature', toAttr: 'waste', produced: num(fruit, 'quantity'), lossTo: 'nature', lossAttr: 'waste' }];
    }
    return [{ kind: 'transfer', attr: 'freshness', from: fruit.id, to: 'nature', amount: rate * dt }];
  },
};

/** 人 ← 事物: 知覚。視界（人の sight と対象の visibility）の内側にある事物の写しを心象に書く。自分に付いた物は常に分かる。 */
export const perceive: Law = {
  id: 'perceive',
  version: 'tick-1',
  scope: (w) =>
    persons(w).flatMap((p) =>
      w
        .query((t) => t.id !== p.id && t.kind !== 'nature' && (w.inRange('sight', p.id, t.id) || str(t, 'attachedTo') === p.id))
        .map((t) => ({ person: p.id, target: t.id })),
    ),
  flow: (b) => [{ kind: 'inform', observer: b['person']!, about: b['target']!, attrs: ['attachedTo', 'freshness', 'cap', 'ripenPerHour'] }],
};

/**
 * 人 ← 心象: 見直し。覚えている場所が視界の内側にあるのに、その事物がそこに見えなければ（消えた、移った）心象から消す。
 * 自分が持っていた実を食べたときも、これで「もう持っていない」と分かる。
 */
export const revise: Law = {
  id: 'revise',
  version: 'tick-1',
  scope: (w) =>
    persons(w).flatMap((p) => {
      const k = (p.attrs['knowledge'] as Knowledge | undefined) ?? {};
      const pos = w.positionOf(p.id)!;
      return Object.entries(k)
        .filter(([id, e]) => {
          const remembered = Math.hypot(e.x - pos.x, e.y - pos.y);
          const canSeeSpot = remembered <= num(p, 'sight');
          const exists = w.thing(id) !== undefined;
          const stillThere = exists && (w.inRange('sight', p.id, id) || str(w.thing(id), 'attachedTo') === p.id);
          return canSeeSpot && !stillThere;
        })
        .map(([id]) => ({ person: p.id, about: id }));
    }),
  flow: (b) => [{ kind: 'forget', observer: b['person']!, about: b['about']! }],
};

/** 人 ↔ 地面: 移動。意図した目標へ速度 × Δt だけ進む。動いた分の栄養が熱として自然へ移る。 */
export const walk: Law = {
  id: 'walk',
  version: 'tick-1',
  scope: (w) => persons(w).filter((p) => str(p, 'intent') === 'move').map((p) => ({ person: p.id })),
  flow: (b, dt, w) => {
    const p = w.thing(b['person']!)!;
    const pos = w.positionOf(p.id)!;
    const tx = num(p, 'targetX');
    const ty = num(p, 'targetY');
    const dist = Math.hypot(tx - pos.x, ty - pos.y);
    if (dist < 1e-9) return [];
    const step = Math.min(dist, (num(p, 'speedPerHour') / HOUR) * dt);
    const dx = ((tx - pos.x) / dist) * step;
    const dy = ((ty - pos.y) / dist) * step;
    return [{ kind: 'move', thing: p.id, dx, dy, costFrom: p.id, costAttr: 'nutrition', costTo: 'nature', cost: num(p, 'walkCostPerMeter') * step }];
  },
};

/** 人 ↔ 木: 採る。意図した木が手の届く範囲にあれば、速度 × Δt 個の実が木から人へ付け替わる。二人なら順に、無くなれば止まる。 */
export const pick: Law = {
  id: 'pick',
  version: 'tick-1',
  scope: (w) =>
    persons(w)
      .filter((p) => str(p, 'intent') === 'pick' && w.thing(str(p, 'target'))?.kind === 'tree' && w.inRange('reach', p.id, str(p, 'target')))
      .map((p) => ({ person: p.id, tree: str(p, 'target') })),
  flow: (b, dt, w) => {
    const p = w.thing(b['person']!)!;
    const n = Math.floor((num(p, 'pickPerHour') / HOUR) * dt + 1e-9);
    return fruitsOn(w, b['tree']!)
      .slice(0, n)
      .map<Effect>((f) => ({ kind: 'reassign', thing: f.id, attr: 'attachedTo', from: b['tree']!, to: p.id }));
  },
};

/** 人 ↔ 自分の実: 食べる。意図が eat で実を持っていれば、速度 × Δt 個の実が胃の内容になる。 */
export const eat: Law = {
  id: 'eat',
  version: 'tick-1',
  scope: (w) => persons(w).filter((p) => str(p, 'intent') === 'eat').map((p) => ({ person: p.id })),
  flow: (b, dt, w) => {
    const p = w.thing(b['person']!)!;
    const n = Math.floor((num(p, 'eatPerHour') / HOUR) * dt + 1e-9);
    return fruitsOn(w, p.id)
      .slice(0, n)
      .map<Effect>((f) => ({ kind: 'despawn', thing: f.id, to: p.id, toAttr: 'stomach', produced: num(f, 'quantity'), lossTo: 'nature', lossAttr: 'waste' }));
  },
};

/** 自然 ↔ 身体: 消化。胃の内容が速度で栄養になり、一部は排出へ。 */
export const digest: Law = {
  id: 'digest',
  version: 'tick-1',
  scope: (w) => persons(w).filter((p) => num(p, 'stomach') > 0).map((p) => ({ person: p.id })),
  flow: (b, dt, w) => {
    const p = w.thing(b['person']!)!;
    const amount = (num(p, 'digestPerHour') / HOUR) * dt;
    const yieldRatio = num(p, 'digestYield');
    return [{ kind: 'convert', from: p.id, fromAttr: 'stomach', amount, to: p.id, toAttr: 'nutrition', produced: amount * yieldRatio, lossTo: 'nature', lossAttr: 'waste' }];
  },
};

/** 自然 ↔ 身体: 消耗。栄養が速度で熱として自然へ移る。 */
export const wear: Law = {
  id: 'wear',
  version: 'tick-1',
  scope: (w) => persons(w).map((p) => ({ person: p.id })),
  flow: (b, dt, w) => {
    const p = w.thing(b['person']!)!;
    return [{ kind: 'transfer', attr: 'nutrition', from: p.id, to: 'nature', amount: (num(p, 'wearPerHour') / HOUR) * dt }];
  },
};

/** 法則の順。知覚と見直し → 行為（移動・採る・食べる）→ 自然（消化・消耗・実る・腐る）。 */
export const fruitLaws: Law[] = [perceive, revise, walk, pick, eat, digest, wear, ripen, rot];

// ---- 心 ----

function known(self: ThingSnapshot): Knowledge {
  return (self.attrs['knowledge'] as Knowledge | undefined) ?? {};
}

/**
 * 採取者: 木の場所は知らない。視界に入って心象に書かれた木と実から、実の付いた木を選ぶ。
 * 空腹で実を持っていれば食べ、手持ちが目標未満なら実の付いた木へ行って採り、足りれば家へ戻る。
 */
export class ForagerMind implements Mind {
  constructor(
    private readonly target = 3,
    private readonly eatBelow = 4,
  ) {}
  decide(self: ThingSnapshot, _now: number) {
    const me = self.id;
    const k = known(self);
    const holding = Object.values(k).filter((e) => e.kind === 'fruit' && e.attrs['attachedTo'] === me).length;
    const hungry = num(self, 'stomach') < 1 && num(self, 'nutrition') < this.eatBelow;
    if (hungry && holding >= 1) return { intent: 'eat' };
    if (holding < this.target) {
      const x = num(self, 'x');
      const y = num(self, 'y');
      const byDistance = (a: { e: { x: number; y: number } }, b: { e: { x: number; y: number } }) => Math.hypot(a.e.x - x, a.e.y - y) - Math.hypot(b.e.x - x, b.e.y - y);
      // 知っている木と、その木に付いていると知っている実の数。実は木より見える範囲が狭いので、遠くからは木しか見えない。
      const trees = Object.entries(k)
        .filter(([, e]) => e.kind === 'tree')
        .map(([id, e]) => ({ id, e, fruits: Object.values(k).filter((f) => f.kind === 'fruit' && f.attrs['attachedTo'] === id).length }))
        .sort(byDistance);
      const withFruit = trees.find((t) => t.fruits >= 1);
      if (withFruit) {
        const d = Math.hypot(withFruit.e.x - x, withFruit.e.y - y);
        if (d <= num(self, 'reach')) return { intent: 'pick', target: withFruit.id };
        return { intent: 'move', target: withFruit.id, targetX: withFruit.e.x, targetY: withFruit.e.y };
      }
      // 実が見えていない木へ近づいて確かめる（木を辿る）。手の届く所まで来ても実が無ければ待つ。
      const unknown = trees.find((t) => Math.hypot(t.e.x - x, t.e.y - y) > num(self, 'reach'));
      if (unknown) return { intent: 'move', target: unknown.id, targetX: unknown.e.x, targetY: unknown.e.y };
      return { intent: 'idle' }; // 木を知らなければ探索が要るが、未実装。
    }
    const hx = num(self, 'homeX');
    const hy = num(self, 'homeY');
    if (Math.hypot(hx - num(self, 'x'), hy - num(self, 'y')) > 1) return { intent: 'move', target: 'home', targetX: hx, targetY: hy };
    return { intent: 'idle' };
  }
}

// ---- 場面 ----

export interface FruitOptions {
  persons?: number;
  /** 木が実をつける速さ（実/時）。 */
  ripenPerHour?: number;
  /** 人物の視界（m）。家から木が見えるかを決める。 */
  sight?: number;
  /** 木までの距離（m）。 */
  treeDistance?: number;
}

export interface Scenario {
  world: World;
  persons: ThingId[];
}

/** 果樹一本と家一軒。採取者は家にいて、視界に入る木を知覚し、往復して果実で生きる。 */
export function buildFruitScenario(options: FruitOptions = {}): Scenario {
  const w = new World();
  const n = options.persons ?? 1;
  const ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  w.addThing('nature', 'nature', { fruitStock: 100000, growth: 100000, growthSpent: 0, waste: 0, nutrition: 0, freshness: 0, rotPerHour: 1 / 16 });
  w.addThing('tree', 'tree', {
    x: options.treeDistance ?? 40,
    y: 0,
    visibility: 300,
    cap: 12,
    growth: 0,
    ripenPerHour: options.ripenPerHour ?? 0.25,
    fruitFreshness: 2,
    fruitVisibility: 30,
    fruitOdor: 5,
  });
  for (const id of ids) {
    w.addThing(id, 'person', {
      alive: 'yes',
      x: 0,
      y: 0,
      homeX: 0,
      homeY: 0,
      visibility: 100,
      sight: options.sight ?? 60,
      reach: 1.5,
      smell: 3,
      speedPerHour: 60,
      walkCostPerMeter: 0.0005,
      pickPerHour: 6,
      eatPerHour: 12,
      digestPerHour: 0.5,
      digestYield: 0.8,
      wearPerHour: 0.1,
      nutrition: 6,
      stomach: 0,
      intent: 'idle',
      target: '',
      targetX: 0,
      targetY: 0,
      knowledge: {},
    });
    w.addMind(id, new ForagerMind());
  }
  // 初期の実 6 個を木に付ける（自然の蓄えから）。
  for (let i = 0; i < 6; i++) {
    w.seed({
      kind: 'spawn',
      id: w.nextSpawnId('fruit'),
      thingKind: 'fruit',
      attrs: { attachedTo: 'tree', freshness: 2, visibility: 30, odor: 5 },
      from: 'nature',
      fromAttr: 'fruitStock',
      amount: 1,
    });
  }
  for (const law of fruitLaws) w.addLaw(law);
  return { world: w, persons: ids };
}

export function summarize(w: World, persons: ThingId[]): Record<string, number | string> {
  const out: Record<string, number | string> = { day: Math.round(w.now / DAY) };
  for (const p of persons) {
    const t = w.thing(p)!;
    out[`${p}.alive`] = str(t, 'alive');
    out[`${p}.pos`] = `${num(t, 'x').toFixed(0)},${num(t, 'y').toFixed(0)}`;
    out[`${p}.nutrition`] = Number(num(t, 'nutrition').toFixed(2));
    out[`${p}.holding`] = fruitsOn(w, p).length;
    out[`${p}.intent`] = str(t, 'intent');
  }
  out['tree.fruits'] = fruitsOn(w, 'tree').length;
  out['nature.waste'] = Number(num(w.thing('nature'), 'waste').toFixed(2));
  out['ledger'] = w.ledger.length;
  return out;
}

export function runFruitDays(days: number, options: FruitOptions = {}): { scenario: Scenario; daily: Record<string, number | string>[] } {
  const scenario = buildFruitScenario(options);
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    scenario.world.run((day + 1) * DAY, DT);
    daily.push(summarize(scenario.world, scenario.persons));
  }
  return { scenario, daily };
}

/** 保存則の検査に使う総量: 自然の実の蓄え＋付いている実＋胃＋栄養＋廃棄＋自然へ移った栄養。 */
export function massTotal(w: World): number {
  return w.total('fruitStock') + w.total('quantity', (t) => t.kind === 'fruit') + w.total('stomach') + w.total('nutrition') + w.total('waste');
}

export type { Binding };
