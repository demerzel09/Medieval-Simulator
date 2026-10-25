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

/**
 * 種類の定義（Def）: 事物の雛形。札と仕様（attr）、初期の状態と資源をデータとして持つ。
 * parent を指すと親の既定値を継ぎ、自分の値で上書きする（振る舞いは継がない。振る舞いは法則にある）。
 * Unity の prefab、RimWorld の Def、Dwarf Fortress の raw、REA の ResourceSpecification にあたる。
 */
export interface ThingDef {
  name: string;
  parent?: string;
  attr?: Record<string, Scalar>;
  state?: State;
  res?: Resources;
}

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
  /**
   * 付属先（状態 attachedTo）の付け替え。from は現在の付属先で、変わっていれば何も起きない。
   * force は要求者が提供した有効な力（握る力、刃物）。同じ物を取り合えば、力の大きい要求が通り、同点は要求者の id 順。持ち主の意思ではなく物理が決める。
   */
  | { kind: 'reassign'; thing: ThingId; from: ThingId; to: ThingId; force?: number }
  /** 事物の生成。種類の定義 def から作り、state で初期の状態を上書きする。量は源泉の資源から引き、生まれる事物の資源 quantity になる（保存則）。 */
  | { kind: 'spawn'; id: ThingId; def: string; state?: State; from: ThingId; fromRes: string; amount: number }
  /** 事物の消滅。量は行き先の資源へ移り、差分は loss へ。 */
  | { kind: 'despawn'; thing: ThingId; to: ThingId; toRes: string; produced: number; lossTo: ThingId; lossRes: string }
  /** 位置（状態 x, y）の変化。動いた分の費用（資源）を別の事物へ移す。 */
  | { kind: 'move'; thing: ThingId; dx: number; dy: number; costFrom: ThingId; costRes: string; costTo: ThingId; cost: number }
  /**
   * 容量を使う。能力（属性、毎時）× Δt がその刻みの容量で、不可分な行為（実を一個採る、一個食べる）が一つずつ使う。
   * 持ち主が容量を超える要求を優先順に落とす。値ではなく、その刻みの中だけの帳簿。
   */
  | { kind: 'use'; thing: ThingId; capacity: string; available: number; amount: number }
  /** 関係を書く。thing の相手 about への関係に fields を重ねる（所属、所有）。相互作用で得る関係はこれで書き、場面の構築で注入しない。 */
  | { kind: 'relate'; thing: ThingId; about: ThingId; fields: Relation }
  /** 生死の確定。状態 alive を no にし、意図を消す。以後その事物はどの組でも何も起こさない。法則が返す（世界の進行は栄養という名を知らない）。 */
  | { kind: 'die'; thing: ThingId };

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
  /** 種類の定義を、親の既定値を継いで解決した形で返す。 */
  def(name: string): { attr: Record<string, Scalar>; state: State; res: Resources };
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
  | { at: number; event: 'intend'; person: ThingId; intent: string; target?: ThingId; targetX?: number; targetY?: number };

/**
 * 世界の写し（録画の初期状態）。定義と事物の値をそのまま持つ。World.save が作り、World.load が世界に戻す。
 * 録画は、この写しと、その時刻以後の記録（LedgerEntry の列）の組である。
 */
export interface WorldState {
  now: number;
  defs: ThingDef[];
  things: { id: ThingId; kind: string; attr: Record<string, Scalar>; state: State; rel: Relations; res: Resources }[];
  /** 生む側ごとの採番の続き。再生のあとに走らせ続けるときに要る。 */
  spawnSeq: Record<string, number>;
}

/**
 * 心: 自分の写し（関係＝心象を含む）だけから、自分の意図を返す。世界の真実は見ない。
 * どの心を持つかは事物の札 mind（定義にある）で決まり、世界は登録された心の種類から作って事物に付ける。場面が人物ごとに割り当てることはしない。
 * 入力は自分の写し、出力は有限の行為（意図）の一つなので、規則・NN・LLM・人間の代行、強化学習や遺伝的アルゴリズムで探した方針に差し替えられる。
 */
export interface Mind {
  decide(self: ThingSnapshot, now: number): Omit<Extract<InfoEffect, { kind: 'intend' }>, 'kind' | 'person'> | undefined;
}
