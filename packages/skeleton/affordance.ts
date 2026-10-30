// 新しい事物に自律的に対応する心の試作（study/new-things。docs/RESEARCH.md 10.10 の実験）。
// 心と記憶は、事物の札の名（食べられる、実をつける、炉、穀物、実…）を一つも知らない。知っているのは、
//   身体: 自分の胃（stomach）と栄養（nutrition）、身体の札（手の届く範囲、歩く速さ、食べる速さ、消化の速さ、食欲など）。
//   運動の型: 採る（pick。相手に付いた物を自分へ）、食べる（eat）、加工する（process。手に持った物に働く）の三つと、移動。
//   知覚: 心象に写った物の種類の名（kind）、見た目の分類（looks。無ければ種類の名）、位置、何に付いているか（attachedTo）。
// 新しい物への対応は、認識の一歩（記憶の規則 affordance）の二つの層で行う。
//   物の層: 行為 × 種類ごとの型（schema）。その行為をその種類の物に向けた刻みの成否と結果（胃の増え、得た物、失った物）を数え、
//     どの近くの種類・手に持った種類があると成功するかを、ある時とない時の成功の割合の差で見分ける（Drescher 1991 の文脈の割り当て）。
//   上の層（メタの認識）: 新しい種類が、知っている種類のどれに似た振る舞いをするかの信念。見た目の分類が同じなら初めから似ていると見込み、
//     試した型の成否が知っている種類の型と合うほど、その種類の型（成功の割合、得る物の価値、要る文脈）を、まだ試していない型の見込みに移す。
//     どれにも似ていない（新しい型）の重みも残す。見た目の分類の中で種類どうしの振る舞いが揃っていなければ、見た目を信じる重みを下げる。
//   表出: 知っている物ごとに、行為・場所・見込み（胃に入る量、手持ちの価値の増え、知る価値）を選択肢として心象に書く。
// 心（AffordanceMind）は、表出を動機（空腹、手持ちの充足、身体の余裕）で重みづけて一つ選ぶだけ。
// 他人から学ぶ（村の実験。docs/RESEARCH.md 10.10「他人から学び、他人と比べる」）: 別の系統は作らず、同じ認識の一歩の、別の種類の手がかりとして扱う。
//   見て学ぶ: 振る舞いの知覚（behaviour）が写した他人の行為と、その手に現れた・消えた物を、同じ型の「見た数え」（o で始まる値）に数える。
//     見込みは、自分の数えに見た数えを札 affSocial の重みで足したもの（同じ値と確からしさの形）。胃の増えは見えないので、見た「食べた」は、
//     自分の知る食べ物の平均の量を満たすと見込む。
//   比べる: 見えた他人の体の様子（栄養）の均しを基準にし、自分が下回る差を表出に書く。差は、見る相手の重み（自分より良い相手ほど重い）と、
//     心が新しいことを試す重みを上げる。
// 意図を写された物（他の人）とその手の物は、行き先・文脈・付いている先の見込みから外す（人から採る、人のそばを文脈と取り違えるのを避ける）。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { Memory, Mind, Relation, Relations, Sense, ThingId, ThingSnapshot, WorldView } from './types.js';
import { HOUR, exploreSpiral, sight } from './fruit.js';

const attr = (t: ThingSnapshot, a: string, d = 0): number => (typeof t.attr[a] === 'number' ? (t.attr[a] as number) : d);
const num = (e: Relation | undefined, k: string, d = 0): number => (typeof e?.[k] === 'number' ? (e[k] as number) : d);
const str = (e: Relation | undefined, k: string): string => (typeof e?.[k] === 'string' ? (e[k] as string) : '');

/** 心が持つ運動の型。法則が意図の名で読む。 */
export const ACTS = ['pick', 'eat', 'process'] as const;
type Act = (typeof ACTS)[number];

/** 心象の項目の頭。 */
const P = 'aff:';
const LAST = `${P}last`;
const ORIGIN = `${P}origin`;
const BOUT = `${P}bout`;
const schemaKey = (a: Act, k: string) => `${P}s:${a}:${k}`;
const holderKey = (id: ThingId) => `${P}h:${id}`;
/** 他の人ごとの、前の刻みに見た様子（手の物、そこでの文脈、近くで見えたか）。 */
const watchKey = (id: ThingId) => `${P}w:${id}`;
/** 比べる基準（見えた他人の栄養の均し）。 */
const PEER = `${P}peer`;
const OPT = `${P}o`;
/** 表出に書く選択肢の数の上限の既定（人の札 affOptions で変えられる。行き先の多い世界では、上限で大事な選択肢が落ちる）。 */
const OPTIONS = 8;
const HELD = 'held:';

/** 試作の値（人の札で上書きできる）。 */
const knobs = (self: ThingSnapshot) => ({
  /** 見込みに混ぜる上の層の見込みの重み（試行の数に換算）。 */
  priorWeight: attr(self, 'affPrior', 3),
  /** 新しい型（どれにも似ていない）の重み。 */
  newType: attr(self, 'affNewType', 0.5),
  /** 知る価値の大きさ（胃の単位 / 刻み）。 */
  curiosity: attr(self, 'affCuriosity', 0.6),
  /** 結果の見えない行為を続ける刻みの数（加工のように時間の掛かる行為の初めの試し）。 */
  patience: attr(self, 'affPatience', 8),
  /** 加工してできる物の価値の割引（手間）。 */
  discount: attr(self, 'affDiscount', 0.9),
  /**
   * 上の層: 0 なら見込みの移し替えをしない（比べるため）。1 なら見た目だけ、2 なら見た目と振る舞い、
   * 3 なら加えて、行為ごとに「文脈が成否を左右するか、左右するならどの文脈か」を種類をまたいで学び、新しい種類の試し方を絞る。
   */
  meta: attr(self, 'affMeta', 3),
  /** 見た数えの重み（自分の一回に対する、見た一回）。0 なら見ても学ばない。 */
  social: attr(self, 'affSocial', 0),
  /** 比べる強さ。0 なら比べない。 */
  compare: attr(self, 'affCompare', 0),
  /** 他人の手の物まで見分けられる距離（物の見える距離より短く）。 */
  watch: attr(self, 'affWatch', 25),
});

// ---- 知覚: 視界に、見た目の分類 looks を足す ----

const FIELDS = ['kind', 'looks', 'edible', 'bears', 'stores', 'hearth', 'visibility', 'attachedTo', 'freshness'];
/**
 * 見た目の知覚。視界（fruit.ts の sight）と同じ範囲で、写す値に見た目の分類 looks を足す。
 * looks は物の定義の札（見た目）で、似た見た目の別の種類（新しい木の種類、実に似た物）を、知覚の側で同じ分類に見せる。
 * 採取者の心のために、視界と同じ札も写す（この試作の心はそれらを読まない）。
 */
export const appearance: Sense = {
  id: 'appearance',
  version: 'novel-1',
  observe: (observer, object, w) => (sight.observe(observer, object, w) ? FIELDS : null),
  expected: (observer, remembered, w) => sight.expected(observer, remembered, w),
};
/**
 * 厳しい見た目の知覚: 種類の名、見た目の分類、見える範囲、何に付いているかだけを写し、法則が読む札（食べられる、実をつける、炉…）を写さない。
 * 試作の心がそれらを読まずに動くことを確かめる（appearance と同じ記録になる）。採取者の心はこれでは動かない。
 */
export const strictAppearance: Sense = {
  id: 'appearance-strict',
  version: 'novel-1',
  observe: (observer, object, w) => (sight.observe(observer, object, w) ? ['kind', 'looks', 'visibility', 'attachedTo'] : null),
  expected: (observer, remembered, w) => sight.expected(observer, remembered, w),
};
/**
 * 振る舞いの知覚: 視界に入った、意図を持つ物（他の人）の、いましている行為（意図と相手）と、体の様子（栄養）を写す。
 * 動物は他の個体が何をしているか、肥えているか痩せているかを見て分かる。栄養をそのまま写すのは試作の簡略で、粗い見た目にするのが本来。
 */
export const behaviour: Sense = {
  id: 'behaviour',
  version: 'social-1',
  observe: (observer, object, w) => (typeof object.state['intent'] === 'string' && sight.observe(observer, object, w) ? ['intent', 'target', 'nutrition'] : null),
  expected: (observer, remembered, w) => sight.expected(observer, remembered, w),
};

// ---- 物の層: 型の数え方 ----

/** 型（行為 a を種類 k の物に向けた刻みの数え）。 */
interface Schema {
  n: number; // 試した刻み（その場にいて行為した刻み）
  s: number; // 何かが起きた刻み
  u: number; // 使った（失った）k の数
  st: number; // 胃に入った量
  y: Record<string, number>; // 得た物の種類ごとの数
  c: Record<string, number>; // 文脈 c がある刻みの数
  cs: Record<string, number>; // 文脈 c がある刻みのうち、何かが起きた刻みの数
  o: Observed; // 他人がその行為をその種類の物に向けるのを見た数え（見る相手の重みつき）
}
/** 見た数え。胃の増えは見えないので、食べた数（u）だけを数える。 */
interface Observed {
  n: number;
  s: number;
  u: number;
  y: Record<string, number>;
  c: Record<string, number>;
  cs: Record<string, number>;
}
const readSchema = (e: Relation | undefined): Schema => {
  const o: Observed = { n: num(e, 'on'), s: num(e, 'os'), u: num(e, 'ou'), y: {}, c: {}, cs: {} };
  const sc: Schema = { n: num(e, 'n'), s: num(e, 's'), u: num(e, 'u'), st: num(e, 'st'), y: {}, c: {}, cs: {}, o };
  for (const [f, v] of Object.entries(e ?? {})) {
    if (typeof v !== 'number') continue;
    if (f.startsWith('y.')) sc.y[f.slice(2)] = v;
    else if (f.startsWith('c.')) sc.c[f.slice(2)] = v;
    else if (f.startsWith('cs.')) sc.cs[f.slice(3)] = v;
    else if (f.startsWith('oy.')) o.y[f.slice(3)] = v;
    else if (f.startsWith('oc.')) o.c[f.slice(3)] = v;
    else if (f.startsWith('ocs.')) o.cs[f.slice(4)] = v;
  }
  return sc;
};
const writeSchema = (sc: Schema): Relation => {
  const e: Relation = { n: sc.n, s: sc.s, u: sc.u, st: sc.st };
  for (const [k, v] of Object.entries(sc.y)) e[`y.${k}`] = v;
  for (const [k, v] of Object.entries(sc.c)) e[`c.${k}`] = v;
  for (const [k, v] of Object.entries(sc.cs)) e[`cs.${k}`] = v;
  if (sc.o.n > 0) {
    e['on'] = sc.o.n;
    e['os'] = sc.o.s;
    e['ou'] = sc.o.u;
    for (const [k, v] of Object.entries(sc.o.y)) e[`oy.${k}`] = v;
    for (const [k, v] of Object.entries(sc.o.c)) e[`oc.${k}`] = v;
    for (const [k, v] of Object.entries(sc.o.cs)) e[`ocs.${k}`] = v;
  }
  return e;
};
/**
 * 見込みに使う数え: 自分の数えに、見た数えを重み ws で足す（一つの見込み。手がかりの種類ごとに重みが違うだけ）。
 * 見た「食べた」の胃の量は見えないので、その種類を自分で食べた平均か、無ければ自分の知る食べ物の平均 food を満たすと見込む。
 */
const mergeSchema = (sc: Schema, ws: number, food: number): Schema => {
  if (ws <= 0 || sc.o.n <= 0) return sc;
  const add = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + ws * v;
    return out;
  };
  const per = sc.u > 0 ? sc.st / sc.u : food;
  return { n: sc.n + ws * sc.o.n, s: sc.s + ws * sc.o.s, u: sc.u + ws * sc.o.u, st: sc.st + ws * sc.o.u * per, y: add(sc.y, sc.o.y), c: add(sc.c, sc.o.c), cs: add(sc.cs, sc.o.cs), o: sc.o };
};

/**
 * 成功を左右する文脈: ある刻みと無い刻みの成功の割合の差が最も大きい文脈（どちらも 1 刻み以上あるもの）。
 * 差が小さければ無し。成功を増やす文脈だけを見る（Drescher の文脈の割り当ての、最も単純な形）。
 * 差は試した数で割り引く（ある時の割合は 1 回分低く、無い時の割合は 0.5 回分高く見る）。一度の成功に居合わせただけの文脈
 * （たまたま手に持っていた物）を、成功の条件と取り違える迷信（Skinner 1948）を減らす。
 * 行為の相手と同じ種類を手に持っていること（held:相手の種類）は候補にしない。それは成功の条件ではなく、前の成功の結果である。
 * 他人を見て学ぶと、初めの成功は見ず、すでに手に持った後の成功ばかりを見るので、「穀物を持っていれば穀物が採れる」という迷信になる。
 */
function relevantContext(sc: Schema, obj: string): { c: string; pWith: number; pWithout: number } | undefined {
  let best: { c: string; pWith: number; pWithout: number; d: number } | undefined;
  for (const [c, nWith] of Object.entries(sc.c)) {
    if (c === HELD + obj) continue;
    const nWithout = sc.n - nWith;
    if (nWith < 1 || nWithout < 1) continue;
    const pWith = (sc.cs[c] ?? 0) / nWith;
    const pWithout = (sc.s - (sc.cs[c] ?? 0)) / nWithout;
    const d = (sc.cs[c] ?? 0) / (nWith + 1) - (sc.s - (sc.cs[c] ?? 0) + 0.5) / (nWithout + 1);
    if (d > 0.05 && (!best || d > best.d + 1e-12 || (Math.abs(d - best.d) <= 1e-12 && c < best.c))) best = { c, pWith, pWithout, d };
  }
  return best && { c: best.c, pWith: best.pWith, pWithout: best.pWithout };
}

// ---- 認識の一歩 ----

/** 心象から読む、いまの自分の状況。 */
interface Now {
  x: number;
  y: number;
  reach: number;
  held: Map<string, ThingId[]>; // 手に持っている物（種類ごと）
  near: Set<string>; // 手の届く所にある物の種類（手に持った物を除く）と、手に持った種類（held:種類）
}

const kindOf = (e: Relation): string => str(e, 'kind');
const looksOf = (e: Relation): string => str(e, 'looks') || kindOf(e);
const hasPos = (e: Relation) => typeof e['x'] === 'number' && typeof e['y'] === 'number';
/** 意図を写された物（他の人。自ら動く物を見分けるのは生まれつきの知覚）。 */
const isAgent = (e: Relation | undefined) => typeof e?.['intent'] === 'string';
/** 他の人か、他の人の手にある物。 */
const ofAgent = (self: ThingSnapshot, e: Relation) => isAgent(e) || (str(e, 'attachedTo') !== '' && str(e, 'attachedTo') !== self.id && isAgent(self.rel[str(e, 'attachedTo')]));

function situation(self: ThingSnapshot): Now {
  const x = typeof self.state['x'] === 'number' ? (self.state['x'] as number) : 0;
  const y = typeof self.state['y'] === 'number' ? (self.state['y'] as number) : 0;
  const reach = attr(self, 'reach');
  const held = new Map<string, ThingId[]>();
  const near = new Set<string>();
  for (const [id, e] of Object.entries(self.rel)) {
    if (id.startsWith(P) || !kindOf(e)) continue;
    if (e['attachedTo'] === self.id) {
      held.set(kindOf(e), [...(held.get(kindOf(e)) ?? []), id]);
      near.add(HELD + kindOf(e));
    } else if (hasPos(e) && !ofAgent(self, e) && Math.hypot(num(e, 'x') - x, num(e, 'y') - y) <= reach) near.add(kindOf(e));
  }
  return { x, y, reach, held, near };
}

/** 場所 (px, py) の手の届く所にある物の種類（他の人とその手の物を除く）と、手に持った種類 held（既定はいま自分が手に持っている種類）。 */
function contextAt(self: ThingSnapshot, now: Now, px: number, py: number, held: Iterable<string> = now.held.keys()): Set<string> {
  const out = new Set<string>();
  for (const [id, e] of Object.entries(self.rel)) {
    if (id.startsWith(P) || !kindOf(e) || e['attachedTo'] === self.id || !hasPos(e) || ofAgent(self, e)) continue;
    if (Math.hypot(num(e, 'x') - px, num(e, 'y') - py) <= now.reach) out.add(kindOf(e));
  }
  for (const k of held) out.add(HELD + k);
  return out;
}

/** 心象に写った物の、何に付いているかから、付いている先ごとの種類ごとの数（他の人の手は付いている先に数えない）。 */
function attachments(self: ThingSnapshot): Map<ThingId, Map<string, number>> {
  const out = new Map<ThingId, Map<string, number>>();
  for (const [id, e] of Object.entries(self.rel)) {
    if (id.startsWith(P) || !kindOf(e)) continue;
    const at = str(e, 'attachedTo');
    if (!at || at === self.id || isAgent(self.rel[at])) continue;
    const m = out.get(at) ?? new Map<string, number>();
    m.set(kindOf(e), (m.get(kindOf(e)) ?? 0) + 1);
    out.set(at, m);
  }
  return out;
}

/**
 * 選択肢: 表出に書く一つ。food は胃に入る量 / 刻み、ready はすぐ食べられる手持ちの価値の増え / 刻み、
 * raw は加工などを経て食べ物になる手持ち（道具を含む）の価値の増え / 刻み、info は知る価値、ticks は着くまでの刻み。
 */
export interface Option {
  intent: Act | 'move';
  target: ThingId;
  tx: number;
  ty: number;
  act: Act;
  obj: string;
  food: number;
  ready: number;
  raw: number;
  info: number;
  ticks: number;
  keep: boolean;
}

/**
 * 記憶の規則 affordance（認識の一歩）。札 affordances を持つ人に、一刻みに一度働く。順は、
 *   1. 観察: 前の刻みの自分（胃、手持ち）と比べ、前の刻みの行為の結果を、その行為 × 物の種類の型に数える（物の層の記憶の形成）。
 *   2. 上の層の認識: 種類ごとに、知っている種類のどれに似ているかの信念を、見た目と、試した型の成否から決める。
 *   3. 価値: 手に持つ物の価値（食べて胃に入る量、加工してできる物の価値）を、型と上の層の見込みからたどる。
 *   4. 表出: 選択肢を心象に書く。
 */
export const affordanceMemory: Memory = {
  id: 'affordance',
  version: 'novel-1',
  recognize: (self, w, dt) => {
    if (self.attr['affordances'] !== true) return null;
    const k = knobs(self);
    const out: Relations = {};
    const now = situation(self);
    const last = self.rel[LAST];
    const stomach = self.res['stomach'] ?? 0;
    // 来た所（探索の中心）。x・y の名で置くと、感覚が物の記憶とみなして「見えるはずなのに無い」で消すので、別の名で置く。
    if (!self.rel[ORIGIN]) out[ORIGIN] = { ox: now.x, oy: now.y };

    // 1. 観察と物の層の記憶の形成。この刻みの物理層で働いた行為は、前の刻みに心が選んだ意図（いまの状態）で、
    //    どの種類に向けた選択肢だったか、その場にいたか（選択肢の意図が行為そのものか）は、前の刻みの表出から分かる。
    const schemas = new Map<string, Schema>();
    const schema = (a: Act, kind: string) => {
      const key = schemaKey(a, kind);
      if (!schemas.has(key)) schemas.set(key, readSchema(self.rel[key]));
      return schemas.get(key)!;
    };
    const heldCount = (kind: string) => now.held.get(kind)?.length ?? 0;
    const act = str(self.state as Relation, 'intent');
    const target = str(self.state as Relation, 'target');
    const prevOpts = readOptions(self.rel);
    const chosen = (ACTS as readonly string[]).includes(act)
      ? prevOpts.find((o) => o.intent === act && (act === 'eat' || o.target === target))
      : undefined;
    if (last && chosen) {
      const obj = chosen.obj;
      const ctx = str(last, 'c').split('|').filter(Boolean);
      // 胃の増え: 消化で減る分（身体の札から分かる）を足し戻す。
      const lastS = num(last, 's');
      const digested = Math.min(lastS, (attr(self, 'digestPerHour') / HOUR) * dt);
      const dS = stomach - lastS + digested;
      const before = (kind: string) => num(last, `h.${kind}`);
      const kinds = new Set([...Object.keys(last).filter((f) => f.startsWith('h.')).map((f) => f.slice(2)), ...now.held.keys()]);
      const gained: Record<string, number> = {};
      const lost: Record<string, number> = {};
      for (const kind of kinds) {
        const d = heldCount(kind) - before(kind);
        if (d > 0) gained[kind] = d;
        if (d < 0) lost[kind] = -d;
      }
      const count = (sc: Schema, ok: boolean) => {
        sc.n += 1;
        if (ok) sc.s += 1;
        for (const c of ctx) {
          sc.c[c] = (sc.c[c] ?? 0) + 1;
          if (ok) sc.cs[c] = (sc.cs[c] ?? 0) + 1;
        }
      };
      if (act === 'eat') {
        // 食べる行為は手に持つ物すべてに向く。種類ごとに、減った数と、胃の増えをその数で分けた量を数える。
        const used = Object.values(lost).reduce((a, b) => a + b, 0);
        for (const kind of Object.keys(last).filter((f) => f.startsWith('h.') && num(last, f) > 0).map((f) => f.slice(2))) {
          const sc = schema('eat', kind);
          const u = lost[kind] ?? 0;
          count(sc, u > 0);
          sc.u += u;
          if (used > 0) sc.st += (Math.max(0, dS) * u) / used;
        }
      } else if (act === 'pick' && obj) {
        const sc = schema('pick', obj);
        count(sc, (gained[obj] ?? 0) > 0);
        for (const [g, n] of Object.entries(gained)) sc.y[g] = (sc.y[g] ?? 0) + n;
      } else if (act === 'process' && obj) {
        const sc = schema('process', obj);
        const made = Object.entries(gained).filter(([g]) => g !== obj);
        const ok = (lost[obj] ?? 0) > 0 && made.length > 0;
        count(sc, ok);
        if (ok) {
          sc.u += lost[obj]!;
          for (const [g, n] of made) sc.y[g] = (sc.y[g] ?? 0) + n;
        }
      }
    }

    // 1b. 見て学ぶ（札 affSocial が正のとき）と比べる（札 affCompare が正のとき）。他の人ごとに、前の刻みの様子（手の物、そこでの文脈）を残し、
    //     手の物まで見分けられる距離（affWatch）で前の刻みも今も見えた人の、この刻みの行為と結果を、自分の型と同じ数え方で見た数えに数える。
    //     比べる: 見えた他人の栄養を均して基準にし、相手が自分より良いほど、その相手の一回を重く数える（成果に比例した真似。Schlag 1998）。
    const att = attachments(self);
    const myNut = self.res['nutrition'] ?? 0;
    let peerMean = num(self.rel[PEER], 'm', Number.NaN);
    if (k.social > 0 || k.compare > 0) {
      const alpha = 1 - Math.exp(-dt / (6 * HOUR));
      for (const [id, e] of Object.entries(self.rel)) {
        if (id.startsWith(P) || !isAgent(e) || str(e, 'intent') === 'none' || num(e, 'at') !== w.now) continue;
        const qn = num(e, 'nutrition', Number.NaN);
        if (k.compare > 0 && Number.isFinite(qn)) peerMean = Number.isFinite(peerMean) ? peerMean + alpha * (qn - peerMean) : qn;
        const qx = num(e, 'x');
        const qy = num(e, 'y');
        const close = Math.hypot(qx - now.x, qy - now.y) <= k.watch;
        const qHeld = new Map<string, number>();
        for (const [jd, f] of Object.entries(self.rel)) if (!jd.startsWith(P) && kindOf(f) && f['attachedTo'] === id) qHeld.set(kindOf(f), (qHeld.get(kindOf(f)) ?? 0) + 1);
        const key = watchKey(id);
        const prev = self.rel[key];
        const qTarget = str(e, 'target');
        const rec: Relation = { near: close ? 1 : 0, c: [...contextAt(self, now, qx, qy, qHeld.keys())].sort().join('|'), tk: kindOf(self.rel[qTarget] ?? {}) || (str(prev, 'tt') === qTarget ? str(prev, 'tk') : ''), tt: qTarget };
        for (const f of Object.keys(prev ?? {})) if (f.startsWith('h.')) rec[f] = 0;
        for (const [kind, n] of qHeld) rec[`h.${kind}`] = n;
        out[key] = rec;
        const qa = str(e, 'intent');
        if (k.social <= 0 || !close || num(prev, 'near') !== 1 || !(ACTS as readonly string[]).includes(qa)) continue;
        const bias = k.compare > 0 && Number.isFinite(qn) ? 1 + k.compare * Math.max(-0.75, Math.min(1, (qn - myNut) / 4)) : 1;
        const ctx = str(prev, 'c').split('|').filter(Boolean);
        const gained: Record<string, number> = {};
        const lost: Record<string, number> = {};
        for (const kind of new Set([...Object.keys(prev!).filter((f) => f.startsWith('h.')).map((f) => f.slice(2)), ...qHeld.keys()])) {
          const d = (qHeld.get(kind) ?? 0) - num(prev, `h.${kind}`);
          if (d > 0) gained[kind] = d;
          if (d < 0) lost[kind] = -d;
        }
        const see = (a: Act, kind: string, ok: boolean): Observed => {
          const o = schema(a, kind).o;
          o.n += bias;
          if (ok) o.s += bias;
          for (const c of ctx) {
            o.c[c] = (o.c[c] ?? 0) + bias;
            if (ok) o.cs[c] = (o.cs[c] ?? 0) + bias;
          }
          return o;
        };
        if (qa === 'pick') {
          const got = Object.entries(gained);
          if (got.length)
            for (const [g, n] of got) {
              const o = see('pick', g, true);
              o.y[g] = (o.y[g] ?? 0) + bias * n;
            }
          else for (const kind of att.get(qTarget)?.keys() ?? []) see('pick', kind, false);
        } else if (qa === 'eat') {
          const ate = Object.entries(lost);
          if (ate.length) for (const [kind, n] of ate) see('eat', kind, true).u += bias * n;
          else for (const f of Object.keys(prev!)) if (f.startsWith('h.') && num(prev, f) > 0) see('eat', f.slice(2), false);
        } else if (qa === 'process' && str(prev, 'tk')) {
          const obj = str(prev, 'tk');
          const made = Object.entries(gained).filter(([g]) => g !== obj);
          const ok = (lost[obj] ?? 0) > 0 && made.length > 0;
          const o = see('process', obj, ok);
          if (ok) for (const [g, n] of made) o.y[g] = (o.y[g] ?? 0) + bias * n;
        }
      }
      if (k.compare > 0 && Number.isFinite(peerMean)) out[PEER] = { m: peerMean };
    }
    for (const [key, sc] of schemas) out[key] = writeSchema(sc);

    // 付いている先の見込み: 手の届く所に着いた刻みに、付いている種類ごとの数を見て、離れていた間の増え方を直す。
    for (const [id, e] of Object.entries(self.rel)) {
      if (id.startsWith(P) || !kindOf(e) || !hasPos(e) || e['attachedTo'] === self.id || ofAgent(self, e)) continue;
      const here = Math.hypot(num(e, 'x') - now.x, num(e, 'y') - now.y) <= now.reach;
      const h = self.rel[holderKey(id)];
      const wasHere = num(h, 'here') === 1;
      if (!here && !wasHere) continue;
      const counts = att.get(id) ?? new Map<string, number>();
      const fields: Relation = { here: here ? 1 : 0 };
      if (here) {
        for (const [kind, n] of counts) {
          const prev = num(h, `n.${kind}`, -1);
          const gone = num(h, 'leftAt', -1);
          if (!wasHere && prev >= 0 && gone >= 0 && w.now > gone) {
            // 増え方は、増えた数の和 ÷ 離れていた時間の和（比の和でなく和の比。短く離れただけの回の比が大きく振れて、無い実を見込むのを防ぐ）。
            const sumN = num(h, `gn.${kind}`) + Math.max(0, n - prev);
            const sumT = num(h, `gt.${kind}`) + (w.now - gone);
            fields[`gn.${kind}`] = sumN;
            fields[`gt.${kind}`] = sumT;
            fields[`g.${kind}`] = sumN / sumT;
          }
          fields[`m.${kind}`] = Math.max(num(h, `m.${kind}`), n);
        }
        for (const f of Object.keys(h ?? {})) if (f.startsWith('n.') && !counts.has(f.slice(2))) fields[f] = 0;
        for (const [kind, n] of counts) fields[`n.${kind}`] = n;
        fields['seenAt'] = w.now;
      } else fields['leftAt'] = w.now;
      out[holderKey(id)] = { ...(h ?? {}), ...fields };
    }

    // 2〜3. 上の層の認識と価値。直した後の型で計算する。
    const rel: Relations = { ...self.rel, ...out };
    const view: ThingSnapshot = { ...self, rel };
    const known = knownKinds(view);
    const est = estimator(view, known, k);

    // 4. 表出。
    const opts = options(view, now, att, est, k, w.now, dt);
    // 続けている試し（結果の見えない行為）を、patience の刻みまでは続ける。
    const bout = self.rel[BOUT];
    let boutOut: Relation = { key: '', start: w.now };
    if (chosen) {
      const key = `${chosen.act}|${chosen.obj}|${chosen.target}`;
      const start = str(bout, 'key') === key ? num(bout, 'start') : w.now - dt;
      boutOut = { key, start };
      const age = (w.now - start) / dt;
      const sc = schemas.get(schemaKey(chosen.act, chosen.obj));
      const succeeded = sc !== undefined && sc.s > readSchema(self.rel[schemaKey(chosen.act, chosen.obj)]).s;
      if (age < est.patienceOf(chosen.act) && !succeeded && chosen.info > 0) {
        const same = opts.find((o) => o.act === chosen.act && o.obj === chosen.obj && o.target === chosen.target && o.intent === chosen.act);
        if (same) same.keep = true;
      }
    }
    out[BOUT] = boutOut;
    // 手持ちの価値（心が、もっと集めるかを決めるのに読む）。すぐ食べられる分と、加工などで食べ物になる分。
    let ready = 0;
    let raw = 0;
    for (const [kind, ids] of now.held) {
      ready += ids.length * est.ready(kind);
      raw += ids.length * Math.max(0, est.value(kind) - est.ready(kind));
    }
    // 比べる差: 基準（見えた他人の栄養の均し）を自分が下回る分。心が新しいことを試す重みを上げる。
    out[`${P}value`] = k.compare > 0 ? { ready, raw, gap: Number.isFinite(peerMean) ? Math.max(0, peerMean - myNut) : 0 } : { ready, raw };
    opts.sort(byScoreHint);
    for (let i = 0; i < attr(self, 'affOptions', OPTIONS); i++) out[`${OPT}${i}`] = opts[i] ? (opts[i] as unknown as Relation) : { intent: '' };

    // 次の刻みのための写し: 胃、手持ち、これから行う行為（心の選択は次の刻みに状態から読む）。
    // 世界は心象の項目を値ごとに重ねるので、もう持っていない種類は 0 と書く（書かないと前の数が残る）。
    const lastOut: Relation = { at: w.now, s: stomach, c: [...now.near].sort().join('|') };
    for (const f of Object.keys(last ?? {})) if (f.startsWith('h.')) lastOut[f] = 0;
    for (const [kind, ids] of now.held) lastOut[`h.${kind}`] = ids.length;
    out[LAST] = lastOut;
    return out;
  },
};

/** 心象の表出を読む。 */
export function readOptions(rel: Readonly<Relations>): Option[] {
  const out: Option[] = [];
  for (let i = 0; rel[`${OPT}${i}`]; i++) {
    const e = rel[`${OPT}${i}`];
    if (!e || !e['intent']) continue;
    out.push(e as unknown as Option);
  }
  return out;
}

/** 表出の並び（心が選ぶのではない。表出の数の上限で切るための粗い並び）。 */
const hint = (o: Option) => (o.food + o.ready + o.raw + o.info + (o.keep ? 1 : 0)) / (1 + o.ticks);
const byScoreHint = (p: Option, q: Option) => hint(q) - hint(p) || (p.target < q.target ? -1 : p.target > q.target ? 1 : p.obj < q.obj ? -1 : 1);

/** 心象に現れた種類と、その見た目の分類。 */
function knownKinds(self: ThingSnapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, e] of Object.entries(self.rel)) if (!id.startsWith(P) && kindOf(e) && !isAgent(e)) out.set(kindOf(e), looksOf(e));
  for (const id of Object.keys(self.rel)) {
    if (!id.startsWith(`${P}s:`)) continue;
    const kind = id.split(':').slice(3).join(':');
    if (!out.has(kind)) out.set(kind, kind);
  }
  return out;
}

/** 型の見込み: 成功の割合 p（文脈ごと）、成功一回あたりの価値の内訳、要る文脈、確からしさ。 */
interface Estimate {
  p: (ctx: Set<string>) => number;
  need: string | undefined; // 成功を左右する文脈（場所の種類か、held:種類）
  food: number; // 成功一回（物一つ）あたりの胃の量（食べる）
  yields: Record<string, number>; // 成功一回あたりの得る物
  conf: number; // 0〜1
  tried: (ctx: Set<string>) => number; // この文脈で試した刻みの数（最も少ない文脈で）
}

/**
 * 上の層（メタの認識）と、型の見込み。種類 kind の行為 a の見込みは、自分の数えに、上の層の見込みを priorWeight 回分だけ混ぜたもの。
 * 上の層の見込みは、知っている種類 j の同じ行為の見込みを、「kind は j に似ている」の信念で重みづけた和と、新しい型（全種類の平均）の和。
 * 信念は、見た目（同じ分類なら重い）と、kind で試した型の成否が j の型の成否と合うか（振る舞い）から決まる。
 * 見た目の分類の中で、種類どうしの振る舞いが合わなければ、見た目の重みを下げる（見た目を信じてよいかの認識）。
 */
function estimator(self: ThingSnapshot, known: Map<string, string>, k: ReturnType<typeof knobs>) {
  // 見た「食べた」が満たすと見込む量: 自分で食べた種類の、一つあたりの胃の量の平均（無ければ 1）。
  let foodSum = 0;
  let foodN = 0;
  for (const kind of known.keys()) {
    const sc = readSchema(self.rel[schemaKey('eat', kind)]);
    if (sc.u > 0) {
      foodSum += sc.st / sc.u;
      foodN += 1;
    }
  }
  const meanFood = foodN ? foodSum / foodN : 1;
  const raw = new Map<string, Schema>();
  const get = (a: Act, kind: string) => {
    const key = `${a}:${kind}`;
    if (!raw.has(key)) raw.set(key, mergeSchema(readSchema(self.rel[schemaKey(a, kind)]), k.social, meanFood));
    return raw.get(key)!;
  };
  const kinds = [...known.keys()].sort();
  // 行為の層の見込み（上の層、meta 3）: 種類をまたいで学ぶ、行為そのものの性質。成功が 3 刻み以上ある種類だけを数える。
  //   matters: その行為の成否を文脈が左右した種類の割合（成功した種類が 2 つ以上のときだけ。1 つから決めると、効く文脈を見落とす）。
  //   need: 左右した文脈で最も多かったもの。  patience: 結果が出るまでの刻み（成功した種類の、刻みあたりの成功の割合の平均の逆数の 1.5 倍）。
  // 行為ごとに、どれだけ試せば「効かない」と分かるか、どの文脈で試せばよいかを、新しい種類について知る前から持つ（学び方を学ぶ）。
  const actionLevel = new Map<Act, { matters: number | undefined; need: string | undefined; patience: number }>();
  for (const a of ACTS) {
    let succ = 0;
    let rate = 0;
    const needs = new Map<string, number>();
    for (const kind of kinds) {
      const sc = get(a, kind);
      if (sc.s < 3) continue;
      succ += 1;
      const rc = relevantContext(sc, kind);
      rate += rc ? rc.pWith : sc.s / sc.n;
      if (rc) needs.set(rc.c, (needs.get(rc.c) ?? 0) + 1);
    }
    const ranked = [...needs.entries()].sort(([p, x], [q, y]) => y - x || (p < q ? -1 : 1));
    const withNeed = [...needs.values()].reduce((x, y) => x + y, 0);
    const learned = k.meta >= 3 && succ > 0;
    actionLevel.set(a, {
      matters: learned && succ >= 2 ? withNeed / succ : undefined,
      need: ranked[0]?.[0],
      patience: learned ? Math.min(k.patience, Math.max(2, Math.ceil(1.5 / Math.max(1e-9, rate / succ)))) : k.patience,
    });
  }
  const patienceOf = (a: Act) => actionLevel.get(a)!.patience;
  const works = (a: Act, sc: Schema): number | undefined => (sc.s > 0 ? 1 : sc.n >= patienceOf(a) ? 0 : undefined); // 成否が分かったか
  // 見た目の分類の中で振る舞いが揃っているか: 同じ分類の種類どうしで、成否の分かった型が合う割合。
  const looksAgreement = new Map<string, number>();
  for (const look of new Set(known.values())) {
    const members = kinds.filter((kind) => known.get(kind) === look);
    let agree = 1;
    let total = 1;
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++)
        for (const a of ACTS) {
          const p = works(a, get(a, members[i]!));
          const q = works(a, get(a, members[j]!));
          if (p === undefined || q === undefined) continue;
          total += 1;
          if (p === q) agree += 1;
        }
    looksAgreement.set(look, agree / total);
  }
  const base = (a: Act) => {
    let s = 0;
    let n = 0;
    for (const kind of kinds) {
      const sc = get(a, kind);
      if (sc.n > 0) {
        s += sc.s / sc.n;
        n += 1;
      }
    }
    return n ? s / n : 0.2;
  };
  const similarity = new Map<string, Map<string, number>>();
  const likeOf = (kind: string): Map<string, number> => {
    if (similarity.has(kind)) return similarity.get(kind)!;
    const m = new Map<string, number>();
    if (k.meta > 0) {
      for (const j of kinds) {
        if (j === kind) continue;
        const sameLook = known.get(j) === known.get(kind);
        let weight = sameLook ? 1 + 4 * (looksAgreement.get(known.get(kind)!) ?? 1) : 1;
        if (k.meta >= 2) {
          for (const a of ACTS) {
            const p = works(a, get(a, kind));
            const q = works(a, get(a, j));
            if (p === undefined || q === undefined) continue;
            weight *= p === q ? 4 : 0.05;
          }
        } else if (!sameLook) weight = 0;
        if (weight > 0) m.set(j, weight);
      }
    }
    similarity.set(kind, m);
    return m;
  };
  const cache = new Map<string, Estimate>();
  const estimate = (a: Act, kind: string): Estimate => {
    const key = `${a}:${kind}`;
    if (cache.has(key)) return cache.get(key)!;
    const sc = get(a, kind);
    const like = likeOf(kind);
    const totalLike = [...like.values()].reduce((x, y) => x + y, 0) + k.newType;
    // 上の層の見込み: 似た種類 j の、同じ行為の自分の数え（j 自身の上の層は使わない。一段だけたどる）。
    let pPrior = (k.newType / totalLike) * base(a);
    let foodPrior = 0;
    const yieldPrior: Record<string, number> = {};
    let needPrior: string | undefined;
    let needWeight = 0;
    for (const [j, wj] of like) {
      const sj = get(a, j);
      const r = wj / totalLike;
      const rc = relevantContext(sj, j);
      pPrior += r * (rc ? rc.pWith : sj.n ? sj.s / sj.n : base(a));
      if (sj.u > 0) foodPrior += (r * sj.st) / sj.u;
      if (sj.s > 0) for (const [g, n] of Object.entries(sj.y)) yieldPrior[g] = (yieldPrior[g] ?? 0) + (r * n) / sj.s;
      if (rc && r > needWeight) {
        needPrior = rc.c;
        needWeight = r;
      }
    }
    // 上の層の見込みの重み。meta 3 では、行為の層が学んだ「結果が出るまでの刻み」だけ試した型は、自分の数えだけで決める
    // （食べられるか、採れるかは種類ごとにほぼ決まっていて、一つの種類の中ではばらつかない、という行為の層の見込み。Kemp ら 2007 の袋とおはじき）。
    const settled = k.meta >= 3 && sc.n >= patienceOf(a);
    const m = k.meta > 0 && !settled ? k.priorWeight * (1 - k.newType / totalLike) : 0;
    const own = relevantContext(sc, kind);
    const need = own?.c ?? (needWeight > 0.3 ? needPrior : undefined);
    const p = (ctx: Set<string>) => {
      if (own) {
        const nWith = sc.c[own.c] ?? 0;
        const with_ = ctx.has(own.c);
        const n = with_ ? nWith : sc.n - nWith;
        const s = with_ ? (sc.cs[own.c] ?? 0) : sc.s - (sc.cs[own.c] ?? 0);
        return (s + m * (with_ ? pPrior : 0)) / (n + m || 1);
      }
      if (need && !ctx.has(need)) return sc.n ? sc.s / (sc.n + m) : 0;
      return (sc.s + m * pPrior) / (sc.n + m) || (sc.n === 0 && m === 0 ? 0 : 0);
    };
    const food = sc.u > 0 ? (sc.st + m * foodPrior) / (sc.u + m) : foodPrior;
    const yields: Record<string, number> = {};
    for (const g of new Set([...Object.keys(sc.y), ...Object.keys(yieldPrior)])) yields[g] = sc.s > 0 ? ((sc.y[g] ?? 0) + m * (yieldPrior[g] ?? 0)) / (sc.s + m) : (yieldPrior[g] ?? 0);
    // この文脈で試した刻みの数。文脈の組み合わせはいくらでも新しくなるので、どの文脈で試したかを数え分けると、同じ無駄な試しが繰り返される。
    // 上の層（meta 3）は、行為ごとに文脈が効くかを学んでいるので、効かない行為は文脈によらず数え、効く行為はその文脈のある所だけで試す。
    const level = actionLevel.get(a)!;
    const tried = (ctx: Set<string>) => {
      if (k.meta >= 3 && level.matters !== undefined) {
        if (level.matters <= 0) return sc.n;
        if (level.matters >= 0.75 && level.need) return ctx.has(level.need) ? (sc.c[level.need] ?? 0) : Number.POSITIVE_INFINITY;
      }
      let least = sc.n;
      for (const c of ctx) least = Math.min(least, sc.c[c] ?? 0);
      return least;
    };
    const e: Estimate = { p, need, food, yields, conf: (sc.n + m) / (sc.n + m + patienceOf(a)), tried };
    cache.set(key, e);
    return e;
  };
  // すぐ食べられる価値: 食べて胃に入る量（食べる型の成功の割合で弱める）。
  const ready = (kind: string): number => {
    const eatE = estimate('eat', kind);
    return eatE.food * Math.min(1, eatE.p(new Set()) * 4);
  };
  // 手に持つ物の価値: すぐ食べられる価値か、加工してできる物の価値（割引）の大きい方。道具の価値は別（valueAsTool）。
  const valueCache = new Map<string, number>();
  const value = (kind: string, depth = 0): number => {
    if (valueCache.has(kind)) return valueCache.get(kind)!;
    if (depth > 4) return 0;
    valueCache.set(kind, 0); // 循環の止め
    let v = ready(kind);
    const pr = estimate('process', kind);
    let made = 0;
    for (const [g, n] of Object.entries(pr.yields)) if (g !== kind) made += n * value(g, depth + 1);
    v = Math.max(v, made * k.discount);
    valueCache.set(kind, v);
    return v;
  };
  // 道具の価値: 手に持つと、ほかの種類の採るが成功するようになるなら、その物の価値。
  const valueAsTool = (kind: string): number => {
    let v = 0;
    for (const j of kinds) {
      const e = estimate('pick', j);
      if (e.need === HELD + kind) v = Math.max(v, value(j));
    }
    return v;
  };
  return { estimate, ready, value, valueAsTool, kinds, likeOf, actionLevel, patienceOf };
}

/** 表出の選択肢を作る。 */
function options(self: ThingSnapshot, now: Now, att: Map<ThingId, Map<string, number>>, est: ReturnType<typeof estimator>, k: ReturnType<typeof knobs>, t: number, dt: number): Option[] {
  const speed = (attr(self, 'speedPerHour') / HOUR) * dt; // m/刻み
  const ticksTo = (px: number, py: number) => Math.max(0, Math.hypot(px - now.x, py - now.y) - now.reach) / Math.max(speed, 1e-9);
  const out: Option[] = [];
  const add = (o: Omit<Option, 'intent' | 'keep'>) => out.push({ ...o, intent: o.ticks <= 1e-9 ? o.act : 'move', keep: false });
  const eatPerTick = (attr(self, 'eatPerHour') / HOUR) * dt;
  /** 知る価値: その文脈で試した刻みが少ないほど大きい（limit 刻みで 0）。確からしさが高い（上の層の見込みが強い）ほど小さい。 */
  const infoOf = (tried: number, conf: number, limit: number) => (tried < limit ? k.curiosity * (1 - conf) * (tried === 0 ? 1 : 0.5) : 0);
  /** 自由に立っている物（何にも付いていない、位置を知っている物）: 行き先の候補。 */
  const places: [ThingId, Relation][] = Object.entries(self.rel).filter(
    ([id, e]) => !id.startsWith(P) && kindOf(e) && hasPos(e) && !isAgent(e) && !(typeof e['attachedTo'] === 'string' && e['attachedTo'] !== ''),
  );
  // 手に持つ物: 食べる、ここで加工する、知っている場所で加工する。
  for (const [kind, ids] of now.held) {
    const eatE = est.estimate('eat', kind);
    add({ act: 'eat', obj: kind, target: '', tx: now.x, ty: now.y, food: Math.min(ids.length, eatPerTick) * eatE.food * eatE.p(now.near), ready: 0, raw: 0, info: infoOf(eatE.tried(now.near), eatE.conf, est.patienceOf('eat')), ticks: 0 });
    const pr = est.estimate('process', kind);
    let ready = 0;
    let raw = 0;
    for (const [g, n] of Object.entries(pr.yields)) {
      if (g === kind) continue;
      ready += n * est.ready(g);
      raw += n * Math.max(0, est.value(g) - est.ready(g)) * k.discount;
    }
    const spots: [ThingId, number, number][] = [['', now.x, now.y], ...places.map(([id, e]) => [id, num(e, 'x'), num(e, 'y')] as [ThingId, number, number])];
    for (const [spot, px, py] of spots) {
      const ticks = spot ? ticksTo(px, py) : 0;
      if (spot && ticks <= 1e-9) continue; // ここと同じ
      const ctx = contextAt(self, now, px, py);
      const p = pr.p(ctx);
      const info = infoOf(pr.tried(ctx), pr.conf, est.patienceOf('process'));
      if (p * (ready + raw) <= 1e-9 && info <= 0) continue;
      out.push({ act: 'process', obj: kind, target: ids[0]!, tx: px, ty: py, food: 0, ready: p * ready, raw: p * raw, info, ticks, intent: ticks <= 1e-9 ? 'process' : 'move', keep: false });
    }
  }
  // 付いている物: 採る。手の届く所に無ければ、付いている先へ行く。見えていない間の増えは、付いている先の見込みから。
  for (const [id, e] of places) {
    const h = self.rel[holderKey(id)];
    const counts = new Map(att.get(id) ?? []);
    // 見えていない間に増えた分（付いている先ごとの増え方 × 離れていた時間、これまでの最大まで）。
    const leftAt = num(h, 'leftAt', -1);
    if (h && num(h, 'here') !== 1 && leftAt >= 0) {
      for (const f of Object.keys(h)) {
        if (!f.startsWith('g.')) continue;
        const kind = f.slice(2);
        const grown = Math.min(num(h, `m.${kind}`), (counts.get(kind) ?? 0) + num(h, f) * (t - leftAt));
        if (grown > (counts.get(kind) ?? 0)) counts.set(kind, grown);
      }
    }
    const ctx = contextAt(self, now, num(e, 'x'), num(e, 'y'));
    const ticks = ticksTo(num(e, 'x'), num(e, 'y'));
    for (const [kind, n] of counts) {
      if (n < 0.5) continue;
      const pe = est.estimate('pick', kind);
      const p = pe.p(ctx) * Math.min(1, n);
      const ready = est.ready(kind);
      const raw = Math.max(est.value(kind) - ready, now.held.has(kind) ? 0 : est.valueAsTool(kind));
      const info = infoOf(pe.tried(ctx), pe.conf, est.patienceOf('pick'));
      if (p * (ready + raw) <= 1e-9 && info <= 0) continue;
      out.push({ act: 'pick', obj: kind, target: id, tx: num(e, 'x'), ty: num(e, 'y'), food: 0, ready: p * ready, raw: p * raw, info, ticks, intent: ticks <= 1e-9 ? 'pick' : 'move', keep: false });
    }
    // まだ近くで見たことの無い物は、行って確かめる価値がある（付いている物は近づかないと見えない）。
    if (!h && ticks > 1e-9) out.push({ act: 'pick', obj: '', target: id, tx: num(e, 'x'), ty: num(e, 'y'), food: 0, ready: 0, raw: 0, info: k.curiosity * 0.5, ticks, intent: 'move', keep: false });
    // 価値のある物が付いていたのに、また付くかをまだ知らない先は、離れていた時間が長いほど、行って確かめる価値がある。
    if (h && num(h, 'here') !== 1 && leftAt >= 0 && ticks > 1e-9) {
      let unknown = 0;
      for (const f of Object.keys(h)) {
        if (!f.startsWith('m.') || num(h, f) < 1) continue;
        const kind = f.slice(2);
        if (h[`g.${kind}`] === undefined) unknown = Math.max(unknown, est.value(kind) + (now.held.has(kind) ? 0 : est.valueAsTool(kind)));
      }
      // 慣れは時とともに薄れる（馴化の自然な回復）: 何も無かった先も、離れていた時間に応じて小さく確かめる価値が戻る。
      const recovered = k.curiosity * 0.25 * Math.min(1, (t - leftAt) / (12 * HOUR));
      const info = Math.max(recovered, unknown > 0 ? k.curiosity * 0.5 * Math.min(1, (t - leftAt) / (6 * HOUR)) * Math.min(1, unknown) : 0);
      if (info > 0) out.push({ act: 'pick', obj: '', target: id, tx: num(e, 'x'), ty: num(e, 'y'), food: 0, ready: 0, raw: 0, info, ticks, intent: 'move', keep: false });
    }
  }
  return out;
}

/** この一時間に見えた他の人のうち、自分より栄養の良い、いちばん良い人の位置。 */
function bestOff(self: ThingSnapshot, now: number): { x: number; y: number } | undefined {
  const mine = self.res['nutrition'] ?? 0;
  let best: { x: number; y: number; n: number; id: string } | undefined;
  for (const [id, e] of Object.entries(self.rel)) {
    if (id.startsWith(P) || !isAgent(e) || str(e, 'intent') === 'none' || num(e, 'at') < now - HOUR) continue;
    const n = num(e, 'nutrition', Number.NaN);
    if (!(n > mine) || (best && (n < best.n || (n === best.n && id > best.id)))) continue;
    best = { x: num(e, 'x'), y: num(e, 'y'), n, id };
  }
  return best;
}

/**
 * 心（試作）: 表出の選択肢を、動機で重みづけて一つ選ぶ。記憶は持たない。事物の札の名を知らない。
 *   空腹（栄養が食欲 appetite 未満で胃が 1 未満）なら胃に入る量を、すぐ食べられる手持ちが carry 未満ならその増えを、
 *   手持ち全体が 2 × carry 未満なら加工などで食べ物になる物の増えを、身体に余裕（栄養が reserve 以上）があれば知る価値を数える。
 *   点数 =（重みづけた和）÷（着くまでの刻み + 1）。続けている試し（keep）は、余裕のあるうちは替えない。
 *   知る価値の重みは、余裕・空腹（affNeed）・比べた差（affCompare）から決まる。空腹でなく最も良い点数が affRest に届かなければ、来た所で休む。
 *   affNet が正なら、点数から歩く費用を差し引く。affFollow が正なら、休む所と、することが無いときの行き先を、自分より上手くいっている人のそばにする。
 *   どれも 0 なら、来た所を中心に渦巻きに探す。
 */
export class AffordanceMind implements Mind {
  decide(self: ThingSnapshot, now: number) {
    const opts = readOptions(self.rel);
    const nutrition = self.res['nutrition'] ?? 0;
    const stomach = self.res['stomach'] ?? 0;
    const carry = attr(self, 'carry', 3);
    const held = self.rel[`${P}value`];
    const hungry = stomach < 1 && nutrition < attr(self, 'appetite', 4);
    const wantReady = num(held, 'ready') < carry;
    const wantRaw = num(held, 'ready') + num(held, 'raw') < 2 * carry;
    const curious = nutrition >= attr(self, 'reserve', 3);
    // 新しいことを試す重み: 身体に余裕があれば 1（遊び・探索）、空腹なら札 affNeed（必要が試行を生む。Laland・Reader 1999 の飢えたグッピー）、
    // 比べて自分が下回る差に札 affCompare を掛けた分（周りが上手くいっているのを見ると、変える価値が上がる）。既定は余裕の 1 だけ。
    const tryWeight = (curious ? 1 : 0) + (hungry ? attr(self, 'affNeed', 0) : 0) + (attr(self, 'affCompare', 0) * num(held, 'gap')) / 4;
    // 迷いの止め（Blumberg・Galyean 1995 の履歴効果）: いまの意図を続ける選択肢は、点数を札 commit 倍（既定 2）にする。
    // 無ければ、二つの行き先の間で刻みごとに向きを替え、どちらにも着かない。
    const intent = self.state['intent'];
    const target = self.state['target'];
    const commit = attr(self, 'commit', 2);
    // 正味（札 affNet が正のとき）: 行き先までの歩く費用（身体の札の歩く費用 × 距離を、胃の量に直したもの）を差し引く。
    // 得られる量から移動の費用を引いた正味の速さで選ぶのは、採餌の理論の基本（Charnov 1976）。既定は差し引かない（試作のこれまでの心）。
    const net = attr(self, 'affNet', 0);
    const sx = typeof self.state['x'] === 'number' ? (self.state['x'] as number) : 0;
    const sy = typeof self.state['y'] === 'number' ? (self.state['y'] as number) : 0;
    const trip = (o: Option) => (net > 0 ? (net * attr(self, 'walkCostPerMeter') * Math.max(0, Math.hypot(o.tx - sx, o.ty - sy) - attr(self, 'reach'))) / attr(self, 'digestYield', 0.8) : 0);
    const score = (o: Option) => {
      const gain = (hungry ? o.food : 0) + (wantReady ? o.ready : 0) + (wantRaw ? o.raw : 0) + tryWeight * o.info + (o.keep && tryWeight > 0 ? 1 : 0);
      const base = (gain - trip(o)) / (1 + o.ticks);
      const same = o.target === target && (o.intent === intent || (intent === 'move' && o.intent === o.act));
      return same ? base * commit : base;
    };
    let best: Option | undefined;
    let bestScore = 1e-9;
    for (const o of opts) {
      const s = score(o);
      if (s > bestScore + 1e-12) {
        best = o;
        bestScore = s;
      }
    }
    const o = self.rel[ORIGIN];
    // 付いて行く相手（札 affFollow が正のとき）: この一時間に見えた他の人のうち、自分より栄養の良い、いちばん良い人（比べる）。
    // 上手くいっている仲間の近くにいれば、その人が何をどこでするかが見える（局所的強調。群れで採餌する動物、Ward・Zahavi 1973 の情報の中心）。
    const leader = attr(self, 'affFollow', 0) > 0 ? bestOff(self, now) : undefined;
    const sx0 = sx;
    const sy0 = sy;
    const toward = (px: number, py: number, within: number) => (Math.hypot(px - sx0, py - sy0) > within ? { intent: 'move' as const, target: '', targetX: px, targetY: py } : undefined);
    // 現状維持（札 affRest が正のとき）: 空腹でなく、どの選択肢の点数も affRest に届かなければ、休む。休む所は来た所か、付いて行く相手のそば。
    const rest = attr(self, 'affRest', 0);
    if (rest > 0 && !hungry && bestScore < rest) {
      if (leader) return toward(leader.x, leader.y, 5) ?? { intent: 'idle' };
      return toward(num(o, 'ox'), num(o, 'oy'), attr(self, 'reach')) ?? { intent: 'idle' };
    }
    if (best) {
      if (best.intent === 'move') return { intent: 'move', target: best.target || '', targetX: best.tx, targetY: best.ty };
      return { intent: best.act, target: best.target };
    }
    // することが無ければ、付いて行く相手について行く（知らない所を一人で探すより安い）。
    if (leader) return toward(leader.x, leader.y, 5) ?? { intent: 'idle' };
    return exploreSpiral(self, o && { x: num(o, 'ox'), y: num(o, 'oy') }, attr(self, 'exploreSpacing', 1), 0.5, 1, 0);
  }
}
