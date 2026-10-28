// 果実の段を突き詰める一歩目: 実る時期のある木と、時期を学んで巡回する心。docs/RESEARCH.md「巡回と時期の学習」の提案の実装。
// 世界の側: 木の種類ごとに実る時期（周期・始まり・長さ、年ごとのずれ）があり、法則 ripen はその間だけ実らせる（fruit.ts の inSeason）。
// 情報層: 心象のモデルの枠組み（modular.ts）の上に、源（実を付ける物）の組 forageModelSet を置く。着くたびに、付いている実の数を観察して、
//   種類のモデル（心象の種類の知識 `kind:treeA`）と一本ずつのモデル（その木の心象のずれ）を、割り当て（既定は協調型）で直す。見込みは 種類 + その木のずれ。
//   記憶の規則は観測者ごとに一刻みに一度の認識の一歩で、いまの区間の信念（いまは暦と同じ）で直し、知っている木ごとに、着く時刻の見込み expect を心象に書く。
// 心: 巡回者は組み合わせの心（ModularMind）で、規則の組 patrolRules を優先の順に並べる。見込み expect ÷ 距離が最大の木へ行き、確率 exp(−最良の点数 / η) で探索に出る。
//   記憶は持たない（心象を読むだけ）。暦も、どのモデルで当てるかも読まない。どの組・どの割り当て・どの規則の組・どの選び方を使うかは、人の札で選ぶ（差し替えて比べるため）。
// 木の一生: 生まれることと死ぬことは別の法則。法則 sow で木は一本ずつ、一定の確率で、森の広がりの中の、ほかの木の縄張りの外に同じ種類の若木を生み、
//   法則 wither で寿命（札 lifespan）に達した木は消える。木の数は決めず、森の広さと縄張りと、生まれる数・死ぬ数の釣り合いから出てくる。
//   森（定義 forest）は広さ area を持つ物で、木がどの森に属するかは位置で決まる（森の広がりの中に立つ木が、その森の木）。新しい木は、知られていない木として現れる。
// 個性: 学ぶ速さ・直近の観察を信じる長さ・気まぐれさ・時期の細かさ・初めの見込みは人の属性で、配置で上書きできる（遺伝的アルゴリズムで探す値）。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Law, Relation, Relations, ThingDef, ThingId, ThingSnapshot } from './types.js';
import { ModularMind, assigners, createModelSystem, individualModel, kindModel, prioritySelector, treeModel, type Intent, type ModelSet, type RuleSet } from './modular.js';
import { World, type WorldOptions } from './world.js';
import { DAY, DT, HOUR, KIND, edibleOn, exploreSpiral, exploring, fruitWorld, place, seedFruits, sight, unitHash, type Placement, type Scenario } from './fruit.js';

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

/**
 * 実る時期の違う三種の木。どれも木の定義を継ぎ、違いは時期だけ。一年 24 日のうち 6 日ずつ（A は 0〜6 日、B は 8〜14 日、C は 16〜22 日）、間に 2 日の端境がある。
 * 一本の実る速さは 0.036 実/時（森が埋まった 41〜42 本で、果樹園の全体はおよそ 1.5 実/時。以前の一本ずつの果樹園の 0.25 実/時 × 6 本と同じ）。
 * 木の量 quantity 1 は、枯れたときに自然の廃棄へ移る分（若木は自然の蓄えから 1 で生まれる）。lifespan 0 は枯れない。
 * sowPerDay は一日に種をまく見込みの回数（0 はまかない）、spreadRadius は種が親から届く距離の上限（m）、sowTries は一度にまく種の数（落ちる場所を試す回数）、
 * canopy はその木の縄張り（枝の広がり、m。ほかの種はこの内では日が当たらず生えない）。
 */
const seasonTree = (name: string, start: number): ThingDef => ({
  name,
  parent: 'tree',
  attr: { ripenPerHour: 0.036, seasonPeriod: SEASON_YEAR, seasonStart: start, seasonLength: 6 * DAY, seasonJitter: 0, lifespan: 0, sowPerDay: 0, spreadRadius: 15, sowTries: 10, canopy: 10 },
  res: { quantity: 1 },
});
export const treeADef: ThingDef = seasonTree('treeA', 0);
export const treeBDef: ThingDef = seasonTree('treeB', 8 * DAY);
export const treeCDef: ThingDef = seasonTree('treeC', 16 * DAY);

/**
 * 巡回者。人の定義を継ぎ、心の種類（modular）と、使う部品の札（モデルの組 models、誤差の割り当て assigner、規則の組 rules、選び方 selector）、個性の値を持つ。
 * calendar は一年の長さの感覚（分）、bins は一年を何区間に分けて覚えるか、
 * kindRate は種類の見込みを、learnRate は一本ごとのずれを、予測誤差のどれだけ直すか（和を 1 以下に。kindRate 0 なら一本ずつ、learnRate 0 なら種類だけで覚え、両方 0 なら学ばない）、
 * recallHours は直近の観察（最後に見た数）を信じる長さ（時）、wander は気まぐれさ η（点数は 実 / m）、prior は見たことの無い時期の見込み（実）、
 * appetite は栄養がこれを下回れば食べる値（身体の蓄えの上限 nutritionMax までは、多く食べるほど端境を越えやすいが、共有の木を空にする）、carry は持ち歩く実の目標の数。
 * 競合型の割り当て（modular.ts）の値: errRate は外し具合の移動平均の速さ、respVar は責任の幅 σ²、vigilance は作る警戒の基準（誤差の二乗）、
 * obsNoise・drift・priorVar は不確かさの割り当ての観察の揺らぎ・不確かさの増え方・初めの不確かさ。協調型では使わない。
 */
export const patrollerDef: ThingDef = {
  name: 'patroller',
  parent: 'person',
  attr: { mind: 'modular', models: 'forage', assigner: 'additive', rules: 'patrol', selector: 'priority', calendar: SEASON_YEAR, bins: 12, kindRate: 0.25, learnRate: 0.25, recallHours: 12, wander: 0.002, prior: 1, appetite: 4, carry: 3, errRate: 0.2, respVar: 1, vigilance: 1, obsNoise: 1, drift: 0.05, priorVar: 4 },
};
/**
 * 森: 木の生える広がり（札 area）。中心（位置）から area（m）の内にだけ、木の種が根付く。いまは誰にも見えない（visibility を持たない）。
 * 入る木の数は area と木の縄張り canopy の比で決まる（area が canopy の 0.5〜0.577 倍なら 2 本、0.577〜0.7 倍なら 3 本まで）。
 */
export const forestDef: ThingDef = { name: 'forest', attr: { area: 15 } };
export const seasonDefs: ThingDef[] = [treeADef, treeBDef, treeCDef, forestDef, patrollerDef];

// ---- 情報層: 見込みと学習（心象のモデルの枠組みの上の、源の組） ----

/** 心象で、源 about に付いていると知っている物の数。 */
const attachedKnown = (rel: Readonly<Relations>, about: ThingId): number => Object.values(rel).filter((e) => e['attachedTo'] === about).length;

/**
 * 源の組 forage: 心象に bears が写った物（木）を源とし、着いたときに付いていると知っている実の数を観察する。
 * 種類のモデル（`kind:種類` の fc{区間}、見たことの無い区間は prior）と一本ずつのモデル（その木の dv{区間}、無ければ 0）を並べる。
 * 既定の割り当て（協調型）では、見込みは 種類 + ずれ で、誤差 e = 観察 − 見込み を、種類は kindRate 倍、ずれは learnRate 倍だけ足す
 * （種類の札と木の札の線形和の逐次最小二乗。一本の木の見込みは kindRate + learnRate の速さで動く）。
 * 見込みは「着いたときに付いている数」で学ぶので、自分や他人が先に取った後の数も混ざる（動物の観察と同じ制約）。
 */
export const forageModelSet: ModelSet = {
  id: 'forage',
  version: 'modular-1',
  isSource: (entry) => 'bears' in entry,
  observe: attachedKnown,
  models: [kindModel, individualModel],
};

/**
 * 源の組 forage-compete: 源と観察は forage と同じで、種類のモデルと一本ずつのモデル（競合型 treeModel）が、それぞれ単独で全体を予測する。
 * 責任・勝者一つ・作る・不確かさの割り当てと組む（協調型と組むと二つの予測の和になり、意味を持たない）。
 */
export const forageCompeteSet: ModelSet = { ...forageModelSet, id: 'forage-compete', models: [kindModel, treeModel] };

/** 季節の段の見込みの仕組み。記憶の規則（forageModels.memory、認識の一歩）を世界に登録する。割り当ては一覧 assigners から札で選ぶ。 */
export const forageModels = createModelSystem({ forage: forageModelSet, 'forage-compete': forageCompeteSet }, assigners);

/**
 * 見込み: 源の心象 entry から、時刻 t に付いている数の見込み。区間の見込み（種類 + その木のずれ）に、直近の観察のずれを経過時間で薄めて足す。
 * 訪れたことの無い木も、同じ種類の木で学んだ見込みで当てる（ずれは 0）。認識の一歩が表出 expect を書くのと同じ計算で、画面と検査が任意の時刻を読む口。心は使わない。
 */
export const predict = (self: ThingSnapshot, entry: Relation, t: number): number => forageModels.forecast(self, entry, t);

// ---- 物理層: 木の一生 ----

/** 木の寿命: lifespan ×（0.5 + 木の id と seasonSeed から決まる 0〜1 の値）。生まれた時刻 bornAt（初めからある木は 0）から数える。 */
const lifeOf = (b: ThingSnapshot): number => attr(b, 'lifespan') * (0.5 + unitHash(`${b.id}:life:${attr(b, 'seasonSeed')}`, 0));

/** (育てる, 寿命のある木): 枯れる。寿命に達した刻みに、木は自然の廃棄へ消える。付いていた実は付く先を失って見えなくなり、そのまま腐る。 */
export const wither: Law = {
  id: 'wither',
  version: 'season-1',
  pair: (a, b, dt, w) => {
    if (!has(a, 'grows') || typeof b.attr['bears'] !== 'string' || attr(b, 'lifespan') <= 0) return [];
    if (w.now + dt - stateNum(b, 'bornAt') < lifeOf(b) - 1e-9) return [];
    return [{ kind: 'despawn', thing: b.id, to: a.id, toRes: 'waste', produced: res(b, 'quantity'), lossTo: a.id, lossRes: 'waste' }];
  },
};

/**
 * (育てる, 種をまく木): まく。刻みごとに確率 sowPerDay × dt / 1 日 で、木は sowTries 粒の種をまく。種は親から spreadRadius 以内の一点（向きと距離は木の id・時刻・種の番号・seasonSeed から決まる値）に落ちる。
 * 落ちた所が、どれかの森（札 area を持つ物）の広がりの内で、どの木（札 bears を持つ物。種類を問わない）の縄張り canopy の内でもなければ、そこに若木が根付く。
 * 森の外や、ほかの木の陰に落ちた種は生えない。試した所がどれも塞がっていれば、その回は生えない。
 * 根付くのは一度に一本で、親の属性（時期・実る速さ・寿命・まく速さなど）を受け継ぐ同じ種類の木（自然の蓄えから 1）。
 * 木の数を決めるものは無く、森の空きが多いほど増え、森が埋まれば生えない。若木は生まれたときから、時期が来れば実る（育つまでの年月は省く）。
 * 同じ刻みに二本の親の種が近くに落ちると、どちらも刻みの始めの世界を見て根付くので、縄張りの重なる二本が生えることがある。
 */
export const sow: Law = {
  id: 'sow',
  version: 'season-1',
  pair: (a, b, dt, w) => {
    if (!has(a, 'grows') || typeof b.attr['bears'] !== 'string' || attr(b, 'sowPerDay') <= 0) return [];
    const seed = attr(b, 'seasonSeed');
    const tick = Math.round(w.now / dt);
    if (unitHash(`${b.id}:sow:${seed}`, tick) >= attr(b, 'sowPerDay') * dt / DAY) return [];
    const forests = w.query((t) => has(t, 'area'));
    if (!forests.length) return []; // 森が無ければ根付く所も無い
    const trees = w.query((t) => typeof t.attr['bears'] === 'string');
    const free = (x: number, y: number) =>
      forests.some((f) => Math.hypot(x - stateNum(f, 'x'), y - stateNum(f, 'y')) <= attr(f, 'area')) &&
      trees.every((t) => Math.hypot(stateNum(t, 'x') - x, stateNum(t, 'y') - y) >= attr(t, 'canopy'));
    for (let k = 0; k < Math.max(1, attr(b, 'sowTries')); k++) {
      const angle = 2 * Math.PI * unitHash(`${b.id}:dir:${seed}:${k}`, tick);
      const r = attr(b, 'spreadRadius') * Math.sqrt(unitHash(`${b.id}:dist:${seed}:${k}`, tick)); // 円の中に一様に落ちる
      const x = stateNum(b, 'x') + r * Math.cos(angle);
      const y = stateNum(b, 'y') + r * Math.sin(angle);
      if (!free(x, y)) continue;
      return [{ kind: 'spawn', id: (w as World).nextSpawnId(b.id), def: b.kind, attr: { ...b.attr }, state: { x, y, bornAt: w.now + dt }, from: a.id, fromRes: 'fruitStock', amount: 1 }];
    }
    return [];
  },
};

// ---- 心: 巡回の規則の組 ----

/** 巡回の規則が読む状況。心象と状態から一度だけ作り、規則たちで共有する。 */
interface PatrolSituation {
  self: ThingSnapshot;
  now: number;
  near: (e: Relation) => boolean;
  dist: (e: Relation) => number;
  goTo: (id: ThingId, e: Relation) => Intent;
  fruitsOn: (holder: ThingId) => number;
  holding: number;
  home: [ThingId, Relation] | undefined;
  trees: [ThingId, Relation][];
  explore: () => Intent;
}

/**
 * 巡回の規則の組。並びが優先の順（優先の順の選び方で、最初に勧めた規則の意図を採る）。
 * 採取者と同じく、栄養が食欲（appetite）を下回り実を持てば食べ、家が無ければ住み、手持ちが目標（carry）に足りれば家へ戻る。
 * 手の届く木に実が見えれば採る。向かっている木と探索の行き先は着くまで替えない。そうでなければ、知っている木ごとに
 * 「着く時刻の見込み（認識の一歩が心象に書いた expect）÷ (距離 + 1)」を点数にし、確率 exp(−最良の点数 / wander) で探索に出て、そうでなければ最良の木へ行く（Boyer・Walsh 2010 の形）。
 * 最良の点数がほぼ 0 なら、その場で待つ。巡回の順路は書かない。巡回は見込みと選び方から出てくるものとして観測する。
 * 気まぐれは自分の id と時刻から決まる値（unitHash）で引き、再現できる。探索の渦巻きの間隔は札 exploreSpacing（無ければ 1）。
 */
export const patrolRules: RuleSet<PatrolSituation> = {
  id: 'patrol',
  version: 'modular-1',
  situation: (self, now) => {
    const k = self.rel;
    const x = stateNum(self, 'x');
    const y = stateNum(self, 'y');
    const dist = (e: Relation) => Math.hypot(num(e, 'x', 0) - x, num(e, 'y', 0) - y);
    const fruitsOn = (holder: ThingId) => Object.values(k).filter((f) => 'edible' in f && f['attachedTo'] === holder).length;
    const home = Object.entries(k).find(([, e]) => e['home'] === true && 'x' in e);
    return {
      self,
      now,
      dist,
      near: (e) => dist(e) <= attr(self, 'reach'),
      goTo: (id, e) => ({ intent: 'move', target: id, targetX: num(e, 'x', 0), targetY: num(e, 'y', 0) }),
      fruitsOn,
      holding: fruitsOn(self.id),
      home,
      trees: Object.entries(k).filter(([, e]) => 'bears' in e && 'x' in e),
      explore: () => exploreSpiral(self, home?.[1], attr(self, 'exploreSpacing') || 1, 0.5, 1, 0),
    };
  },
  rules: [
    { id: 'eat', propose: (s) => (res(s.self, 'stomach') < 1 && res(s.self, 'nutrition') < attr(s.self, 'appetite') && s.holding >= 1 ? { intent: 'eat' } : undefined) },
    {
      id: 'settle',
      propose: (s) => {
        if (s.home) return undefined;
        const place = Object.entries(s.self.rel).filter(([, e]) => 'stores' in e).sort(([, p], [, q]) => s.dist(p) - s.dist(q))[0];
        if (!place) return undefined;
        return s.near(place[1]) ? { intent: 'settle', target: place[0] } : s.goTo(place[0], place[1]);
      },
    },
    { id: 'carry-home', propose: (s) => (s.holding >= attr(s.self, 'carry') ? (s.home && !s.near(s.home[1]) ? s.goTo(s.home[0], s.home[1]) : { intent: 'idle' }) : undefined) },
    {
      id: 'pick-here',
      propose: (s) => {
        const here = s.trees.find(([id, e]) => s.near(e) && s.fruitsOn(id) >= 1);
        return here ? { intent: 'pick', target: here[0] } : undefined;
      },
    },
    {
      id: 'keep-heading',
      propose: (s) => {
        const heading = state(s.self, 'target');
        const committed = state(s.self, 'intent') === 'move' ? s.trees.find(([id, e]) => id === heading && !s.near(e)) : undefined;
        return committed ? s.goTo(committed[0], committed[1]) : undefined;
      },
    },
    { id: 'keep-exploring', propose: (s) => (exploring(s.self) || !s.trees.length ? s.explore() : undefined) },
    {
      id: 'choose-tree',
      propose: (s) => {
        let best: { id: ThingId; e: Relation; score: number } | undefined;
        for (const [id, e] of s.trees) {
          if (s.near(e)) continue; // 手の届く木は見えている（実が無いので来た）
          const score = num(e, 'expect', 0) / (s.dist(e) + 1);
          if (!best || score > best.score + 1e-12) best = { id, e, score };
        }
        const score = best?.score ?? 0;
        const wander = attr(s.self, 'wander');
        if (wander > 0 && unitHash(s.self.id, s.now) < Math.exp(-score / wander)) return s.explore();
        if (!best || score <= 1e-9) return { intent: 'idle' };
        return s.goTo(best.id, best.e);
      },
    },
  ],
};

/** 季節の段の組み合わせの心（規則の組 patrol、選び方 priority）。 */
export const seasonMind = () => new ModularMind({ patrol: patrolRules }, { priority: prioritySelector });

// ---- 場面 ----

/**
 * 季節の果樹園: 家一軒と、三種の木の森を二つずつ（広さ 15m、縄張り 10m の木がおよそ 7 本まで入る。初めから埋まった森で始める）。森の中心は、以前の一本ずつの木の場所。
 * 家からは近い森の木しか見えない（視界 60m）。初めの木は buildSeasonScenario が、森ごとに plantForest で置く（木は置いた場所で、その森の木になる）。
 */
export const orchardForests: { id: string; def: string; x: number; y: number }[] = [
  { id: 'A1', def: 'treeA', x: 50, y: 10 },
  { id: 'A2', def: 'treeA', x: -40, y: 60 },
  { id: 'B1', def: 'treeB', x: 90, y: -30 },
  { id: 'B2', def: 'treeB', x: -70, y: -50 },
  { id: 'C1', def: 'treeC', x: 20, y: -90 },
  { id: 'C2', def: 'treeC', x: 120, y: 60 },
];
export const orchard: Placement[] = [
  { id: 'home', def: 'home', x: 0, y: 0 },
  ...orchardForests.map((f) => ({ id: `wood-${f.id}`, def: 'forest', x: f.x, y: f.y })),
];

/**
 * 森に初めの木を植える（初期状態）。一本目は森の中心に id そのままで、残りは森の中の一点を試し、ほかの木の縄張り（canopy）の外なら植える（法則 sow の根付き方と同じ規則）。
 * 位置は名と種から決まる値で選ぶ。n 本に届かなくても、試す回数を使い切れば止める。
 */
export function plantForest(forest: { id: string; def: string; x: number; y: number }, n: number, area: number, canopy: number, seed = 0): Placement[] {
  const out: Placement[] = [{ id: forest.id, def: forest.def, x: forest.x, y: forest.y }];
  for (let k = 0; out.length < n && k < 50 * n; k++) {
    const angle = 2 * Math.PI * unitHash(`${forest.id}:plant:${seed}`, 2 * k);
    const r = area * Math.sqrt(unitHash(`${forest.id}:plant:${seed}`, 2 * k + 1));
    const x = forest.x + r * Math.cos(angle);
    const y = forest.y + r * Math.sin(angle);
    if (out.every((t) => Math.hypot(t.x! - x, t.y! - y) >= canopy)) out.push({ id: `${forest.id}${String.fromCharCode(97 + out.length)}`, def: forest.def, x, y });
  }
  return out;
}

export interface SeasonOptions {
  /** 置く人（定義の名と個性の上書き）。既定は巡回者 2 人と採取者 2 人。 */
  persons?: { id: ThingId; def: string; attr?: Placement['attr'] }[];
  /** 木一本の実る速さ（実/時）。自然の生産量を下げるときに使う。果樹園の全体の生産量は、これ × 木の数。 */
  ripenPerHour?: number;
  /** 森ごとに初めに植える木の数（既定 7。広さ 15m・縄張り 10m の森がほぼ埋まり、六つの森で 41〜42 本）。 */
  treesPerForest?: number;
  /** 実る時期の年ごとのずれ（日）。 */
  jitterDays?: number;
  /** 年ごとのずれの乱数の種（繰り返しの比較で場面を変える）。 */
  seed?: number;
  /** 年ごとのずれを、木一本ごと（既定）ではなく種類で共通にする（同じ種類の木は同じ年に同じだけずれる）。 */
  sharedJitter?: boolean;
  /** 木一本ごとの、毎年同じ時期の違い（日）。始まりを ±この幅で木ごとに動かす（種 seed と木の id から決まる。札 seasonSpread）。 */
  spreadDays?: number;
  /** 木の寿命（日）。0 か無しなら枯れない。一本ごとの寿命は、この 0.5〜1.5 倍（札 lifespan）。 */
  lifespanDays?: number;
  /** 木が一日に種をまく見込みの回数（札 sowPerDay）。0 か無しならまかない。 */
  sowPerDay?: number;
  /** 組を数える順（比較用。結果は変わらない）。 */
  pairOrder?: 'sorted' | 'reverse' | 'shuffle';
}

/** 季節の世界: 果実の世界に、時期のある木・森・巡回者の定義、木の一生の法則、見込みの記憶の規則、組み合わせの心を足す。 */
export function seasonWorld(options: WorldOptions = {}): World {
  const w = fruitWorld(options);
  for (const d of seasonDefs) w.addDef(d);
  w.addLaw(wither);
  w.addLaw(sow);
  w.addMemory(forageModels.memory);
  w.addMind('modular', seasonMind);
  return w;
}

export const defaultSeasonPersons: NonNullable<SeasonOptions['persons']> = [
  { id: 'P1', def: 'patroller' },
  { id: 'P2', def: 'patroller' },
  { id: 'F1', def: 'person' },
  { id: 'F2', def: 'person' },
];

const attrOfDef = (w: World, def: string, a: string): number => {
  const v = w.def(def).attr[a];
  return typeof v === 'number' ? v : 0;
};

/** 木の配置に、場面の選択（実る速さ・年ごとのずれ・種・種類で共通のずれ・木ごとの時期の違い・寿命）を、どの木にも同じ属性として重ねる。 */
function treePlacement(p: Placement, options: SeasonOptions): Placement {
  const treeAttr = {
    ...(options.ripenPerHour !== undefined ? { ripenPerHour: options.ripenPerHour } : {}),
    ...(options.jitterDays !== undefined ? { seasonJitter: options.jitterDays * DAY } : {}),
    ...(options.seed !== undefined ? { seasonSeed: options.seed } : {}),
    ...(options.sharedJitter ? { seasonShared: p.def } : {}),
    ...(options.spreadDays ? { seasonSpread: options.spreadDays * DAY } : {}),
    ...(options.lifespanDays ? { lifespan: options.lifespanDays * DAY } : {}),
    ...(options.sowPerDay ? { sowPerDay: options.sowPerDay } : {}),
  };
  return { ...p, attr: { ...treeAttr, ...p.attr } };
}

/**
 * 季節の果樹園に人を置く。森ごとに木を置き（plantForest）、木の実る速さ・時期・寿命などは、木の配置で上書きする。
 * 人は家の脇（1m の円周上）に置く。初めの実は、最初に実る種（A）の森の一本目（A1・A2）に 6 個ずつ。
 */
export function buildSeasonScenario(options: SeasonOptions = {}): Scenario {
  const w = seasonWorld({ pairOrder: options.pairOrder ?? 'sorted' });
  const persons = options.persons ?? defaultSeasonPersons;
  const area = attrOfDef(w, 'forest', 'area');
  const trees = orchardForests.flatMap((f) =>
    plantForest(f, options.treesPerForest ?? 7, area, attrOfDef(w, f.def, 'canopy'), options.seed ?? 0).map((t) => treePlacement(t, options)),
  );
  place(w, [
    ...orchard,
    ...trees,
    // 人は家の手の届く所に、円周上に少しずらして置く（全く同じ道を歩いて、同じ刻みに同じ実を取り合うことを避ける）。
    ...persons.map((p, i) => ({ id: p.id, def: p.def, x: Math.cos((2 * Math.PI * i) / persons.length), y: Math.sin((2 * Math.PI * i) / persons.length), attr: p.attr })),
  ]);
  for (const f of orchardForests) if (f.def === 'treeA') seedFruits(w, f.id, 6);
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
  w.addMemory(forageModels.memory);
  w.replay(ledger, DT, until);
  return w;
}

