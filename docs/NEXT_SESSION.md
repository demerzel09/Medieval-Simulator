# 次の作業は運用契約に沿った接続試作

更新: 2026-10-06。最新のユーザー指定は、[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)の実装順序に沿って、まずR04・R05・R06・R10・R11の実装契約を設計・文書化すること。[運用契約](foundations/HMOSAIC_RUNTIME_CONTRACT.md)を作成し、登録簿、入出力の型、行程グラフと将来状態の合成、目的・行程・委譲・意図の状態機械、観測の対応と追跡台帳、死亡の扱い、保存JSONと乱数、計算予算と失敗時の応答について、採用する仕様と未決事項を明示した。続けて[形式仕様](foundations/HMOSAIC_FORMAL_SPEC.md)を作成し、予測・適合度・評価・行動決定をR01・R02・R03の主案として数式で定義し、代替・未決と「式にすると残る問題」を列挙した。本体はv24のままで、階層モデル、統一した生存評価、上位の戦略学習は未実装。契約の型例はstrict型検査、形式仕様の式は数値の検算で整合を確認したが、新構成の実行・学習・生活改善は行っていない。

## 再開時の入口

- 作業ディレクトリはリポジトリのroot。`git status -sb`、`git log -3 --oneline`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `$HOME/.local/node/bin` かnvmのPATHを通し、`node_modules` が無ければ `npm ci` を実行する。
- この文書と[STATUS](STATUS.md)で現在を確認し、[DESIGN](DESIGN.md)・[DECISIONS](DECISIONS.md)で境界と維持条件を読む。
- 今回は[運用契約](foundations/HMOSAIC_RUNTIME_CONTRACT.md)を運用の正、[形式仕様](foundations/HMOSAIC_FORMAL_SPEC.md)を計算の主案とし、[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)で不足の判定と完了条件、[分割案](foundations/HMOSAIC_MODULE_DESIGN.md)と[利得・経験更新案](foundations/HMOSAIC_VALUE_AND_FEEDBACK_DESIGN.md)で方針、[人格の外側の契約](foundations/AUTONOMY_INTERFACE_CONTRACT.md)で境界を読む。現行結果の根拠は[v24の結果](baseline/FOOD_ACQUISITION_V24_RESULT.md)と[実測JSON](../artifacts/v24-food-acquisition-result.json)。前版には[v23のB1分析](baseline/MORTALITY_V23_RESULT.md)、供給と取得の区別には[監査の原則](baseline/FOOD_SHORTAGE_AND_ACCESS_AUDIT.md)を使う。身体の変更・検証には[v22の実装](baseline/ENERGY_EFFORT_V22_RESULT.md)を追加する。全文書をまとめて読み込まない。

## 今回の設計検討と次の課題

運用契約で採用したのは次の点である。登録簿はコードの定義・構成表で、版を不変にし、読込時に単位・観測予測・投影・循環を検査する。身体の感覚量を出す出力ポートは合成からだけ結線でき、時間経過は合成だけが進める。推定は点・範囲・分岐・未知の四形で、未知を0や失敗へ変換しない。行程は委譲・試行・観察の三種のノードと条件辺・有限ループで表し、資源の重複消費・現金の負・身体占有の衝突を違反コードで返す。目的・行程版・委譲・意図を分け、中断・数量変更・親の切替・外部指示でどの実結果をどこへ返すかを表で定めた。追跡台帳は実行状態が閉じた後も吸収などの遅延結果を待ち、終了理由を六つに分け、期限後の結果は `late` として学習しない。死亡は本人が観測できない終端として、死亡前の信号から学ぶ方式を採用した。新状態は `memory.hierarchy` に置き、新ruleset（仮にv25）のfixtureフラグで旧記録と分ける。乱数は人物ごとに持ち、選択だけが消費する。予算は壁時計を使わない個数で、結果対応→計画→選択→応答の四段階のうち結果対応を確定単位にし、以後の失敗は予備の制御で応答する。

運用契約で未決として残したのは、生存比較（R01）、適合度と事前・事後重み（R02）、最終選択の分布と更新式（R03）、分析器の確率出力・非線形な影響（R07）、更新則・忘却・探索（R08）、構成定義の学習による変更手順（R09）、検証計画の合否（R12）。加えて、食事・購入の結果刺激にロットIDが無いため吸収の同一性を所持差分で推定する点（世界側の配送項目の追加が候補）、予算の仮の値、終端の学習専用処理である。

形式仕様はこのうちR01・R02・R03を主案として数式で定めた。順モデルは適用域付きのクレダル集合（点・範囲・分岐・未知）で、宣言した依存だけで因数分解し、宣言のない組はフレシェ境界を使う。適合度は参照モデル付きの事後確率で、全モデルの外れを `λ_∅` で測り、順モデルの寄与付き更新を混合尤度の勾配として導いた。評価は生存・累積の不快・期間末の備蓄の基準ベクトルで、生存は区間優越で候補を絞り、残りはHurwiczの代表値の重み付き和で比べる。行動決定は最大集合の上のsoftmaxで、予測 `V_2` と学習する調整 `φ_w` を分け、基準価値付きの方策勾配で更新する。寄与を使うなら混合方策から導いた事後寄与に限り、レビューR03の反例が起きないことを数値で確認した。TDは累積の不快にだけ使い、生存は本人が死亡を観測しないためモデルベースに限る。B1のhour32を記録の入力と仮のパラメータで再計算し、売却と野草確認の選択が楽観度 `α` で反転することを示した。残る未決は `H, α, β, 重み, σ_0, π_∅, ρ, ε_λ, n_min` の校正、依存の宣言の学習、方策差の補正、危機時の期間短縮、状態推定の特徴選択で、「式にすると残る問題」として形式仕様の第6節に列挙した。

次は[レビューの順序](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md#実装へ移る順序と残る判断)の2として、運用契約に沿った接続試作を作る。`travel-forward@1`・`body-forward@1`・`travel-control@1`・`compose@1` を登録し、回復と食品確保の二つの仮の親から共用する。確認する対照は[運用契約の試作対照](foundations/HMOSAIC_RUNTIME_CONTRACT.md#接続試作で確認する対照)の7項目で、結線検査、行程の違反検出、一度だけの合成と学習、状態機械の配送先、追跡と終了理由、保存再開・判断再計算・旧記録の再生、予算の打切りと予備の経路を別のテストで確認する。別人格・別ruleset・別fixtureで作り、v24・v23・v22の記録と本体の判断経路は変更しない。仮の目標評価を生存比較の実装と扱わない。

試作の後、形式仕様の主案（状態推定の特徴、区間優越と第二基準、参照モデル付きの適合度、二段階の方策と更新）を試作の計測で確認し、採用を確定してから生活の選択へ進む。パラメータの仮の値を結果を見て変えた場合は、その条件を学習・調整側へ記録する。続いてR08・R09の更新則とモデル内の構成変更を具体化し、R12の学習固定との対照・未経験の組合せ・複数条件の実走を測る。責務の型例を採用済みAPIとして移植したり、少数の条件別テストだけで適応を認定したりしない。

## 実装済みと現在の問題

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
5. 判断規則を変える場合は別fixture／ruleset／記録（次版は仮にv25）を作る。v24・v23・v22の同梱記録を保持する。最初の10日、全判断再計算・保存再開・Event投影を確認してから90日比較とリプレイを行う。食事間隔と最後の食事から死亡までの空白を別に報告する。
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
