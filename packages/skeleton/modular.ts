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

/** 一本ずつのモデル: 相手その物の項目に置く。見たことの無い区間は 0（種類のモデルと足すときのずれ）。 */
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
 * 誤差の割り当て。combine は項たちから見込みを組む。assign は観察 observed を受けて、各モデルの新しい項を返す（undefined は書かない）。
 * 理論の違い（協調・責任・勝者一つ・作る・不確かさ）は、この部品の違いとして並べる。
 */
export interface Assigner {
  id: string;
  version: string;
  combine(self: ThingSnapshot, terms: number[]): number;
  assign(self: ThingSnapshot, terms: number[], observed: number, models: ModelKind[]): (number | undefined)[];
}

/**
 * 協調型（いまの二段の見込み）: 見込みは項の和。誤差 e = 観察 − 和 を、各モデルが自分の速さ倍だけ足す（同じ誤差を分け合う）。
 * 速さ 0 のモデルは書かない。専門家の混合でいう協調型で、モデルは分かれない（RESEARCH 10.3）。
 */
export const additiveAssigner: Assigner = {
  id: 'additive',
  version: 'modular-1',
  combine: (_self, terms) => terms.reduce((a, b) => a + b, 0),
  assign: (self, terms, observed, models) => {
    const error = observed - terms.reduce((a, b) => a + b, 0);
    return models.map((m, i) => {
      const rate = attr(self, m.rateAttr);
      return rate > 0 ? terms[i]! + rate * error : undefined;
    });
  },
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
export function createModelSystem(sets: Record<string, ModelSet>, assigners: Record<string, Assigner>): ModelSystem {
  const setOf = (self: ThingSnapshot) => partOf(self, 'models', sets, undefined);
  const assignerOf = (self: ThingSnapshot) => partOf(self, 'assigner', assigners, additiveAssigner)!;
  const paramsOf = (self: ThingSnapshot, m: ModelKind, entry: Relation): Relation | undefined => {
    if (m.own) return entry;
    const slot = m.slot(entry);
    return slot ? self.rel[slot] : undefined;
  };
  const termsAt = (self: ThingSnapshot, set: ModelSet, entry: Relation, b: number) =>
    set.models.map((m) => num(paramsOf(self, m, entry), `${m.prefix}${b}`, m.base(self)));

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
        const v = next[i];
        if (v === undefined) return;
        if (m.own) fields[`${m.prefix}${b}`] = v;
        else {
          const slot = m.slot(entry);
          if (slot) out[slot] = { ...(out[slot] ?? {}), [`${m.prefix}${b}`]: v };
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
