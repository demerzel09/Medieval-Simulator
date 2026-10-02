# 文書案内

`docs/` 直下は現在の正本です。実装時は [設計基準](DESIGN.md)、[採用中の判断](DECISIONS.md)、[実測と未達](STATUS.md) を最初に確認してください。[次セッション](NEXT_SESSION.md)は再開用の要約で、実装後に更新します。旧版の指示より、現行コードと実測・本表を優先します。

| 場所 | 内容 | 扱い |
|---|---|---|
| [baseline](baseline/) | 現在の個人経済・生活市場の結果、食料生態の拡張順、M3試遊記録票 | 実装と照合する現在の実験資料 |
| [foundations](foundations/) | 人格、認識、ルーティン、物体、行動・動力、元の企画思想 | 長期の設計原則または未実装の設計案。実装済みとは限らない |
| [archive](archive/) | 古いインターフェース、E0/E1/A3の契約・監査、時系列STATUS/DECISIONS、初版企画の複製 | 判断の経緯と回帰資料。古い「次の作業」は現行指示ではない |

買主B1/B2の薪仕事と所得は人物間の因果で成立しました。[生活市場](baseline/LIVING_MARKET_EXPERIMENT.md)の90日結果はなお生活の安定に失敗し、中央給付や帳尻合わせで成功扱いしません。未実装の境界は[STATUS](STATUS.md)に記録します。

現在の実装順は[穀物・パン、技能獲得と職選択](baseline/FOOD_ECONOMY_SKILLS_PLAN.md)にまとめています。直近の実装設計は[状況別の予測モデルと快・不快による行動選択](baseline/MODULAR_PREDICTION_AND_ACTION_PLAN.md)。予測と実結果の対応、小モデルの競合、短い行動列、食品経済との統合の順で進める。移動の対応記録は[v13](baseline/PREDICTION_LEDGER_V13_RESULT.md)で実装済み、モデル競合以降は未実装。判断・身体モデルの基礎設計は[身体・環境の欲求から行動を選ぶ計画](baseline/NEEDS_AND_ACTION_SELECTION_PLAN.md)を参照してください。[土地の生産を90日の生活へつなぐ計画](baseline/LAND_ECONOMY_NEXT_PLAN.md)は完了済みの旧段階です。[自律する90日生活世界への旧計画](baseline/AUTONOMOUS_90_DAY_PLAN.md)の段階0〜4は完了済みで、[5人の収支・時間の実行可能性](baseline/AUTONOMOUS_90_DAY_FEASIBILITY.md)は当時の算術条件、[5人の自律生活世界](baseline/AUTONOMOUS_VILLAGE_RESULT.md)は実行・対照の結果です。[履歴・経路・土地の版2](baseline/VILLAGE_RECORDING_AND_LAND_V2.md)は、その後の記録再生、矩形グリッド、植物・動物の実装範囲を説明します。

土地経済計画の順1〜4は完了しました。[90日収支の算術候補](baseline/LAND_ECONOMY_FEASIBILITY_V1.md)と[5人・90日の実走と対照](baseline/LAND_ECONOMY_V3_RESULT.md)を分けて記録しています。次の候補と未達は[STATUS](STATUS.md)を参照してください。

画面と世界が同じセルを使い、生活拠点を地図に分散した現在の実装は[1280×768の全域版](baseline/WIDE_WORLD_V5_RESULT.md)から始まった。現在の画面は[穀物・パン市場v14](baseline/FOOD_MARKET_V14_RESULT.md)を標準表示する。農夫は穀物を売ってパンを買い、初期製パン技能を持つSが市場で加工する。v12の自宅加工は比較用の旧記録として残す。気温と睡眠不足、経験と予測の初期実装を追加し、判断の根拠も確認できる。穀物は直接食べられず、家・市場へ保存後に加工し、パンには製造日基準の腐敗期限を設けた。[食用植物の局所探索](baseline/PLANT_EXPLORATION_RESULT.md)と[生育周期・畑の休止・分散採集](baseline/ECOLOGICAL_LAND_V6_RESULT.md)、所有畑・現地作業も引き継ぐ。中央に集中した旧[空間版](baseline/SPATIAL_GRID_V4_RESULT.md)と旧5×5土地経済は再現用の別規則・記録として残しています。
