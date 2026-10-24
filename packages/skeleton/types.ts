// 最小の骨格: 事物・属性・作用（法則）・記録の型。
// 更新は Δt ごと。法則ごとに影響範囲の組を列挙し、速度 × Δt の変化を順に適用する。
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
 * 作用が属性に加える変化。すべて二つの事物の間で釣り合う。
 * Δt の中で足りなければ、その効果だけ縮める（取り消しではなく、流れが細る）。
 */
export type Effect =
  /** 同じ属性を from から to へ移す。 */
  | { kind: 'transfer'; attr: string; from: ThingId; to: ThingId; amount: number }
  /** from の属性を減らし、to の別の属性を増やす。差分は loss として明示した事物へ。 */
  | { kind: 'convert'; from: ThingId; fromAttr: string; amount: number; to: ThingId; toAttr: string; produced: number; lossTo: ThingId; lossAttr: string }
  /** 付属先（木→人など）の付け替え。手放す側と受け取る側を参加者として記録する。 */
  | { kind: 'reassign'; thing: ThingId; attr: 'attachedTo'; from: ThingId; to: ThingId }
  /** 事物の生成。量は源泉の属性から引く（保存則）。 */
  | { kind: 'spawn'; id: ThingId; thingKind: string; attrs: Record<string, number | string>; from: ThingId; fromAttr: string; amount: number }
  /** 事物の消滅。量は行き先の属性へ移り、差分は loss へ。 */
  | { kind: 'despawn'; thing: ThingId; to: ThingId; toAttr: string; produced: number; lossTo: ThingId; lossAttr: string }
  /** 位置の変化。動いた分の費用（栄養など）を別の事物へ移す。 */
  | { kind: 'move'; thing: ThingId; dx: number; dy: number; costFrom: ThingId; costAttr: string; costTo: ThingId; cost: number }
  /** 知覚: 対象の写しを観測者の心象に書く。対象側の変化はゼロ。 */
  | { kind: 'inform'; observer: ThingId; about: ThingId; attrs: string[] }
  /** 見直し: 見えるはずの場所に無いと確かめた事物を心象から消す。 */
  | { kind: 'forget'; observer: ThingId; about: ThingId }
  /** 意図: 人物が自分の意図属性を定める。心だけが自分に対して使える。 */
  | { kind: 'intend'; person: ThingId; intent: string; target?: ThingId; targetX?: number; targetY?: number };

export type Binding = Record<string, ThingId>;

/** 世界の読み取り専用の窓。法則と世界の進行だけが使う。心には渡さない。 */
export interface WorldView {
  readonly now: number;
  thing(id: ThingId): ThingSnapshot | undefined;
  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[];
  /** 事物の位置。付属している事物は付属先の位置。 */
  positionOf(id: ThingId): { x: number; y: number } | undefined;
  distance(a: ThingId, b: ThingId): number;
  /** 影響範囲の種類ごとの判定。sight は観測者の視界と対象の見える範囲、reach は手の届く範囲、smell は匂い。 */
  inRange(kind: 'sight' | 'reach' | 'smell', subject: ThingId, object: ThingId): boolean;
}

/** 作用の型（法則）: 属性ごとに決まる規則。版を持ち、実例の状態を持たない。 */
export interface Law {
  id: string;
  version: string;
  /** 影響範囲: いまこの法則が働く事物の組をすべて列挙する。距離と範囲の属性で決める。 */
  scope(w: WorldView): Binding[];
  /** Δt（分）の間に起こる変化。速度 × Δt。 */
  flow(b: Binding, dt: number, w: WorldView): Effect[];
}

/** 記録: 起きたことの記述。再現と検査に使う。 */
export type LedgerEntry =
  | { at: number; law: string; binding: Binding; effect: Effect; applied: number }
  | { at: number; kind: 'death'; person: ThingId }
  | { at: number; kind: 'intend'; person: ThingId; intent: string; target?: ThingId };

/** 心: 自分の写し（心象を含む）だけから、自分の意図を返す。世界の真実は見ない。 */
export interface Mind {
  decide(self: ThingSnapshot, now: number): Omit<Extract<Effect, { kind: 'intend' }>, 'kind' | 'person'> | undefined;
}
