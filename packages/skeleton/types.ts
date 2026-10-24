// 最小の骨格: 事物・属性・作用（法則）・記録の型。
// 大きな構造: 世界にあるものはすべて事物。刻み Δt ごとに、すべての事物の組（自分自身を含む）に法則を当て、
// 両者の属性と距離から流れを決め、速度 × Δt を適用する。資源のやり取りはすべてこの更新に収まる（物理層）。
// 知覚・心象・記憶は Δt の流れでは済まないので、事象として扱う（情報層）。
// docs/DESIGN.md「大きな構造」「更新規則と影響範囲」に対応する。

export type ThingId = string;

/** 心象: 知覚した事物の写し。時刻・位置・種類・属性を持ち、古く、誤り得る。 */
export interface Knowledge {
  [about: ThingId]: { at: number; kind: string; x: number; y: number; attrs: Record<string, number | string> };
}

/** 属性の値。数は釣り合いの対象、文字列は種類・付属先・意図、Knowledge は人物の心象。 */
export type AttrValue = number | string | Knowledge;

/** 事物の読み取り専用の写し。属性は作用によってしか変わらない。 */
export interface ThingSnapshot {
  readonly id: ThingId;
  readonly kind: string;
  readonly attrs: Readonly<Record<string, AttrValue>>;
}

/**
 * 物理層の効果: 法則が二つの事物の組に対して返す変化。すべて二つの事物の間で釣り合う。
 * Δt の中で足りなければ、その効果だけ縮める（取り消しではなく、流れが細る）。
 * 効果が触れてよいのは組の二つの事物と、その組から生まれる事物だけである（世界が検査する）。
 */
export type Effect =
  /** 同じ属性を from から to へ移す。 */
  | { kind: 'transfer'; attr: string; from: ThingId; to: ThingId; amount: number }
  /** from の属性を減らし、to の別の属性を増やす。差分は loss として明示した事物へ。 */
  | { kind: 'convert'; from: ThingId; fromAttr: string; amount: number; to: ThingId; toAttr: string; produced: number; lossTo: ThingId; lossAttr: string }
  /** 付属先（木→人など）の付け替え。from は現在の付属先で、変わっていれば何も起きない。 */
  | { kind: 'reassign'; thing: ThingId; attr: 'attachedTo'; from: ThingId; to: ThingId }
  /** 事物の生成。量は源泉の属性から引く（保存則）。 */
  | { kind: 'spawn'; id: ThingId; thingKind: string; attrs: Record<string, number | string>; from: ThingId; fromAttr: string; amount: number }
  /** 事物の消滅。量は行き先の属性へ移り、差分は loss へ。 */
  | { kind: 'despawn'; thing: ThingId; to: ThingId; toAttr: string; produced: number; lossTo: ThingId; lossAttr: string }
  /** 位置の変化。動いた分の費用（栄養など）を別の事物へ移す。 */
  | { kind: 'move'; thing: ThingId; dx: number; dy: number; costFrom: ThingId; costAttr: string; costTo: ThingId; cost: number }
  /** 刻みの予算を使う。各事物は刻みごとに Δt を受け取り、行為がそれを使い切る。時計の帳簿であり、属性ではない。 */
  | { kind: 'spend'; thing: ThingId; minutes: number };

/**
 * 情報層の効果: 心象と意図を変える。世界の事象の処理と心だけが使い、法則は返さない。
 */
export type InfoEffect =
  /** 知覚: 対象の写しを観測者の心象に書く。対象側の変化はゼロ。 */
  | { kind: 'inform'; observer: ThingId; about: ThingId; attrs: string[] }
  /** 消えた: 見えるはずの場所に無いと確かめた事物を心象から消す。 */
  | { kind: 'forget'; observer: ThingId; about: ThingId }
  /** 意図: 人物が自分の意図属性を定める。心だけが自分に対して使える。 */
  | { kind: 'intend'; person: ThingId; intent: string; target?: ThingId; targetX?: number; targetY?: number };

/** 世界の読み取り専用の窓。法則と世界の進行だけが使う。心には渡さない。 */
export interface WorldView {
  readonly now: number;
  thing(id: ThingId): ThingSnapshot | undefined;
  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[];
  /** 事物の位置。付属している事物は付属先の位置。 */
  positionOf(id: ThingId): { x: number; y: number } | undefined;
  distance(a: ThingId, b: ThingId): number;
  /** 範囲の種類ごとの判定。sight は観測者の視界と対象の見える範囲、reach は手の届く範囲、smell は匂い。 */
  inRange(kind: 'sight' | 'reach' | 'smell', subject: ThingId, object: ThingId): boolean;
  /** この刻みで事物に残っている時間（分）。 */
  timeLeft(id: ThingId): number;
}

/**
 * 作用の型（法則）: 二つの事物の組（a === b を含む）に対して、両者の属性と距離から Δt の流れを決める。
 * 版を持ち、実例の状態を持たない。影響範囲の絞り込みはしない。世界が全組に当てる。
 */
export interface Law {
  id: string;
  version: string;
  /** 事物 a と b の間で Δt（分）に起こる変化。何も起こらなければ空。 */
  pair(a: ThingSnapshot, b: ThingSnapshot, dt: number, w: WorldView): Effect[];
}

/**
 * 感覚（情報層）: 観測者が対象を観測できるかと、何を写すか。
 * 世界は刻みごとに観測を集め、心象との差だけを事象（現れた・消えた）にする。
 */
export interface Sense {
  id: string;
  version: string;
  /** いま観測できれば写す属性の名、できなければ null。 */
  observe(observer: ThingSnapshot, object: ThingSnapshot, w: WorldView): string[] | null;
  /** 覚えている事物が、いまの位置からなら観測できるはずか（覚えている位置と属性で判定）。 */
  expected(observer: ThingSnapshot, remembered: Knowledge[ThingId], w: WorldView): boolean;
}

/** 記録: 起きたことの記述。物理層は適用した流れ、情報層は事象。再現と検査に使う。 */
export type LedgerEntry =
  | { at: number; law: string; a: ThingId; b: ThingId; effect: Effect; applied: number }
  | { at: number; event: 'appear'; person: ThingId; about: ThingId; kind: string }
  | { at: number; event: 'vanish'; person: ThingId; about: ThingId }
  | { at: number; event: 'intend'; person: ThingId; intent: string; target?: ThingId }
  | { at: number; event: 'death'; person: ThingId };

/** 心: 自分の写し（心象を含む）だけから、自分の意図を返す。世界の真実は見ない。 */
export interface Mind {
  decide(self: ThingSnapshot, now: number): Omit<Extract<InfoEffect, { kind: 'intend' }>, 'kind' | 'person'> | undefined;
}
