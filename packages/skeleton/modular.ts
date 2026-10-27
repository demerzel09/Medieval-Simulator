// 心象のモデルの枠組み（階層のモデル選択の土台。docs/DESIGN.md「本命の仮説」、docs/RESEARCH.md「誤差をどこが引き受けるか」）。
// 部品は四つで、どれも人の札（属性）の名で選び、差し替えられる。
//   見込みのモデル（ModelKind）: 心象の一つの項目にパラメータを置き、時期の区間ごとの値（項）を出す。
//   誤差の割り当て（Assigner）: 同じ相手を受け持つモデルたちの項から見込みを組み、観察との誤差を、どのモデルにどれだけ割り当てるかを決める。
//   規則（Rule）: 状況から意図を一つ勧めるか、勧めない。規則は見込みを持たない制御のモジュール（MOSAIC の逆モデルの側）。
//   選び方（Selector）: 規則たちの勧めから意図を一つ選ぶ。
// 心象を書くのは記憶の規則（ModelSystem.memory。札 models のモデルの組と、札 assigner の割り当て）、意図を選ぶのは心 ModularMind（札 rules・selector）。
// 心は記憶を持たず、モデルのパラメータはすべて心象に置くので、記録から再生すると心象まで同じになる。
// この枠組みは物の種類の名を知らない。何を源とみなし、何を観察するか、どの規則を並べるかは、段ごとの組（ModelSet・RuleSet）が決める。

import type { Memory, Mind, Relation, Relations, ThingId, ThingSnapshot } from './types.js';
import { HOUR, KIND } from './fruit.js';

const attr = (t: ThingSnapshot | undefined, a: string): number => {
  const v = t?.attr[a];
  return typeof v === 'number' ? v : 0;
};
const name = (t: ThingSnapshot, a: string): string => (typeof t.attr[a] === 'string' ? (t.attr[a] as string) : '');
const num = (e: Relation | undefined, k: string, d: number): number => (typeof e?.[k] === 'number' ? (e[k] as number) : d);
/** 札の数。札が無ければ d（個性の値の既定）。 */
const opt = (t: ThingSnapshot, a: string, d: number): number => (typeof t.attr[a] === 'number' ? (t.attr[a] as number) : d);

/** 意図（心が選ぶもの）。 */
export type Intent = NonNullable<ReturnType<Mind['decide']>>;

/** 時刻 t が、一年（札 calendar、分）を札 bins に分けたどの区間か。 */
export const binOf = (self: ThingSnapshot, t: number): number => {
  const cal = attr(self, 'calendar') || 1;
  const bins = Math.max(1, Math.round(attr(self, 'bins') || 1));
  return Math.min(bins - 1, Math.floor((((t % cal) + cal) % cal) / cal * bins));
};

// ---- 見込みのモデルと、誤差の割り当て ----

/**
 * 見込みのモデルの種類。パラメータは心象の項目に、区間 b ごとの値 `{prefix}{b}` として置く。
 * own が真なら相手その物の項目に（一本ずつのモデル）、偽なら slot が返す共有の項目に（種類のモデルなど）置く。
 * 値が無い区間の項は base（見たことの無いときの値）。直す速さは人の札 rateAttr。
 */
export interface ModelKind {
  id: string;
  version: string;
  prefix: string;
  rateAttr: string;
  own: boolean;
  /** 共有の項目の名（own が偽のとき）。置く場所が無ければ undefined（項は base のまま、書かない）。 */
  slot(entry: Relation): string | undefined;
  base(self: ThingSnapshot): number;
}

/** 種類のモデル: 相手の心象に写った種類の名ごとに、心象の種類の知識の項目（`kind:名`）に置く。見たことの無い区間は札 prior。 */
export const kindModel: ModelKind = {
  id: 'kind',
  version: 'modular-1',
  prefix: 'fc',
  rateAttr: 'kindRate',
  own: false,
  slot: (entry) => (typeof entry['kind'] === 'string' ? `${KIND}${entry['kind']}` : undefined),
  base: (self) => attr(self, 'prior'),
};

/** 一本ずつのモデル（協調型のずれ）: 相手その物の項目に置く。見たことの無い区間は 0（種類のモデルと足すときのずれ）。 */
export const individualModel: ModelKind = {
  id: 'individual',
  version: 'modular-1',
  prefix: 'dv',
  rateAttr: 'learnRate',
  own: true,
  slot: () => undefined,
  base: () => 0,
};

/**
 * 一本ずつのモデル（競合型）: 相手その物の項目に置き、単独で全体を予測する。見たことの無い区間は札 prior（種類のモデルと同じ出発点）。
 * 協調型のずれ（individualModel）とは値の意味が違うので、項目の名も別にする（tv{区間}）。
 */
export const treeModel: ModelKind = {
  id: 'tree',
  version: 'modular-1',
  prefix: 'tv',
  rateAttr: 'learnRate',
  own: true,
  slot: () => undefined,
  base: (self) => attr(self, 'prior'),
};

/**
 * 割り当てに渡す、一つのモデルの項。value は区間の値（無ければ base）、known はその区間の値を持っているか、
 * err はそのモデルがこの源をどれだけ外してきたか（誤差の二乗の移動平均。源の項目の `{prefix}err`。まだ無ければ undefined）、
 * variance はその区間の値の不確かさ（モデルの項目の `{prefix}q{区間}`。まだ無ければ undefined）。
 */
export interface Term {
  value: number;
  known: boolean;
  err: number | undefined;
  variance: number | undefined;
}

/** 割り当てが返す、一つのモデルの書き直し。書かない欄は省く。モデルごとに undefined なら何も書かない。 */
export interface TermUpdate {
  value?: number;
  err?: number;
  variance?: number;
}

/**
 * 誤差の割り当て。combine は項たちから見込みを組む。assign は観察 observed を受けて、各モデルの書き直しを返す。
 * 理論の違い（協調・責任・勝者一つ・作る・不確かさ）は、この部品の違いとして並べる（docs/RESEARCH.md 10.7）。
 */
export interface Assigner {
  id: string;
  version: string;
  combine(self: ThingSnapshot, terms: Term[]): number;
  assign(self: ThingSnapshot, terms: Term[], observed: number, models: ModelKind[]): (TermUpdate | undefined)[];
}

/**
 * 協調型（いまの二段の見込み）: 見込みは項の和。誤差 e = 観察 − 和 を、各モデルが自分の速さ倍だけ足す（同じ誤差を分け合う）。
 * 速さ 0 のモデルは書かない。外し具合も不確かさも使わない。専門家の混合でいう協調型で、モデルは分かれない（RESEARCH 10.3）。
 */
export const additiveAssigner: Assigner = {
  id: 'additive',
  version: 'modular-1',
  combine: (_self, terms) => terms.reduce((a, t) => a + t.value, 0),
  assign: (self, terms, observed, models) => {
    const error = observed - terms.reduce((a, t) => a + t.value, 0);
    return models.map((m, i) => {
      const rate = attr(self, m.rateAttr);
      return rate > 0 ? { value: terms[i]!.value + rate * error } : undefined;
    });
  },
};

/** 外し具合の移動平均を直す。速さは札 errRate（既定 0.2）。まだ記録が無ければ、いまの誤差の二乗から始める。 */
const nextErr = (self: ThingSnapshot, t: Term, observed: number): number => {
  const sq = (observed - t.value) ** 2;
  return t.err === undefined ? sq : t.err + opt(self, 'errRate', 0.2) * (sq - t.err);
};
/** 外し具合（記録が無ければ札 respVar、既定 1）。 */
const errOf = (self: ThingSnapshot, t: Term): number => t.err ?? opt(self, 'respVar', 1);

/**
 * 責任: 各モデルの外し具合から、softmax(−err / 2σ²) で責任を出す（σ² は札 respVar、既定 1）。MOSAIC の責任信号を、源ごとの外し具合で出す形。
 * 責任を出す前に、外し具合の最も小さいものを引いておく（値は変わらず、桁があふれない）。
 */
export function responsibilities(self: ThingSnapshot, terms: Term[], among: boolean[] = terms.map(() => true)): number[] {
  const s2 = Math.max(1e-9, opt(self, 'respVar', 1));
  const errs = terms.map((t) => errOf(self, t));
  const low = Math.min(...errs.filter((_, i) => among[i]));
  const w = errs.map((e, i) => (among[i] ? Math.exp(-(e - low) / (2 * s2)) : 0));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}

/** 外し具合が最も小さいモデル（同じなら並びの先）。among で候補を絞る。 */
const winnerOf = (self: ThingSnapshot, terms: Term[], among: boolean[] = terms.map(() => true)): number => {
  let best = -1;
  terms.forEach((t, i) => {
    if (among[i] && (best < 0 || errOf(self, t) < errOf(self, terms[best]!) - 1e-12)) best = i;
  });
  return Math.max(0, best);
};

/**
 * 柔らかい責任（MOSAIC）: 各モデルは単独で全体を予測する（競合型）。見込みは責任で重みづけた和。
 * 各モデルは自分の誤差 e_i = 観察 − 値_i を、速さ × 責任 r_i 倍だけ足す。外し具合は全モデルで直す（どのモデルも予測したので）。
 */
export const responsibilityAssigner: Assigner = {
  id: 'responsibility',
  version: 'modular-1',
  combine: (self, terms) => {
    const r = responsibilities(self, terms);
    return terms.reduce((a, t, i) => a + r[i]! * t.value, 0);
  },
  assign: (self, terms, observed, models) => {
    const r = responsibilities(self, terms);
    return models.map((m, i) => ({ value: terms[i]!.value + attr(self, m.rateAttr) * r[i]! * (observed - terms[i]!.value), err: nextErr(self, terms[i]!, observed) }));
  },
};

/**
 * 勝者一つ: 見込みは外し具合の最も小さいモデルの値。直るのはそのモデルだけ（自分の誤差を自分の速さ倍）。外し具合は全モデルで直す。
 * 問い「階層のどこかの、最も寄与した一か所の線形モデルだけを直す」の、層が一つのときの形。
 */
export const winnerAssigner: Assigner = {
  id: 'winner',
  version: 'modular-1',
  combine: (self, terms) => terms[winnerOf(self, terms)]!.value,
  assign: (self, terms, observed, models) => {
    const w = winnerOf(self, terms);
    return models.map((m, i) => ({ ...(i === w ? { value: terms[i]!.value + attr(self, m.rateAttr) * (observed - terms[i]!.value) } : {}), err: nextErr(self, terms[i]!, observed) }));
  },
};

/**
 * 合わなければ作る（ART の形）: 並びの先のモデル（いまの組では種類のモデル）は初めからあり、ほかのモデルは、その区間の値を持つ（作られた）ときだけ候補になる。
 * 見込みと直し方は勝者一つと同じ（候補の中で）。勝ったモデルの誤差の二乗が警戒の基準（札 vigilance、既定 1）を超え、
 * まだ作られていないモデルがあれば、並びの先から一つを作り、その区間の値を観察そのものにする（一度で覚える例外）。
 * 作られた例外は、その源のその区間だけに置かれ、ほかの区間は先のモデルで当てる。
 */
export const artAssigner: Assigner = {
  id: 'art',
  version: 'modular-1',
  combine: (self, terms) => {
    const among = terms.map((t, i) => i === 0 || t.known);
    return terms[winnerOf(self, terms, among)]!.value;
  },
  assign: (self, terms, observed, models) => {
    const among = terms.map((t, i) => i === 0 || t.known);
    const w = winnerOf(self, terms, among);
    const out: (TermUpdate | undefined)[] = models.map((m, i) =>
      among[i] ? { ...(i === w ? { value: terms[i]!.value + attr(self, m.rateAttr) * (observed - terms[i]!.value) } : {}), err: nextErr(self, terms[i]!, observed) } : undefined,
    );
    const missing = terms.findIndex((_, i) => !among[i]);
    if ((observed - terms[w]!.value) ** 2 > opt(self, 'vigilance', 1) && missing >= 0) out[missing] = { value: observed, err: 0 };
    return out;
  },
};

/**
 * 不確かさで振り分ける（カルマンフィルタ・階層ガウスフィルタの形）: 各モデルは区間ごとに値と不確かさ q を持ち、単独で全体を予測する（競合型）。
 * 見込みは不確かさの逆数で重みづけた平均。各モデルは、利得 K = q / (q + R) で自分の誤差を足し、q ← (1 − K) q + Q とする
 * （R は観察の揺らぎ、札 obsNoise、既定 1。Q は時とともに増える不確かさ、札 drift、既定 0.05。まだ記録の無い q は札 priorVar、既定 4）。
 * 自信の無いモデルほど多く直り、見込みへの重みは小さい。速さの札は使わない。
 */
export const uncertaintyAssigner: Assigner = {
  id: 'uncertainty',
  version: 'modular-1',
  combine: (self, terms) => {
    const q0 = opt(self, 'priorVar', 4);
    const w = terms.map((t) => 1 / Math.max(1e-9, t.variance ?? q0));
    const sum = w.reduce((a, b) => a + b, 0);
    return terms.reduce((a, t, i) => a + w[i]! * t.value, 0) / sum;
  },
  assign: (self, terms, observed) => {
    const q0 = opt(self, 'priorVar', 4);
    const R = Math.max(1e-9, opt(self, 'obsNoise', 1));
    const Q = opt(self, 'drift', 0.05);
    return terms.map((t) => {
      const q = t.variance ?? q0;
      const K = q / (q + R);
      return { value: t.value + K * (observed - t.value), variance: (1 - K) * q + Q, err: nextErr(self, t, observed) };
    });
  },
};

/** 割り当ての一覧（札 assigner の名）。 */
export const assigners: Record<string, Assigner> = {
  additive: additiveAssigner,
  responsibility: responsibilityAssigner,
  winner: winnerAssigner,
  art: artAssigner,
  uncertainty: uncertaintyAssigner,
};

/** 段ごとのモデルの組: 心象のどの項目を源とみなし、着いたときに何を観察するか、どのモデルを並べるか。 */
export interface ModelSet {
  id: string;
  version: string;
  isSource(entry: Relation): boolean;
  observe(rel: Readonly<Relations>, about: ThingId): number;
  models: ModelKind[];
}

/** モデルの組と割り当ての一覧から作る、見込みの仕組み。memory を世界に登録し、forecast で見込みを読む。 */
export interface ModelSystem {
  memory: Memory;
  forecast(self: ThingSnapshot, entry: Relation, t: number): number;
}

/** 札の名で部品を引く。札が無ければ fallback。知らない名なら設定の誤りとして止まる（黙って別の部品で走らせない）。 */
function partOf<T>(self: ThingSnapshot, tag: string, parts: Record<string, T>, fallback: T | undefined): T | undefined {
  const n = name(self, tag);
  if (!n) return fallback;
  const part = parts[n];
  if (!part) throw new Error(`${self.id}: unknown ${tag} ${n} (known: ${Object.keys(parts).join(', ')})`);
  return part;
}

/** 札 models の組と札 assigner の割り当てで見込みを持つ仕組みを作る。札 models が無い人には働かない。札 assigner が無ければ協調型。 */
export function createModelSystem(sets: Record<string, ModelSet>, assignerTable: Record<string, Assigner> = assigners): ModelSystem {
  const setOf = (self: ThingSnapshot) => partOf(self, 'models', sets, undefined);
  const assignerOf = (self: ThingSnapshot) => partOf(self, 'assigner', assignerTable, additiveAssigner)!;
  const paramsOf = (self: ThingSnapshot, m: ModelKind, entry: Relation): Relation | undefined => {
    if (m.own) return entry;
    const slot = m.slot(entry);
    return slot ? self.rel[slot] : undefined;
  };
  const termsAt = (self: ThingSnapshot, set: ModelSet, entry: Relation, b: number): Term[] =>
    set.models.map((m) => {
      const params = paramsOf(self, m, entry);
      const v = params?.[`${m.prefix}${b}`];
      const err = entry[`${m.prefix}err`];
      const q = params?.[`${m.prefix}q${b}`];
      return { value: typeof v === 'number' ? v : m.base(self), known: typeof v === 'number', err: typeof err === 'number' ? err : undefined, variance: typeof q === 'number' ? q : undefined };
    });

  /**
   * 記憶の規則 models: 札 models の組を持つ観測者が、源の手の届く所にいるとき、その源と、モデルたちの項目を書き直す。
   * 着いた刻み（前の刻みに近くにいなかった）に、いまの区間 b の項たちと観察から、割り当てが新しい項を決める。訪れた数 visits を数える。
   * 近くにいる間は、最後に見た数 lastCount と時刻 lastAt を書き続ける（去るときに残っていた数が、直近の観察になる）。
   * 同じ刻みに同じ共有の項目を二つの源が書くと、後の源（項目の並びで後）の書き直しだけが残る。
   */
  const memory: Memory = {
    id: 'models',
    version: 'modular-1',
    learn: (observer, about, entry, w, dt) => {
      const set = setOf(observer);
      if (!set || !set.isSource(entry) || w.distance(observer.id, about) > attr(observer, 'reach')) return null;
      const count = set.observe(observer.rel, about);
      const fields: Relation = { visitAt: w.now, lastCount: count, lastAt: w.now };
      const ongoing = typeof entry['visitAt'] === 'number' && w.now - (entry['visitAt'] as number) <= dt + 1e-9;
      if (ongoing) return { [about]: fields };
      const b = binOf(observer, w.now);
      const next = assignerOf(observer).assign(observer, termsAt(observer, set, entry, b), count, set.models);
      const out: Relations = { [about]: fields };
      set.models.forEach((m, i) => {
        const u = next[i];
        if (!u) return;
        // 値と不確かさはモデルの項目へ、外し具合は源の項目へ。
        const own: Relation = {};
        if (u.value !== undefined) own[`${m.prefix}${b}`] = u.value;
        if (u.variance !== undefined) own[`${m.prefix}q${b}`] = u.variance;
        if (u.err !== undefined) fields[`${m.prefix}err`] = u.err;
        if (m.own) Object.assign(fields, own);
        else {
          const slot = m.slot(entry);
          if (slot && Object.keys(own).length) out[slot] = { ...(out[slot] ?? {}), ...own };
        }
      });
      fields['visits'] = num(entry, 'visits', 0) + 1;
      return out;
    },
  };

  /**
   * 見込み: 源の心象 entry から、時刻 t に観察される数の見込み。区間の見込み（割り当てが項から組む）に、直近の観察のずれ（最後に見た数 − その区間の見込み）を
   * 経過時間で薄めて足す（exp(−経過 / recallHours)）。取り尽くした木は、しばらくは少なく、時が経つと区間の見込みへ戻る。モデルの組が無ければ 0。
   */
  const forecast = (self: ThingSnapshot, entry: Relation, t: number): number => {
    const set = setOf(self);
    if (!set) return 0;
    const assigner = assignerOf(self);
    const at = (time: number) => assigner.combine(self, termsAt(self, set, entry, binOf(self, time)));
    const base = at(t);
    if (typeof entry['lastAt'] !== 'number') return Math.max(0, base);
    const lastAt = entry['lastAt'] as number;
    const tau = Math.max(1e-9, attr(self, 'recallHours') * HOUR);
    const surprise = num(entry, 'lastCount', 0) - at(lastAt);
    return Math.max(0, base + surprise * Math.exp(-Math.max(0, t - lastAt) / tau));
  };

  return { memory, forecast };
}

// ---- 規則と、選び方 ----

/** 規則: 状況 S から意図を一つ勧めるか、勧めない（undefined）。 */
export interface Rule<S> {
  id: string;
  propose(s: S): Intent | undefined;
}

/** 段ごとの規則の組: 状況の作り方と、並べる規則（並びは優先の順）。 */
export interface RuleSet<S> {
  id: string;
  version: string;
  situation(self: ThingSnapshot, now: number): S;
  rules: Rule<S>[];
}

/** 選び方: 規則たちの勧めから意図を一つ選ぶ。 */
export interface Selector {
  id: string;
  version: string;
  select<S>(rules: Rule<S>[], s: S): Intent;
}

/** 優先の順（サブサンプションの形）: 並びの先から、最初に勧めた規則の意図を採る。どれも勧めなければ待つ。 */
export const prioritySelector: Selector = {
  id: 'priority',
  version: 'modular-1',
  select: (rules, s) => {
    for (const r of rules) {
      const intent = r.propose(s);
      if (intent) return intent;
    }
    return { intent: 'idle' };
  },
};

/** 組み合わせの心: 札 rules の規則の組と、札 selector の選び方（無ければ優先の順）で意図を選ぶ。記憶は持たない（心象と状態を読むだけ）。 */
export class ModularMind implements Mind {
  constructor(
    private readonly ruleSets: Record<string, RuleSet<any>>,
    private readonly selectors: Record<string, Selector> = { priority: prioritySelector },
  ) {}
  decide(self: ThingSnapshot, now: number): Intent | undefined {
    const set = partOf(self, 'rules', this.ruleSets, undefined);
    if (!set) return undefined;
    const selector = partOf(self, 'selector', this.selectors, prioritySelector)!;
    return selector.select(set.rules, set.situation(self, now));
  }
}
