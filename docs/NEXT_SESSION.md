# 次の作業は世界と人物の境界を食事の一経路で具体化する

## コンテキスト切替時の引き継ぎ

2026-10-24。直近の設計整理は `1799a93`、直近のコード変更は `6eaf3aa`。どちらもmainへpush済み。コンテキスト切替の準備としてこの節を追加した。新しい実装には着手していない。

- **現在の依頼**: 世界と判断主体としての人物を最上位に置き直す。人物も世界も物理的制約に従う。人物は身体を持つ世界内の存在であり、世界の外から状態を操作する存在ではない。
- **最も重要な訂正**: 既存実装の維持は不要。構造が合わなければ置換・統合・削除してよい。法則・既存記録と比較可能性は保ち、挙動変更を版で明示する。
- **読む順序**: README→NEXT_SESSION→STATUS→DESIGN→DECISIONS。その後、[世界と人物の設計](foundations/WORLD_AND_PERSON_DESIGN.md)、[コロニー系の比較](foundations/COLONY_SIM_ARCHITECTURE_REVIEW.md)を必要な順に読む。全文書を一括読込しない。
- **最初の返答**: 読んだ文書と、目的／最上位の二つ／物理と身体／知覚・記憶／行為と実結果／再利用と置換／検証と未達、の7点を短く日本語で要約する。以前のHMOSAIC内部の改修を、そのまま最優先として再開しない。
- **次の具体作業**: 食事の一経路について、実状態→感覚・観察→判断→試み→現物消費→遅延吸収→結果の記憶を、関数・保存項目・Eventへ対応づける。更新権限と情報の到達根拠を定め、必要な実装変更を選ぶ。`packages/sim/autonomous-world.ts`の`localView / attempt / advanceVillageWorld`、`packages/sim/effort-body.ts`、`packages/ai/personality.ts`が入口。
- **完了と未達**: 全体図・外部5作品の比較・現行コードの対応表は作成済み。外部実装はコード読解のみ。新しい最上位境界の実装・受入対照は未着手。v25の食品・睡眠の生活接続と生存改善も未達。既存回帰の成功を新設計の成立としない。
- **環境と許可**: リポジトリrootで作業、Node v22（確認時v22.16.0、`$HOME/.local/node/bin`でも利用可）。node_modulesがなければ`npm ci`。シェル・ファイル編集・テスト・記録再生が必要。mainへのcommit/pushの既存許可を継承し、終了時にNEXT_SESSION・STATUS・関係設計文書を更新する。

前回の検証はSTATUSに記録済み。`/tmp`のログや図の検証スクリプトは補助資料で、次のセッションでも存在することを前提にしない。今回の切替準備は文書リンク・差分のみを検査し、コードテストや記録再生は再実行しない。

## 既存の生活試作の状況

更新: 2026-10-24。v25初版でFが1日目13:45に疲労死する問題を、回復行程の欠落として修正した。最新は`travel-body-recovery@2`の別fixture／rulesetで、画面とCLIをv24と同じ90日へ延長した。生活上の挙動を調べる際は[修正と実測](baseline/HMOSAIC_RECOVERY_V25_RESULT.md)を確認する。24時間は5人とも生存したが、食品取得・食事は未接続のため28〜49.75時間で全員が栄養死する。**90日生存は未達**。旧v25の24時間記録と旧v24/v23/v22は保持している。

運用の正本は[運用契約](foundations/HMOSAIC_RUNTIME_CONTRACT.md)、計算法の主案は[形式仕様](foundations/HMOSAIC_FORMAL_SPEC.md)。今回の仮評価・経験平均は形式仕様の採用ではなく、生存比較・制御学習・構成学習は未実装。

## 最新の設計合意

ユーザーとの整理により、最上位は世界と判断主体である人間（人物）とする。人物の身体は世界に実在し、世界も人物も物理的制約に従う。HMOSAICは人物内部の判断方式である。[全体図と現行コードの対応](foundations/WORLD_AND_PERSON_DESIGN.md)と[外部実装の比較](foundations/COLONY_SIM_ARCHITECTURE_REVIEW.md)を追加した。ユーザー提示のMountaincoreとRust版COLONYも比較している。

**既存実装を保持する必要はない。** 法則・既存記録と比較可能性を保ち、責任の枠組みに合わないコードは置換・統合・削除してよい。今回の変更は設計・引き継ぎ文書だけで、再構成の実装や生活改善は行っていない。

次は、食事の一経路で実状態・感覚・記憶・試み・現物消費・遅延吸収・結果配送を関数／保存項目／Eventへ対応づけ、更新権限を決める。その結果から最小の実装変更を選ぶ。`localView`が遠隔の自己保管庫の現物数量を渡す仕様と、世界の進行が人格固有の組立てに依存する点を照合する。全面的な隔離や誤った情報漏れを既に実証したとはしない。詳細は全体設計の「具体的に残る照合点」を参照。

## 再開時の入口

- リポジトリrootで`git status -sb`、`git log -3 --oneline`、適用される`AGENTS.md`を確認する。Node v22（nvmまたは`$HOME/.local/node/bin`）、`node_modules`がなければ`npm ci`。
- READMEの順にこの文書→[STATUS](STATUS.md)→[DESIGN](DESIGN.md)→[DECISIONS](DECISIONS.md)を読み、今回必要な文書だけ追加する。全文書をまとめて読み込まない。
- v25を続けるときは結果文書とオブジェクト設計の「試作で具体化した境界」を確認し、変更する契約を運用契約・形式仕様で照合する。コードと文書が食い違えば記録も調べて文書を直す。

## 完了した範囲

VS Codeの「実行とデバッグ」で **試作: ブラウザ画面（v25・階層モデル）** を選びF5で起動する。`/?village=land-economy&wood=hierarchy`は改訂版90日、記録選択の「v25初版」／`&wood=hierarchy-legacy`は旧24時間の比較。**試作: 90日計測（v25・階層モデル）** は2160時間のCLI計測・判断再計算・保存再開・記録再生を実行する。[launch設定](../.vscode/launch.json)を参照。標準のv24画面も保持する。

`packages/ai/hierarchy/`に登録・結線検査、役割別モデル、行程合成、状態・追跡の所有者、判断単位のキャッシュ・予算、A結果対応の確定とB〜Dのロールバックを実装した。`travel-forward@1`・`body-forward@1`・`travel-control@1`・`compose@1`を回復・食品確保の二つの仮の親から共用する。第三の親の追加と予測／制御の独立した差し替えも対照に含む。評価器と選択器は別登録で、共通実行器は具体的な親名・モデルIDを分岐に使わない。

初版は別fixtureの`hierarchyModel`、ruleset `autonomous-village-hierarchy-v25`、`memory.hierarchy`で隔離した。世界法則・身体係数・物品・死亡条件・旧v24/v23/v22のfixture、判断経路、同梱記録は維持。7対照は独立した7テストで確認し、seed240924の24時間・109判断で再計算、12時間保存からの再開、新記録再生が一致した。これは移動と観察の接続試作で、食品取得→食事→吸収の自律生活実装ではない。吸収や避難後の再開には合成した証拠・状態操作による対照も用いた。

改訂版は`hierarchy-registry@2`、`travel-body-recovery@2`、ruleset `autonomous-village-hierarchy-recovery-v25`。その場の2時間休息と帰宅後の休息を行程として提案し、疲労変化の仮評価と区間ごとの予測枯渇の検査を加えた。待機を休息扱いする予測を修正し、共有JSONから可変状態を作る際の配列参照の共有も解消した。初版の全判断・hashを再現して保持する。行動の対照は別の5テストで、初版7対照とは区別した。

## 既存v25の実装と残課題

2026-10-24、[成果判定と状態更新の契約](foundations/HMOSAIC_GOAL_OUTCOME_CONTRACT.md)で行為・行程・成果・価値を分け、取得・食事・推定吸収、疲労回復・有効睡眠の証拠と未知の扱いを具体化した。**生活判断への接続、必要量・比較期間の具体値、形式仕様の採用は未完**。

今回実装したのは状態所有の改善。`ExecutionState`へ進行・期限・行程終了・採用／再開を集約し、読取は凍結した複写にした。目的／行程の改訂を照合し、`ModelStateStore.apply`は更新元改訂を必須とする。`DecisionHistory`へ判断・失敗記録を分離し、モデルへはsession本体を渡さず凍結した`Calls`窓口を渡す。[実装図](foundations/HMOSAIC_OBJECT_DESIGN.md#現在の抽象化と実装図)も更新した。

後続で`Definition.calls`の許可宣言、呼出し元を固定した窓口、モデル別の入力投影を実装した。許可はキャッシュ参照前に検査し、キャッシュキーには投影後入力を使う。入力codecは`input-projections.ts`へ分離した。追加6対照と既存記録の応答一致で検査する。所有者間の追跡変更と分析器の登録簿参照は残る。これらは人物内部の残課題であり、最上位の境界整理後に成果判定と食品・睡眠の証拠を別版へ接続する。今回の改修は正常な判断・保存状態を変えない内部再構成で、生活改善ではない。再検証の事実はSTATUSを参照する。

## 全体の境界整理後に進める生活接続

実装上の最優先の未達は**食品取得→食事→吸収の接続と、睡眠・回復を含む行程**。現在は食事0回で、90日表示はできても生活は持続しない。休息による疲労低下だけを適応成功としない。世界の栄養消耗や食品量を変えて帳尻を合わせない。

1. [成果判定の契約](foundations/HMOSAIC_GOAL_OUTCOME_CONTRACT.md)の観測条件を出発点に、必要量・判定器の登録・保存形を具体化する。実測JSONの局所予測・残差・未評価・予備応答を調べ、形式仕様を主案に、状態推定・依存の宣言・評価期間・未知・生存比較・最終選択の採用範囲と校正条件を具体化する。レビュー順序3の生活選択契約への準備であり、24時間の再現一致だけで計算法を採用しない。
2. 抽象化の不足を詰める。今回集約した実行状態操作・改訂照合を保ち、所有者間の追跡変更を依頼・通知へ分ける。実装した呼出し先の制限とモデル別入力投影を保ち、診断の登録簿参照と登録・役割別実装の分離を具体化する。新たな親をruntimeの条件分岐で処理しない。
3. 採用範囲を定めて、小さな食品取得→食事→吸収と回復・睡眠の行程を接続する。既存世界の語彙・法則を使い、成立する条件と枯渇・競合・遅延・高疲労で成立しない条件を実結果で確認する。二つの親から基本モデルを共用し、中断・避難・再開も本人の観測でつなぐ。
4. 接続7対照・再現性と、生活の実結果を別に判定する。対象テスト、10日間の全判断再計算・保存再開・Event投影から始め、必要な90日・複数条件へ進む。食事・吸収・疲労・欠食時間・死亡を報告し、既知の死亡を再現するテストの成功を生活成立としない。新仕様は構成／ruleset／記録の版で区別する。
5. R07の非線形・飽和・欠測を含む分析、R08の更新則・忘却・探索、R09のモデル内の子・引数・順序の変更を段階的に具体化する。未計測の親利得から教師を作らず、許可操作・再検査・版・旧状態保持と学習固定比較を定める。行程の再計画、開発者による構成変更、新たな条件別ifを適応成功としない。mainへのcommit/pushの既存許可は継承する。

未実行: R12の適応・一般化、学習固定との複数条件比較、全体テスト、コンテンツ検査、ブラウザテスト全体。今回の設計書のMermaid表示確認はSTATUSを参照。改訂版の10日・90日実走と対象検査はSTATUSに記録する。

```bash
npx vitest run tests/hierarchy-boundaries-v25.test.ts tests/hierarchy-ownership-v25.test.ts tests/hierarchy-recovery-v25.test.ts tests/hierarchy-v25.test.ts tests/food-acquisition-v24.test.ts tests/mortality-v23.test.ts tests/energy-effort-v22.test.ts tests/village-food-audit.test.ts
npm run typecheck
npm run autonomy:hierarchy -- 2160 --output /tmp/v25-connection.json --record /tmp/v25-connection.json.gz
npm run autonomy:hierarchy -- 24 --legacy
npm run autonomy:village -- replay /tmp/v25-connection.json.gz
```

## 比較基準v24の実装と問題

v24では本人が観察／記憶した採集、自分の保管食品、遠方の自己穀物庫からの取得→運搬→売却→食品購入、現金購入、未確認の探索を共同比較する。食品0〜1食でも売却候補を生成し、旧版の先行returnを改めた。有限の目的を保存し、到着後の現物・提示・競合と身体を再確認する。対応する本人の結果から活動疲労・販売・購入の見込みを更新する。採集先の枯渇で市場の再試行を止めない。

しかし通常条件の90日では穀物・パン売買が各0件。B1は5食、6日目23:15死亡で、旧v23の7食・7日目11:30から改善しない。Cも早く死亡する。Fは24食・25日目11:30まで延び、S・B2は生存する。全員の生活継続・持続経済は未達である。

B1はhour16／23／38にベリー、58／78に野草を食べ、以後65.25時間食品を摂れず死亡する。穀物は畑20・自宅4、現金0。hour32の穀物3単位行程は身体条件で除外されず、吸収まで14時間・成立見込み0.25・便益5.14／負担10.26で評価−5.13。覚えた野草地点の確認は8時間・評価1.44で選ばれた。候補消失の問題と、時間・成立見込み・価値や実際の供給不足を区別する。

[v24の供給監査](../artifacts/v24-food-availability-audit.json)の240時間では可食供給ゼロが15回（hour95〜109）。B1の低備蓄11判断には世界の食品が存在するが、現地の自己食品と吸収待ちは0。食品の存在を取得可能性へ読み替えない。v23の死亡規則により備蓄0の判断は保存されないので、枯渇を身体・死亡Eventで追う。

## v24を比較基準として調べる項目

以下は現行行程の監査・旧版の再現に必要な項目である。最新の階層設計を飛ばしてv24へ条件分岐を追加する作業順序ではない。

1. B1の判断と実際の供給・提示・他の本人の行動を照合する。未観察の世界状態は監査だけに使い、人格の正解へ渡さない。食品が存在するだけで取得可能だったとしない。
2. 市場行程を小さな成立・不成立対照で測る。穀物庫への往路、指定ロットの積載、荷重付きの運搬、提示、実際の買い手、加工と食品提示、購入・食事・吸収、売れない場合の保管・帰路を段階別に確認する。本人が知り得る見込みと実結果を対応させる。
3. 採集と探索を対照に残す。近場の採集が十分／既訪問先が枯渇／再生待ち／競合／市場の提示が実在／買い手不在／可食供給ゼロを区別する。未確認の探索が常に勝つ、あるいは全て負の評価で待機する場合を測る。単に売却優先へ逆転しない。
4. 時間・確率の見込み、初期方策の価値、身体の世界法則を分けて変更する。未達を身体消耗の低減、供給の増加、穀物の直接食事、現金からの栄養生成で隠さない。
5. 判断規則を変える場合は別fixture／ruleset／記録（v25は接続試作として使用済み。変更時は構成版と記録を区別）を作る。v24・v23・v22の同梱記録を保持する。最初の10日、全判断再計算・保存再開・Event投影を確認してから90日比較とリプレイを行う。食事間隔と最後の食事から死亡までの空白を別に報告する。
6. 対象テスト・必要なブラウザ・型検査を含むビルド、コンテンツ・文書リンク・差分を確認し、実行した範囲だけを文書へ記す。mainへのcommit/pushの既存許可は継承する。

## 維持する条件

本人の刺激・記憶・感覚、現物・所有・貨幣・容量、農夫は自分の畑だけ、穀物は非可食で腐敗なし、パンは2時間加工と3日の期限、栄養は2時間後に吸収、栄養と活動疲労の分離、身体15分／行動の再検討1時間を維持する。内部の体力0で死亡し、身体・位置・判断を固定して所有物を残す。技能・転職・薪・雇用・相続は食品経済の整合の後である。

## コードと再現

候補と有限の目的は[food-acquisition](../packages/ai/food-acquisition.ts)、接続は[effort-choice](../packages/ai/effort-choice.ts)と[learning-needs](../packages/ai/learning-needs.ts)。観察と現物取引は[世界](../packages/sim/autonomous-world.ts)、版は[fixture](../fixtures/land-economy-wide.ts)と[記録](../packages/sim/village-recording.ts)。[対照テスト](../tests/food-acquisition-v24.test.ts)、[行程監査CLI](../packages/tools/village-acquisition-audit.ts)、[供給監査CLI](../packages/tools/village-food-audit.ts)、[画面](../apps/web/village-debug.tsx)が検証の出発点。

F5の先頭「自律: デバッグ画面（最新 v24）」／`/?village=land-economy&wood=acquisition`が現行。v23は `&wood=mortality`、v22は `&wood=energy`。seed `240924`、90日は2160時間。

| 規則 | 同梱記録 | 状態hash / Event hash |
|---|---|---|
| v24 | [共同比較](../fixtures/recordings/autonomous-village-food-acquisition-90.v2.json.gz) | `c98d56bb` / `a9762281` |
| v23 | [死亡追加](../fixtures/recordings/autonomous-village-mortality-90.v2.json.gz) | `1a773125` / `80241c8f` |
| v22 | [死亡追加前](../fixtures/recordings/autonomous-village-energy-effort-90.v2.json.gz) | `bda36c39` / `d09d1515` |

```bash
# 再計測は同梱記録を上書きしない
npm run autonomy:village -- 90 --scenario land-food-acquisition --record /tmp/v24-check.json.gz
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-food-acquisition-90.v2.json.gz
npm run autonomy:village -- history fixtures/recordings/autonomous-village-food-acquisition-90.v2.json.gz B1 /tmp/b1-v24.json
npx tsx packages/tools/village-acquisition-audit.ts fixtures/recordings/autonomous-village-food-acquisition-90.v2.json.gz --output /tmp/v24-acquisition.json
npx tsx packages/tools/village-food-audit.ts fixtures/recordings/autonomous-village-food-acquisition-90.v2.json.gz --until-hour 240 --output /tmp/v24-supply.json
npx vitest run tests/food-acquisition-v24.test.ts tests/mortality-v23.test.ts tests/energy-effort-v22.test.ts tests/village-food-audit.test.ts
```

gzip＋共有JSONは `decodeVillageDocument(..., true)` で不変の読取として復元する。replayは保存判断による世界の検証なので、本人の判断は保存入力からの再計算でも確認する。確認済みの範囲と全体テストの結果は[STATUS](STATUS.md)へ集約する。
