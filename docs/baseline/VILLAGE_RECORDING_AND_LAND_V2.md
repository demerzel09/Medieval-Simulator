# 5人世界の履歴・経路・土地の版2

更新: 2026-09-27。`autonomous_village` の世界セーブを `schemaVersion: 2`、リプレイ記録を `formatVersion: 2` とする。旧版のセーブを暗黙変換しない。版1の[90日結果](AUTONOMOUS_VILLAGE_RESULT.md)は比較基準として維持する。

## 行動履歴と再実行

各起床で、本人に届いた刺激IDと時刻、現地で見た状態、判断前の主観記憶、人格の応答、実際に選んだ試行を `decisions` に記録する。刺激到達、判断、作業開始・進捗・完了、拒否、現物と支払は原因ID付きEventとして残す。`villageActorHistory` は一人に関わるEventと判断入力を時系列に返す。画面は不要で、JSONを後から読める。

`VillageRecording` は初期fixture・地図・生態状態、seed、人物Command、地形変更Command、全判断応答、全Event、終了時の状態/Eventハッシュを保存する。`replayVillageRecording` は記録された人格応答を同じ入力のときだけ適用し、毎回Gatewayと物理法則を再実行する。入力や結果が分岐すると失敗する。`compareVillageRecordings` は初期条件と最初に違ったEventを示す。これは実行一致の検査であり、ハッシュを暗号学的な改ざん防止とみなさない。rule人格を再評価したい場合は同じfixtureで別に実行し、二つの記録を比較する。[通常90日の圧縮済み記録](../../fixtures/recordings/autonomous-village-90.v2.json.gz)をリポジトリに保存した。

```bash
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-90.v2.json.gz
npm run autonomy:village -- history fixtures/recordings/autonomous-village-90.v2.json.gz F /tmp/farmer-history.json
npm run autonomy:village -- 3 --record /tmp/village-normal.json.gz
npm run autonomy:village -- 3 --scenario carrier-refuses --record /tmp/village-refusal.json.gz
npm run autonomy:village -- compare /tmp/village-normal.json.gz /tmp/village-refusal.json.gz
```

CLIの対照は `low-capital`、`scarce-wood`、`late-information`、`carrier-refuses`、`cultivation`、`no-grass`、`rerouted-carrier`。最後の例は長い道、途中の通行止め、Cの行き先変更を記録する。`.json.gz` なら保存・読込時に圧縮する。版2の通常90日は約10秒、記録はJSON約12 MB・圧縮約0.8 MB・Event26,638件で、再実行に成功した。画面での再生はまだ付けていない。

## 矩形グリッドと途中変更

[A*探索の原論文](https://ieeexplore.ieee.org/abstract/document/4082128/authors)に基づく8近傍の決定的な経路探索を採用した。優先キューには二分ヒープを使い、斜め移動で塞がれた角を通り抜けず、地形セルの整数コストを扱う。版2の地図は5×5で、市場・森・家・畑・草地にセルを割り当てる。移動中は物体木の道中siteに本人と荷物を置き、現在セル、経路、次のセル、辺の進捗、体力費を作業状態に保存する。荷重とセル費用で各歩の時間と体力が決まる。

外部の地形Commandが次のセルを塞いだ場合、現在セルからA*で引き直す。道がなければその時刻は待ち、体力を使わず、地形変更または本人の行き先変更を待つ。移動中の `redirect_travel` Commandで別のsiteへ向かえる。辺の途中で方向を変えると、現在の確定セルから新しい経路を始める。既に使った時間と体力は戻らない。通行止め・行き先変更・道中保存・再実行を同じGatewayでテストした。現時点のセルは歩の完了時に更新する離散位置であり、セル内の連続座標や他者との衝突回避は扱わない。

## 土地に結び付いた植物と動物

森の野生ベリーは版1の食料資源と同じ日次再生量を持つ植物パッチとして記録し、版1の90日循環を保つ。畑の穀物は `bare → tilled → seeded → growing → ripe` を通り、本人が現地で耕し、所持する種を1使って播き、72時間の成長後に収穫する。収穫は食品5と次の種1を本人の袋に作り、食品ロットと種の保存則を検査する。Fには穀物の技能レベル1を持たせ、[穀物技能](../../packages/ai/farming-skill.ts)が現地で見えた段階から試行を提案する。技能のない人や遠方からの作業はGatewayが拒否する。

果樹は実を48時間周期で、野草と草は24時間周期で再生する。実・野草は人がそのパッチのsiteで採る。ウサギは毎日空腹になり、近隣2セル内で見つけた草と野草を経路探索で食べに行き、摂食と72時間後の幼体→成体をEventにする。動物の物体は現在セルのsiteに置き、移動で物体木の所在も原子的に更新する。植物の初期量・成長・人の収穫・動物の摂食はパッチごとに検算し、土地と動物の初期状態も記録へ保存する。

`cultivation` は穀物の生育・本人作業を確かめる4日程度の対照で、90日生活の正常fixtureではない。通常の90日取引は野生ベリーを用いる。畑作で5人の交易を90日支える仕事配分、種の種類、季節、動物の繁殖・死亡、複数の同時作物は次段の検証対象として残す。

次の実装順と受入条件は[土地の生産を90日の生活へつなぐ計画](LAND_ECONOMY_NEXT_PLAN.md)にまとめた。
