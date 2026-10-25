// いちばん小さな生活の環: 果実を採って食べる。採取だけの経済。
// 事物: 自然、木、木に付いた実（一つずつが事物）、人物、家（持ち物を付け替えて蓄える場所）。
// 値の四区分: 属性（札と仕様。更新は書かない）、状態、関係（心象）、資源（釣り合う量）。
// 法則は事物の種類ではなく属性（札）の組で相手を選ぶ。札は属性の名の有無で表し、値が仕様になる。
//   自然: sink（受け皿）、grows（育てる）。  木: bears=fruit（実をつける）。
//   実:   edible=plant（食べられる、植物性）、perishable（腐る）、bond（結びつきの強さ。採るのに要る力）。
//   人:   eats=plant（植物を食べる）、picks（採る）、grip（握る力）、dwells（住む）、mortal（死ぬ）、mind=forager（心の種類）、sight・reach・smell（範囲）。
//   家:   stores（物を置ける）。 刃物: cuts（切る力。人に付けると握る力に足される）。
// 行為の成否は物理が決める。願望と予測は心象、提供した運動は意図と身体の能力、結果は法則と解決、結果の知覚で心象が更新される。
// 場面の構築は、定義・法則・感覚・心の種類を登録して事物を置くだけで、事物ごとの設定はしない。どの家が自分の家かは人が法則 settle で得る関係
// （rel[家].home）で、心は札 mind から世界が付け、死亡は法則 starve が返す効果である。
// 札は資源の有無では代用しない。鮮度の受け皿である自然も資源 freshness を持つので、資源の有無で「腐る物」を選ぶと自然自身に腐敗が当たる。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Effect, Law, LedgerEntry, Mind, Relation, Scalar, Sense, ThingDef, ThingId, ThingSnapshot, WorldState, WorldView } from './types.js';
import { World, type WorldOptions } from './world.js';

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
  attr: { edible: 'plant', perishable: true, visibility: 30, odor: 5, bond: 0 },
  state: { attachedTo: '' },
  res: { freshness: 2 },
};
/** 刃物。人に付ければ、採るときの有効な力に切る力が足される（結びつきの強い実は刃物が無ければ採れない）。持ち物は事物。 */
export const knifeDef: ThingDef = {
  name: 'knife',
  attr: { cuts: 10, visibility: 5 },
  state: { attachedTo: '' },
};
export const personDef: ThingDef = {
  name: 'person',
  attr: {
    eats: 'plant',
    picks: true,
    grip: 1,
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
    dwells: true,
    mortal: true,
    mind: 'forager',
  },
  state: { alive: 'yes', x: 0, y: 0, intent: 'idle', target: '', targetX: 0, targetY: 0 },
  res: { nutrition: 6, stomach: 0 },
};
/** 家。札 stores は、人が持ち物を付け替えて置ける場所であること。位置を持つ事物で、法則の組の相手にはならず、付け替えの行き先になる。 */
export const homeDef: ThingDef = {
  name: 'home',
  attr: { stores: true, visibility: 100 },
  state: { x: 0, y: 0 },
};
export const fruitDefs: ThingDef[] = [natureDef, treeDef, fruitDef, knifeDef, personDef, homeDef];

// ---- 物理層の法則。組 (a, b) の札で当たるかを決め、状態・資源・距離で流れを決める ----

/** (育てる, 実をつける): 実る。育ちが自然から木へ移り、1 たまるごとに、上限まで、bears が指す定義の事物が木に生まれる。量は自然の蓄えから引く。 */
export const ripen: Law = {
  id: 'ripen',
  version: 'defs-1',
  pair: (a, b, dt, w) => {
    if (!has(a, 'grows') || typeof b.attr['bears'] !== 'string') return [];
    const rate = attr(b, 'ripenPerHour') / HOUR; // 実/分
    const effects: Effect[] = [{ kind: 'transfer', res: 'growth', from: a.id, to: b.id, amount: rate * dt }];
    // 刻みの始めにたまっている育ちで生むかを決める。この刻みの流入は次の刻みに効く（同期更新）。
    const room = Math.max(0, attr(b, 'cap') - edibleOn(w, b.id).length);
    const whole = Math.min(Math.floor(res(b, 'growth') + 1e-9), room);
    for (let i = 0; i < whole; i++) {
      effects.push({ kind: 'convert', from: b.id, fromRes: 'growth', amount: 1, to: a.id, toRes: 'growthSpent', produced: 1, lossTo: a.id, lossRes: 'growthSpent' });
      effects.push({ kind: 'spawn', id: (w as World).nextSpawnId(`${b.id}/${b.attr['bears'] as string}`), def: b.attr['bears'] as string, state: { attachedTo: b.id }, from: a.id, fromRes: 'fruitStock', amount: 1 });
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

/** (歩ける, 受け皿): 移動。意図した目標へ、速度 × Δt だけ進む。動いた分の栄養が熱として自然へ移る。 */
export const walk: Law = {
  id: 'walk',
  version: 'kinds-1',
  pair: (a, b, dt, w) => {
    if (!alive(a) || !has(a, 'speedPerHour') || !has(b, 'sink') || state(a, 'intent') !== 'move') return [];
    const pos = w.positionOf(a.id)!;
    const dist = Math.hypot(stateNum(a, 'targetX') - pos.x, stateNum(a, 'targetY') - pos.y);
    const speed = attr(a, 'speedPerHour') / HOUR; // m/分
    if (dist < 1e-9 || speed <= 0) return [];
    const step = Math.min(dist, speed * dt);
    const dx = ((stateNum(a, 'targetX') - pos.x) / dist) * step;
    const dy = ((stateNum(a, 'targetY') - pos.y) / dist) * step;
    return [{ kind: 'move', thing: a.id, dx, dy, costFrom: a.id, costRes: 'nutrition', costTo: b.id, cost: attr(a, 'walkCostPerMeter') * step }];
  },
};

/** 人 a が提供できる有効な力: 握る力に、付けている道具の切る力を足したもの。 */
export const forceOf = (a: ThingSnapshot, w: WorldView): number =>
  attr(a, 'grip') + w.query((t) => has(t, 'cuts') && state(t, 'attachedTo') === a.id).reduce((s, t) => s + attr(t, 'cuts'), 0);

/** 付け替えの要求。人 a が、from に付いた物 b を to へ付け替える。物と行き先が手の届く範囲にあること。一刻みの数は能力 × Δt。要求には提供した力を載せる。 */
const handOver = (a: ThingSnapshot, b: ThingSnapshot, from: ThingId, to: ThingId, dt: number, w: WorldView): Effect[] => {
  if (state(b, 'attachedTo') !== from || w.distance(a.id, b.id) > attr(a, 'reach') || w.distance(a.id, to) > attr(a, 'reach')) return [];
  return [
    { kind: 'reassign', thing: b.id, from, to, force: forceOf(a, w) },
    { kind: 'use', thing: a.id, capacity: 'pick', available: (attr(a, 'pickPerHour') / HOUR) * dt, amount: 1 },
  ];
};

/**
 * (採る, 付属する物): 採る。意図した相手（木でも家でも）に付いた物が手の届く範囲にあり、提供できる力が物の結びつき（bond）以上なら、人へ付け替わる。
 * 結びつきの強い実は刃物が無ければ採れない。二人が同じ物を狙えば力の大きい方、同点は id 順で、持ち主の意思ではなく物理が決める。
 */
export const pick: Law = {
  id: 'pick',
  version: 'kinds-2',
  pair: (a, b, dt, w) => {
    if (!alive(a) || !has(a, 'picks') || state(a, 'intent') !== 'pick' || !('attachedTo' in b.state)) return [];
    if (forceOf(a, w) < attr(b, 'bond')) return [];
    return handOver(a, b, state(a, 'target'), a.id, dt, w);
  },
};

/** (採る, 付属する物): しまう。自分に付いた物を、意図した置ける相手（札 stores）へ付け替える。採るの逆向き。 */
export const stow: Law = {
  id: 'stow',
  version: 'kinds-1',
  pair: (a, b, dt, w) => {
    if (!alive(a) || !has(a, 'picks') || state(a, 'intent') !== 'stow' || !('attachedTo' in b.state) || !has(w.thing(state(a, 'target')), 'stores')) return [];
    return handOver(a, b, a.id, state(a, 'target'), dt, w);
  },
};

/** (食べる, 食べられる): 食べる。札の値が合い（植物を食べる × 植物性）、自分に付いていて、意図が eat なら、胃の内容になる。一刻みに食べる数は能力 × Δt。 */
export const eat: Law = {
  id: 'eat',
  version: 'kinds-1',
  pair: (a, b, dt) => {
    if (!alive(a) || !has(a, 'eats') || a.attr['eats'] !== b.attr['edible'] || state(a, 'intent') !== 'eat' || state(b, 'attachedTo') !== a.id) return [];
    return [
      { kind: 'despawn', thing: b.id, to: a.id, toRes: 'stomach', produced: res(b, 'quantity'), lossTo: a.id, lossRes: 'stomach' },
      { kind: 'use', thing: a.id, capacity: 'eat', available: (attr(a, 'eatPerHour') / HOUR) * dt, amount: 1 },
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

/** (死ぬ, 自分): 飢え死に。自分自身との組で、刻みの始めに栄養が尽きていれば死ぬ。世界の進行ではなく法則が決める。 */
export const starve: Law = {
  id: 'starve',
  version: 'kinds-1',
  pair: (a, b) => {
    if (a.id !== b.id || !alive(a) || !has(a, 'mortal') || res(a, 'nutrition') > 1e-9) return [];
    return [{ kind: 'die', thing: a.id }];
  },
};

/** (住む, 置ける): 住む。意図した置ける相手が手の届く範囲にあれば、それを自分の家とする関係（home）を得る。場面の構築で注入しない。 */
export const settle: Law = {
  id: 'settle',
  version: 'kinds-1',
  pair: (a, b, _dt, w) => {
    if (!alive(a) || !has(a, 'dwells') || !has(b, 'stores') || state(a, 'intent') !== 'settle' || state(a, 'target') !== b.id) return [];
    if (w.distance(a.id, b.id) > attr(a, 'reach')) return [];
    return [{ kind: 'relate', thing: a.id, about: b.id, fields: { home: true } }];
  },
};

/** (採る, 付属する物): 渡す。自分に付いた物を、意図した生きている相手（札 picks）へ付け替える。持ち主の意思は解決の規則ではなく、この行為である。 */
export const give: Law = {
  id: 'give',
  version: 'kinds-1',
  pair: (a, b, dt, w) => {
    if (!alive(a) || !has(a, 'picks') || state(a, 'intent') !== 'give' || !('attachedTo' in b.state)) return [];
    const to = w.thing(state(a, 'target'));
    if (!to || !alive(to) || !has(to, 'picks')) return [];
    return handOver(a, b, a.id, to.id, dt, w);
  },
};

/** 法則の一覧。同期更新なので順序は結果に関わらない（記録の並びの正規順にだけ使う）。 */
export const fruitLaws: Law[] = [walk, pick, stow, give, eat, digest, wear, starve, ripen, rot, settle];

// ---- 情報層の感覚 ----

/** 心象に写す値の名。属性（札）、状態、資源から。見える範囲を写すのは、覚えている物が見えるはずかを後で判定するため。 */
const SEEN_FIELDS = ['edible', 'bears', 'stores', 'visibility', 'attachedTo', 'freshness'];

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
 * 採取者: 木の場所も家の場所も知らない。視界に入って心象（関係）に写った物から選ぶ。
 * 家が無ければ、知っている置ける物（札 stores）のうち最も近いものに住む（意図 settle。法則が関係 home を書く）。
 * 空腹で実を持っていれば食べ、手持ちが目標未満なら実の付いた木へ行って採り、足りれば家へ戻る。実は手に持ったままで、家にはしまわない
 * （しまう心にすると、二人で一本の木では先の一人の蓄えが循環から外れ、もう一人が 19 日目に死んだ。DESIGN「骨格を動かして分かったこと」）。
 * 入力は自分の写し、出力は有限の行為（idle・move・settle・pick・stow・eat）の一つ。細かい行動原理は後に学習で探す。
 */
export class ForagerMind implements Mind {
  constructor(
    private readonly target = 3,
    private readonly eatBelow = 4,
  ) {}
  decide(self: ThingSnapshot, _now: number) {
    const me = self.id;
    const k = self.rel;
    const x = stateNum(self, 'x');
    const y = stateNum(self, 'y');
    const dist = (e: Relation) => Math.hypot(relNum(e, 'x') - x, relNum(e, 'y') - y);
    const near = (e: Relation) => dist(e) <= attr(self, 'reach');
    const goTo = (id: ThingId, e: Relation) => ({ intent: 'move', target: id, targetX: relNum(e, 'x'), targetY: relNum(e, 'y') });
    const fruitsOn = (holder: ThingId) => Object.values(k).filter((f) => 'edible' in f && f['attachedTo'] === holder).length;
    const holding = fruitsOn(me);
    const hungry = res(self, 'stomach') < 1 && res(self, 'nutrition') < this.eatBelow;
    if (hungry && holding >= 1) return { intent: 'eat' };
    // 家が無ければ、知っている置ける物のうち最も近いものに住む。
    const home = Object.entries(k).find(([, e]) => e['home'] === true && 'x' in e);
    if (!home) {
      const place = Object.entries(k).filter(([, e]) => 'stores' in e).sort(([, p], [, q]) => dist(p) - dist(q))[0];
      if (place) return near(place[1]) ? { intent: 'settle', target: place[0] } : goTo(place[0], place[1]);
    }
    if (holding < this.target) {
      // 知っている木（実をつける札）と、その木に付いていると知っている実の数。実は木より見える範囲が狭いので、遠くからは木しか見えない。
      const trees = Object.entries(k)
        .filter(([, e]) => 'bears' in e)
        .map(([id, e]) => ({ id, e, fruits: fruitsOn(id) }))
        .sort((p, q) => dist(p.e) - dist(q.e));
      const withFruit = trees.find((t) => t.fruits >= 1);
      if (withFruit) return near(withFruit.e) ? { intent: 'pick', target: withFruit.id } : goTo(withFruit.id, withFruit.e);
      // 実が見えていない木へ近づいて確かめる（木を辿る）。手の届く所まで来ても実が無ければ待つ。
      const unknown = trees.find((t) => !near(t.e));
      if (unknown) return goTo(unknown.id, unknown.e);
      return { intent: 'idle' }; // 木を知らなければ探索が要るが、未実装。
    }
    // 足りている。家に着いていなければ戻る。
    if (home && !near(home[1])) return goTo(home[0], home[1]);
    return { intent: 'idle' };
  }
}

// ---- 場面 ----

export interface FruitOptions {
  persons?: number;
  /** true なら影響範囲で飛ばさず、すべての組に法則を当てる（比較用）。 */
  allPairs?: boolean;
  /** 組を数える順（比較用）。結果は変わらない。 */
  pairOrder?: 'sorted' | 'reverse' | 'shuffle';
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

/** 果実の世界。定義・法則・感覚・心の種類を登録し、自然を置く。事物はまだ置かない。 */
export function fruitWorld(options: WorldOptions = {}): World {
  const w = new World({ rangeAttrs: ['sight', 'reach', 'smell'], ...options });
  for (const d of fruitDefs) w.addDef(d);
  for (const law of fruitLaws) w.addLaw(law);
  w.addSense(sight);
  w.addMind('forager', () => new ForagerMind());
  w.addFromDef('nature', 'nature');
  return w;
}

/** 配置: 定義の名と位置を並べて置くだけ。事物ごとの設定は位置と、生成時だけ上書きできる属性に限る。 */
export interface Placement {
  id: ThingId;
  def: string;
  x?: number;
  y?: number;
  attr?: Record<string, Scalar>;
}
export function place(w: World, items: Placement[]): void {
  for (const p of items) w.addFromDef(p.id, p.def, { attr: p.attr, state: p.x !== undefined || p.y !== undefined ? { x: p.x ?? 0, y: p.y ?? 0 } : undefined });
}

/** 初期の実を木に付ける（自然の蓄えから）。初期状態の一部。 */
export function seedFruits(w: World, tree: ThingId, count: number): void {
  for (let i = 0; i < count; i++) {
    w.seed({ kind: 'spawn', id: w.nextSpawnId(`${tree === 'tree' ? '' : tree + '/'}fruit`), def: 'fruit', state: { attachedTo: tree }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
  }
}

/**
 * 果樹一本と家一軒（事物）と採取者。構築は、定義・法則・感覚・心の種類を登録し、事物を定義から置くだけである。
 * 採取者は家の脇に置かれるだけで、家を知覚して住み（関係 home を得て）、視界に入る木を知覚し、往復して果実で生きる。
 */
export function buildFruitScenario(options: FruitOptions = {}): Scenario {
  const w = fruitWorld({ allPairs: options.allPairs ?? false, pairOrder: options.pairOrder ?? 'sorted' });
  const n = options.persons ?? 1;
  const ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  place(w, [
    { id: 'tree', def: 'tree', x: options.treeDistance ?? 40, y: 0, attr: { ripenPerHour: options.ripenPerHour ?? 0.25 } },
    { id: 'home', def: 'home' },
    ...ids.map((id) => ({ id, def: 'person', attr: { sight: options.sight ?? 60 } })),
  ]);
  seedFruits(w, 'tree', 6);
  return { world: w, persons: ids };
}

/**
 * 置くだけの村: 家 3 軒・木 3 本・採取者 5 人を任意の座標に置く。構築関数の固定の配置によらず、
 * 登録した定義・法則・感覚・心の種類だけで世界が動くことを確かめる比較条件（2026-10-25。数値は仮）。
 */
export const placedVillage: Placement[] = [
  { id: 'home1', def: 'home', x: 0, y: 0 },
  { id: 'home2', def: 'home', x: 0, y: 30 },
  { id: 'home3', def: 'home', x: 60, y: -20 },
  { id: 'tree1', def: 'tree', x: 40, y: 0 },
  { id: 'tree2', def: 'tree', x: -30, y: 30 },
  { id: 'tree3', def: 'tree', x: 80, y: 20 },
  { id: 'P1', def: 'person', x: 0, y: 0 },
  { id: 'P2', def: 'person', x: 2, y: 0 },
  { id: 'P3', def: 'person', x: 0, y: 30 },
  { id: 'P4', def: 'person', x: 60, y: -20 },
  { id: 'P5', def: 'person', x: 30, y: 10 },
];
export function buildPlacedScenario(items: Placement[] = placedVillage, initialFruitsPerTree = 3): Scenario {
  const w = fruitWorld();
  place(w, items);
  for (const p of items) if (p.def === 'tree') seedFruits(w, p.id, initialFruitsPerTree);
  return { world: w, persons: items.filter((p) => p.def === 'person').map((p) => p.id) };
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
  for (const t of w.query((x) => 'bears' in x.attr)) out[`${t.id}.fruits`] = edibleOn(w, t.id).length;
  for (const h of w.query((x) => 'stores' in x.attr)) out[`${h.id}.fruits`] = edibleOn(w, h.id).length;
  out['nature.waste'] = Number(res(w.thing('nature'), 'waste').toFixed(2));
  out['things'] = w.thingCount;
  out['ledger'] = w.ledger.length;
  return out;
}

/** 走らせる。initial は走る前の写し（録画の初期状態）で、記録と合わせて replayFruit で再生できる。 */
export function runFruitDays(days: number, options: FruitOptions = {}): { scenario: Scenario; daily: Record<string, number | string>[]; initial: WorldState } {
  const scenario = buildFruitScenario(options);
  const initial = scenario.world.save();
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    scenario.world.run((day + 1) * DAY, DT);
    daily.push(summarize(scenario.world, scenario.persons));
  }
  return { scenario, daily, initial };
}

/** 録画の再生。初期状態と記録から時刻 until の世界を作る。法則と心は要らず、感覚（視界）だけ登録する。 */
export function replayFruit(initial: WorldState, ledger: LedgerEntry[], until: number): World {
  const w = World.load(initial);
  w.addSense(sight);
  w.replay(ledger, DT, until);
  return w;
}

/** 保存則の検査に使う資源の総量: 自然の実の蓄え＋付いている実の量＋胃＋栄養＋廃棄＋自然へ移った栄養。 */
export function massTotal(w: World): number {
  return w.total('fruitStock') + w.total('quantity', (t) => has(t, 'edible')) + w.total('stomach') + w.total('nutrition') + w.total('waste');
}
