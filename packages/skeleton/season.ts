// 果実の段を突き詰める一歩目: 実る時期のある木と、時期を学んで巡回する心。docs/RESEARCH.md「巡回と時期の学習」の提案の実装。
// 世界の側: 木の種類ごとに実る時期（周期・始まり・長さ、年ごとのずれ）があり、法則 ripen はその間だけ実らせる（fruit.ts の inSeason）。
// 情報層: 記憶の規則 forecast が、源（札 bears を持つ物）の心象に時期ごとの見込みの表を持たせ、近くで見るたびに予測誤差で直す。
// 心: 巡回者（PatrolMind）は見込み ÷ 距離が最大の木へ行き、確率 exp(−最良の点数 / η) で探索に出る。記憶は持たない（心象を読むだけ）。
// 個性: 学ぶ速さ・直近の観察を信じる長さ・気まぐれさ・時期の細かさ・初めの見込みは人の属性で、配置で上書きできる（遺伝的アルゴリズムで探す値）。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Memory, Relation, Relations, ThingDef, ThingId, ThingSnapshot } from './types.js';
import { World, type WorldOptions } from './world.js';
import { DAY, DT, HOUR, edibleOn, exploreSpiral, exploring, fruitWorld, place, seedFruits, sight, unitHash, type Placement, type Scenario } from './fruit.js';

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
const num = (e: Relation | undefined, k: string, d: number): number => (typeof e?.[k] === 'number' ? (e[k] as number) : d);

/** 季節の場面の一年（分）。実る時期はこの周期で繰り返す。 */
export const SEASON_YEAR = 24 * DAY;

// ---- 種類の定義 ----

/** 実る時期の違う三種の木。どれも木の定義を継ぎ、違いは時期だけ。一年 24 日のうち 6 日ずつ（A は 0〜6 日、B は 8〜14 日、C は 16〜22 日）、間に 2 日の端境がある。 */
export const treeADef: ThingDef = { name: 'treeA', parent: 'tree', attr: { seasonPeriod: SEASON_YEAR, seasonStart: 0, seasonLength: 6 * DAY, seasonJitter: 0 } };
export const treeBDef: ThingDef = { name: 'treeB', parent: 'tree', attr: { seasonPeriod: SEASON_YEAR, seasonStart: 8 * DAY, seasonLength: 6 * DAY, seasonJitter: 0 } };
export const treeCDef: ThingDef = { name: 'treeC', parent: 'tree', attr: { seasonPeriod: SEASON_YEAR, seasonStart: 16 * DAY, seasonLength: 6 * DAY, seasonJitter: 0 } };

/**
 * 巡回者。人の定義を継ぎ、心の種類と、見込みを持つ札 forecasts、個性の値を持つ。
 * calendar は一年の長さの感覚（分）、bins は一年を何区間に分けて覚えるか、learnRate は見込みを予測誤差のどれだけ直すか（0〜1）、
 * recallHours は直近の観察（最後に見た数）を信じる長さ（時）、wander は気まぐれさ η（点数は 実 / m）、prior は見たことの無い時期の見込み（実）、
 * appetite は栄養がこれを下回れば食べる値（身体の蓄えの上限 nutritionMax までは、多く食べるほど端境を越えやすいが、共有の木を空にする）、carry は持ち歩く実の目標の数。
 */
export const patrollerDef: ThingDef = {
  name: 'patroller',
  parent: 'person',
  attr: { mind: 'patroller', forecasts: true, calendar: SEASON_YEAR, bins: 12, learnRate: 0.5, recallHours: 12, wander: 0.002, prior: 1, appetite: 4, carry: 3 },
};
export const seasonDefs: ThingDef[] = [treeADef, treeBDef, treeCDef, patrollerDef];

// ---- 情報層: 見込みと学習 ----

/** 時刻 t が、一年を bins に分けたどの区間か。 */
const binOf = (self: ThingSnapshot, t: number): number => {
  const cal = attr(self, 'calendar') || SEASON_YEAR;
  const bins = Math.max(1, Math.round(attr(self, 'bins') || 1));
  return Math.min(bins - 1, Math.floor((((t % cal) + cal) % cal) / cal * bins));
};

/** 心象で、源 about に付いていると知っている物の数。 */
const attachedKnown = (rel: Readonly<Relations>, about: ThingId): number => Object.values(rel).filter((e) => e['attachedTo'] === about).length;

/**
 * 記憶の規則 forecast: 札 forecasts を持つ観測者が、源（心象に bears が写った物）の手の届く所にいるとき、その源の心象を書き直す。
 * 着いた刻み（前の刻みに近くにいなかった）に、いまの時期の見込み fc{区間} を 見込み + learnRate ×（付いている数 − 見込み）で直し、訪れた数 visits を数える。
 * 近くにいる間は、最後に見た数 lastCount と時刻 lastAt を書き続ける（去るときに残っていた数が、直近の観察になる）。
 * 見込みは「着いたときに付いている数」で学ぶので、自分や他人が先に取った後の数も混ざる（動物の観察と同じ制約）。
 */
export const forecastMemory: Memory = {
  id: 'forecast',
  version: 'season-1',
  learn: (observer, about, entry, w, dt) => {
    if (!has(observer, 'forecasts') || !('bears' in entry) || w.distance(observer.id, about) > attr(observer, 'reach')) return null;
    const count = attachedKnown(observer.rel, about);
    const fields: Relation = { visitAt: w.now, lastCount: count, lastAt: w.now };
    const ongoing = typeof entry['visitAt'] === 'number' && w.now - (entry['visitAt'] as number) <= dt + 1e-9;
    if (!ongoing) {
      const key = `fc${binOf(observer, w.now)}`;
      const before = num(entry, key, attr(observer, 'prior'));
      fields[key] = before + attr(observer, 'learnRate') * (count - before);
      fields['visits'] = num(entry, 'visits', 0) + 1;
    }
    return fields;
  },
};

/**
 * 見込み: 源の心象 entry から、時刻 t に付いている数の見込み。時期の表の値に、直近の観察のずれ（最後に見た数 − その時期の見込み）を
 * 経過時間で薄めて足す（exp(−経過 / recallHours)）。取り尽くした木は、しばらくは少なく、時が経つと時期の見込みへ戻る。
 */
export function predict(self: ThingSnapshot, entry: Relation, t: number): number {
  const prior = attr(self, 'prior');
  const base = num(entry, `fc${binOf(self, t)}`, prior);
  if (typeof entry['lastAt'] !== 'number') return Math.max(0, base);
  const lastAt = entry['lastAt'] as number;
  const tau = Math.max(1e-9, attr(self, 'recallHours') * HOUR);
  const surprise = num(entry, 'lastCount', 0) - num(entry, `fc${binOf(self, lastAt)}`, prior);
  return Math.max(0, base + surprise * Math.exp(-Math.max(0, t - lastAt) / tau));
}

// ---- 心 ----

/**
 * 巡回者の心: 採取者と同じく、栄養が食欲（appetite）を下回り実を持てば食べ、家が無ければ住み、手持ちが目標（carry）に足りれば家へ戻る。違いは行き先の選び方と、食欲・目標が個性（属性）であること。
 * 手の届く木に実が見えれば採る。向かっている木と探索の行き先は着くまで替えない。そうでなければ、知っている木ごとに
 * 「着く時刻の見込み ÷ (距離 + 1)」を点数にし、確率 exp(−最良の点数 / wander) で探索に出て、そうでなければ最良の木へ行く（Boyer・Walsh 2010 の形）。
 * 最良の点数がほぼ 0 なら、その場で待つ。巡回の順路は書かない。巡回は見込みと選び方から出てくるものとして観測する。
 * 気まぐれは自分の id と時刻から決まる値（unitHash）で引き、再現できる。
 */
export class PatrolMind {
  constructor(private readonly exploreSpacing = 1) {}
  decide(self: ThingSnapshot, now: number) {
    const target = attr(self, 'carry');
    const eatBelow = attr(self, 'appetite');
    const me = self.id;
    const k = self.rel;
    const x = stateNum(self, 'x');
    const y = stateNum(self, 'y');
    const dist = (e: Relation) => Math.hypot(num(e, 'x', 0) - x, num(e, 'y', 0) - y);
    const near = (e: Relation) => dist(e) <= attr(self, 'reach');
    const goTo = (id: ThingId, e: Relation) => ({ intent: 'move', target: id, targetX: num(e, 'x', 0), targetY: num(e, 'y', 0) });
    const fruitsOn = (holder: ThingId) => Object.values(k).filter((f) => 'edible' in f && f['attachedTo'] === holder).length;
    const holding = fruitsOn(me);
    if (res(self, 'stomach') < 1 && res(self, 'nutrition') < eatBelow && holding >= 1) return { intent: 'eat' };
    const home = Object.entries(k).find(([, e]) => e['home'] === true && 'x' in e);
    if (!home) {
      const place = Object.entries(k).filter(([, e]) => 'stores' in e).sort(([, p], [, q]) => dist(p) - dist(q))[0];
      if (place) return near(place[1]) ? { intent: 'settle', target: place[0] } : goTo(place[0], place[1]);
    }
    if (holding >= target) return home && !near(home[1]) ? goTo(home[0], home[1]) : { intent: 'idle' };
    const trees = Object.entries(k).filter(([, e]) => 'bears' in e && 'x' in e);
    const here = trees.find(([id, e]) => near(e) && fruitsOn(id) >= 1);
    if (here) return { intent: 'pick', target: here[0] };
    const heading = state(self, 'target');
    const committed = state(self, 'intent') === 'move' ? trees.find(([id, e]) => id === heading && !near(e)) : undefined;
    if (committed) return goTo(committed[0], committed[1]);
    const explore = () => exploreSpiral(self, home?.[1], this.exploreSpacing, 0.5, 1, 0);
    if (exploring(self) || !trees.length) return explore();
    const speed = attr(self, 'speedPerHour') / HOUR; // m/分
    let best: { id: ThingId; e: Relation; score: number } | undefined;
    for (const [id, e] of trees) {
      if (near(e)) continue; // 手の届く木は見えている（実が無いので来た）
      const d = dist(e);
      const score = predict(self, e, now + d / Math.max(speed, 1e-9)) / (d + 1);
      if (!best || score > best.score + 1e-12) best = { id, e, score };
    }
    const score = best?.score ?? 0;
    const wander = attr(self, 'wander');
    if (wander > 0 && unitHash(me, now) < Math.exp(-score / wander)) return explore();
    if (!best || score <= 1e-9) return { intent: 'idle' };
    return goTo(best.id, best.e);
  }
}

// ---- 場面 ----

/** 季節の果樹園: 家一軒と、三種の木を二本ずつ。家からは近い木しか見えない（視界 60m）。 */
export const orchard: Placement[] = [
  { id: 'home', def: 'home', x: 0, y: 0 },
  { id: 'A1', def: 'treeA', x: 50, y: 10 },
  { id: 'A2', def: 'treeA', x: -40, y: 60 },
  { id: 'B1', def: 'treeB', x: 90, y: -30 },
  { id: 'B2', def: 'treeB', x: -70, y: -50 },
  { id: 'C1', def: 'treeC', x: 20, y: -90 },
  { id: 'C2', def: 'treeC', x: 120, y: 60 },
];

export interface SeasonOptions {
  /** 置く人（定義の名と個性の上書き）。既定は巡回者 2 人と採取者 2 人。 */
  persons?: { id: ThingId; def: string; attr?: Placement['attr'] }[];
  /** 木の実る速さ（実/時）。自然の生産量を下げるときに使う。 */
  ripenPerHour?: number;
  /** 実る時期の年ごとのずれ（日）。 */
  jitterDays?: number;
  /** 年ごとのずれの乱数の種（繰り返しの比較で場面を変える）。 */
  seed?: number;
  /** 組を数える順（比較用。結果は変わらない）。 */
  pairOrder?: 'sorted' | 'reverse' | 'shuffle';
}

/** 季節の世界: 果実の世界に、時期のある木・巡回者の定義、記憶の規則 forecast、心の種類 patroller を足す。 */
export function seasonWorld(options: WorldOptions = {}): World {
  const w = fruitWorld(options);
  for (const d of seasonDefs) w.addDef(d);
  w.addMemory(forecastMemory);
  w.addMind('patroller', () => new PatrolMind());
  return w;
}

export const defaultSeasonPersons: NonNullable<SeasonOptions['persons']> = [
  { id: 'P1', def: 'patroller' },
  { id: 'P2', def: 'patroller' },
  { id: 'F1', def: 'person' },
  { id: 'F2', def: 'person' },
];

/** 季節の果樹園に人を置く。木の実る速さと年ごとのずれは、木の配置で上書きする。人は家の脇（1m の円周上）に置く。初めの実は、最初に実る種（A）の木に 6 個ずつ。 */
export function buildSeasonScenario(options: SeasonOptions = {}): Scenario {
  const w = seasonWorld({ pairOrder: options.pairOrder ?? 'sorted' });
  const treeAttr = {
    ...(options.ripenPerHour !== undefined ? { ripenPerHour: options.ripenPerHour } : {}),
    ...(options.jitterDays !== undefined ? { seasonJitter: options.jitterDays * DAY } : {}),
    ...(options.seed !== undefined ? { seasonSeed: options.seed } : {}),
  };
  const persons = options.persons ?? defaultSeasonPersons;
  place(w, [
    ...orchard.map((p) => (p.def.startsWith('tree') ? { ...p, attr: { ...treeAttr, ...p.attr } } : p)),
    // 人は家の手の届く所に、円周上に少しずらして置く（全く同じ道を歩いて、同じ刻みに同じ実を取り合うことを避ける）。
    ...persons.map((p, i) => ({ id: p.id, def: p.def, x: Math.cos((2 * Math.PI * i) / persons.length), y: Math.sin((2 * Math.PI * i) / persons.length), attr: p.attr })),
  ]);
  for (const p of orchard) if (p.def === 'treeA') seedFruits(w, p.id, 6);
  return { world: w, persons: persons.map((p) => p.id) };
}

/** 人ごとの結果: 生きているか、死んだ日、食べた数、木ごとの訪れた数（巡回者の心象の visits）。 */
export function seasonOutcome(w: World, persons: ThingId[]) {
  return persons.map((p) => {
    const t = w.thing(p)!;
    const died = w.ledger.find((e) => 'law' in e && e.law === 'starve' && e.a === p);
    const eaten = w.ledger.filter((e) => 'law' in e && e.law === 'eat' && e.a === p).length;
    const visits: Record<string, number> = {};
    for (const [id, e] of Object.entries(t.rel)) if (typeof e['visits'] === 'number') visits[id] = e['visits'] as number;
    return { id: p, kind: t.kind, alive: t.state['alive'] === 'yes', diedDay: died ? Number((died.at / DAY).toFixed(1)) : undefined, eaten, visits };
  });
}

export function summarizeSeason(w: World, persons: ThingId[]): Record<string, number | string> {
  const out: Record<string, number | string> = { day: Math.round(w.now / DAY) };
  for (const p of persons) {
    const t = w.thing(p)!;
    out[`${p}`] = t.state['alive'] === 'yes' ? Number(res(t, 'nutrition').toFixed(2)) : 'dead';
  }
  for (const t of w.query((x) => typeof x.attr['bears'] === 'string')) out[t.id] = edibleOn(w, t.id).length;
  return out;
}

export function runSeasonDays(days: number, options: SeasonOptions = {}) {
  const scenario = buildSeasonScenario(options);
  const initial = scenario.world.save();
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    scenario.world.run((day + 1) * DAY, DT);
    daily.push(summarizeSeason(scenario.world, scenario.persons));
  }
  return { scenario, daily, initial };
}

/** 再生: 感覚に加えて記憶の規則も登録する（心象の見込みは記録に無く、世界の真実から計算し直す）。 */
export function replaySeason(initial: ReturnType<World['save']>, ledger: World['ledger'], until: number): World {
  const w = World.load(initial);
  w.addSense(sight);
  w.addMemory(forecastMemory);
  w.replay(ledger, DT, until);
  return w;
}

