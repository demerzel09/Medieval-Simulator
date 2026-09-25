# 動機・行動・社会的約束の設計調査（検討稿）

調査日: 2026-09-25。ここは実装決定ではない。既存の M0〜M3 と設計書を前提に、ゲームの行動を社会シミュレーションへ拡張する候補を比較する。論文の事実と本作への適用案を区別する。

## 問題の捉え方

現行実装では `Person` に空腹・価値・文化・信用・認識があり、`PromiseContract`、`Command`、`Message`、`Audience`、日次 `Activity`、因果 `Event` が別々に存在する。`policyResponse` は政策への反応を計算するが、日常労働・伝令・面談・約束の履行はそれぞれ固有の制御経路を持つ。既存設計書の第7章には「本人が実行可能な候補を認識から生成して評価する」とあるが、全人物に共通する判断と実行の契約にはまだなっていない。ユーザーが望む一般化の焦点はここである。

「約束」をあらゆる行動の親概念にすると、空腹で食べることと他人に食糧を届ける約束の違いが消える。もっと広い語は **動機** とする。ただし動機も実行要求・実行中の仕事・実際の結果とは分ける。

| 概念 | 意味 | 例 |
|---|---|---|
| Need / Motive | 本人が守りたい状態・不足・価値・規範・利得・恐怖などの理由 | 家族を食べさせたい、給金が欲しい、名誉を保つ |
| Belief | 本人が知っている、または信じている事柄。真実とは限らない | 村は飢えていると聞いた |
| SocialCommitment | 相手に対する条件付きの債務・約束。相手、成立、履行、違反が問題になる | 勝てば兵に40通貨払う |
| Intention | 本人がいま採用した目的・方針。内的な選択で、対人約束ではない | 明日は村に戻る |
| Task / Assignment | 誰が何をいつまでにするかという実行中の仕事。委任への承諾・拒否を含む | 書記が招待状を作る、伝令が運ぶ |
| Action | 人物が試みる具体的な操作 | 移動、書く、渡す、話す、耕す、支払う |
| Event | 検証後に実際に起きた変化 | 到着、配達失敗、食糧3生産、支払い40 |

BDI（Belief–Desire–Intention）は、認識・望み・採用した方針を分ける既存の枠組みである。[Rao & Georgeff 1995, AAAI](https://aaai.org/papers/icmas95-042-bdi-agents-from-theory-to-practice/)。本作への推論は、完全なBDI論理系を導入することではなく、この区別を軽量なデータ契約にすること。部分観測下の判断を厳密に扱う研究としてPOMDPがあるが、本作の1,000人を毎分厳密解法で解く提案ではない。[Kaelbling, Littman & Cassandra 1998](https://www.sciencedirect.com/science/article/pii/S000437029800023X)。

対人の約束には、誰が誰に何を負うかという社会的コミットメントの研究が近い。[Yolum & Singh, Commitment Machines](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/atal-01.pdf) は、約束の状態が行動で変わるプロトコルを扱う。達成型の約束（食糧を届ける）と維持型の約束（通行を許し続ける）を分ける研究もある。[Telang, Singh & Yorke-Smith 2021](https://ojs.aaai.org/index.php/AAAI/article/view/17355)。本作では `debtor / creditor / condition / due / evidence / status` 程度を初期核とし、内的な「自分との約束」を SocialCommitment に偽装しないのがよい。

役職・慣習・制度は個別約束だけに還元しきれない。制度文を行為主体、義務・許可、行為、条件、違反時の帰結などに分解する研究がある。[Crawford & Ostrom 1995, A Grammar of Institutions](https://www.cambridge.org/core/journals/american-political-science-review/article/grammar-of-institutions/7D37CD3BC5ED2D9FD57D2EE292958F47)。本作への推論は、文化・職務上の義務を別の `Norm/RoleDuty` として記述し、個人の動機と行動評価へ入力すること。最初から汎用法体系を実装する必要はない。

## 共通の処理経路の候補

```text
World の Event → 人物ごとの知覚・Belief 更新
  → Need/Goal/Norm/SocialCommitment から Motive を評価
  → 本人が知る行動候補を列挙し、権限・所在・資源を確認
  → 意図を選択し、必要なら Task に分解・委任
  → ActionProposal を提出
  → sim が真実を再検証し、時間・在庫・所有権を適用
  → 成功/失敗 Event → 関係者へ伝わった分だけ Belief 更新
  → Task と Commitment の進行・違反判定
```

この経路の「一般」とは、どの人物も同じ**入出力契約**を通ること。全ての効果を一つの自由記述スクリプトにすることではない。行動型ごとの効果は sim が実装し、型で検証する。`Command` は外部からの依頼・指示であり、本人が実行した `Action` や結果の `Event` と同一視しない。任命・命令が届いても、相手が拒否・遅延・交渉できる。

境界を検討するための**擬似型**（実装確定ではない）：

```ts
type Motive = {
  id: Id; ownerId: PersonId;
  source: { kind: "need" | "goal" | "norm" | "role" | "commitment"; refId: Id };
  desiredCondition: Condition; priority: number; evidenceIds: Id[];
};
type Task = {
  id: Id; assigneeId: PersonId; requestedById?: PersonId;
  goal: Condition; status: "offered" | "accepted" | "active" | "done" | "failed" | "refused";
  motiveIds: Id[]; parentTaskId?: Id; dueAt?: Minute;
};
type ActionProposal = {
  actorId: PersonId; kind: ActionKind; args: TypedArgs;
  taskId?: Id; motiveIds: Id[]; observedVersion: number;
};
interface DecisionPolicy {
  choose(observation: PersonalObservation, candidates: ActionCandidate[]): Decision;
}
```

`Motive.source` は「なぜ」を結び付ける参照で、約束の成立そのものではない。`priority` は空腹や信用などの変化から再計算する候補値で、固定の人格値ではない。`Condition` は少数の型付き述語から始め、任意コードや自由文を実行条件にしない。`Task.status` は仕事の進行、`SocialCommitment.status` は相手に対する義務の進行であり、片方の完了からもう片方の履行を**実世界のEventで**判定する。`DecisionPolicy` は本人の観測と候補だけを受け取る。sim の `ActionExecutor` のみが真実、所有権、時間、人物の位置を変更できる。

例：君主が家臣を呼びたいという動機から面談を依頼する。書記に招待状作成の Task が発生し、書記が作成 Action を行う。伝令に配送 Task が渡り、伝令が移動・配達 Action を行う。相手は受け取った情報と自分の動機から承諾を決める。到着と面談は別 Event で、約束が交わされた場合だけ SocialCommitment が新たに生じる。農民の労働も同じ経路に載せられるが、日常反復の候補選択は日次にまとめ、毎分1,000人のフル計画はしない。

計画を細かい仕事へ分ける際は HTN（階層的タスク分解）が参考になる。[Nau et al. 2003, SHOP2](https://www.cs.umd.edu/~nau/papers/nau2003shop2.pdf)。本作への推論は、「面談を実現する → 招待状作成 → 配送 → 承諾 → 同行移動 → 面談」のような少数の定義済み分解から始めること。任意の自然文から新しい効果を生やさない。

## 候補の比較

| 案 | 内容 | 得るもの | 主な費用・危険 |
|---|---|---|---|
| A. 共通Action/Taskだけ先に導入 | 現行の動機計算は維持し、書記・伝令・労働・面談の実行経路を統一 | 既存ゲームを壊しにくく、局所的に移行できる | 行動は共通でも「なぜするか」が場面固有のまま残る |
| B. 軽量BDI＋社会的約束＋Task分解 | Belief、Motive、Intention、SocialCommitment、Task、Action、Eventを別概念として接続 | 自分の必要と対人約束を同じ判断へ入力でき、LLM/NNの共通契約になる | 状態遷移・期限・委任失敗の設計と移行に手間がかかる |
| C. LLM/NN中心の自由行動生成 | モデルが計画文や行動列を主導し、世界が解釈する | 少人数の創発的な会話・計画の試作が速い | 大人数の再現性、所有権、行動の意味、評価が崩れやすい。社会シミュレーションとして何を再現したかも不明瞭になりうる |

**暫定推奨は B を目標に、A の薄い実行境界から段階移行すること。** C の表現力は、確定した行動語彙と観測契約を守る `DecisionPolicy` の一実装として後から試す。これは研究に基づく設計判断案で、論文が本作への最適解を証明したという意味ではない。

移行を検討するなら、(1) 現行90日シナリオ・セーブ・資産保存・因果Eventの基準を固定、(2) 書記・伝令・面談で `Task → Action → Event` を実証、(3) 農民と兵士の日常行動へ拡張、(4) 内的動機と対人約束を判断に接続、(5) 同じObservation/Candidate契約でルール・NN・LLMを比較、の順が考えられる。各段で「一つの指示で人手不足・拒否・遅延が実際の結果を変える」ことと、旧90日シナリオがなお遊べることを受入条件にする。順序は仮案であり、工数見積りではない。

[Generative Agents (Park et al. 2023)](https://arxiv.org/abs/2304.03442) は記憶検索・反省・計画による25人の町を示した。会話や招待の説得力には参考になるが、1,000人の所有権・徴兵・戦闘の保存則を保証する根拠にはならない。[Concordia (Vezhnevets et al. 2023)](https://deepmind.google/research/publications/64717/) も、エージェントの発話と環境側の妥当性判断を分ける。本作では環境側を既存の決定論的 sim に固定する案が適している。

## 将来の小さなローカルNNとLLM

共通インターフェースは「本人の Observation、候補、動機の根拠ID、現在の意図」から「候補IDまたは型付き ActionProposal、理由の根拠ID」を返すものにする。ルール、LLM、ローカルNNは交換可能な **候補の選択者** とし、資産移転・配達成功・約束履行の真偽は決めさせない。モデルの提案は適用時に再検証し、採用した提案・モデル版・入力の版・時刻を記録する。リプレイで推論を再実行しない。

小型NNの最初の研究案は、固定長の人物特徴と候補特徴を入力し、最大8候補を採点する共有モデルである。まずルールAIの選択を教師信号にして模倣し、予測一致率だけでなく90日後の飢餓、約束違反、軍務、異なる文化・seedでの行動差を測る。模倣学習は自分の選択が次の観測を変えるため、教師データの単純な分類精度では不足する。[Ross, Gordon & Bagnell 2011](https://proceedings.mlr.press/v15/ross11a)。多主体評価は既知の相手だけでなく、未知の相手・役割・協力と競争の混在で見る。[Melting Pot 2.0](https://arxiv.org/abs/2211.13746)。小型NNが複雑な社会的推論を必ず獲得するとは仮定しない。最初はルールを超えない可能性が高く、比較実験で判断する。

## 社会シミュレーションとして必要な評価

「面白い出来事が出る」と「社会過程を説明できる」は異なる。モデルの目的、個人・世帯・組織の変数、時間順序、学習、観測可能性、初期化、実験条件を明記し、複数seedで反証可能なパターンを調べる。[Grimm et al. 2020, ODD](https://www.jasss.org/23/2/7.html)。本作では少なくとも次を対照実験にする。

1. 同じ税でも文化・目的・信用を変えると、納税、伝令への返答、暴動前の不満が異なるか。
2. 同じ約束を履行・違反させた場合、情報の到着順を介して信用、徴兵、離反がどう変わるか。
3. 書記・伝令・食糧を不足させると、指揮の遅れが会戦・家計へ波及するか。
4. 文化や人員構成を変えても、通貨・在庫・人口・所有権・因果・リプレイの不変条件が保たれるか。
5. ルールAI、NN、LLMを同じ小世界へ入れたとき、未知の相手・seedでの判断、費用、失敗率がどう変わるか。

人口集計だけでなく、個人の動機→選択→実行→伝達→他者の反応を追えることが必要。ただし経済の全仕訳を個別Eventへ膨張させず、日次帳票と個人Activityの因果リンクを活用する。

## 方針決定前の論点

- 文化規範と役職上の義務を、長期動機と別エンティティにするか、評価時に導出するか。
- `SocialCommitment` は明示的に相手がいる約束から始めるか、役職義務まで同じ状態機械に載せるか。研究とゲーム性からは前者が安全。
- Task の受任は明示的承諾を常に要求するか、通常業務は黙示受任として拒否可能性だけ残すか。
- 日常労働は日次の一括解決、政治・通信はイベント駆動、戦闘は既存の時間刻み、という粒度を正式に採るか。
- 社会シミュレーションの第一の対象を、文化による協力、情報と指揮、約束による信用、どれに絞って検証するか。

ここを決めるまで、既存の `DESIGN.md` を正式に書き換えたり、実装の型を先行して固定したりしない。
