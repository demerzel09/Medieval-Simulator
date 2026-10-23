# 次の作業は接続試作の計測を踏まえた計算法の採用判断

更新: 2026-10-23。[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)の順序2、移動・時間・身体感覚の小さな接続試作を別人格v25で実装した。目的・思想と責務の整理は[オブジェクト設計](foundations/HMOSAIC_OBJECT_DESIGN.md)、実装・計測と限定範囲は[v25の結果](baseline/HMOSAIC_CONNECTION_V25_RESULT.md)、検証範囲は[STATUS](STATUS.md)を参照する。標準の生活実装・画面はv24のまま。

運用の正本は[運用契約](foundations/HMOSAIC_RUNTIME_CONTRACT.md)、計算法の主案は[形式仕様](foundations/HMOSAIC_FORMAL_SPEC.md)。今回の仮評価・経験平均は形式仕様の採用ではなく、生存比較・制御学習・構成学習は未実装。

## 再開時の入口

- リポジトリrootで`git status -sb`、`git log -3 --oneline`、適用される`AGENTS.md`を確認する。Node v22（nvmまたは`$HOME/.local/node/bin`）、`node_modules`がなければ`npm ci`。
- READMEの順にこの文書→[STATUS](STATUS.md)→[DESIGN](DESIGN.md)→[DECISIONS](DECISIONS.md)を読み、今回必要な文書だけ追加する。全文書をまとめて読み込まない。
- v25を続けるときは結果文書とオブジェクト設計の「試作で具体化した境界」を確認し、変更する契約を運用契約・形式仕様で照合する。コードと文書が食い違えば記録も調べて文書を直す。

## 完了した範囲

VS Codeの「実行とデバッグ」で **試作: ブラウザ画面（v25・階層モデル）** を選びF5を押すと、`/?village=land-economy&wood=hierarchy`で同梱の24時間記録を表示できる。地図・身体・判断履歴と予測更新数を表示し、24時間で再生を止める。**試作: 24時間計測（v25・階層モデル）** はCLI計測と再現検証をターミナルで実行する別設定。[launch設定](../.vscode/launch.json)を参照。標準のブラウザ画面はv24を維持する。

`packages/ai/hierarchy/`に登録・結線検査、役割別モデル、行程合成、状態・追跡の所有者、判断単位のキャッシュ・予算、A結果対応の確定とB〜Dのロールバックを実装した。`travel-forward@1`・`body-forward@1`・`travel-control@1`・`compose@1`を回復・食品確保の二つの仮の親から共用する。第三の親の追加と予測／制御の独立した差し替えも対照に含む。評価器と選択器は別登録で、共通実行器は具体的な親名・モデルIDを分岐に使わない。

別fixtureの`hierarchyModel`、ruleset `autonomous-village-hierarchy-v25`、`memory.hierarchy`で隔離した。世界法則・身体係数・物品・死亡条件・旧v24/v23/v22のfixture、判断経路、同梱記録は維持。7対照は独立した7テストで確認し、seed240924の24時間・109判断で再計算、12時間保存からの再開、新記録再生が一致した。これは移動と観察の接続試作で、食品取得→食事→吸収の自律生活実装ではない。吸収や避難後の再開には合成した証拠・状態操作による対照も用いた。

## 次に行うこと

1. 実測JSONの局所予測・残差・未評価・予備応答を調べ、形式仕様の状態推定、依存の宣言、評価期間、区間優越と第二基準、参照モデル付き適合度、選択分布の採用範囲と校正条件を決める。24時間の再現一致だけで計算法を採用しない。
2. R07の非線形・飽和・欠測を含む親固有の分析、R08の更新則・忘却・探索を具体化する。到着完了と数値的な親利得を分け、未計測の利得へ教師を作らない。現在の制御／寄与フィードバックは保存だけで、制御更新なし、寄与は`unknown`。
3. R09の経験によるモデル内の子・引数・順序の変更を、許可された操作と再検査・版・旧状態の保持で設計する。登録定義の変更や行程の再計画を構成学習の成功としない。
4. 採用判断後にレビュー順序3の生活選択へ進む。食品・回復の親を具体化し、取得から吸収までと中断・避難・再開を本人の観測から自律的につなぐ。初期ruleの条件別ifを増やして適応成功と認定しない。
5. 生活実装の比較は、対象テスト、10日間の全判断再計算・保存再開・Event投影から始め、必要な90日・複数条件・学習固定対照へ進む。新仕様は構成／ruleset／記録の版で区別する。mainへのcommit/pushの既存許可は継承する。

未実行: v25の10日・90日生活比較、R12の適応・一般化、全体テスト、コンテンツ検査、ブラウザテスト全体、Mermaid表示確認。ブラウザ接続時の本番ビルドと対象ブラウザ検査を含め、実行範囲はSTATUSに記録する。

```bash
npx vitest run tests/hierarchy-v25.test.ts tests/food-acquisition-v24.test.ts tests/mortality-v23.test.ts tests/energy-effort-v22.test.ts tests/village-food-audit.test.ts
npm run typecheck
npm run autonomy:hierarchy -- 24 --output /tmp/v25-connection.json --record /tmp/v25-connection.json.gz
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
