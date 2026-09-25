# 人格の認知・行動インターフェース v2（設計案）

状態: 文書設計。現行ゲームへの実装・保存形式の移行は未着手。v1 は設計履歴であり、v2 と互換ではない。

## 何をインターフェースにするか

**認識、動機づけ、判断、行為の試行、結果の受け取り**を、意味の異なるブロックとして分ける。Rule・NN・LLM・人間はこれらのインターフェースの実装方法であり、インターフェース名でも固定の担当工程でもない。一つのブロックを複数の方法で実装してよく、一つの実装が複数ブロックを一体で処理してもよい。ただし、ブロック間で交換する情報の意味、本人が知り得る範囲、因果 ID は守る。

図の矢印は**情報上の依存関係**であり、全人物が毎回全ブロックを順番に実行するという命令ではない。習慣的な行動では判断を簡略化でき、経験で認識や動機を再評価できる。いずれの経路も外部へ出る行為は同じ型付き試行と sim の検証を通る。

```mermaid
flowchart LR
  E[世界の Event] --> A[到達・可視性を判定<br/>届いた刺激]
  A --> P[認識 Perception<br/>何が起き、何を意味すると捉えたか]
  C[文化: 分類・規範・解釈枠] --> P
  S[本人が知る状況: 役割・関係・場所・仕事] --> P
  M[本人の記憶・身体状態] --> P
  P --> B[本人の認識・解釈]
  B --> V[動機づけ Motivation<br/>何を必要・義務・望みと感じるか]
  C --> V
  S --> V
  M --> V
  V --> D[判断 Deliberation<br/>意図・計画・行為を決める]
  B --> D
  S --> D
  D --> Q[既知のルーティンを起動<br/>役割とTaskを配置]
  C --> Q
  S --> Q
  Q --> K[各担当者へのTask]
  K --> J[担当者本人の判断・引受]
  J --> T[型付き行為試行・延期]
  D -. 例外時の直接行動 .-> T
  T --> G[sim が真の可否と資産を検証]
  G --> E
  G -. 知り得た結果だけ .-> A
```

人物ごとに固有 ID と持続する人格状態を持つ。文化、経験、信用、習慣、役割に関する**本人の知識**が認識と動機を左右する。役職や居場所など世界が管理する値も、本人へ渡すときはその人物にアクセス可能な投影にする。文化は「行動の得点係数」だけではなく、出来事の分類、原因の帰属、言葉の意味、義務の認定にも作用する。たとえば同じ徴税の報を、共同体の負担分担、君主による搾取、約束違反のどれと捉えるかが変わり、その後の動機と行動も変わる。

文化にはさらに、訪問・伝令・護衛・弔い・職務などの場面で、誰が何をどう準備するかという**社会的慣行**を含める。高位者の訪問時に護衛を手配するのは、その都度危険を最適化して発明する行動ではなく、場面に応じて起動する既定の方法である。慣行は認識に場面の意味を与え、動機に役割上の期待を与え、意図を複数人のTaskへ展開する。[慣行の境界と訪問の因果例](SOCIAL_PRACTICES.md)を参照。

多くの行動も同様に、場面からルーティンを起動し、仕事を配置し、Eventに応じて次の手順へ進める。職業・文化・組織ごとの違いは、可能な限り版付き[ルーティンデータ](DATA_DRIVEN_ROUTINES.md)として追加できるようにする。データが任意の世界効果を実行するのではなく、既知の行為プリミティブをsimが検証する。

## ブロックの入力と出力

| ブロック | 入力 | 出力 | 境界が保証するもの |
| --- | --- | --- | --- |
| 到達・可視性 | 世界 Event、位置、伝令・会話の配送 | `ReceivedStimulus[]` | 本人に届いた内容・時刻・原因だけ。隠された真実を渡さない |
| 認識 | 刺激、文化の解釈枠、既存の主観記憶、本人が知る状況、身体信号 | `PerceptionResult` | 「観察内容」と「本人による解釈」を分け、根拠と不確実性を残す |
| 動機づけ | 主観的認識、文化規範、本人の必要、仕事・対人約束・長期意図 | `MotivationResult` | 仕事と対人約束を混同せず、衝突する動機を表現できる |
| 判断 | 主観的認識、動機、既存意図、知っている行動語彙、判断時刻 | `DecisionDraft` | 探索・予測の有無を決めず、型付きの意図・計画・行為試行・延期を返す |
| 実行と結果 | 型付き試行、世界の真実、権限・時間・所有権 | `Event[]` と後続刺激 | sim だけが実行可否・資産・人口を更新し、結果が届くまで人物には知らせない |

これはデータの契約であり、`PerceptionPort` にルール、`MotivationPort` に NN、`DeliberationPort` に LLM を割り当てる図ではない。実装の組合せや内部の細分化は人格モデルの構成として版管理する。各ブロックは同一人物の人格状態を読み書きし、別人格として独立させない。

```ts
type ReceivedStimulus = {
  id: Id;
  kind: "observation" | "communication" | "somatic" | "known_outcome";
  schemaId: string;
  occurredAt: SimTime;
  receivedAt: SimTime;
  sourcePersonId?: PersonId;
  causeEventIds: EventId[];
  payload: JsonValue; // 届いた内容。真実と同義ではない
};

type SituatedContext = {
  at: SimTime;
  knownPlace?: PlaceRef;
  knownRoles: RoleRef[];
  knownRelations: RelationRef[];
  activeTasks: TaskRef[];
  knownCommitments: CommitmentRef[];
  sourceRefs: Id[];
};

type CulturalFrame = {
  id: Id;
  version: string;
  knownConcepts: ConceptRef[];
  knownNorms: NormRef[];
  // 概念・規範の内容は版付きカタログ/本人の学習状態から解決する。
};

type PerceptionInput = {
  personId: PersonId;
  stimuli: ReceivedStimulus[];
  culture: CulturalFrame;
  context: SituatedContext;
  priorSubjectiveState: SubjectiveStateRef;
};

type InterpretedClaim = {
  id: Id;
  proposition: TypedProposition;
  stance: "accept" | "suspect" | "reject" | "uncertain";
  evidenceStimulusIds: Id[];
  // 信頼度・重要度・原因帰属などは必要な場合のみ版付き拡張に置く。
};

type PerceptionResult = {
  personId: PersonId;
  interpretations: InterpretedClaim[];
  subjectiveStateUpdate?: VersionedStateUpdate;
  consumedStimulusIds: Id[];
};
```

`ReceivedStimulus` は世界そのものではなく、見聞きした断片、届いた手紙、感じた空腹、知った結果である。手紙の本文が虚偽でも配送された事実は残る。`SituatedContext` の関係や仕事も「本人が知る状況」であって、内部台帳の全内容ではない。認識は刺激を単純に写す関数ではない。同じ刺激でも文化、現在の役割、空腹、相手との関係、過去の裏切りによって、注目する点や意味づけが変わる。`InterpretedClaim` は本人の主張であり、世界の真実へ書き戻さない。

残る二つの契約は、内部アルゴリズムを固定しない最小形にする。

```ts
type MotivationInput = {
  personId: PersonId;
  perception: PerceptionResult;
  subjectiveState: SubjectiveStateRef;
  culture: CulturalFrame;
  context: SituatedContext;
};
type MotivationResult = {
  personId: PersonId;
  pressures: MotivationalPressure[]; // 必要・仕事・約束・意図などを併存させる
  subjectiveStateUpdate?: VersionedStateUpdate;
  causeRefs: Id[];
};
type DeliberationInput = {
  personId: PersonId;
  interpretations: InterpretedClaim[];
  motivations: MotivationResult;
  subjectiveState: SubjectiveStateRef;
  context: SituatedContext;
  actionVocabularyVersion: string;
  window: DecisionWindow;
};
type DecisionDraft = {
  proposal: TypedIntention | TypedPlan | TypedActionAttempt | TypedDefer;
  subjectiveStateUpdate?: VersionedStateUpdate;
  evidenceRefs: Id[];
  diagnostics?: { schemaId: string; payload: JsonValue };
};

interface PerceptionPort {
  perceive(input: PerceptionInput): PerceptionResult;
}
interface MotivationPort {
  motivate(input: MotivationInput): MotivationResult;
}
interface DeliberationPort {
  deliberate(input: DeliberationInput): DecisionDraft;
}
```

`MotivationalPressure` は互いに比較可能な単一スコアを要求しない。期限、対象、由来、対人義務か自分の必要かなどを型で識別する。`DeliberationInput` の行動語彙は**行為の文法**であって、真の実行可能候補一覧ではない。判断ブロックが予測を使う場合、その予測は本人の期待として主観状態に置き、真実の可否と混ぜない。予測器、候補生成器、固定段階順序は共通契約に含めない。

これらの `Port` は「何を受けて何を返すか」の契約であり、実装クラスの数を指定しない。ひとつの実装が三つとも満たせる。各 `subjectiveStateUpdate` は人格 ID・基準改訂・原因参照を持つ共通の版付き変更として順に適用し、後続ブロックには更新後の本人の状態を渡す。再評価する場合も改訂と原因を残す。

## 人格、組合せ、再現性

`PersonalityState` は人物 ID、人格 ID、改訂番号、文化・価値傾向、版付き主観状態を保存する。認識・動機づけ・判断の実装はこの**同じ人格**を構成する。各ブロックを別プロセスに置いても、共有重みを多数の人物に使っても、人物固有の経験・信用・意図は混ぜない。複数ブロックを一体で計算する実装でも、境界を横切るときは認識結果・動機結果・判断草案を同じ意味で記録できるようにする。内部診断の詳細形式は任意とする。

Gateway は人物・人格 ID、版、時刻、根拠参照、提案型、状態変更を検証し、採用した草案と人格更新を原子的に記録する。sim が世界の真実を使って行為試行を判定し、因果 Event を作る。伝令、面談、呼び出し、仕事、約束の履行、戦闘は担当人物の実際の行為を必要とする。デバッグ表示では全人物の「届いた刺激→解釈→動機→提案→実行 Event→後で知った結果」を ID でたどれるようにする。ただし秘密や誤認もデバッグ上で区別する。

決定的な実装は seed、Command、保存済み人格状態、入力、実装版から再現する。非決定的または外部の実装は、採用済み各ブロックの出力・状態変更と DecisionResponse をログへ保存し、再生時に呼び直さない。実装変更には状態移行と版更新が必要である。

## 検証と移行

1. 現行の文化・価値・信用・記憶を二重台帳にせず人物の人格状態へ対応付ける。
2. 現行ルール AI を各ブロックの最初の実装として包む。全員の日課、書記・伝令・面談、政策反応、約束、戦闘を同じ境界で通す。
3. 同じ税の通知を、異なる文化・関係・仕事・記憶を持つ人物へ渡し、認識の分類・意味づけが変わり、動機と行動にも差が出ることを検証する。同じ文化でも状況だけを変える対照例を作る。
4. 本人へ届かない事実を認識できないこと、虚偽の伝達を事実として確定しないこと、全人物の因果追跡、資産保存則、保存再開・再実行、通常 AI の90日シナリオを回帰検証する。新設計の性能は未計測。

BDI の信念・願望・意図と Generative Agents の記憶・反省・計画は、各ブロックの中身を考える**研究上の参考**であり、共通インターフェースそのものではない。参考: [Rao & Georgeff, BDI Agents (1995)](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf)、[Park et al., Generative Agents (2023)](https://arxiv.org/abs/2304.03442)。
