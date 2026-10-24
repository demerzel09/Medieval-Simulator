// いちばん小さな生活の環: 果実を採って食べる。
// 事物: 自然、木、木に付いた実（一つずつが事物）、人物。すべて位置と範囲を持つ。
// 物理層の法則（二つの事物の組に対して）: 実る、腐る、移動、採る、食べる、消化、消耗。Δt ごとに速度 × Δt。
// 情報層の感覚: 視界。観測と心象の差が事象になる。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Effect, Knowledge, Law, Mind, Sense, ThingId, ThingSnapshot, WorldView } from './types.js';
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
const isPerson = (t: ThingSnapshot): boolean => t.kind === 'person' && alive(t);
const fruitsOn = (w: WorldView, holder: ThingId) => w.query((t) => t.kind === 'fruit' && str(t, 'attachedTo') === holder);

// ---- 物理層の法則。組 (a, b) の両者の属性と距離から流れを決める ----

/** (自然, 木): 実る。育ちが自然から木へ移り、1 たまるごとに、上限まで、実という事物が木に生まれる。実の量は自然の蓄えから引く。 */
export const ripen: Law = {
  id: 'ripen',
  version: 'pair-1',
  pair: (a, b, dt, w) => {
    if (a.kind !== 'nature' || b.kind !== 'tree') return [];
    const rate = num(b, 'ripenPerHour') / HOUR; // 実/分
    const effects: Effect[] = [{ kind: 'transfer', attr: 'growth', from: a.id, to: b.id, amount: rate * dt }];
    const growth = num(b, 'growth') + rate * dt;
    const room = Math.max(0, num(b, 'cap') - fruitsOn(w, b.id).length);
    const whole = Math.min(Math.floor(growth), room);
    for (let i = 0; i < whole; i++) {
      effects.push({ kind: 'convert', from: b.id, fromAttr: 'growth', amount: 1, to: a.id, toAttr: 'growthSpent', produced: 1, lossTo: a.id, lossAttr: 'growthSpent' });
      effects.push({
        kind: 'spawn',
        id: (w as World).nextSpawnId('fruit'),
        thingKind: 'fruit',
        attrs: { attachedTo: b.id, freshness: num(b, 'fruitFreshness'), visibility: num(b, 'fruitVisibility'), odor: num(b, 'fruitOdor') },
        from: a.id,
        fromAttr: 'fruitStock',
        amount: 1,
      });
    }
    return effects;
  },
};

/** (実, 自然): 腐る。鮮度が速度で自然へ移り、尽きた実は廃棄になる。木に付いていても人が持っていても同じ。 */
export const rot: Law = {
  id: 'rot',
  version: 'pair-1',
  pair: (a, b, dt) => {
    if (a.kind !== 'fruit' || b.kind !== 'nature') return [];
    const rate = num(b, 'rotPerHour') / HOUR;
    if (num(a, 'freshness') - rate * dt <= 1e-9) {
      return [{ kind: 'despawn', thing: a.id, to: b.id, toAttr: 'waste', produced: num(a, 'quantity'), lossTo: b.id, lossAttr: 'waste' }];
    }
    return [{ kind: 'transfer', attr: 'freshness', from: a.id, to: b.id, amount: rate * dt }];
  },
};

/** (人, 自然): 移動。意図した目標へ、残っている時間 × 速度だけ進む。動いた分の栄養が熱として自然へ移る。 */
export const walk: Law = {
  id: 'walk',
  version: 'pair-1',
  pair: (a, b, _dt, w) => {
    if (!isPerson(a) || b.kind !== 'nature' || str(a, 'intent') !== 'move') return [];
    const pos = w.positionOf(a.id)!;
    const dist = Math.hypot(num(a, 'targetX') - pos.x, num(a, 'targetY') - pos.y);
    const speed = num(a, 'speedPerHour') / HOUR; // m/分
    const time = w.timeLeft(a.id);
    if (dist < 1e-9 || time <= 0 || speed <= 0) return [];
    const step = Math.min(dist, speed * time);
    const dx = ((num(a, 'targetX') - pos.x) / dist) * step;
    const dy = ((num(a, 'targetY') - pos.y) / dist) * step;
    return [
      { kind: 'move', thing: a.id, dx, dy, costFrom: a.id, costAttr: 'nutrition', costTo: b.id, cost: num(a, 'walkCostPerMeter') * step },
      { kind: 'spend', thing: a.id, minutes: step / speed },
    ];
  },
};

/** (人, 実): 採る。意図した木に付いた実が手の届く範囲にあり、時間が残っていれば、実が人へ付け替わる。二人なら順に、無くなれば止まる。 */
export const pick: Law = {
  id: 'pick',
  version: 'pair-1',
  pair: (a, b, _dt, w) => {
    if (!isPerson(a) || b.kind !== 'fruit' || str(a, 'intent') !== 'pick') return [];
    const tree = str(a, 'target');
    if (str(b, 'attachedTo') !== tree || w.distance(a.id, b.id) > num(a, 'reach')) return [];
    const cost = HOUR / num(a, 'pickPerHour'); // 分/個
    if (w.timeLeft(a.id) + 1e-9 < cost) return [];
    return [
      { kind: 'reassign', thing: b.id, attr: 'attachedTo', from: tree, to: a.id },
      { kind: 'spend', thing: a.id, minutes: cost },
    ];
  },
};

/** (人, 自分の実): 食べる。意図が eat で、その実を持っていて、時間が残っていれば、実は胃の内容になる。 */
export const eat: Law = {
  id: 'eat',
  version: 'pair-1',
  pair: (a, b, _dt, w) => {
    if (!isPerson(a) || b.kind !== 'fruit' || str(a, 'intent') !== 'eat' || str(b, 'attachedTo') !== a.id) return [];
    const cost = HOUR / num(a, 'eatPerHour');
    if (w.timeLeft(a.id) + 1e-9 < cost) return [];
    return [
      { kind: 'despawn', thing: b.id, to: a.id, toAttr: 'stomach', produced: num(b, 'quantity'), lossTo: a.id, lossAttr: 'stomach' },
      { kind: 'spend', thing: a.id, minutes: cost },
    ];
  },
};

/** (人, 自然): 消化。胃の内容が速度で栄養になり、一部は排出として自然へ。 */
export const digest: Law = {
  id: 'digest',
  version: 'pair-1',
  pair: (a, b, dt) => {
    if (!isPerson(a) || b.kind !== 'nature' || num(a, 'stomach') <= 0) return [];
    const amount = (num(a, 'digestPerHour') / HOUR) * dt;
    return [{ kind: 'convert', from: a.id, fromAttr: 'stomach', amount, to: a.id, toAttr: 'nutrition', produced: amount * num(a, 'digestYield'), lossTo: b.id, lossAttr: 'waste' }];
  },
};

/** (人, 自然): 消耗。栄養が速度で熱として自然へ移る。 */
export const wear: Law = {
  id: 'wear',
  version: 'pair-1',
  pair: (a, b, dt) => {
    if (!isPerson(a) || b.kind !== 'nature') return [];
    return [{ kind: 'transfer', attr: 'nutrition', from: a.id, to: b.id, amount: (num(a, 'wearPerHour') / HOUR) * dt }];
  },
};

/** 法則の順。行為（移動・採る・食べる）→ 身体（消化・消耗）→ 自然（実る・腐る）。 */
export const fruitLaws: Law[] = [walk, pick, eat, digest, wear, ripen, rot];

// ---- 情報層の感覚 ----

/** 心象に写す属性。見える範囲（visibility）を写すのは、覚えている物が見えるはずかを後で判定するため。 */
const SEEN_ATTRS = ['attachedTo', 'freshness', 'cap', 'ripenPerHour', 'visibility'];

/** 視界。観測者の sight と対象の visibility の小さい方の内側なら見える。自分に付いた物は常に分かる。自然は見る対象ではない。 */
export const sight: Sense = {
  id: 'sight',
  version: 'event-1',
  observe: (observer, object, w) => {
    if (object.kind === 'nature') return null;
    if (str(object, 'attachedTo') === observer.id || w.inRange('sight', observer.id, object.id)) return SEEN_ATTRS;
    return null;
  },
  expected: (observer, remembered, w) => {
    const pos = w.positionOf(observer.id)!;
    const d = Math.hypot(remembered.x - pos.x, remembered.y - pos.y);
    const vis = typeof remembered.attrs['visibility'] === 'number' ? remembered.attrs['visibility'] : Number.POSITIVE_INFINITY;
    return remembered.attrs['attachedTo'] === observer.id || d <= Math.min(num(observer, 'sight'), vis);
  },
};

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
  w.addSense(sight);
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
  out['things'] = w.thingCount;
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
