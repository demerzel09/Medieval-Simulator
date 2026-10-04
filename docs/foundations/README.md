# 基盤設計・研究の参照範囲

ここは人格・物体・作用の契約、研究の参考、長期設計・初版企画を保存する場所。設計書に機能があることは実装の証明ではない。現在の実装は [STATUS](../STATUS.md)、採用条件は [DECISIONS](../DECISIONS.md)、直近の作業は [NEXT_SESSION](../NEXT_SESSION.md) で確認する。

| 目的 | 文書 |
|---|---|
| 人格の外側の境界・認識・行動の契約 | [AUTONOMY_INTERFACE_CONTRACT](AUTONOMY_INTERFACE_CONTRACT.md)、[AGENT_INTERFACES_v2](AGENT_INTERFACES_v2.md) |
| 現行ruleの階層モデルへの分割と共用を検討する | [HMOSAIC_MODULE_DESIGN](HMOSAIC_MODULE_DESIGN.md)。2026-10-04のコード調査と未採用の設計案。予測と制御の独立、基本要素の共用、入出力、利得・学習の不足 |
| 未経験の行程を既知の子から評価し、各層へ誤差を戻す | [HMOSAIC_VALUE_AND_FEEDBACK_DESIGN](HMOSAIC_VALUE_AND_FEEDBACK_DESIGN.md)。2026-10-04の未採用の補足案。部分適用、利得予測と実結果の差、親子の学習接続、BPとの関係、更新則の候補 |
| 設計案を実装する前の不足と計算上の問題を確認する | [HMOSAIC_IMPLEMENTATION_READINESS_REVIEW](HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)。2026-10-04のレビュー。12項目の不足、制御更新の反例、観測・死亡・保存との接続、必要な契約と実装順序 |
| 物の所在・所有・包含・容量 | [PHYSICAL_OBJECT_MODEL](PHYSICAL_OBJECT_MODEL.md) |
| 動機・行動の理論を調べる | [RESEARCH_MOTIVATION_ACTION](RESEARCH_MOTIVATION_ACTION.md) |
| 将来の作用・実行・能力・動力・物流 | [ACTION_PROCESS_DESIGN](ACTION_PROCESS_DESIGN.md)、[ACTOR_EXECUTION_DESIGN](ACTOR_EXECUTION_DESIGN.md)、[CAPABILITY_AGENTS_DESIGN](CAPABILITY_AGENTS_DESIGN.md)、[WORK_ENERGY_DESIGN](WORK_ENERGY_DESIGN.md)、[COMMON_LOGISTICS_DESIGN](COMMON_LOGISTICS_DESIGN.md) |
| 生活の慣行・ルーティンの構想 | [SOCIAL_PRACTICES](SOCIAL_PRACTICES.md)、[DAILY_LIFE_ROUTINES](DAILY_LIFE_ROUTINES.md)、[DATA_DRIVEN_ROUTINES](DATA_DRIVEN_ROUTINES.md) |
| 初版の企画・成立経緯 | [ORIGINAL_GAME_DESIGN](ORIGINAL_GAME_DESIGN.md)、[concept-original](concept-original.md) |

再開時は今回のコードや境界に必要な文書だけを読む。初版企画の政治・軍事・UIの受入や、汎用ActionProcess等の将来設計を、現行食品経済の次の作業へ自動的に追加しない。
