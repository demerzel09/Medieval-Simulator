# 文書の入口と読む範囲

更新: 2026-10-04。新しいチャットでは、文書全体をまとめて読み込まず、今回の課題に必要な正本と実測を読む。

## 再開時に使う正本

| 順序 | 文書 | 確認すること |
|---|---|---|
| 1 | [NEXT_SESSION](NEXT_SESSION.md) | 今回の課題、確認済みの原因、次の実装範囲、コードと検証方法 |
| 2 | [STATUS](STATUS.md) | 現在の版、実装済み、実測、未達、最後に確認した検証範囲 |
| 3 | [DESIGN](DESIGN.md) | 自律・世界・時計・制度の境界と開発の目的 |
| 4 | [DECISIONS](DECISIONS.md) | 食品・身体・死亡・所有・経験更新など、維持する具体的条件 |

今回の課題は、HMOSAIC的な階層設計を実装する前提で、未検討の部分と現行コードとの接続を点検することである。[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)に12項目の不足、制御更新式の反例、必要な契約と実装順序をまとめた。本体はv24のままで、設計の採用や階層学習の実装は行っていない。

[HMOSAICを参考にした分割案](foundations/HMOSAIC_MODULE_DESIGN.md)にコードの対応、入出力、移行案をまとめた。共用・上下のフィードバックの責務を示す案であり、必要な契約が全て確定した実装仕様ではない。

未経験の行程を既知の子から評価し、実利得と予測の差を各層へ戻す方法は、[利得予測と経験更新の補足](foundations/HMOSAIC_VALUE_AND_FEEDBACK_DESIGN.md)にまとめた。親の目的による評価、部分適用、誤差と学習の割当てを今回の設計の中心として読む。

比較基準を調べる場合は、[共同比較v24](baseline/FOOD_ACQUISITION_V24_RESULT.md)、[B1の分析と死亡v23](baseline/MORTALITY_V23_RESULT.md)、[供給と取得の監査](baseline/FOOD_SHORTAGE_AND_ACCESS_AUDIT.md)を追加で読む。栄養・活動疲労のコードを変更・検証するときは[v22の実装](baseline/ENERGY_EFFORT_V22_RESULT.md)も参照する。

ユーザーの最新の指定を優先する。設計文書は採用する境界・条件、STATUSは確認した事実、NEXT_SESSIONは直近の作業を記す。食い違いがあれば現行コードと記録を照合して文書を更新する。古い記録の数値・「次の作業」を現在へ読み替えない。

## 必要時にだけ参照する資料

| 場所 | 資料の役割 | 読むとき |
|---|---|---|
| [baselineの案内](baseline/README.md) | 現行結果、前版の対照、研究に基づく設計、将来計画、旧実験の版別結果 | 対象機能の根拠・測定・回帰を調べるとき。各文書の区分を確認する |
| [foundationsの案内](foundations/README.md) | 人格契約、物体モデル、研究、長期設計・初版企画 | 境界や理論を詳しく検討するとき。設計案は実装の証明ではない |
| [archiveの案内](archive/README.md) | 過去の正本・引き継ぎ・監査と別系列の経緯 | 変更理由や旧実験を調べるとき。通常の再開では読まない |

## 整理と更新のルール

- DESIGNは原則、DECISIONSは現行条件、STATUSは現在の結果、NEXT_SESSIONは次の課題に絞る。作業経過は版別結果かarchiveへ保存する。
- baselineの文書には現行実測／前版の対照／継承した設計／将来計画／旧段階／別系列の区分を付ける。後続実装の達成度はSTATUSで確認する。
- 現行の正本へ旧版の「最新」「次」を積み重ねない。版別文書は記録された時点の証拠として保ち、実験結果そのものを書き換えない。
- 文書の削除や大量の移動で過去の参照を壊さず、既存の版別文書のパスを維持する。変更時はローカルリンクと差分を検査する。

今回の整理前の正本は[旧DESIGN](archive/DESIGN_HISTORY_2026-10-03.md)、[旧DECISIONS](archive/DECISIONS_HISTORY_2026-10-03.md)、[旧STATUS](archive/STATUS_HISTORY_2026-10-03.md)、[旧文書案内](archive/README_HISTORY_2026-10-03.md)に保存した。
