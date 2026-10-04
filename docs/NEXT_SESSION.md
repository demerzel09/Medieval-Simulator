# 次の作業は階層モデルへの分割案の具体化

更新: 2026-10-04。最新のユーザー指定は、基本要素モデルを共用し、予測と行動制御を分け、HMOSAIC的な階層として現行ruleを構成できるか検討・設計・文書化すること。[分割案](foundations/HMOSAIC_MODULE_DESIGN.md)を作成した。本体はv24のままであり、階層モデル、統一した生存評価、上位の戦略学習は未実装。設計案は未採用で、直ちに旧優先順位を分割移植する指示ではない。

## 再開時の入口

- 作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。`git status -sb`、`git log -3 --oneline`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。
- この文書と[STATUS](STATUS.md)で現在を確認し、[DESIGN](DESIGN.md)・[DECISIONS](DECISIONS.md)で境界と維持条件を読む。
- 今回は[分割案](foundations/HMOSAIC_MODULE_DESIGN.md)と[人格の外側の契約](foundations/AUTONOMY_INTERFACE_CONTRACT.md)を読む。現行結果の根拠は[v24の結果](baseline/FOOD_ACQUISITION_V24_RESULT.md)と[実測JSON](../artifacts/v24-food-acquisition-result.json)。前版には[v23のB1分析](baseline/MORTALITY_V23_RESULT.md)、供給と取得の区別には[監査の原則](baseline/FOOD_SHORTAGE_AND_ACCESS_AUDIT.md)を使う。身体の変更・検証には[v22の実装](baseline/ENERGY_EFFORT_V22_RESULT.md)を追加する。全文書をまとめて読み込まない。

## 今回の設計検討と次の課題

予測・制御・利得・適合度を区別し、移動、取引、探索、身体、所持品、加工、栽培へ現行コードを対応づけた。基本要素は引数を変えて複数の上位戦略から利用する。管理上の階層と、共通モデルへの参照・データの接続は分ける。交渉の対案・対話過程はv24にない。局所ifは初期制御の材料だが、全体のreturn順、候補生成と評価の混在、選択後の置換は再設計対象である。

次は、本人の情報だけを使う身体・栄養の経過予測、生存を優先する評価契約、上位の数量・順序・子の選択の具体的な更新則、接続の型・単位・条件分岐と予算を詰める。移動の予測と制御を独立させ、二つの親から共用し、複数の出力を統合する接続試作が最初の候補である。旧記録との比較と新しい構成の検証は分ける。単に売却優先のifを追加したり、少数の状況別テストだけで適応を認定したりしない。

順モデルへ返す予測誤差と、逆モデルへ返す目標の達成誤差・制御修正を分ける。上位からの事前重み、下位からの事後重み、上位の寄与遷移予測も接続試作の対象とする。行為中の観察による再検討を含め、逆モデルの学習は誤差の配送だけでなく、引数・次の案が経験で変わる更新として具体化する。更新則はまだ未採用である。

未経験の制御を試す方針は従来の案で未具体化だったため、分割案へ探索の要求を追加した。MOSAIC原型のフィードバック補正による逆モデル学習と、MMRLの確率的な行動探索を区別する。本プロジェクトでは、基本行為の引数・子の組合せを変える試行に、調べる不明点・更新先・費用・期限・中断条件を持たせる案である。食品の探索と汎用的な制御の探索は別。情報価値と生存の比較、試行機会、制御の具体的な更新則は未採用・未実装で、誤差の返送と合わせて詰める。

[利得予測と経験更新の補足](foundations/HMOSAIC_VALUE_AND_FEEDBACK_DESIGN.md)を設計の中心として読む。最新の要求は、未経験の行程でも適用できる子の予測を共用し、親が目的に照らして利得を計算し、予測と実利得の差を各層へ戻す構成を検討すること。子の効果と親の接続・相互作用の未知を区別し、利得予測の誤差と価値のTD誤差を混同しない。局所予測、親の構成、価値と制御の更新則の候補まで補足したが未採用・未実装。次は本人の評価基準・期間、適用範囲・不確かさ、親子の学習接続と最終的な選択確率を契約へ具体化する。完成行程の固定一覧や、全失敗を全ての子へ配る方式へ戻さない。

局所誤差の返送に加えて、各親へ接続する `FeedbackAnalyzer` の案を補足した。役割・計測対象を登録し、子自身の条件付き残差、上流の入力の違いからの波及、親の利得への推定影響と共同の影響を分析して、根拠付きで更新先を提案する。観測した実入力による診断を行動前の予測と混同せず、未確定を任意の比率へ配分しない。分析器の責務は今回明記したもので、未採用・未実装である。

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
