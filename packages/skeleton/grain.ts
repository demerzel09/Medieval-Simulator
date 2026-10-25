// 間接さの段 2: 穀物を自分で加工して食べる。他人は介さない。
// 畑（札 bears=grain）は木と同じ法則 ripen で穀物を生む。穀物は生では食べられず（札 edible が無い）、腐らない。
// 炉（札 hearth）の手の届く所で、人が手に持った穀物を加工すると、時間（加工の量 × 札 work）を掛けて粥（食べられる、腐る）になる。
// 加工は「時間の掛かる行為」の形: 抵抗（穀物の量 quantity）を速さ × Δt で加工済み（processed）へ移し、尽きたら粥が生まれ穀物が消える。
// 心はこの場面のために変えない。穀物が食べ物になると知っているかは心象の種類の知識（`kind:grain`）で決まり、知らない心にはただの物である。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Law, ThingDef, ThingSnapshot } from './types.js';
import type { World } from './world.js';
import { DAY, DT, HOUR, KIND, fruitWorld, place, seedFruits, summarize, type Scenario } from './fruit.js';

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

// ---- 種類の定義 ----

/** 畑。木と同じく bears が指す定義（穀物）を生む。 */
export const fieldDef: ThingDef = {
  name: 'field',
  attr: { bears: 'grain', visibility: 300, cap: 12, ripenPerHour: 0.25 },
  state: { x: -40, y: 0 },
  res: { growth: 0 },
};
/** 穀物。becomes は加工してできる物の定義の名、processedAt は加工に要る場所の札、work は量 1 あたりの加工の時間（時）。 */
export const grainDef: ThingDef = {
  name: 'grain',
  attr: { becomes: 'gruel', processedAt: 'hearth', work: 1, visibility: 30, bond: 0 },
  state: { attachedTo: '' },
  res: { processed: 0 },
};
/** 粥。食べられ、腐る。 */
export const gruelDef: ThingDef = {
  name: 'gruel',
  attr: { edible: 'plant', perishable: true, visibility: 30, odor: 5, bond: 0 },
  state: { attachedTo: '' },
  res: { freshness: 2 },
};
/** 炉。札 hearth は加工の場所であること。法則の組の相手にはならず、加工する人の手の届く所にあればよい。 */
export const hearthDef: ThingDef = {
  name: 'hearth',
  attr: { hearth: true, visibility: 100 },
  state: { x: 0, y: 1 },
};
/**
 * 穀物の加工を知っている人。人と同じ定義で、違いは心象の種類の知識だけ（穀物は炉で粥になる、粥は食べられる）。
 * 知識を生まれつき持つか、教わるか、経験で得るかは未決で、学習で探す対象。
 */
export const farmerDef: ThingDef = {
  name: 'farmer',
  parent: 'person',
  rel: { [`${KIND}grain`]: { becomes: 'gruel', at: 'hearth' }, [`${KIND}gruel`]: { edible: 'plant' } },
};
export const grainDefs: ThingDef[] = [fieldDef, grainDef, gruelDef, hearthDef, farmerDef];

// ---- 法則 ----

/**
 * (加工する, 加工できる物): 加工。意図 process の相手として手に持った物が、札 processedAt の場所の手の届く所にあれば、
 * 量を速さ（workPerHour ÷ 札 work）× Δt で加工済みへ移す。刻みの始めに量が尽きていれば、加工済みの量で becomes の定義の物が人に生まれ、元の物は消える。
 * 場所は読むだけで書かない（組の外の事物には触れない）。
 */
export const processLaw: Law = {
  id: 'process',
  version: 'grain-1',
  pair: (a, b, dt, w) => {
    if (state(a, 'alive') !== 'yes' || !has(a, 'workPerHour') || state(a, 'intent') !== 'process' || state(a, 'target') !== b.id) return [];
    const becomes = b.attr['becomes'];
    const at = b.attr['processedAt'];
    if (typeof becomes !== 'string' || typeof at !== 'string' || state(b, 'attachedTo') !== a.id) return [];
    if (!w.query((t) => has(t, at) && w.distance(a.id, t.id) <= attr(a, 'reach')).length) return [];
    if (res(b, 'quantity') > 1e-9) {
      const amount = ((attr(a, 'workPerHour') / HOUR) * dt) / Math.max(attr(b, 'work'), 1e-9);
      return [{ kind: 'convert', from: b.id, fromRes: 'quantity', amount, to: b.id, toRes: 'processed', produced: amount, lossTo: b.id, lossRes: 'processed' }];
    }
    return [
      { kind: 'spawn', id: (w as World).nextSpawnId(`${a.id}/${becomes}`), def: becomes, state: { attachedTo: a.id }, from: b.id, fromRes: 'processed', amount: res(b, 'processed') },
      { kind: 'despawn', thing: b.id, to: b.id, toRes: 'processed', produced: 0, lossTo: b.id, lossRes: 'processed' },
    ];
  },
};

// ---- 場面 ----

export interface GrainOptions {
  /** true なら人を、穀物の加工を知っている定義（farmer）で置く。違いは心象の知識だけ。 */
  knows?: boolean;
  /** 木が実をつける速さ（実/時）。既定の 0.1 は一人の消耗に足りない（実だけでは痩せていく）。 */
  treeRipenPerHour?: number;
}

/** 果実の世界に、穀物の定義と加工の法則を足す。 */
export function grainWorld(): World {
  const w = fruitWorld();
  for (const d of grainDefs) w.addDef(d);
  w.addLaw(processLaw);
  return w;
}

/**
 * 実が足りない木と、穀物の畑と、家と炉と、人一人。旧 v24・v25 の「穀物は取れるのに、実が尽きると飢え死にする」を、市場も他人も無しに再現する比較条件。
 * 知らない人と知っている人は同じ心（採取者）で、違いは心象の種類の知識だけ。
 */
export function buildGrainScenario(options: GrainOptions = {}): Scenario {
  const w = grainWorld();
  place(w, [
    { id: 'home', def: 'home', x: 0, y: 0 },
    { id: 'hearth', def: 'hearth', x: 0, y: 1 },
    { id: 'tree', def: 'tree', x: 40, y: 0, attr: { ripenPerHour: options.treeRipenPerHour ?? 0.1 } },
    { id: 'field', def: 'field', x: -40, y: 0 },
    { id: 'P1', def: options.knows ? 'farmer' : 'person' },
  ]);
  seedFruits(w, 'tree', 6);
  return { world: w, persons: ['P1'] };
}

/** 日次の要約に、畑の穀物、手持ちの穀物と粥、加工の回数を足す。 */
export function summarizeGrain(w: World, persons: string[]): Record<string, number | string> {
  const out = summarize(w, persons);
  const on = (holder: string, kind: string) => w.query((t) => t.kind === kind && t.state['attachedTo'] === holder).length;
  for (const f of w.query((t) => t.attr['bears'] === 'grain')) out[`${f.id}.grain`] = on(f.id, 'grain');
  for (const p of persons) {
    out[`${p}.grain`] = on(p, 'grain');
    out[`${p}.gruel`] = on(p, 'gruel');
  }
  out['processed'] = w.ledger.filter((e) => 'law' in e && e.law === 'process' && e.effect.kind === 'spawn').length;
  return out;
}

export function runGrainDays(days: number, options: GrainOptions = {}) {
  const scenario = buildGrainScenario(options);
  const initial = scenario.world.save();
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    scenario.world.run((day + 1) * DAY, DT);
    daily.push(summarizeGrain(scenario.world, scenario.persons));
  }
  return { scenario, daily, initial };
}
