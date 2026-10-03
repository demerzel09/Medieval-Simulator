# 文書案内

`docs/` 直下は現在の正本です。実装時は [設計基準](DESIGN.md)、[採用中の判断](DECISIONS.md)、[実測と未達](STATUS.md) を最初に確認してください。[次セッション](NEXT_SESSION.md)は再開用の要約で、実装後に更新します。旧版の指示より、現行コードと実測・本表を優先します。

直近のFの分析と次の設計は[不快の解消・荷重・我慢による行動選択](baseline/AVERSION_AND_EFFORT_ACTION_DESIGN.md)。90日の未売却往復をEventで確認し、販売提示3に対して現物2になる不整合を特定した。身体の消耗と現在の重さの不快、快・安堵、目的のために耐える理由を分け、研究・OSSの参考と実装の順序を記載する。監査済みであり、新しい感覚や選択方式は未実装。

| 場所 | 内容 | 扱い |
|---|---|---|
| [baseline](baseline/) | 現在の個人経済・生活市場の結果、食料生態の拡張順、M3試遊記録票 | 実装と照合する現在の実験資料 |
| [foundations](foundations/) | 人格、認識、ルーティン、物体、行動・動力、元の企画思想 | 長期の設計原則または未実装の設計案。実装済みとは限らない |
| [archive](archive/) | 古いインターフェース、E0/E1/A3の契約・監査、時系列STATUS/DECISIONS、初版企画の複製 | 判断の経緯と回帰資料。古い「次の作業」は現行指示ではない |

買主B1/B2の薪仕事と所得は人物間の因果で成立しました。[生活市場](baseline/LIVING_MARKET_EXPERIMENT.md)の90日結果はなお生活の安定に失敗し、中央給付や帳尻合わせで成功扱いしません。未実装の境界は[STATUS](STATUS.md)に記録します。

現在の実装順は[穀物・パン、技能獲得と職選択](baseline/FOOD_ECONOMY_SKILLS_PLAN.md)にまとめています。直近の実装設計は[状況別の予測モデルと快・不快による行動選択](baseline/MODULAR_PREDICTION_AND_ACTION_PLAN.md)。予測と実結果の対応、小モデルの競合、短い行動列、食品経済との統合の順で進める。移動の対応記録は[v13](baseline/PREDICTION_LEDGER_V13_RESULT.md)で実装済み、[v17](baseline/EXPERIENCE_LEARNING_V17_RESULT.md)で体力モデルの誤差比較と短い採集目的を初実装した。[v18](baseline/FOOD_JOURNEYS_V18_RESULT.md)で農作業・市場訪問の目的を保持し、[v19](baseline/FOOD_PLANNING_V19_RESULT.md)で食品の期限・採集競合・睡眠・帰路を含む限定した行程比較を追加した。理論上の参考と現行コードの対応は予測モデル設計の「理論・設計・現行コードの対応」に記載。統合した快不快の行動評価と技能・職選択は後続。判断・身体モデルの基礎設計は[身体・環境の欲求から行動を選ぶ計画](baseline/NEEDS_AND_ACTION_SELECTION_PLAN.md)を参照してください。[土地の生産を90日の生活へつなぐ計画](baseline/LAND_ECONOMY_NEXT_PLAN.md)は完了済みの旧段階です。[自律する90日生活世界への旧計画](baseline/AUTONOMOUS_90_DAY_PLAN.md)の段階0〜4は完了済みで、[5人の収支・時間の実行可能性](baseline/AUTONOMOUS_90_DAY_FEASIBILITY.md)は当時の算術条件、[5人の自律生活世界](baseline/AUTONOMOUS_VILLAGE_RESULT.md)は実行・対照の結果です。[履歴・経路・土地の版2](baseline/VILLAGE_RECORDING_AND_LAND_V2.md)は、その後の記録再生、矩形グリッド、植物・動物の実装範囲を説明します。

土地経済計画の順1〜4は完了しました。[90日収支の算術候補](baseline/LAND_ECONOMY_FEASIBILITY_V1.md)と[5人・90日の実走と対照](baseline/LAND_ECONOMY_V3_RESULT.md)を分けて記録しています。次の候補と未達は[STATUS](STATUS.md)を参照してください。

睡眠不足が増えやすい指摘を受け、次の身体設計を[睡眠・眠気・活動疲労の身体モデル](baseline/SLEEP_AND_FATIGUE_BODY_MODEL.md)へまとめた。24時間に6時間の睡眠、睡眠圧、昼夜のリズム、強い活動疲労からの眠気を分け、入眠待ち・実睡眠・自然起床・中断を扱う。[v20の実装と検証](baseline/SLEEP_REGULATION_V20_RESULT.md)で身体単体→Processと保存→本人の見込み→90日比較まで実装した。旧v19は比較基準として残す。

画面と世界が同じセルを使い、生活拠点を地図に分散した現在の実装は[1280×768の全域版](baseline/WIDE_WORLD_V5_RESULT.md)から始まった。現在の画面は[睡眠・疲労v20](baseline/SLEEP_REGULATION_V20_RESULT.md)を標準表示する。旧[食品の需要・期限と行程比較v19](baseline/FOOD_PLANNING_V19_RESULT.md)は `&wood=plan` で比較できる。人物履歴で、観察・記憶・未確認を区別した候補と選択の見込みを確認できる。旧v18は `&wood=journey`、旧v17は `&wood=learn` で比較する。ステータスで、初期・経験の見込みと対応した実結果を確認できる。旧[穀物・荷重運搬v16](baseline/BULK_TRANSPORT_V16_RESULT.md)は比較用に残す。身体・快不快と携帯・家・市場・畑の所持金、物品の数量・重量・期限を確認できる。播種1→収穫20を畑で保管し、重さに応じ歩行が遅く体力消費が増す運搬を表示する。農夫は穀物を売ってパンを買い、初期製パン技能を持つSが市場で加工する。v12の自宅加工は比較用の旧記録として残す。気温と睡眠不足、経験と予測の初期実装を追加し、判断の根拠も確認できる。穀物は直接食べられず、家・市場へ保存後に加工し、パンには製造日基準の腐敗期限を設けた。[食用植物の局所探索](baseline/PLANT_EXPLORATION_RESULT.md)と[生育周期・畑の休止・分散採集](baseline/ECOLOGICAL_LAND_V6_RESULT.md)、所有畑・現地作業も引き継ぐ。中央に集中した旧[空間版](baseline/SPATIAL_GRID_V4_RESULT.md)と旧5×5土地経済は再現用の別規則・記録として残しています。


現在の不自然な動きと次の修正は、[v16の行動監査と経験学習の改善計画](baseline/V16_BEHAVIOR_AUDIT_AND_LEARNING_PLAN.md)を参照。ログの具体例、食事時刻の不一致、積み戻し、疲労・採集・販売・腐敗の原因と汎用学習への実装順を整理した。

監査後の初版は[v17の実装と実測](baseline/EXPERIENCE_LEARNING_V17_RESULT.md)、直近の修正と未達は[v19の実装と実測](baseline/FOOD_PLANNING_V19_RESULT.md)を参照してください。
