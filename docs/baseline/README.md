# 実装結果・監査・設計資料の案内

現在の正本は [STATUS](../STATUS.md) と [DECISIONS](../DECISIONS.md)、次の作業は [NEXT_SESSION](../NEXT_SESSION.md)。このディレクトリには版別の証拠と設計を保存している。全資料を現在の仕様として読み込まない。

## 現行の課題と必要時の参考

| 文書 | 区分 | 参照する内容 |
|---|---|---|
| [MORTALITY_V23_RESULT](MORTALITY_V23_RESULT.md) | 現行v23の実装・実測 | 死亡とB1の判断。今回の改修の出発点 |
| [FOOD_SHORTAGE_AND_ACCESS_AUDIT](FOOD_SHORTAGE_AND_ACCESS_AUDIT.md) | 評価原則と前版v22の監査 | 供給不足／取得・摂食の問題を分ける。数値はv22の測定 |
| [ENERGY_EFFORT_V22_RESULT](ENERGY_EFFORT_V22_RESULT.md) | 前版v22の実装・比較基準 | 栄養・活動疲労はv23へ継承。行動と90日の数値はv22 |
| [ENERGY_EFFORT_AND_DELAYED_REWARD_DESIGN](ENERGY_EFFORT_AND_DELAYED_REWARD_DESIGN.md) | 研究と設計、一部実装済み | v20当時の説明とv22以降の設計を区別。実装済みはSTATUS |
| [MODULAR_PREDICTION_AND_ACTION_PLAN](MODULAR_PREDICTION_AND_ACTION_PLAN.md) | 継続する設計、一部実装済み | 状況別小モデルと予測・結果の対応。全面的なモデル競合・行動評価は未完了 |
| [FOOD_ECONOMY_SKILLS_PLAN](FOOD_ECONOMY_SKILLS_PLAN.md) | 将来の実装順序 | 食品経済の整合を先に確立し、その後に技能獲得・職選択 |
| [SLEEP_AND_FATIGUE_BODY_MODEL](SLEEP_AND_FATIGUE_BODY_MODEL.md) | 睡眠の設計を継承、旧身体の説明を含む | 睡眠履歴・圧・昼夜は継承。体力から疲労を作る記述は旧v20 |
| [NEEDS_AND_ACTION_SELECTION_PLAN](NEEDS_AND_ACTION_SELECTION_PLAN.md) | 初版の設計と継承する原則 | v12以降に実装が進んだ。現在の係数・未達・次の作業はSTATUSとNEXT_SESSION |
| [AVERSION_AND_EFFORT_ACTION_DESIGN](AVERSION_AND_EFFORT_ACTION_DESIGN.md) | 前版v20の監査・研究・設計 | Fの未売却往復の分析。提示整合と身体の後続実装はv21/v22 |
| [PLAYTEST](PLAYTEST.md) | 別系列：本編M3の未実施の人間試遊 | 自律生活v23の判断改善とは別の受入 |

今回のB1の改修は、まずMORTALITY_V23_RESULTとFOOD_SHORTAGE_AND_ACCESS_AUDITから読む。身体の詳細や研究を検討するときに他の資料を追加する。前版の記録と現在へ継承した法則を区別し、設計書の未実装項目はSTATUSで照合する。

## 旧版・旧段階

以下は過去の実走・対照・計画として保存する。古い結果の数値や手順を現在へ読み替えず、旧記録の再現・変更理由を調べる場合に参照する。本文冒頭にも区分を付け、既存のリンクとファイルパスを維持した。

| 文書 | 扱い |
|---|---|
| [欲求・経験と予防行動 v12](ANTICIPATORY_NEEDS_V12_RESULT.md) | 旧版・旧段階 |
| [5人の90日生活: 実行可能性の数表](AUTONOMOUS_90_DAY_FEASIBILITY.md) | 旧版・旧段階 |
| [自律する90日生活世界への実装計画](AUTONOMOUS_90_DAY_PLAN.md) | 旧版・旧段階 |
| [5人の自律生活世界: 実行結果](AUTONOMOUS_VILLAGE_RESULT.md) | 旧版・旧段階 |
| [穀物保存・パン加工 v11](BREAD_STORAGE_V11_RESULT.md) | 旧版・旧段階 |
| [穀物の収量・保管と荷重による運搬 v16](BULK_TRANSPORT_V16_RESULT.md) | 旧版・旧段階 |
| [生育周期・土地休止・分散採集の90日実走](ECOLOGICAL_LAND_V6_RESULT.md) | 旧版・旧段階 |
| [食事の実時計・目的を持つ運搬・行動経験 v17](EXPERIENCE_LEARNING_V17_RESULT.md) | 旧版・旧段階 |
| [食料・仕事契約・空間資源の拡張順](FOOD_ECOLOGY_AND_MARKET_PLAN.md) | 旧版・旧段階 |
| [農作業の目的・市場の再訪・パン購入 v18](FOOD_JOURNEYS_V18_RESULT.md) | 旧版・旧段階 |
| [穀物売却・市場製パン・パン購入 v14](FOOD_MARKET_V14_RESULT.md) | 旧版・旧段階 |
| [食料の需要・期限・採集競合と短い行程比較 v19](FOOD_PLANNING_V19_RESULT.md) | 旧版・旧段階 |
| [人物のステータスと自宅保管 v15](HOME_STORAGE_V15_RESULT.md) | 旧版・旧段階 |
| [個人を経由する経済の独立実験](INDIVIDUAL_ECONOMY_IMPLEMENTATION.md) | 旧版・旧段階 |
| [土地経済90日の実行可能性 — 算術候補版1](LAND_ECONOMY_FEASIBILITY_V1.md) | 旧版・旧段階 |
| [版2以降の実装計画 — 土地の生産を90日の生活へつなぐ](LAND_ECONOMY_NEXT_PLAN.md) | 旧版・旧段階 |
| [土地経済の実走結果 — 5人・90日](LAND_ECONOMY_V3_RESULT.md) | 旧版・旧段階 |
| [食事と個人備蓄を伴う市場の小実験](LIVING_MARKET_EXPERIMENT.md) | 旧版・旧段階 |
| [植物セルで採集する移動・待機の修正](LOCAL_WORK_V10_RESULT.md) | 旧版・旧段階 |
| [所有農夫の畑と腐敗しない穀物](OWNED_FARMS_V8_RESULT.md) | 旧版・旧段階 |
| [食用植物の局所探索と往復採集](PLANT_EXPLORATION_RESULT.md) | 旧版・旧段階 |
| [移動の事前予測と実結果の対応 v13](PREDICTION_LEDGER_V13_RESULT.md) | 旧版・旧段階 |
| [睡眠・眠気・活動疲労 v20：実装と実測](SLEEP_REGULATION_V20_RESULT.md) | 旧版・旧段階 |
| [1280×768のセル地図 — 土地経済の空間版](SPATIAL_GRID_V4_RESULT.md) | 旧版・旧段階 |
| [自律村の不自然な行動と経験学習の改善計画](V16_BEHAVIOR_AUDIT_AND_LEARNING_PLAN.md) | 旧版・旧段階 |
| [5人世界の履歴・経路・土地の版2](VILLAGE_RECORDING_AND_LAND_V2.md) | 旧版・旧段階 |
| [地図全域を使う土地経済](WIDE_WORLD_V5_RESULT.md) | 旧版・旧段階 |
| [自分で食べる野生食品と余剰の市場売買](WILD_FOOD_MARKET_V9_RESULT.md) | 旧版・旧段階 |
| [薪停止の対照と森での待機の原因](WOOD_PAUSED_V7_RESULT.md) | 旧版・旧段階 |
