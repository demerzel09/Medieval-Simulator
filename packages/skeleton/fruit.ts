// いちばん小さな生活の環: 果実を採って食べる。採取だけの経済。
// 事物: 自然、木、木に付いた実（一つずつが事物）、人物。
// 値の四区分: 属性（札と仕様。更新は書かない）、状態、関係（心象）、資源（釣り合う量）。
// 法則は事物の種類ではなく属性（札）の組で相手を選ぶ。札は属性の名の有無で表し、値が仕様になる。
//   自然: sink（受け皿）、grows（育てる）。  木: bears=fruit（実をつける）。
//   実:   edible=plant（食べられる、植物性）、perishable（腐る）。 人: eats=plant（植物を食べる）、picks（採る）、sight・reach・smell（範囲）。
// 札は資源の有無では代用しない。鮮度の受け皿である自然も資源 freshness を持つので、資源の有無で「腐る物」を選ぶと自然自身に腐敗が当たる。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Effect, Law, Mind, Relation, Sense, ThingDef, ThingId, ThingSnapshot, WorldView } from './types.js';
import { World } from './world.js';

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const DT = 10 * MINUTE;

const attr = (t: ThingSnapshot | undefined, a: string): number => {
  const v = t?.attr[a];
  return typeof v === 'number' ? v : 0;
};
const has = (t: ThingSnapshot | undefined, a: string): boolean => t !== undefined && a in t.attr;
const res = (t: ThingSnapshot | undefined, r: string): number => t?.res[r] ?? 0;
const state = (t: ThingSnapshot | undefined, s: string): string => {
  const v = t?.state[s];
  return typeof v === 'string' ? v : '';
};
const stateNum = (t: ThingSnapshot | undefined, s: string): number => {
  const v = t?.state[s];
  return typeof v === 'number' ? v : 0;
};
/** 生きて行為する事物。状態 alive を持ち、yes であること。 */
const alive = (t: ThingSnapshot | undefined): boolean => state(t, 'alive') === 'yes';
/** 食べられる物（札 edible）で、holder に付いているもの。 */
export const edibleOn = (w: WorldView, holder: ThingId) => w.query((t) => has(t, 'edible') && state(t, 'attachedTo') === holder);

// ---- 種類の定義（データ）。札と仕様、初期の状態と資源。振る舞いは持たない ----

export const natureDef: ThingDef = {
  name: 'nature',
  attr: { sink: true, grows: true, rotPerHour: 1 / 16 },
  res: { fruitStock: 100000, growth: 100000, growthSpent: 0, waste: 0, nutrition: 0, freshness: 0 },
};
/** 木。bears は生む実の定義の名。 */
export const treeDef: ThingDef = {
  name: 'tree',
  attr: { bears: 'fruit', visibility: 300, cap: 12, ripenPerHour: 0.25 },
  state: { x: 40, y: 0 },
  res: { growth: 0 },
};
export const fruitDef: ThingDef = {
  name: 'fruit',
  attr: { edible: 'plant', perishable: true, visibility: 30, odor: 5 },
  state: { attachedTo: '' },
  res: { freshness: 2 },
};
export const personDef: ThingDef = {
  name: 'person',
  attr: {
    eats: 'plant',
    picks: true,
    visibility: 100,
    sight: 60,
    reach: 1.5,
    smell: 3,
    speedPerHour: 60,
    walkCostPerMeter: 0.0005,
    pickPerHour: 6,
    eatPerHour: 12,
    digestPerHour: 0.5,
    digestYield: 0.8,
    wearPerHour: 0.1,
    homeX: 0,
    homeY: 0,
  },
  state: { alive: 'yes', x: 0, y: 0, intent: 'idle', target: '', targetX: 0, targetY: 0 },
  res: { nutrition: 6, stomach: 0 },
};
export const fruitDefs: ThingDef[] = [natureDef, treeDef, fruitDef, personDef];

// ---- 物理層の法則。組 (a, b) の札で当たるかを決め、状態・資源・距離で流れを決める ----

/** (育てる, 実をつける): 実る。育ちが自然から木へ移り、1 たまるごとに、上限まで、bears が指す定義の事物が木に生まれる。量は自然の蓄えから引く。 */
export const ripen: Law = {
  id: 'ripen',
  version: 'defs-1',
  pair: (a, b, dt, w) => {
    if (!has(a, 'grows') || typeof b.attr['bears'] !== 'string') return [];
    const rate = attr(b, 'ripenPerHour') / HOUR; // 実/分
    const effects: Effect[] = [{ kind: 'transfer', res: 'growth', from: a.id, to: b.id, amount: rate * dt }];
    const growth = res(b, 'growth') + rate * dt;
    const room = Math.max(0, attr(b, 'cap') - edibleOn(w, b.id).length);
    const whole = Math.min(Math.floor(growth), room);
    for (let i = 0; i < whole; i++) {
      effects.push({ kind: 'convert', from: b.id, fromRes: 'growth', amount: 1, to: a.id, toRes: 'growthSpent', produced: 1, lossTo: a.id, lossRes: 'growthSpent' });
      effects.push({ kind: 'spawn', id: (w as World).nextSpawnId(b.attr['bears'] as string), def: b.attr['bears'] as string, state: { attachedTo: b.id }, from: a.id, fromRes: 'fruitStock', amount: 1 });
    }
    return effects;
  },
};

/** (腐る物, 受け皿): 腐る。鮮度が速度で自然へ移り、尽きた物は廃棄になる。木に付いていても人が持っていても同じ。 */
export const rot: Law = {
  id: 'rot',
  version: 'kinds-1',
  pair: (a, b, dt) => {
    if (!has(a, 'perishable') || !has(b, 'sink')) return [];
    const rate = attr(b, 'rotPerHour') / HOUR;
    if (res(a, 'freshness') - rate * dt <= 1e-9) {
      return [{ kind: 'despawn', thing: a.id, to: b.id, toRes: 'waste', produced: res(a, 'quantity'), lossTo: b.id, lossRes: 'waste' }];
    }
    return [{ kind: 'transfer', res: 'freshness', from: a.id, to: b.id, amount: rate * dt }];
  },
};

/** (歩ける, 受け皿): 移動。意図した目標へ、残っている時間 × 速度だけ進む。動いた分の栄養が熱として自然へ移る。 */
export const walk: Law = {
  id: 'walk',
  version: 'kinds-1',
  pair: (a, b, _dt, w) => {
    if (!alive(a) || !has(a, 'speedPerHour') || !has(b, 'sink') || state(a, 'intent') !== 'move') return [];
    const pos = w.positionOf(a.id)!;
    const dist = Math.hypot(stateNum(a, 'targetX') - pos.x, stateNum(a, 'targetY') - pos.y);
    const speed = attr(a, 'speedPerHour') / HOUR; // m/分
    const time = w.timeLeft(a.id);
    if (dist < 1e-9 || time <= 0 || speed <= 0) return [];
    const step = Math.min(dist, speed * time);
    const dx = ((stateNum(a, 'targetX') - pos.x) / dist) * step;
    const dy = ((stateNum(a, 'targetY') - pos.y) / dist) * step;
    return [
      { kind: 'move', thing: a.id, dx, dy, costFrom: a.id, costRes: 'nutrition', costTo: b.id, cost: attr(a, 'walkCostPerMeter') * step },
      { kind: 'spend', thing: a.id, minutes: step / speed },
    ];
  },
};

/** (採る, 付属する物): 採る。意図した相手に付いた物が手の届く範囲にあり、時間が残っていれば、人へ付け替わる。二人なら順に、無くなれば止まる。 */
export const pick: Law = {
  id: 'pick',
  version: 'kinds-1',
  pair: (a, b, _dt, w) => {
    if (!alive(a) || !has(a, 'picks') || state(a, 'intent') !== 'pick' || !('attachedTo' in b.state)) return [];
    const holder = state(a, 'target');
    if (state(b, 'attachedTo') !== holder || w.distance(a.id, b.id) > attr(a, 'reach')) return [];
    const cost = HOUR / attr(a, 'pickPerHour'); // 分/個
    if (w.timeLeft(a.id) + 1e-9 < cost) return [];
    return [
      { kind: 'reassign', thing: b.id, from: holder, to: a.id },
      { kind: 'spend', thing: a.id, minutes: cost },
    ];
  },
};

/** (食べる, 食べられる): 食べる。札の値が合い（植物を食べる × 植物性）、自分に付いていて、意図が eat で、時間が残っていれば、胃の内容になる。 */
export const eat: Law = {
  id: 'eat',
  version: 'kinds-1',
  pair: (a, b, _dt, w) => {
    if (!alive(a) || !has(a, 'eats') || a.attr['eats'] !== b.attr['edible'] || state(a, 'intent') !== 'eat' || state(b, 'attachedTo') !== a.id) return [];
    const cost = HOUR / attr(a, 'eatPerHour');
    if (w.timeLeft(a.id) + 1e-9 < cost) return [];
    return [
      { kind: 'despawn', thing: b.id, to: a.id, toRes: 'stomach', produced: res(b, 'quantity'), lossTo: a.id, lossRes: 'stomach' },
      { kind: 'spend', thing: a.id, minutes: cost },
    ];
  },
};

/** (消化する, 受け皿): 消化。胃の内容が速度で栄養になり、一部は排出として自然へ。 */
export const digest: Law = {
  id: 'digest',
  version: 'kinds-1',
  pair: (a, b, dt) => {
    if (!alive(a) || !has(a, 'digestPerHour') || !has(b, 'sink') || res(a, 'stomach') <= 0) return [];
    const amount = (attr(a, 'digestPerHour') / HOUR) * dt;
    return [{ kind: 'convert', from: a.id, fromRes: 'stomach', amount, to: a.id, toRes: 'nutrition', produced: amount * attr(a, 'digestYield'), lossTo: b.id, lossRes: 'waste' }];
  },
};

/** (消耗する, 受け皿): 消耗。栄養が速度で熱として自然へ移る。 */
export const wear: Law = {
  id: 'wear',
  version: 'kinds-1',
  pair: (a, b, dt) => {
    if (!alive(a) || !has(a, 'wearPerHour') || !has(b, 'sink')) return [];
    return [{ kind: 'transfer', res: 'nutrition', from: a.id, to: b.id, amount: (attr(a, 'wearPerHour') / HOUR) * dt }];
  },
};

/** 法則の順。行為（移動・採る・食べる）→ 身体（消化・消耗）→ 自然（実る・腐る）。 */
export const fruitLaws: Law[] = [walk, pick, eat, digest, wear, ripen, rot];

// ---- 情報層の感覚 ----

/** 心象に写す値の名。属性（札）、状態、資源から。見える範囲を写すのは、覚えている物が見えるはずかを後で判定するため。 */
const SEEN_FIELDS = ['edible', 'bears', 'visibility', 'attachedTo', 'freshness'];

/** 視界。観測者の sight と対象の visibility の小さい方の内側なら見える。自分に付いた物は常に分かる。位置の無い物（自然）は見る対象ではない。 */
export const sight: Sense = {
  id: 'sight',
  version: 'kinds-1',
  observe: (observer, object, w) => {
    if (!has(observer, 'sight') || !w.positionOf(object.id)) return null;
    if (state(object, 'attachedTo') === observer.id || w.inRange('sight', observer.id, object.id)) return SEEN_FIELDS;
    return null;
  },
  expected: (observer, remembered, w) => {
    const pos = w.positionOf(observer.id)!;
    const rx = typeof remembered['x'] === 'number' ? remembered['x'] : Number.NaN;
    const ry = typeof remembered['y'] === 'number' ? remembered['y'] : Number.NaN;
    const d = Math.hypot(rx - pos.x, ry - pos.y);
    const vis = typeof remembered['visibility'] === 'number' ? remembered['visibility'] : Number.POSITIVE_INFINITY;
    return remembered['attachedTo'] === observer.id || d <= Math.min(attr(observer, 'sight'), vis);
  },
};

// ---- 心 ----

const relNum = (e: Relation, k: string): number => (typeof e[k] === 'number' ? (e[k] as number) : 0);

/**
 * 採取者: 木の場所は知らない。視界に入って心象（関係）に写った木と実から、実の付いた木を選ぶ。
 * 空腹で実を持っていれば食べ、手持ちが目標未満なら実の付いた木へ行って採り、足りれば家へ戻る。
 */
export class ForagerMind implements Mind {
  constructor(
    private readonly target = 3,
    private readonly eatBelow = 4,
  ) {}
  decide(self: ThingSnapshot, _now: number) {
    const me = self.id;
    const k = self.rel;
    const holding = Object.values(k).filter((e) => 'edible' in e && e['attachedTo'] === me).length;
    const hungry = res(self, 'stomach') < 1 && res(self, 'nutrition') < this.eatBelow;
    if (hungry && holding >= 1) return { intent: 'eat' };
    if (holding < this.target) {
      const x = stateNum(self, 'x');
      const y = stateNum(self, 'y');
      const byDistance = (p: { e: Relation }, q: { e: Relation }) =>
        Math.hypot(relNum(p.e, 'x') - x, relNum(p.e, 'y') - y) - Math.hypot(relNum(q.e, 'x') - x, relNum(q.e, 'y') - y);
      // 知っている木（実をつける札）と、その木に付いていると知っている実の数。実は木より見える範囲が狭いので、遠くからは木しか見えない。
      const trees = Object.entries(k)
        .filter(([, e]) => 'bears' in e)
        .map(([id, e]) => ({ id, e, fruits: Object.values(k).filter((f) => 'edible' in f && f['attachedTo'] === id).length }))
        .sort(byDistance);
      const withFruit = trees.find((t) => t.fruits >= 1);
      if (withFruit) {
        const d = Math.hypot(relNum(withFruit.e, 'x') - x, relNum(withFruit.e, 'y') - y);
        if (d <= attr(self, 'reach')) return { intent: 'pick', target: withFruit.id };
        return { intent: 'move', target: withFruit.id, targetX: relNum(withFruit.e, 'x'), targetY: relNum(withFruit.e, 'y') };
      }
      // 実が見えていない木へ近づいて確かめる（木を辿る）。手の届く所まで来ても実が無ければ待つ。
      const unknown = trees.find((t) => Math.hypot(relNum(t.e, 'x') - x, relNum(t.e, 'y') - y) > attr(self, 'reach'));
      if (unknown) return { intent: 'move', target: unknown.id, targetX: relNum(unknown.e, 'x'), targetY: relNum(unknown.e, 'y') };
      return { intent: 'idle' }; // 木を知らなければ探索が要るが、未実装。
    }
    const hx = attr(self, 'homeX');
    const hy = attr(self, 'homeY');
    if (Math.hypot(hx - stateNum(self, 'x'), hy - stateNum(self, 'y')) > 1) return { intent: 'move', target: 'home', targetX: hx, targetY: hy };
    return { intent: 'idle' };
  }
}

// ---- 場面 ----

export interface FruitOptions {
  persons?: number;
  /** true なら影響範囲で飛ばさず、すべての組に法則を当てる（比較用）。 */
  allPairs?: boolean;
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
  const w = new World({ rangeAttrs: ['sight', 'reach', 'smell'], allPairs: options.allPairs ?? false });
  const n = options.persons ?? 1;
  const ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  for (const d of fruitDefs) w.addDef(d);
  w.addFromDef('nature', 'nature');
  w.addFromDef('tree', 'tree', { attr: { ripenPerHour: options.ripenPerHour ?? 0.25 }, state: { x: options.treeDistance ?? 40 } });
  for (const id of ids) {
    w.addFromDef(id, 'person', { attr: { sight: options.sight ?? 60 } });
    w.addMind(id, new ForagerMind());
  }
  // 初期の実 6 個を木に付ける（自然の蓄えから）。
  for (let i = 0; i < 6; i++) {
    w.seed({ kind: 'spawn', id: w.nextSpawnId('fruit'), def: 'fruit', state: { attachedTo: 'tree' }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
  }
  for (const law of fruitLaws) w.addLaw(law);
  w.addSense(sight);
  return { world: w, persons: ids };
}

export function summarize(w: World, persons: ThingId[]): Record<string, number | string> {
  const out: Record<string, number | string> = { day: Math.round(w.now / DAY) };
  for (const p of persons) {
    const t = w.thing(p)!;
    out[`${p}.alive`] = state(t, 'alive');
    out[`${p}.pos`] = `${stateNum(t, 'x').toFixed(0)},${stateNum(t, 'y').toFixed(0)}`;
    out[`${p}.nutrition`] = Number(res(t, 'nutrition').toFixed(2));
    out[`${p}.holding`] = edibleOn(w, p).length;
    out[`${p}.intent`] = state(t, 'intent');
  }
  out['tree.fruits'] = edibleOn(w, 'tree').length;
  out['nature.waste'] = Number(res(w.thing('nature'), 'waste').toFixed(2));
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

/** 保存則の検査に使う資源の総量: 自然の実の蓄え＋付いている実の量＋胃＋栄養＋廃棄＋自然へ移った栄養。 */
export function massTotal(w: World): number {
  return w.total('fruitStock') + w.total('quantity', (t) => has(t, 'edible')) + w.total('stomach') + w.total('nutrition') + w.total('waste');
}
