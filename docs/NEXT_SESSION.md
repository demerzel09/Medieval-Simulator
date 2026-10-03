# 次のチャット：採集と穀物売却→パン購入の判断を改善する

更新: 2026-10-03。ユーザーはこの課題を新しいチャットで進め、コンテキストを一新したい。今回は引き継ぎ整理だけを行い、判断の改修にはまだ着手していない。

## 再開時の入口

- 作業ディレクトリ：`/home/demerzel/workspace/Medieval-Simulator`。実装の基点はmainの `ed56a57`（死亡v23、origin/mainへ反映済み）。引き継ぎ整理のcommitがこの後に加わる。まず `git status -sb`、`git log -3 --oneline`、適用される `AGENTS.md` を確認する。
- Nodeが見つからない場合：`export PATH="$HOME/.local/node/bin:$PATH"`。
- 最初にこの文書と[B1の切替条件・死亡v23の結果](baseline/MORTALITY_V23_RESULT.md)を読む。[食料供給と取得の監査](baseline/FOOD_SHORTAGE_AND_ACCESS_AUDIT.md)も原因判定に使う。原則は[DESIGN](DESIGN.md)と[DECISIONS](DECISIONS.md)。研究・遅延報酬の設計を詳しく確認する場合は[栄養と努力の設計](baseline/ENERGY_EFFORT_AND_DELAYED_REWARD_DESIGN.md)。
- 以前の長い引き継ぎは[履歴](archive/NEXT_SESSION_HISTORY_2026-10-03.md)へ保存した。通常の再開では読み込まなくてよい。旧版の「最新」「次の作業」は現行指示ではない。

## 次の目的と確認済みの原因

**本人が知る採集、穀物売却後のパン取得、既存現金での食品購入を同じ候補群で検討し、食料が少ないことだけで売却・購入の候補が消える判断を改善する。** 現在の不快、取得・摂食・吸収までの時間、労働負担、成立見込み、未成立時の代替を扱う。

現在の `effortDecision` は上から条件を調べ、最初に選べた行動を返す。**可食の手持ち2食未満の採集・探索が、穀物売却の新規検討より先に返る。** 食料が減ると、余剰穀物と資金不足があっても売却を検討しにくい。積載量1〜5単位の売却行程比較はあるが、採集との共同比較はない。売却開始には食品持参などの条件があり、別地点の所有畑へ取りに行く条件は食品2食以上・8〜13時・疲労0.35未満などでさらに狭い。

市場で買うには購入可能な有効な提示を現地で観察する必要がある。事前の行程評価では購入時間を仮定し、パン取得の成立を十分予測していない。市場を食品探索の行先にもしていない。詳細な優先順・条件は上記のv23文書に保存済み。

| B1の時点 | 実際の行動 |
|---|---|
| hour35 | 穀物3単位を価格2でSへ売却 |
| hour40 | パン1単位を価格1で購入 |
| hour43〜44 | 疲労回復を優先し、次の販売提示を撤回して市場の自分の庫へ保管 |
| hour48以後 | 現金1、未加工穀物21を残し、食品が減ると採集・探索を優先 |
| 7日目11:30 | v23では栄養・体力が0となり死亡 |

穀物21は携帯中ではなく畑14・自宅4・市場3。売却には保管品の取得・運搬と買い手の成立が必要。取引機能自体が未実装という問題ではない。[実測と判断抜粋](../artifacts/v23-mortality-result.json)を基準にする。

## 維持する設計と実装範囲

1. 判断には観察・到達した刺激・本人の記憶と感覚を使う。他人の在庫、未観察の提示、未来の供給、栄養備蓄の実量を正解として渡さない。過去の市場情報や探索先は記憶／未確認の見込みとして扱う。
2. 穀物は直接食べられず腐敗しない。パンは加工が必要で製造から3日で腐敗する。野草・ベリーは直接食べられる。代金を直接栄養へ変換しない。農夫は自分の畑だけを作業する。
3. 栄養の吸収には2時間必要。生活・活動・荷重支持で消費し、休息は栄養を生成しない。栄養と活動疲労は別状態で、体力は派生する活動余力。身体は15分、作業・移動の判断と中断は1時間の区切り。係数変更を判断改善と混ぜない。
4. 現在の不快、目的に伴う有限の我慢、対応する経験からの見込み更新を維持する。このrule人格の候補比較を改善し、他の人格実装まで同じ採点式に固定しない。ランダムな行動選択で問題を隠さない。
5. **内部の体力0で死亡するv23の指定を維持する。** 画面の丸めた0で判定しない。疲労による0も対象。死亡時刻・原因Event・身体・位置を保存し、作業・睡眠・販売を止める。死者の身体と判断は固定し、所有物を保持する。生存者・生態・食品腐敗は進む。相続・遺品取得・死体劣化は未実装。
6. 供給不足、加工・取引の停滞、本人の取得・摂食の見逃しを区別する。因果と帳簿が整合する不足・死亡は有効な結果。全員の90日生存を保証する供給増加や消耗低減を入れない。持続生活の未達は別に報告する。
7. 判断規則を変える場合は別fixture／ruleset／記録（次版は仮にv24）を作り、v23と旧v22の圧縮記録を上書きしない。まず小さな食品経済の整合を確立し、その後に技能獲得・需要に応じた職の切替を進める。今回、技能・転職・薪・雇用は追加しない。

## 次の作業順序と検証

1. B1の記録とコードを照合し、候補が消える分岐、既存の予測・経験更新を確認する。売買・死亡の既存実装を最初から作り直さない。
2. 採集／保管穀物の取得→運搬→売却→食品取得／現金購入の候補生成と比較を設計する。取得・摂食・吸収までの時刻、負担、期限、競合、提示と買い手の成立見込み、未成立時の代替と帰路を明示する。「食品2食必須」を外すだけで成功としない。単に売却優先へ逆転して採集を封じない。
3. 有限の目的を維持しつつ、実行中も実際の食品・提示・身体を再確認する。売却成功、購入、時間切れ、疲労／避難による撤回を区別し、対応した本人の経験で見込みを更新する。
4. 意味のある対照を作る：採集先は枯渇しているが市場の食品行程が成立する場合、既存現金で直接買える場合、採集が小さい負担で足りる場合、パン提示／買い手がいない場合、可食供給自体がゼロの場合。候補の除外理由、選択・取得・摂食、所有と貨幣の保存、死亡後の停止を確認する。
5. 候補・選択理由・見込み・実結果を記録し、既存の行動ログで追跡できるようにする。まず最初の10日と保存再開・判断再計算を確認し、その後90日の新旧比較・リプレイへ進む。B1の食事時刻と間隔、栄養推移、売買・未成立理由、死亡を報告する。食品の存在だけで本人が取得できたと判断しない。
6. 対象テスト、必要なブラウザ確認、型検査を含むビルドと文書を更新する。全体テスト・90日・ブラウザを実行したか明記し、確認した範囲だけを報告する。mainへのcommit/pushの既存許可は継承する。

## 主なコードと検証の出発点

| ファイル | 用途 |
|---|---|
| [effort-choice](../packages/ai/effort-choice.ts) | 現行の優先順、積載量比較、疲労・取引の本人の記憶 |
| [learning-needs](../packages/ai/learning-needs.ts)、[food-planning](../packages/ai/food-planning.ts)、[food-journeys](../packages/ai/food-journeys.ts) | 判断の接続、食品行程・期限・競合と目的。旧版へ単純に戻さない |
| [世界](../packages/sim/autonomous-world.ts)、[身体](../packages/sim/effort-body.ts) | 現地観察、現物取引、身体・死亡・保存則 |
| [fixture](../fixtures/land-economy-wide.ts)、[記録](../packages/sim/village-recording.ts)、[CLI](../packages/tools/autonomous-village.ts) | 版と記録生成・再実行 |
| [画面](../apps/web/village-debug.tsx)、[Event投影](../apps/web/village-status-replay.ts) | 判断候補・履歴、死亡と身体・在庫の表示 |
| [死亡テスト](../tests/mortality-v23.test.ts)、[v22テスト](../tests/energy-effort-v22.test.ts)、[食料監査テスト](../tests/village-food-audit.test.ts) | 回帰・対照の出発点 |

v23で確認済み：死亡6/6、既存v22 8/8、対象ブラウザ2/2、新旧90日記録の再実行、240時間の判断再計算・保存再開・身体と在庫のEvent投影、本番ビルド・コンテンツ・文書リンク・起動設定・差分。全体の `npm test` は未実行。今回の引き継ぎ整理ではシミュレーションを再計測しない。

## 起動と再現

F5の先頭「自律: デバッグ画面（最新 v23）」／`/?village=land-economy&wood=mortality` が現行。旧v22は `&wood=energy`。seed `240924`、90日は2160時間。

| 規則 | 同梱90日記録 | 状態hash / Event hash |
|---|---|---|
| v23 | [死亡あり](../fixtures/recordings/autonomous-village-mortality-90.v2.json.gz) | `1a773125` / `80241c8f` |
| v22 | [死亡追加前](../fixtures/recordings/autonomous-village-energy-effort-90.v2.json.gz) | `bda36c39` / `d09d1515` |

v23は91443 Event。B1は7日目11:30、Cは8日目10:30、Fは8日目20:45に栄養0で死亡し、S・B2は90日終了時に生存。全員の食事継続・経済持続は未達。v22の最初の240時間では可食供給ゼロが42回、hour145には未加工穀物107が残る。[供給監査JSON](../artifacts/v22-food-availability-audit.json)も比較の基準。

```bash
# 現行の再計測／保存（同梱記録を上書きしない）
npm run autonomy:village -- 90 --scenario land-mortality --record /tmp/v23-check.json.gz
# 保存済みの全判断入力・全Event・状態の再実行照合
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-mortality-90.v2.json.gz
# B1の全履歴
npm run autonomy:village -- history fixtures/recordings/autonomous-village-mortality-90.v2.json.gz B1 /tmp/b1-history.json
# 旧v22の供給と取得を区別する接頭部分の監査
npx tsx packages/tools/village-food-audit.ts fixtures/recordings/autonomous-village-energy-effort-90.v2.json.gz --until-hour 240 --output /tmp/v22-food-audit.json
# 変更時の対象回帰。新しい判断の対照テストは別途追加する
npx vitest run tests/mortality-v23.test.ts tests/energy-effort-v22.test.ts tests/village-food-audit.test.ts
```

記録はgzip＋共有JSON形式。直接使う場合は `decodeVillageDocument(..., true)` で不変の読取として復元する。CLIの `replay` は保存判断を使うため、新人格の判断自体の検証には、保存入力から本人の応答を再計算する確認も必要。
