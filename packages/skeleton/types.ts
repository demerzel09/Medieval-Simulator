// 最小の骨格: 事物・値の四区分・作用（法則）・記録の型。
// 大きな構造: 世界にあるものはすべて事物。刻み Δt ごとに、すべての事物の組（自分自身を含む）のうち影響範囲にある組へ
// 法則を当て、両者の値と距離から流れを決め、速度 × Δt を適用する。資源のやり取りはすべてこの更新に収まる（物理層）。
// 知覚・心象・記憶は Δt の流れでは済まないので、事象として扱う（情報層）。
//
// 事物が持つ値は四つに分ける。基準は「更新が書くかどうか」。
//   属性（attr）: 仕様。札と値。どの法則が当たり得るか、どの速さかを決める。更新は書かない（男女、見える範囲、採る速さ）。
//   状態（state）: 更新が書く値（位置、生死、意図、付属先）。
//   関係（rel）: 相手ごとに持つ状態（心象。相性や所有もここに入る）。向きは両側が別に持つ。
//   資源（res）: 量として保存される状態。釣り合いはここに掛かる（栄養、鮮度、蓄え）。
// 法則は事物の種類（kind）ではなく、属性（札）の組で相手を選ぶ。kind は表示のための名にすぎない。
// docs/DESIGN.md「大きな構造」「更新規則と影響範囲」に対応する。

export type ThingId = string;
export type Scalar = number | string | boolean;

/** 属性（仕様）。札（presence）と値。読み取り専用。 */
export type Attrs = Readonly<Record<string, Scalar>>;
/** 状態。更新が書く。 */
export type State = Record<string, Scalar>;
/** 関係: 相手ごとに持つ状態。心象なら、いつ（at）どこで（x, y）何を見たか（写した値）。 */
export type Relation = Record<string, Scalar>;
export type Relations = Record<ThingId, Relation>;
/** 資源: 量として保存される状態。 */
export type Resources = Record<string, number>;

/** 事物の読み取り専用の写し。 */
export interface ThingSnapshot {
  readonly id: ThingId;
  /** 表示のための名。法則は読まない。 */
  readonly kind: string;
  readonly attr: Attrs;
  readonly state: Readonly<State>;
  readonly rel: Readonly<Relations>;
  readonly res: Readonly<Resources>;
}

/**
 * 物理層の効果: 法則が二つの事物の組に対して返す変化。書けるのは状態と資源だけで、資源は二つの事物の間で釣り合う。
 * Δt の中で足りなければ、その効果だけ縮める（取り消しではなく、流れが細る）。
 * 効果が触れてよいのは組の二つの事物と、その組から生まれる事物だけである（世界が検査する）。
 */
export type Effect =
  /** 資源を from から to へ移す。 */
  | { kind: 'transfer'; res: string; from: ThingId; to: ThingId; amount: number }
  /** from の資源を減らし、to の別の資源を増やす。差分は loss として明示した事物の資源へ。 */
  | { kind: 'convert'; from: ThingId; fromRes: string; amount: number; to: ThingId; toRes: string; produced: number; lossTo: ThingId; lossRes: string }
  /** 付属先（状態 attachedTo）の付け替え。from は現在の付属先で、変わっていれば何も起きない。 */
  | { kind: 'reassign'; thing: ThingId; from: ThingId; to: ThingId }
  /** 事物の生成。量は源泉の資源から引き、生まれる事物の資源 quantity になる（保存則）。 */
  | { kind: 'spawn'; id: ThingId; thingKind: string; attr: Record<string, Scalar>; state: State; res: Resources; from: ThingId; fromRes: string; amount: number }
  /** 事物の消滅。量は行き先の資源へ移り、差分は loss へ。 */
  | { kind: 'despawn'; thing: ThingId; to: ThingId; toRes: string; produced: number; lossTo: ThingId; lossRes: string }
  /** 位置（状態 x, y）の変化。動いた分の費用（資源）を別の事物へ移す。 */
  | { kind: 'move'; thing: ThingId; dx: number; dy: number; costFrom: ThingId; costRes: string; costTo: ThingId; cost: number }
  /** 刻みの予算を使う。各事物は刻みごとに Δt を受け取り、行為がそれを使い切る。時計の帳簿であり、値ではない。 */
  | { kind: 'spend'; thing: ThingId; minutes: number };

/**
 * 情報層の効果: 関係（心象）と状態（意図）を変える。世界の事象の処理と心だけが使い、法則は返さない。
 */
export type InfoEffect =
  /** 知覚: 対象の値（属性・状態・資源のうち fields の名）と位置を、観測者の関係 rel[about] に写す。対象側の変化はゼロ。 */
  | { kind: 'inform'; observer: ThingId; about: ThingId; fields: string[] }
  /** 消えた: 見えるはずの場所に無いと確かめた事物を関係から消す。 */
  | { kind: 'forget'; observer: ThingId; about: ThingId }
  /** 意図: 人物が自分の状態 intent・target を定める。心だけが自分に対して使える。 */
  | { kind: 'intend'; person: ThingId; intent: string; target?: ThingId; targetX?: number; targetY?: number };

/** 世界の読み取り専用の窓。法則と世界の進行だけが使う。心には渡さない。 */
export interface WorldView {
  readonly now: number;
  thing(id: ThingId): ThingSnapshot | undefined;
  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[];
  /** 事物の位置。付属している事物は付属先の位置。 */
  positionOf(id: ThingId): { x: number; y: number } | undefined;
  distance(a: ThingId, b: ThingId): number;
  /** 範囲の種類ごとの判定。sight は観測者の視界と対象の見える範囲、reach は手の届く範囲、smell は匂い。属性で決まる。 */
  inRange(kind: 'sight' | 'reach' | 'smell', subject: ThingId, object: ThingId): boolean;
  /** この刻みで事物に残っている時間（分）。 */
  timeLeft(id: ThingId): number;
}

/**
 * 作用の型（法則）: 二つの事物の組（a === b を含む）に対して、両者の属性（札）で当たるかを決め、
 * 状態・関係・資源と距離から Δt の流れを決める。版を持ち、実例の状態を持たない。
 */
export interface Law {
  id: string;
  version: string;
  /** 事物 a と b の間で Δt（分）に起こる変化。何も起こらなければ空。 */
  pair(a: ThingSnapshot, b: ThingSnapshot, dt: number, w: WorldView): Effect[];
}

/**
 * 感覚（情報層）: 観測者が対象を観測できるかと、何を写すか。
 * 世界は刻みごとに観測を集め、関係（心象）との差だけを事象（現れた・消えた）にする。
 */
export interface Sense {
  id: string;
  version: string;
  /** いま観測できれば写す値の名、できなければ null。 */
  observe(observer: ThingSnapshot, object: ThingSnapshot, w: WorldView): string[] | null;
  /** 覚えている事物が、いまの位置からなら観測できるはずか（覚えている位置と値で判定）。 */
  expected(observer: ThingSnapshot, remembered: Relation, w: WorldView): boolean;
}

/** 記録: 起きたことの記述。物理層は適用した流れ、情報層は事象。再現と検査に使う。 */
export type LedgerEntry =
  | { at: number; law: string; a: ThingId; b: ThingId; effect: Effect; applied: number }
  | { at: number; event: 'appear'; person: ThingId; about: ThingId; kind: string }
  | { at: number; event: 'vanish'; person: ThingId; about: ThingId }
  | { at: number; event: 'intend'; person: ThingId; intent: string; target?: ThingId }
  | { at: number; event: 'death'; person: ThingId };

/** 心: 自分の写し（関係＝心象を含む）だけから、自分の意図を返す。世界の真実は見ない。 */
export interface Mind {
  decide(self: ThingSnapshot, now: number): Omit<Extract<InfoEffect, { kind: 'intend' }>, 'kind' | 'person'> | undefined;
}
