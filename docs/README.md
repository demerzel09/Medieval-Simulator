# 文書案内

`docs/` 直下は現在の正本です。実装時は [設計基準](DESIGN.md)、[採用中の判断](DECISIONS.md)、[実測と未達](STATUS.md) を最初に確認してください。[次セッション](NEXT_SESSION.md)は再開用の要約で、実装後に更新します。旧版の指示より、現行コードと実測・本表を優先します。

| 場所 | 内容 | 扱い |
|---|---|---|
| [baseline](baseline/) | 現在の個人経済・生活市場の結果、食料生態の拡張順、M3試遊記録票 | 実装と照合する現在の実験資料 |
| [foundations](foundations/) | 人格、認識、ルーティン、物体、行動・動力、元の企画思想 | 長期の設計原則または未実装の設計案。実装済みとは限らない |
| [archive](archive/) | 古いインターフェース、E0/E1/A3の契約・監査、時系列STATUS/DECISIONS、初版企画の複製 | 判断の経緯と回帰資料。古い「次の作業」は現行指示ではない |

買主B1/B2の薪仕事と所得は人物間の因果で成立しました。[生活市場](baseline/LIVING_MARKET_EXPERIMENT.md)の90日結果はなお生活の安定に失敗し、中央給付や帳尻合わせで成功扱いしません。未実装の境界は[STATUS](STATUS.md)に記録します。

次の実装区切りは[自律する90日生活世界への実装計画](baseline/AUTONOMOUS_90_DAY_PLAN.md)にまとめています。
段階0の[5人の収支・時間の実行可能性](baseline/AUTONOMOUS_90_DAY_FEASIBILITY.md)は算術上の条件で、実際の自律simの90日結果ではありません。

段階1〜4の実行・対照は[5人の自律生活世界](baseline/AUTONOMOUS_VILLAGE_RESULT.md)に記録しています。
[履歴・経路・土地の版2](baseline/VILLAGE_RECORDING_AND_LAND_V2.md)は、その後の記録再生、矩形グリッド、植物・動物の実装範囲と対照を説明します。
