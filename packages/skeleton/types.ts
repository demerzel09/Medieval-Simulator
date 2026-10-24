// 最小の骨格: 事物・属性・作用（型と実例）・予定・記録の型。
// docs/DESIGN.md「大きな構造」の中核をそのまま型にする。語彙は REA / Valueflows に対応づける。

export type ThingId = string;

/** 事物の知識（心象）: 観測した事物の属性の写し。時刻と出所を持ち、古く、誤り得る。 */
export interface Knowledge {
  [about: ThingId]: { at: number; source: ThingId; kind: string; attrs: Record<string, number | string> };
}

/** 属性の値。数は釣り合いの対象、文字列は所在・保管者・種類、Knowledge は人物の心象。 */
export type AttrValue = number | string | Knowledge;

/** 事物の読み取り専用の写し。属性は作用の実例によってしか変わらない。 */
export interface ThingSnapshot {
  readonly id: ThingId;
  readonly kind: string;
  readonly attrs: Readonly<Record<string, AttrValue>>;
}

/** 作用が属性に加える変化。すべて二つの事物の間で双方向に釣り合う。 */
export type Effect =
  /** 同じ属性を from から to へ移す（REA の transfer / hREA の DecrementIncrement）。 */
  | { kind: 'transfer'; attr: string; from: ThingId; to: ThingId; amount: number }
  /** from の属性を減らし、to の別の属性を増やす変換。差分は loss として明示した事物へ移す（保存則）。 */
  | {
      kind: 'convert';
      from: ThingId;
      fromAttr: string;
      amount: number;
      to: ThingId;
      toAttr: string;
      produced: number;
      lossTo: ThingId;
      lossAttr: string;
    }
  /** 保管者や所在の付け替え。手放す側と受け取る側の二者を参加者として記録する。 */
  | { kind: 'reassign'; thing: ThingId; attr: 'custodian' | 'location'; from: string; to: string; giver: ThingId; receiver: ThingId }
  /** 知覚・伝達: 観測対象の属性の写しを観測者の心象に書く。対象側の変化はゼロと確定する。 */
  | { kind: 'inform'; observer: ThingId; about: ThingId; attrs: string[]; source: ThingId };

/** 役割への束縛。影響範囲の決定とは、各役割にどの事物が入るかを決めることである。 */
export type Binding = Record<string, ThingId>;

/** 世界の読み取り専用の窓。作用の型と世界の進行だけが使う。心象には渡さない。 */
export interface WorldView {
  readonly now: number;
  thing(id: ThingId): ThingSnapshot | undefined;
  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[];
}

/** 役割: 影響範囲の条件。所在・保管者・属性の値で相手になり得る事物を選ぶ。 */
export interface Role {
  name: string;
  /** 既に束縛された役割を見て、この役割に入れる事物かを判定する。 */
  where: (candidate: ThingSnapshot, bound: Binding, w: WorldView) => boolean;
}

/** 作用の型: 属性ごとに決まる規則。版を持ち、実例の状態を持たない。 */
export interface ActionType {
  id: string;
  version: string;
  /** 責任を持つ参加者の役割名（Laurier・Poels 第三公理）。自然の作用では nature。 */
  agentRole: string;
  roles: Role[];
  /** 束縛後の追加条件。満たさなければ理由を返す。 */
  guard?: (b: Binding, w: WorldView) => string | null;
  /** 開始から完了までの分。0 なら即時。 */
  duration: (b: Binding, w: WorldView) => number;
  /** 完了時に両側へ一度に適用する釣り合った変化。 */
  effects: (b: Binding, w: WorldView) => Effect[];
}

export type InstanceState = 'scheduled' | 'completed' | 'cancelled';

/** 作用の実例: 型を具体的な事物・参加者・時刻に結びつけた一回の出来事。 */
export interface ActionInstance {
  id: number;
  type: string;
  version: string;
  binding: Binding;
  /** 影響範囲: この実例が触れる事物。束縛された事物と効果の loss 先。 */
  scope: ThingId[];
  startedAt: number;
  dueAt: number;
  state: InstanceState;
  reason?: string;
}

/** 記録: 起きたことの記述。再現と検査に使う。 */
export type LedgerEntry =
  | { at: number; seq: number; kind: 'attempt'; type: string; binding: Binding; accepted: boolean; reason?: string; instance?: number }
  | { at: number; seq: number; kind: 'complete'; instance: number; type: string; binding: Binding; effects: Effect[] }
  | { at: number; seq: number; kind: 'cancel'; instance: number; type: string; reason: string }
  | { at: number; seq: number; kind: 'wake'; person: ThingId }
  | { at: number; seq: number; kind: 'death'; person: ThingId };

/** 心象・予測・配分: 人物の内側。自分の写し（心象を含む）だけから試みを返す。世界の真実は見ない。 */
export interface Mind {
  /** 次に起きる時刻（分）。 */
  nextWake(self: ThingSnapshot, now: number): number;
  /** 起床時にまず行う知覚の試み。世界は即時の実例を完了させてから decide を呼ぶ。 */
  observe(self: ThingSnapshot, now: number): Attempt[];
  /** 知覚の後の判断。試みの列を返す。空なら何もしない。 */
  decide(self: ThingSnapshot, now: number): Attempt[];
}

export interface Attempt {
  type: string;
  binding: Binding;
}
