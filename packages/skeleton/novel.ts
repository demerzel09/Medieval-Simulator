// 新しい事物の実験の世界（study/new-things。docs/RESEARCH.md 10.10）。
// どの世界も、既存の定義・法則（fruit.ts・grain.ts）に、新しい種類の定義を足して置くだけで、法則も心も足さない。
//   E1 果実: 木一本と家。            E2 穀物: 実の少ない木、畑、炉、家（加工の知識は与えない）。
//   E3 大麦: 穀物と同じ法則で加工できるが、見た目の違う種類。   E4 新しい木: 見た目が木の新しい種類と、見た目が実の新しい実。
//   E5 堅い実: 刃物が無ければ採れない実と、家に置いた刃物。     E6 似た物: 見た目が実なのに食べられない物を付ける、見た目が木の物。
// 人は、新しい事物に対応する心の試作（affordance.ts の learner）か、比べるための採取者（person）・知っている人（farmer）。
// 学んだ知識を別の世界へ持って行く（kind の型だけを移し、個々の物の記憶は移さない）ことで、移し替えの速さを測る。

import type { Relations, ThingDef, ThingId } from './types.js';
import { World } from './world.js';
import { DAY, DT, ForagerMind, fruitDefs, fruitLaws, place, type Placement } from './fruit.js';
import { grainDefs, processLaw } from './grain.js';
import { AffordanceMind, affordanceMemory, appearance, strictAppearance } from './affordance.js';

/** 新しい事物に対応する心の試作を持つ人。札 affordances で記憶の規則 affordance が働く。 */
export const learnerDef: ThingDef = { name: 'learner', parent: 'person', attr: { mind: 'affordance', affordances: true, appetite: 4, carry: 3, reserve: 3 } };
/** 大麦: 穀物と同じく炉で粥になる（定義は穀物を継ぐ）。見た目は穀物と違う。 */
export const barleyDef: ThingDef = { name: 'barley', parent: 'grain', attr: { looks: 'barley' } };
export const barleyFieldDef: ThingDef = { name: 'barleyField', parent: 'field', attr: { bears: 'barley', looks: 'barleyField' } };
/** 新しい木（見た目は木）と、その実（見た目は実。実の定義を継ぐ）。 */
export const oakDef: ThingDef = { name: 'oak', parent: 'tree', attr: { bears: 'berry', looks: 'tree' } };
export const berryDef: ThingDef = { name: 'berry', parent: 'fruit', attr: { looks: 'fruit' } };
/** 堅い実: 結びつきが強く（bond 5）、握る力 1 だけでは採れない。刃物（切る力 10）を持てば採れる。 */
export const nutDef: ThingDef = { name: 'nut', parent: 'fruit', attr: { bond: 5, looks: 'nut' } };
export const nutTreeDef: ThingDef = { name: 'nutTree', parent: 'tree', attr: { bears: 'nut', looks: 'nutTree' } };
/** 似た物: 見た目は実だが、札 edible を持たない（食べる法則が当たらない）。見た目が木の物に付く。腐らないので、木の上限を埋めて残る。 */
export const gallDef: ThingDef = { name: 'gall', attr: { looks: 'fruit', visibility: 30, bond: 0 }, state: { attachedTo: '' } };
export const gallTreeDef: ThingDef = { name: 'gallTree', parent: 'tree', attr: { bears: 'gall', looks: 'tree' } };
export const novelDefs: ThingDef[] = [learnerDef, barleyDef, barleyFieldDef, oakDef, berryDef, nutDef, nutTreeDef, gallDef, gallTreeDef];

/** 新しい事物の世界: 果実と穀物の定義・法則に、新しい種類の定義を足す。感覚は見た目の知覚（視界 + looks）。 */
export function novelWorld(strict = false): World {
  const w = new World({ rangeAttrs: ['sight', 'reach', 'smell'] });
  for (const d of [...fruitDefs, ...grainDefs, ...novelDefs]) w.addDef(d);
  for (const law of [...fruitLaws, processLaw]) w.addLaw(law);
  w.addSense(strict ? strictAppearance : appearance);
  w.addMemory(affordanceMemory);
  w.addMind('forager', () => new ForagerMind());
  w.addMind('affordance', () => new AffordanceMind());
  w.addFromDef('nature', 'nature');
  return w;
}

/** 物 holder に、定義 def の物を count 個付ける（初期状態。自然の蓄えから）。 */
export function seedOn(w: World, holder: ThingId, def: string, count: number): void {
  for (let i = 0; i < count; i++) w.seed({ kind: 'spawn', id: w.nextSpawnId(`${holder}/${def}`), def, state: { attachedTo: holder }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
}

export type NovelName = 'fruit' | 'grain' | 'grainApart' | 'barley' | 'oak' | 'nut' | 'gall';

export interface NovelOptions {
  /** 置く人の定義（learner、person、farmer）。 */
  person?: string;
  /** 人の属性の上書き（上の層の切り替え affMeta など）。 */
  attr?: Placement['attr'];
  /** 持って行く知識（心象の型の項目）。 */
  knowledge?: Relations;
  /**
   * 配置の変え方（結果が一つの配置の偶然でないかを見る）: near は家からの距離を 0.7 倍、far は 1.4 倍にする。
   * 東西の入れ替えや回転では、距離と id の順が変わらないので、記録が同じになり確かめにならない。
   */
  layout?: 'base' | 'near' | 'far';
  /** true なら法則の札を写さない厳しい知覚（試作の心が札を読まないことの確かめ）。 */
  strict?: boolean;
}

/** 実験の世界を組み立てる。どれも家 (0,0) の脇に人を一人置く。 */
export function buildNovel(name: NovelName, options: NovelOptions = {}): { world: World; person: ThingId } {
  const w = novelWorld(options.strict);
  const person = options.person ?? 'learner';
  const items: Placement[] = [{ id: 'home', def: 'home', x: 0, y: 0 }];
  const seeds: [ThingId, string, number][] = [];
  const lowTree = { id: 'tree', def: 'tree', x: 40, y: 0, attr: { ripenPerHour: 0.1 } };
  switch (name) {
    case 'fruit':
      items.push({ id: 'tree', def: 'tree', x: 40, y: 0, attr: { ripenPerHour: 0.25 } });
      seeds.push(['tree', 'fruit', 6]);
      break;
    case 'grain':
    case 'grainApart':
      items.push({ id: 'hearth', def: 'hearth', ...(name === 'grain' ? { x: 0, y: 1 } : { x: 25, y: 25 }) }, lowTree, { id: 'field', def: 'field', x: -40, y: 0 });
      seeds.push(['tree', 'fruit', 6]);
      break;
    case 'barley':
      items.push({ id: 'hearth', def: 'hearth', x: 0, y: 1 }, lowTree, { id: 'field', def: 'barleyField', x: -40, y: 0 });
      seeds.push(['tree', 'fruit', 6]);
      break;
    case 'oak':
      items.push({ id: 'oak', def: 'oak', x: 40, y: 0, attr: { ripenPerHour: 0.25 } });
      seeds.push(['oak', 'berry', 6]);
      break;
    case 'nut':
      // 刃物は家ではなく、遠くの小屋（置ける物）に置く。堅い実の木は家の近く。刃物なしで実を試してから刃物に出会う順になる。
      items.push(lowTree, { id: 'nutTree', def: 'nutTree', x: -20, y: 0, attr: { ripenPerHour: 0.25 } }, { id: 'shed', def: 'home', x: 0, y: -60 });
      seeds.push(['tree', 'fruit', 6], ['nutTree', 'nut', 6]);
      break;
    case 'gall':
      items.push({ id: 'tree', def: 'tree', x: 40, y: 0, attr: { ripenPerHour: 0.25 } }, { id: 'gallTree', def: 'gallTree', x: 0, y: 30, attr: { ripenPerHour: 0.25 } });
      seeds.push(['tree', 'fruit', 6], ['gallTree', 'gall', 6]);
      break;
  }
  const scale = options.layout === 'near' ? 0.7 : options.layout === 'far' ? 1.4 : 1;
  const turn = (p: Placement): Placement => (scale === 1 ? p : { ...p, x: (p.x ?? 0) * scale, y: (p.y ?? 0) * scale });
  place(w, items.map(turn));
  w.addFromDef('P1', person, { attr: options.attr, rel: options.knowledge });
  for (const [holder, def, n] of seeds) seedOn(w, holder, def, n);
  if (name === 'nut') w.seed({ kind: 'spawn', id: 'knife', def: 'knife', state: { attachedTo: 'shed' }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
  return { world: w, person: 'P1' };
}

/** 持って行ける知識: 心象のうち、種類ごとの型（aff:s:）だけ。個々の物の記憶・付いている先の見込み・表出は移さない。 */
export function portableKnowledge(w: World, person: ThingId): Relations {
  const rel = w.thing(person)!.rel;
  return Object.fromEntries(Object.entries(rel).filter(([k]) => k.startsWith('aff:s:')));
}

/** 結果の要約: 生きているか、死んだ日、種類ごとに食べた数・採った数・加工してできた数と、それぞれの初めての時刻（時）。 */
export function novelOutcome(w: World, person: ThingId) {
  const t = w.thing(person)!;
  const died = w.ledger.find((e) => 'law' in e && e.law === 'starve' && e.a === person);
  const kindOfId = new Map<string, string>();
  for (const e of w.ledger) if ('law' in e && e.effect.kind === 'spawn') kindOfId.set(e.effect.id, e.effect.def);
  const tally: Record<string, { n: number; first: number }> = {};
  const note = (key: string, at: number) => {
    const x = (tally[key] ??= { n: 0, first: at / 60 });
    x.n += 1;
  };
  for (const e of w.ledger) {
    if (!('law' in e) || e.a !== person) continue;
    if (e.law === 'eat' && e.effect.kind === 'despawn') note(`eat:${kindOfId.get(e.effect.thing) ?? '?'}`, e.at);
    if (e.law === 'pick' && e.effect.kind === 'reassign') note(`pick:${kindOfId.get(e.effect.thing) ?? e.effect.thing}`, e.at);
    if (e.law === 'process' && e.effect.kind === 'spawn') note(`make:${e.effect.def}`, e.at);
  }
  const fmt = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, `${v.n}（初め ${v.first.toFixed(1)} 時）`]));
  // 実りの無い試し: 一度も何も起きなかった型に使った刻みの合計（知る価値で試して、無駄に終わった分）。
  let futile = 0;
  for (const [k, e] of Object.entries(t.rel)) if (k.startsWith('aff:s:') && e['s'] === 0) futile += typeof e['n'] === 'number' ? e['n'] : 0;
  return { alive: t.state['alive'] === 'yes', diedDay: died ? Number((died.at / DAY).toFixed(1)) : undefined, nutrition: Number((t.res['nutrition'] ?? 0).toFixed(2)), futile, ...fmt };
}

export function runNovel(name: NovelName, days: number, options: NovelOptions = {}) {
  const s = buildNovel(name, options);
  s.world.run(days * DAY, DT);
  return { ...s, outcome: novelOutcome(s.world, s.person) };
}
