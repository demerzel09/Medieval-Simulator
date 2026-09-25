# 人物の動機・仕事・行動インターフェース v1

状態: v1設計契約。2026-09-25。実装・既存セーブ形式への適用はまだ行っていない。この文書は [設計調査](RESEARCH_MOTIVATION_ACTION.md) の A（共通実行経路）、B（軽量BDIと社会的約束）、C（LLM/NNによる判断）のいずれにも共通する**意味と境界**を定める。判断器内部の契約は第4章で具体化した。実装前の設計修正を反映したもので、保存済みのv1データや実装利用者は存在しない。実装後に契約の変更が必要なら版を上げて記録する。

## 1. 固定する意味、固定しない実装

人物は見聞きした情報と自身の動機から行動を**提案**する。提案は仕事の引受け、拒否、交渉、具体的な行為、計画の選択のいずれでもよい。sim はその人物の権限・位置・時間・資産を実行時に検査し、結果を Event として確定する。次に結果が誰へ伝わるかを決める。提案した時点では成功も他人の同意も発生しない。

```text
WorldTruth ──知覚と通信──▶ PersonalView
                                   │
                    動機・進行中の意図・候補を添える
                                   ▼
                             DecisionRequest
                                   │
                rule / NN / LLM / 人間のアダプター
                                   ▼
                             DecisionResponse
                                   │
                       型・既知情報・鮮度の検証
                                   ▼
                         Task / ActionAttempt
                                   │
                      sim の実行時再検証と解決
                                   ▼
                      Event / ActionOutcome
                         └──▶ 後続の知覚と評価
```

この図の **DecisionRequest / DecisionResponse** を最大の交換境界とする。小さいモデルでも大きいモデルでも同じ形を使う。`WorldTruth → PersonalView`、`ActionAttempt → Event`、資産・人口・所有権・因果・時刻の更新は sim の責務として固定する。意思決定器へ `World` 参照、台帳の書込権、任意の効果関数を渡さない。インターフェースは世界の真実を保証しない。本人にとって可能に見えた行動が、実行時に失敗することを許す。

認識・望み・採用した意図を分けるのは BDI/AgentSpeak に倣う。ただし完全な論理証明器は要しない。[Rao & Georgeff 1995](https://aaai.org/papers/icmas95-042-bdi-agents-from-theory-to-practice/)、[Rao 1996](https://apice.unibo.it/bin/view/Publication/RaoAgentspeak96)。エージェントと環境の相互作用をデータ契約として標準化すると、異なる学習手法を同じ環境で比べやすいという示唆は [PettingZoo](https://proceedings.nips.cc/paper_files/paper/2021/hash/803f7c4c3ff61b71be53a0c803bfb57f-Abstract.html) にある。本作がその順番制APIを直接採用するという意味ではない。

## 2. 外側の交換契約

以下は実装する交換契約を示す TypeScript 風の型。現時点では文書上の型であり、まだ実コードにはない。`Id` と `PersonId` は一度発行したら再利用しない非空文字列、`Minute` は世界開始からの非負整数、`JsonValue` は有限数・文字列・真偽値・null・それらの配列/辞書に限る。`confidence` と `trust` は 0〜1。全データは正規化JSONとして保存・ハッシュ化できる。ネットワークを通す可能性があるため、関数や実行コードを含まない。

```ts
type ConditionRefV1 = {
  predicateId: string;     // 版管理した少数の条件語彙
  args: JsonValue;          // predicateIdごとのSchemaで検証
};
type PrincipalRefV1 =
  | { kind: "person"; id: PersonId }
  | { kind: "household" | "institution"; id: Id };
type BeliefViewV1 = {
  id: Id;
  claim: ConditionRefV1;
  polarity: "affirmed" | "denied";
  observedAt: Minute;
  receivedAt: Minute;
  sourceId: Id;
  confidence: number;
};
type ExpectationViewV1 = {
  id: Id; subjectRef?: Id; contextTag: string; anticipated: ConditionRefV1;
  subjectiveLikelihood: number; confidence: number;
  horizonMinutes: number; updatedAt: Minute; evidenceIds: Id[];
};
type KnownPersonV1 = {
  personId: PersonId; knownRoles: string[];
  believedLocationId?: Id; trust?: number; evidenceIds: Id[];
};
type KnownTaskV1 = {
  taskId: Id; requesterId?: PersonId; assigneeId: PersonId;
  goal: ConditionRefV1; believedStatus: string; dueAt?: Minute;
  evidenceIds: Id[];
};
type KnownCommitmentV1 = {
  commitmentId: Id; debtor: PrincipalRefV1; creditors: PrincipalRefV1[];
  antecedent: ConditionRefV1; consequent: ConditionRefV1;
  believedStatus: string; dueAt?: Minute; evidenceIds: Id[];
};
type KnownResourceV1 = {
  owner: PrincipalRefV1; goodId: string;
  estimatedMin: number; estimatedMax: number;
  observedAt: Minute; evidenceIds: Id[];
};
type PersonalViewV1 = {
  actor: { id: PersonId; locationId: Id; roles: string[];
           cultureIds: string[]; valueWeights: Record<string, number>;
           health: number; hunger: number; fatigue: number };
  beliefs: BeliefViewV1[];
  expectations: ExpectationViewV1[]; // 未来の見込み。観測済みの事実ではない
  knownPeople: KnownPersonV1[];
  knownTasks: KnownTaskV1[];
  knownCommitments: KnownCommitmentV1[]; // 世界の全約束ではない
  knownResources: KnownResourceV1[];
};
type MotiveViewV1 = {
  id: Id;
  sourceKind: "need" | "goal" | "value" | "norm" | "roleDuty" | "socialCommitment";
  sourceRef?: Id;
  desired: ConditionRefV1;
  priority: number;               // その判断時点の評価
  evidenceIds: Id[];
};
type IntentionViewV1 = {
  id: Id; goal: ConditionRefV1; adoptedAt: Minute;
  reconsiderOn: ConditionRefV1[];
};
type DecisionOptionV1 = {
  optionId: Id;
  kind: "adoptIntention" | "respondTask" | "attemptAction" | "beginPlan";
  payload: JsonValue;             // kindごとのSchemaで検証
  reasonIds: Id[];
  believedPreconditions: ConditionRefV1[];
  estimatedMinutes?: number;      // 本人の見積り。真の移動時間ではない
};
type PlanTemplateViewV1 = {
  templateId: Id; bindingSchemaId: string;
  knownTargetIds: Id[];            // 本人が指定可能と認識する対象だけ
  maxSteps: number;
};
type DecisionRequestV1 = {
  schema: "decision.request.v1";
  requestId: Id;
  actorId: PersonId;
  catalogVersion: string;  // 文化・役職・述語・行動の静的定義を固定
  scope: {
    phase: "goal" | "taskResponse" | "plan" | "act";
    triggerRef: Id; focalRefs: Id[]; horizonMinutes: number;
  };
  observedAt: Minute;      // 個人ビューを構築した時点。個々の情報の観測時刻は別
  decideBy: Minute;        // 応答を受理する最終時刻
  applyAt: Minute;         // 採用した判断を世界へ渡す時刻
  frameHash: string;       // 自身を除くリクエスト全体の正規化JSONハッシュ
  view: PersonalViewV1;
  viewCoverage: { truncated: boolean; omittedCounts: Record<string, number> };
  reasons: MotiveViewV1[]; // その時点で評価された動機と根拠
  intention?: IntentionViewV1;
  options: DecisionOptionV1[]; // 最大数・並び順を版管理
  templates: PlanTemplateViewV1[];
  limits: { maxPlanSteps: number; maxOptions: number; optionSchemaVersion: string };
};

type DecisionResponseV1 = {
  schema: "decision.response.v1";
  requestId: Id;
  actorId: PersonId;
  frameHash: string;
  source: "player" | "rule" | "neural" | "llm" | "script";
  providerVersion: string;
  receivedAt: Minute;      // ingressが刻印。モデル出力を信用しない
  choice:
    | { kind: "select"; optionId: Id }
    | { kind: "compose"; templateId: Id; bindings: JsonValue }
    | { kind: "defer"; reconsiderAt: Minute };
  reasonRefs: Id[];       // view/reasons内で本人に見えた根拠のIDのみ
  rationale?: string;     // UI用、効果・真実判定には使用しない
};
```

`select` は列挙された候補を選ぶ。`compose` はカタログにある計画テンプレートの**パラメータ**を提案する。対象・手順・時間の組合せは広げられるが、効果の種類を生成しない。`defer` は人物の再考予約であり、世界の時刻を止めない。NNは候補採点→`select`、ルールは直接`select`、LLMは`select`または制限された`compose`、プレイヤーはUIから同じ応答へ写像できる。誰も新しい `ActionKind` や資産差分を応答へ書けない。

一つのリクエストは `scope.phase` の**一問だけ**を扱う。`goal` は何を目指すか、`taskResponse` は依頼を受ける・拒む・交渉するか、`plan` は採用した目的をどう進めるか、`act` は直近の一手を選ぶ。対応する候補種別は順に `adoptIntention`、`respondTask`、`beginPlan`、`attemptAction` とし、`compose` は `plan` だけに許す。全人物が全段階を毎分通る必要はない。緊急事態やTask到着などの `triggerRef` で再考し、進行中の仕事は必要な時だけ再計画する。`view` はその一問に関連する本人の認識の**投影**であり、本人の全記憶を毎回列挙しない。省略は「偽」や「存在しない」を意味せず、`viewCoverage` に切り詰めを記録する。`cultureIds` は本人に身についた文化的所属、`valueWeights` はその時点の価値傾向で、文化から一意に決まる値ではない。既知の道・地形・制度なども根拠と時刻を持つ `BeliefView` の述語で渡し、世界地図の真実を自動で複製しない。

`requestId` と `frameHash` の不一致、未知の option/template、本人が知らない根拠ID、遅着、権限外の対象は不受理として Event に残し、通常ルールへフォールバックする。`decideBy <= applyAt` とし、受理した応答は指定の `applyAt` に適用する。応答は採用時にも、後の各行動の実行時にも再検証する。`source` と `receivedAt` は入力窓口が付与し、プロバイダーの自己申告を信用しない。外部モデルの実時間応答の揺れは、`applyAt` と採否・応答本文を入力ログに固定する。リプレイ時はモデルを呼び直さない。モデル版や特徴抽出版はセーブ・ログに残す。

v1の必須フィールドと意味は固定し、意味を変える場合は `v2` にする。述語・行動・計画テンプレートの追加は個別のSchema IDを上げる。未対応のSchemaは拒否する。外部プロバイダーの会話履歴や隠れ状態は世界の記録ではない。結果に影響させるなら、プロバイダー版と採用した応答を入力ログに保存し、途中セーブから外部モデルを再開する際の状態も版付きで保存する。

`PersonalViewV1` には本人の位置・健康・所属、根拠付き Belief、把握した人物・関係、受け取った指示、本人が認識した仕事・約束、把握した資源だけを含める。推定資源は幅で表し、正確に観測した場合だけ上下限が一致する。遠方の部隊の真の位置、未着の伝令、相手の私的動機は含めない。`DecisionOptionV1` は `optionId`、型付き `kind` と `payload`、本人が信じる前提、必要な所要時間の**推定**、関連 `reasonIds` を持つ。真の実行可能性のビットは渡さない。空候補時には必ず `defer` または待機相当を表現できる。

### なぜ単一の `Planner.plan(observation): Action[]` では足りないか

現行 `Planner` は観測から実行行動列を直に返す。受任拒否、意図の継続、行動途中の失敗、応答の遅延、本人に知られた約束と実際の約束の違いを表しにくい。上記の交換契約は「判断」を返し、実行・通信・仕事の進行を別の責務にする。ルールの短期導入だけでも大きな契約を変えずに済む。

## 3. 世界側の不変な意味

### 3.1 動機と意図

`Motive` は理由を表す。出所は `need`（空腹・安全）、`goal`（望む状態）、`value`、`norm`、`roleDuty`、`socialCommitment` などの判別可能な参照にする。一つの候補に複数の理由を持たせる。短期の空腹は既存状態から導出し、毎分新しい永続レコードを作らない。長期目標、重要な意図、未解決の対人義務はIDと履歴を保持する。優先度は現状と本人の認識から再計算する値で、約束の金額や発言だけで確定しない。

`Intention` は本人が継続を選んだ目的と、再考条件を表す。動機は競合できるが、意図は「しばらく続ける」という慣性を持つ。`GoalCondition` は型付きの達成判定であり、単なる文章ではない。計画の全手順や成功未来を記録する必要はない。本人が撤回・変更した場合は理由とEventを残す。

### 3.2 他人への約束

`SocialCommitment` は少なくとも債務者・債権者の型付き参照、成立原因、発動条件、履行条件、期限、履行済み証拠、状態を持つ。`offered → active → discharged | violated | released` を核とし、拒否・再交渉・失効は原因Event付き遷移として扱う。約束の当事者が実在人物・世帯・制度主体の誰かは `PrincipalRefV1` で区別する。本人の内的目標はこの台帳に入れない。

社会的コミットメントを債務者・債権者・条件で表し、出来事による履行を追う研究を参考にする。[Yolum & Singh, Commitment Machines](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/atal-01.pdf)、[Singhらの条件付き記法とEvent進行](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/AAMAS-11-Regula.pdf)。ゲームの一回の配達約束は達成条件、通行権を守り続ける約束は維持条件として区別できる。[Telang, Singh & Yorke-Smith 2021](https://ojs.aaai.org/index.php/AAAI/article/view/17355)。約束の真の状態と、当事者・周囲の認識は別物であり、違反を見ていない人の信用が即変化しない。

### 3.3 仕事と行動

`Task` は一人の担当者、依頼者、目的条件、期限、親Task、根拠の動機/意図/約束、状態、進行原因を持つ。依頼は受任と同義ではない。初期役職の通常業務はルールAIが迅速に受任しうるが、人物が拒否・交渉・離脱できる余地を残す。親Taskは子の**結果Event**を見て進む。割当済みだけでは成功にしない。

`ActionAttempt` は `actorId`、型付き動詞と引数、`taskId?`、提案原因、開始時刻、所要時間、必要な予約を持つ。人物の行動については `ActionExecutor` だけが実行時の所在、権限、死亡・捕虜、道、資産・所有者、競合予約を確認し、移転・生産・消費・人物状態の更新を確定する。`ActionOutcome` は `succeeded | failed | interrupted`、理由コード、原因Event IDで返す。環境や日次の制度処理も sim 内の専用 reducer が世界を更新する。Eventは世界で起きた真実、Report/Beliefは誰に届いたかを表す。共通Actionは少数の型付き動詞から始める。`MOVE_PERSON`、`PREPARE_DOCUMENT`、`DELIVER`、`TALK`、`WORK`、`TRANSFER`、`ACCEPT_TASK`、`DECLINE_TASK` のような候補は例であり、正式語彙は後続レビューで決める。

世界内の記録は交換契約とは別だが、意味の取り違えを防ぐため核となる形も定める。`ConditionRefV1` の述語は権限と期限を含めて真偽を評価でき、自由文を評価器に渡さない。行動の `verbId` と `args` は動詞ごとの版付きSchemaを持つ。以下の `Id` は全レコードに固有で、参照先が消えた場合も Event 履歴のIDを再利用しない。

```ts
type TaskRecordV1 = {
  id: Id; assigneeId: PersonId; requester?: PrincipalRefV1;
  goal: ConditionRefV1; parentTaskId?: Id;
  motiveIds: Id[]; intentionId?: Id; commitmentId?: Id;
  status: "offered" | "accepted" | "active" | "done" | "failed" | "refused" | "cancelled";
  dueAt?: Minute; causeEventIds: Id[];
};
type SocialCommitmentRecordV1 = {
  id: Id; debtor: PrincipalRefV1; creditors: PrincipalRefV1[];
  mode: "achievement" | "maintenance";
  antecedent: ConditionRefV1; consequent: ConditionRefV1;
  status: "offered" | "active" | "discharged" | "violated" | "released" | "expired";
  dueAt?: Minute; createdByEventId: Id; evidenceEventIds: Id[];
};
type ActionAttemptV1 = {
  id: Id; actorId: PersonId; verbId: string; args: JsonValue;
  taskId?: Id; causeDecisionId: Id; startAt: Minute;
  expectedMinutes: number; reservationRefs: Id[];
};
type ActionOutcomeV1 = {
  attemptId: Id; status: "succeeded" | "failed" | "interrupted";
  reasonCode: string; causeEventIds: Id[]; finishedAt: Minute;
};
```

`TaskRecord` の `done` は目標を満たした結果Eventに基づく。`SocialCommitmentRecord` の `discharged` はTaskの完了通知ではなく、真の履行条件と証拠Eventから判定する。維持型の約束は期限まで連続して条件を満たした時点で履行し、途中の違反もEventで判定する。複数債権者の約束が部分履行を許す場合は、債権者別の子約束に分けて各状態を一意にする。`ActionOutcome` は真実の記録であり、離れた依頼者に即時通知しない。

計画の内部で高位Taskを低位Taskへ分ける方法はHTNから借りられる。[Nau et al. 2003](https://www.cs.umd.edu/~nau/papers/nau2003shop2.pdf)。ただし本作は完全な汎用HTNソルバーを必要としない。数個の検証済みテンプレートで始め、行動の組合せと世界効果を分離する。

## 4. 内側の小さなインターフェース

外側のJSON契約に対し、以下は実装を差し替えやすくする**内部ポート案**。初回実装では一部を同じモジュールに置いてよい。実装クラスやアルゴリズムまで外部契約として固定しない。

| ポート | 入力 → 出力 | 現行ルール版 | 後の差し替え |
|---|---|---|---|
| `PerceptionProjector` | WorldのEvent＋知覚経路 → PersonalView/Belief | witnessと伝令到着 | 噂・情報の歪み。ただし真実を直接配らない |
| `MotiveResolver` | PersonalView＋本人の長期状態 → MotiveView[] | 空腹、家族、文化、役職、約束を規則評価 | 学習した重み。ただし理由の出所を維持 |
| `OptionProvider` | 観測＋動機＋意図＋Task → DecisionOption[] | 権限と既知情報から有限候補 | 新しい計画テンプレート、LLMの型付き組合せ |
| `DecisionAdapter`＋Gateway | DecisionInput → ChoiceDraft → DecisionResponse | ルールによる選択と受理記録 | NNの候補採点、LLM、人間のUI |
| `ExperienceUpdater`（任意） | 本人に届いた結果＋過去の期待 → 期待/信用の更新 | 観測された一致・不一致を記録 | 学習した更新式。ただし未到着の結果は使わない |
| `TaskPlanner` | 選ばれた高位Task → 有限の子Task | 招待・配送・面談など定義済み分解 | 制約付き計画探索 |
| `ActionExecutor` | ActionAttempt＋World → ActionOutcome＋Event | sim内の動詞別実装 | 効果の追加は検証済みコードだけ。モデル交換対象にしない |
| `CommitmentReducer` | Commitment＋原因Event → 新状態 | 期限と履行証拠を規則判定 | 新しい約束種類。LLMに真偽判定させない |

内部部品をすべてinterfaceに分けてから作る必要はない。最初に安定させるのはデータの意味、ActorViewの情報境界、Decisionの提出/受理規則、Eventの真実性である。モデル固有の特徴ベクトル、プロンプト、効用式、HTN探索器の詳細は交換可能な内側に置く。

### 4.1 判断器の共通入口

`DecisionProvider` は人物の属性を数十個の引数で受けない。実装上の入口は次の形にする。`CatalogSlice` は版付きの**静的**定義から、そのリクエストに現れた文化・役職・規範・条件・行動だけを切り出す。説明文は表示用で、効果判定や隠れた世界状態を含めない。文化IDだけから性格を決めつけず、個人の `valueWeights`、経験と現在の動機を併せて渡す。

```ts
type CatalogSliceV1 = {
  version: string;
  entries: Array<{
    id: string;
    kind: "culture" | "role" | "norm" | "condition" | "action" | "plan";
    tags: string[];                // 例: care, duty, trade, violence
    label: string; description: string; // 表示・LLM用、真偽の根拠ではない
  }>;
};
type DecisionInputV1 = {
  request: DecisionRequestV1;
  catalog: CatalogSliceV1;
};
type ChoiceDraftV1 = Pick<DecisionResponseV1, "choice" | "reasonRefs" | "rationale">;
interface DecisionAdapterV1 {
  readonly providerId: string;
  readonly providerVersion: string;
  decide(input: DecisionInputV1): ChoiceDraftV1 | Promise<ChoiceDraftV1>;
}
```

sim は `DecisionRequest` を作って保存し、外部ホストが `CatalogSlice` とアダプターを接続する。`catalog.version` は `request.catalogVersion` と一致させる。アダプターの非同期性を sim に持ち込まない。ホストは `ChoiceDraft` を検証し、`source`・`receivedAt` を刻印して `DecisionResponse` にする。期限までに応答がなければ、同じ入力を使う通常ルールへ切り替える。プレイヤー操作もこの入口を通し、UIの自由入力が直接台帳や世界状態を変えない。

| アダプター | 同じ入力からの内部表現 | 出力 |
|---|---|---|
| ルール | 型付き条件と動機ごとの寄与値 | 候補IDまたは制約付きテンプレート |
| 小型NN | 版付き特徴抽出。可変長の人物・候補は集合/関係として表現可能 | 候補スコアから選んだID |
| LLM | 認識・現在の動機・候補・静的語彙を短い文とJSON Schemaに投影 | 型付きChoiceDraft。自然文は理由表示だけ |
| 人間 | 同じ候補と根拠をUIに表示。必要なら段階別の操作画面 | 同じChoiceDraft |

小さな離散行動群と型付きパラメータを分ける考え方は[パラメータ付き行動の研究](https://arxiv.org/abs/1509.01644)と整合する。長く続く仕事を一手の巨大な行動に押し込まず、開始・中断・終了を持つものとして扱う発想は[Options](https://www.sciencedirect.com/science/article/pii/S0004370299000521)に近い。これらは本作の仕様を直接導く証明ではなく、インターフェースを分ける際の参考である。

### 4.2 大量の状況を扱う内部パイプライン

判断の前処理は、世界の真実にアクセスできる **知覚側** と、人物の認識だけを使う **判断側** の境界を越えない。`PersonalView` の関係・資源・Beliefは `scope` に沿って投影する。各段階は「不明」を偽と扱わず、参照した根拠IDを残す。

```text
認識済みEvent / 人物の長期状態
  → ScopeScheduler       何を今判断するか（緊急・期限・Task到着）
  → ContextAssembler     この一問に関連する既知情報を投影
  → MotiveResolver       必要・文化規範・役割・価値・約束を動機化
  → OptionProvider       知っている対象から型付き候補を列挙
  → DecisionAdapter      rule / NN / LLM / human が選択
       └ Rule内では ImpactEstimator → 採点 → 選択
  → DecisionGateway      応答を記録・検証・適用時刻へ予約
```

ルール版の内部の中間型も小さく保つ。候補ごとの予想は「文化×職業×地形×政策」の組合せクラスではなく、動機と候補の関係として記録する。NNやLLMは同じ `DecisionInput` から独自に評価してよく、このルール用中間型には依存しない。

```ts
type ImpactEstimateV1 = {
  optionId: Id; motiveId: Id;
  progress: number;       // -1..1。本人が予想する目的への進み具合
  confidence: number;     // 0..1。未知なら低い
  evidenceIds: Id[];
};
type OptionAssessmentV1 = {
  optionId: Id;
  impacts: ImpactEstimateV1[];
  burdens: Array<{
    kind: "time" | "money" | "food" | "injuryRisk" | "relationship";
    amount: number; confidence: number; evidenceIds: Id[];
  }>;
  evidenceIds: Id[];
};
interface ImpactEstimatorV1 {
  estimate(input: DecisionInputV1): OptionAssessmentV1[];
}
```

最初のルール版は `priority × progress × confidence` の和から本人の価値傾向で換算した負担を差し引き、進行中の意図を続ける小さな加点をする。ただし「役職だから必ず従う」のような例外分岐は置かない。文化は規範由来の動機と予想への補正、役割は責務と権限、個人の利害は必要と価値、世界構造は本人が知る道・距離・資源・関係、状況は期限・危険・疲労などの入力として作用する。複数要因の相互作用が必要な場合だけ、版付きの**疎な規則**を追加し、その寄与と根拠を開発画面に出す。権限・時間・資産の真の可否はスコアではなく sim の実行検証で決める。

| 判断の段階 | 主な文脈 | 候補の粒度 | 例 |
|---|---|---|---|
| `goal` | 必要、長期価値、関係、現在の義務 | 意図の採用・継続・撤回 | 家族を守る、地位を得る |
| `taskResponse` | 依頼内容、依頼者との関係、報酬、現在の仕事 | 受任・拒否・交渉・延期 | 伝令の仕事を受けるか |
| `plan` | 採用した目的、使える人手、既知の経路 | 定義済みの仕事分解・委任 | 書記へ作成、伝令へ配送 |
| `act` | 現在地、手持ち、直近の障害、予約済み時間 | 一人の次の行為 | 文書を書く、道を進む |

候補は本人が知る範囲で生成し、受任中の義務・切迫した必要・待機を省略しない。大人数や多数の相手からの候補削減は決定的な順序と上限を持ち、切り詰め件数を `viewCoverage` に残す。候補数が増えても全人物を全分野の固定長ベクトルへ詰めず、NN側の特徴抽出を別版とする。[Deep Sets](https://arxiv.org/abs/1703.06114)や[Relational Deep RL](https://arxiv.org/abs/1806.01830)は可変数の対象を扱う設計上の参考になる。ゲームAIで目標・行動を再利用できる部品に分ける利点と計算費用については[Orkin 2005](https://ojs.aaai.org/index.php/AIIDE/article/view/18724)を参考にする。

**例:** 書記が君主から招待状作成を頼まれたとき、`taskResponse` の一問だけが起きる。家族の病気、給金、君主への信用、職務上の責務は別々の `MotiveView` として残り、「受ける」「延期を願う」「拒む」への予想影響を評価する。書記が受けた後の `act` では書く・移動する・休むなど現在の候補へ進む。君主の文化や書記の職業を一つの巨大な条件分岐に連結しない。

### 4.3 個人の期待と、選択器の実装自由度

**共通インターフェースは予測の有無を決めない。** `DecisionAdapterV1.decide(DecisionInputV1)` は同じ入力から `ChoiceDraftV1` を返すだけである。単純なルール、習慣、候補の結果予測、NN、LLM、人間の判断は、アダプターの内部で使える方法である。`goal/taskResponse/plan/act` は問いの種類であり、単純さや熟慮の深さを指定しない。どのアダプターを人物に割り当てるかもホスト側の版付き設定で決め、採用したプロバイダーIDと版を記録する。モデル選択と人物自身の意思決定を混同しない。

多くの市民には、最初は役職・場所・時間・把握した例外に応じたルールを使える。「畑で働く」「道を進む」などは、パターンが一つの候補を選ぶだけでよい。そのルールが複雑な場面で自分の内部予測器を呼ぶ実装も可能だが、これを全アダプターの義務にはしない。[Dawら 2011](https://pubmed.ncbi.nlm.nih.gov/21435563/) と [Cushman & Morris 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4653221/) は、習慣的制御と将来の結果を見込む制御の区別を考える参考になる。本作が人間の神経過程を再現しているという主張ではない。速い手掛かりによる判断については [Gigerenzer & Goldstein 1996](https://web.mit.edu/curhan/www/docs/Articles/biases/Gigerenzer_Goldstein_Reasoning%20Fast%20and%20Frugal.pdf) も参考にする。

一方で、**期待は人物の認識の一種として共通入力に置く**。`BeliefView` は既に起きたことについての認識、`ExpectationView` はまだ起きていないことの本人の見込みである。仕事の報酬、伝令の到着、他者の協力などを本人は期待しうる。アダプターは期待を直接使っても、暗黙のパターン条件にしても、他の根拠を優先してもよい。必要な場合だけ、次の内部ポートで候補ごとの主観的予測を作る。

```ts
type SubjectiveForecastV1 = {
  id: Id; optionId: Id; anticipated: ConditionRefV1;
  subjectiveLikelihood: number; // 0..1。真の成功率ではない
  confidence: number;            // 0..1。本人の情報の確かさ
  horizonMinutes: number;
  evidenceIds: Id[]; expectationIds: Id[];
  adjustments: Array<{
    kind: "experience" | "sourceTrust" | "culturalPrior" | "motivated";
    amount: number; basisRefs: Id[];
  }>;
};
interface SubjectiveForecasterV1 {
  forecast(input: DecisionInputV1): SubjectiveForecastV1[];
}
type DecisionTraceV1 = {
  requestId: Id; actorId: PersonId;
  providerId: string; providerVersion: string;
  chosenOptionId?: Id; causeRefs: Id[];
  methodRef?: string; forecastRefs?: Id[]; // 説明資料は任意
};
```

`SubjectiveForecaster` は使うモデルだけが持つ**任意の内部ポート**であり、`DecisionInput/ChoiceDraft` の必須項目ではない。すべての選択にはプロバイダー・選んだ候補・原因を記録し、予測したモデルだけ予測根拠を追加する。ルールのパターンIDも `methodRef` として追える。行動はどの方法で選ばれても同じ `ActionAttempt → Event` を通る。

予測がある場合も、それは本人の主観である。経験、伝聞の送り手への信用、文化的な事前期待、願望による補正を分けて追えるようにする。文化が「何を良いと感じるか」という**選好**へ作用する場合と、「相手は協力するはずだ」という**期待**へ作用する場合を区別する。損失を強く嫌うことと損失の発生を高く見積もることも別である。[Kahneman & Tversky 1979](https://www.jstor.org/stable/1914185) は利得・損失の評価の参考になる。願望に沿う情報を信じやすい場合があるという実験結果は [Tappinら 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5536309/) にあるが、全人物へ一律の「楽観バイアス」を与える根拠にはしない。

期待の更新は **真のEvent発生時ではなく、その人物が結果を知覚した時** に行う。過去の期待と結果のReport/Eventを因果参照で結び、本人の `ExpectationView` や相手への信用を更新する。結果が届かなければ期待はそのまま残る。重要な相手・仕事・危険についての期待だけを永続化し、一時的な予測は必要な場合のデバッグ記録に残す。信用に関する予測と送り手への信頼を別に更新する発想には[社会的助言の予測誤差の研究](https://pubmed.ncbi.nlm.nih.gov/28119508/)を参考にする。

たとえば農民は平常日に単純なルールで「畑で働く」を選ぶ。給金の未払いを**本人が知った**後でも、その人物を担当するルールが「休む」へ切り替えるだけでよい。より高度なアダプターなら、「今日も払われる見込み」と「休めば家族の食事がどうなるか」を比較できる。いずれも同じ入力・出力契約を使い、君主へ未払い報告が届かなければ君主の認識は変わらない。

## 5. 二つの実行例

**面談の呼び出し:** 君主の動機（家臣の意向を知る）→ 面談を求める選択 → 書記への作成依頼 → 書記の受任 → 文書作成Event → 伝令の受任・移動・配達Event → 対象者の観測と承諾/拒否 → 同行移動Event → 宮廷で面談Event。伝令不足、負傷、相手の移動、拒否で中断する。君主は報告や現地の目撃なしに遠隔の失敗を知れない。各人の行動は自分の動機とTaskに結び付く。

**毎日の労働:** 農民の必要（食糧・給金・家族）、役職義務、他の選択肢 → 仕事を続ける判断 → 一日分の `WORK` Task/Action → sim が勤務可能時間と投入財を確認 → 生産・賃金・家計移転の集約Event。徴兵、看病、伝令業務、面談移動が同じ時間枠を占めれば生産は減る。日次集約で処理し、千人を毎分再計画しない。世界に食糧が増えるのは実際の生産Eventによる場合だけ。

## 6. A・B・Cと将来の学習

Aでは `MotiveResolver` は単純なルール、`TaskPlanner` は固定手順、`DecisionProvider` は現行の評価式を包む。Bでは長期意図、条件付き対人約束、役職義務、委任・再交渉を増やす。Cでは `DecisionProvider` や `OptionProvider` にNN/LLMを接続する。いずれも外側の交換契約と sim の実行権限は同じ。Cでも自然文による任意の世界効果は禁止し、未知の行動は型検証で拒否する。

小型NN用には `DecisionRequest` から数値特徴を作る `FeatureEncoder(version)` と候補マスクを別途版管理する。共有モデルが最大N候補を採点して `select` を返す。候補マスクは**本人に見える条件**だけで作る。世界の秘密から作った真の可否をNNへ漏らさない。特徴の意味と出力語彙を版管理すれば、ルールの教師データや別モデルとの比較に使える。模倣学習では自分の判断が後続の観測分布を変える点に注意する。[Ross, Gordon & Bagnell 2011](https://proceedings.mlr.press/v15/ross11a)。LLMは構造化出力のアダプターであり、人物の認識と行動カタログ以外にアクセスしない。

## 7. 実装時に検証する契約テスト

1. 同じ seed・採用 DecisionResponse・Command・保存状態から、Event列と世界ハッシュが一致する。ルール、録画済みLLM、録画済みNN応答で同じ契約を使う。
2. `DecisionRequest` に未到着報告、遠隔の真の兵数、相手の私的動機、世界の版番号が紛れない。真実の漏洩を型検査とfixtureで防ぐ。
3. 提案だけでは資産、人口、信用、約束の真の状態が変わらない。成立と履行はそれぞれ別の原因Eventに結び付く。
4. 担当者の死亡・捕虜・拒否、道の遮断、資産不足、二重予約のどれでも、親Taskは成功しない。失敗原因が本人に伝わらない場合もある。
5. 一人が重なる時間に伝令・兵役・農作業を同時に完遂しない。家臣不足が指揮の遅れを作る。
6. 役職・約束・個人の必要が衝突しても、候補と理由が消えない。選んだ結果と選ばなかった選択肢を開発画面で追える。
7. 現行90日外交勝利・軍事勝利・無策敗北、保存再開、資産保存、不変条件、画面操作が段階移行の各時点で動く。
8. 現行の1,000人90日とM2の200人会戦を旧版と比較する。2,000人会戦は対応後に別途計測し、未計測の大規模性能を成功としない。
9. 同じ `DecisionInput` をルール・NN・LLM録画応答・人間UIアダプターへ渡せる。どの出力も同じGatewayで検証され、モデル独自の世界更新経路を作らない。
10. 書記の価値傾向、依頼者への信用、家族の病気、役職責務を独立に変えるfixtureで、同じ招待状依頼への評価が変わる。たとえば信用・責務の上昇は受任側へ、家族の急病は延期側へ寄与し、寄与量と根拠を表示できる。文化差は規範に対応する候補で検査する。
11. `scope` ごとに無関係な認識を省き、候補切り詰めは決定的で `viewCoverage` に現れる。省略した情報や未知の対象を「存在しない」と判断する規則を置かない。
12. 文化・役職・行動カタログの版不一致、未知の述語、未知の候補、遅着を拒否し、同じ入力を使ったルールフォールバックと原因Eventが再現する。
13. 同じ `DecisionInput` に対し、予測器を持たない市民ルールと、主観的予測を持つモデルの双方が有効な `ChoiceDraft` を返す。予測器がないことを契約違反にしない。
14. 未払いの世界Eventだけでは、まだ知らない農民の期待・信用・選択は変わらない。本人に報告が届いてからだけ更新し、期待と観測結果の因果参照を追える。

社会シミュレーションとして使う前には、モデルの目的・過程・実験条件・評価パターンを記述する。[ODD 2020](https://www.jasss.org/23/2/7.html)。このインターフェース自体が社会の妥当性を保証するわけではない。

## 8. 既存コードとの対応と版管理

- `ActorObservation` → `PersonalViewV1` へ拡張。既存の君主表示には投影アダプターを置く。個人認識を実装せずにWorldを全員へ渡す移行はしない。
- `Planner.plan(observation): Action[]` → `DecisionAdapter`。現行AIを先に移し、同じリクエストで選択した記録を比較する。
- `Command` はプレイヤーの指示とモデルの判断結果を取り込む入口として残し、最終的な人物Action・Task・Eventと区別する。各Commandを強制的な直接効果へしない。
- `Message`、`Audience`、`PromiseContract` は一度に消さず、配送/面談のTaskとSocialCommitmentへ段階的に対応付ける。古いセーブは明示的な移行関数で読む。
- 新しいJSON契約は `decision.*.v1` として版を付け、保存には仕様版、内容ハッシュ、未処理リクエスト、採用済み応答、Task/Commitment状態を含める。版不一致を黙って読み替えない。

**v1で固定する範囲:** 決定者は自分に見える情報だけで提案し、外側の `DecisionRequest/Response` と判断器の `DecisionInput/ChoiceDraft` で rule/NN/LLM/人間を交換すること。Taskは人が実行し、SocialCommitmentは他者への義務として別に持つこと。simだけが真実を更新し、Eventと伝達を分けること。型付き行動語彙とその個数、動機の重み、最初のTaskテンプレートは実装版ごとに変更できる。実コード化の際に型名や正規化表現を調整する場合も意味と版管理を守る。
