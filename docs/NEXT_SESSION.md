# 次の作業は階層モデル設計の実装契約の具体化

更新: 2026-10-04。最新のユーザー指定は、実装する前提で設計案の未検討部分を点検すること。[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)を作成し、12項目の不足と必要な契約を整理した。本体はv24のままで、階層モデル、統一した生存評価、上位の戦略学習は未実装。今回の対応案も未採用である。

## 再開時の入口

- 作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。`git status -sb`、`git log -3 --oneline`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。
- この文書と[STATUS](STATUS.md)で現在を確認し、[DESIGN](DESIGN.md)・[DECISIONS](DECISIONS.md)で境界と維持条件を読む。
- 今回は[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)、[分割案](foundations/HMOSAIC_MODULE_DESIGN.md)、[利得・経験更新案](foundations/HMOSAIC_VALUE_AND_FEEDBACK_DESIGN.md)、[人格の外側の契約](foundations/AUTONOMY_INTERFACE_CONTRACT.md)を読む。現行結果の根拠は[v24の結果](baseline/FOOD_ACQUISITION_V24_RESULT.md)と[実測JSON](../artifacts/v24-food-acquisition-result.json)。前版には[v23のB1分析](baseline/MORTALITY_V23_RESULT.md)、供給と取得の区別には[監査の原則](baseline/FOOD_SHORTAGE_AND_ACCESS_AUDIT.md)を使う。身体の変更・検証には[v22の実装](baseline/ENERGY_EFFORT_V22_RESULT.md)を追加する。全文書をまとめて読み込まない。

## 今回の設計検討と次の課題

設計の中心は、基本要素を引数で共用し、順モデル・逆モデル・評価・分析・学習を分離すること。適用できる子から未経験の行程を予測し、本人の目的による利得を比較する。順モデルの局所残差、親の接続・価値の誤差、逆モデルの目標未達と制御の変更、上下の事前・事後重みを別の信号として扱う。`FeedbackAnalyzer` は役割と観測から残差・波及・推定影響を分析する案であり、観測不足を確定した原因割合へ変換しない。交渉の対案・対話過程はv24にない。

今回の点検では、これらの責務の記述と実装できる計算契約の間に不足があると判定した。制御更新に適合度を任意に乗算すると、共有softmaxで実利得の高い案を減らす反例がある。利得補足は単一の最終方策に限定した対応案へ修正し、階層の寄与・選択分布からの導出は未決とした。現行の食品ledgerは取得で終了し、死亡後は本人の判断・配送が止まるため、吸収までの追跡と終端学習の方式も必要になる。

次は[レビューの順序](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md#実装へ移る順序と残る判断)で、まずR04・R05・R06・R10・R11の登録、行程・委譲状態、観測対応、保存JSON、計算予算を具体化する。その後、移動・時間・身体感覚を二つの親から共用する接続試作で局所更新・分析・保存再開を確認する。仮の目標評価を生存比較の実装と扱わない。

生活の選択へ進む前にR01・R02・R03の主観状態、生存比較、適合度・不確かさ、最終選択と制御学習・探索を確定する。続いてR08・R09の更新則とモデル内の構成変更を具体化し、R12の学習固定との対照・未経験の組合せ・複数条件の実走を測る。責務の型例を採用済みAPIとして移植したり、少数の条件別テストだけで適応を認定したりしない。

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
