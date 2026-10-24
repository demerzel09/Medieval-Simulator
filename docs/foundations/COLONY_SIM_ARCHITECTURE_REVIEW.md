# コロニー系実装から学ぶ世界と人物の境界

調査日: 2026-10-24。区分: 外部ソースの限定的な読解。実行・ビルド・テストはしていない。各作品の機能全体や物理的整合性を合格と判定した資料ではない。[世界と判断主体としての人物](WORLD_AND_PERSON_DESIGN.md)の境界を考える材料とする。既存の中世シミュレーター実装を維持するための調査ではなく、より適切な構成へ置き換える判断にも使う。

## 比較する三つの問い

1. 人物は何を知れるか。世界の実状態と、本人の観測・記憶が分かれているか。
2. 判断の処理は何を変更できるか。意図と記憶だけか、食品・所在・身体の実状態にも直接触れるか。
3. 行為の成立をどこで検査するか。対象・距離・数量・身体・時間・競合を、判断方式から独立して検査できるか。

クラス、部品、ECS、GOAPという方式名だけでは、この三問に答えられない。目的は他作品の全構造の移植ではなく、責任と更新権限を追うことである。

## Mountaincore

ユーザーが示した[GamingOnLinuxの記事](https://www.gamingonlinux.com/2025/04/colony-building-sim-mountaincore-is-now-free-to-play-and-open-source/)から[公式リポジトリ](https://github.com/rossturner/mountaincore)を確認した。以下のリンクは調査対象commit `08afcf6d276f0d4a75c14bf34e02d169a4322ea8` に固定する。

- [Entity](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/model/Entity.java)は物理・位置・行動の部品を持つ。同じ実体に物理的な面と行動の面を組み合わせる構造は、今回の人物像を考える参考になる。
- [CreatureBehaviour](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/behaviour/creature/CreatureBehaviour.java)は`GameContext`を持ち、目標の選択・進行に加え`NeedsComponent.update`も呼ぶ。行動処理に渡る情報が本人の観測だけに限定された構造ではない。
- [AssignedGoal](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/ai/goap/AssignedGoal.java)は複数Actionの状態を保持し、必要の低下による中断も扱う。行程の進行を保持する例として読める。
- [ConsumeFoodAction](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/ai/goap/actions/nourishment/ConsumeFoodAction.java)は食品割当ての有無と経過時間を確認し、食品数量を減らして必要値を回復させる。割当て・時間・中断を持つ実例である一方、AIのActionが実状態の変更まで担う。世界への試みを返すだけの契約ではない。

**参考にする部分**は、物理・位置・行動の合成と、継続する行程の状態管理。今回の枠組みに取り込むなら、身体時計と物理結果の更新を世界の責任として分ける必要がある。食事前の全経路・競合時の原子性・知覚範囲は未監査であり、この一ファイルから作品全体の欠陥とは断定しない。

## Rust版COLONY

ユーザーが示した[作者のReddit投稿](https://www.reddit.com/r/rust/comments/14p1fiw/opensourcing_my_rust_game_a_colony_simulator_game/)は[ryankopf/colony](https://github.com/ryankopf/colony)を指す。以下はcommit `e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba`。

- [components.rs](https://github.com/ryankopf/colony/blob/e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba/src/components.rs)で`Brain`・`PhysicalBody`・`Position`等をBevyの部品として分ける。身体を持つ主体を合成する小さな実例になる。
- [thinking_system.rs](https://github.com/ryankopf/colony/blob/e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba/src/thinking_system.rs)は身体の必要を参照して動機・Taskを選ぶ。ただしQueryの型はBrainだけでなくPhysicalBodyへの可変アクセスも許す。
- [eat.rs](https://github.com/ryankopf/colony/blob/e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba/src/task_system/eat.rs)はQueryで食品を探索し、近い食品を目標にして経路を設定する。隣接した目標食品を食べると、身体の食料必要値を上限まで回復し、食品Entityを削除し、動機も更新する。探索・選択・物理的消費・身体効果・認知更新が同じSystemにある。この食品Queryに本人の可視範囲による制限はない。

**参考にする部分**は、小さな部品構成と動機から行為への流れを追いやすいこと。ECSにしただけで責任境界が成立するわけではないことも分かる。今回なら、食品の知識、食べる試み、現物の消費、身体効果、結果の記憶を別の責任に置く。Redditのコメントにも食事処理の責務分割の議論があるが、他作品の内部構造に関するコメントの推測を設計根拠には使わない。

## 先に確認した三作品との比較

以下は今回の会話で確認した既定ブランチのコード。リンク先が将来更新される可能性がある。限定読解であり、知覚の隔離・物理的保存則の全面的な検証はしていない。

| 作品 | 確認したコード | 今回の参考と限界 |
|---|---|---|
| Mars Simulation Project | [Person](https://github.com/mars-sim/mars-sim/blob/master/mars-sim-core/src/main/java/com/mars_sim/core/person/Person.java)、[Mind](https://github.com/mars-sim/mars-sim/blob/master/mars-sim-core/src/main/java/com/mars_sim/core/person/ai/Mind.java)、[PhysicalCondition](https://github.com/mars-sim/mars-sim/blob/master/mars-sim-core/src/main/java/com/mars_sim/core/person/PhysicalCondition.java) | PersonにMindと身体状態を持たせ、身体が生命維持の供給を受けて不足を検査する。人物の二つの面の参考になる。ただしMindはPersonを参照し、身体の状態値にもアクセスするので、感覚だけを受け取る境界が保証されたとはしない |
| KeeperRL | [Controller](https://github.com/miki151/keeperrl/blob/master/controller.h)、[CreatureAction](https://github.com/miki151/keeperrl/blob/master/creature_action.h)、[Creatureの行為](https://github.com/miki151/keeperrl/blob/master/creature.cpp) | 判断のControllerとCreatureの行為を分け、移動で身体条件・移動可否・時間を扱う。行為と判断の接点の参考になる。ただしControllerはCreatureの参照を持ち、CreatureActionは実行関数を包む。厳格な要求DTOと世界専用更新APIの実装例とは異なる |
| DwarfCorp | [CreatureAI](https://github.com/Blecki/dwarfcorp/blob/master/DwarfCorp/Components/AI/CreatureAI.cs)、[Creature](https://github.com/Blecki/dwarfcorp/blob/master/DwarfCorp/Components/AI/Creature.cs)、[Physics](https://github.com/Blecki/dwarfcorp/blob/master/DwarfCorp/Components/Physics/Physics.cs) | 判断・生物・質量や衝突の部品構成の参考になる。ただしCreatureAIはWorldの食品量を参照し、身体・物理の部品にもアクセスできる。本人が知る範囲だけの判断へそのまま採用できるものではない |

## このプロジェクトで採用する考え方

最上位は世界と判断主体としての人物とし、身体は世界内に実在する同じ人物の面として扱う。上記の部品構成はこの関係を表す候補になるが、クラス名やファイル数をそのまま移植しない。

境界は「本人に届く情報→判断→行為の試み→世界が実結果を確定→結果が本人へ届く」とする。身体の実状態を持つことと、それを判断処理が自由に書き換えられることは別である。継続する行程と世界で進む作業も区別する。判断側の学習や再計画で物理の制約を変更しない。

参考の優先度は、**Mountaincoreで同一実体の部品構成、Mars Simで身体と判断、KeeperRLで行為成立の接点を読む**。Rust版COLONYは小さな構成を追う対照とする。この優先度は今回の設計課題に対する判断で、ゲームの品質の順位ではない。採用するエンジン・言語・AI方式は今回決めていない。
