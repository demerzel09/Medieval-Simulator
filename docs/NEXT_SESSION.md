# 次のチャットへの引き継ぎ

更新: 2026-09-27。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。文書整理前の実装基準は `8adb1de`、直前の引き継ぎコミットは `29af0cb`。現在のHEADと作業ツリーは再開時に確認する。次のチャットでは最初に `git status --short` と現在のHEADを確認すること。適用される `AGENTS.md` は直近の確認では見つかっていないが、新たに追加されていないか確認する。

## 目標と変えてはいけない境界

ゲームの長期目標は、文化・動機・約束・本人の認識・所有権と物理制約から、人物の行動として経済・社会・政治が生じること。simが人口や共同口座を調整して安定させる方式を完成形としない。世界の物理的真実と人物の認識を分け、人物が行動を提案し、simが所在・容量・時間・権利と資産保存を検証して因果Eventを確定する。人格の外側の境界は `packages/ai/personality.ts` の `PersonalityModel`。rule/NN/LLM/人間はその実装方式で、別々の社会インターフェースではない。simコアはUI/ネットワークに依存させない。

現行の設計基準は [DESIGN.md](DESIGN.md)、初版企画書は [原本](foundations/ORIGINAL_GAME_DESIGN.md)、人格の意味分割は [AGENT_INTERFACES_v2.md](foundations/AGENT_INTERFACES_v2.md)、自律行動の境界は [AUTONOMY_INTERFACE_CONTRACT.md](foundations/AUTONOMY_INTERFACE_CONTRACT.md)。直近の実装判断は [DECISIONS.md](DECISIONS.md)、現行の実装/未実装/検証は [STATUS.md](STATUS.md)（時系列は [履歴](archive/STATUS_HISTORY_2026-09-27.md)）。食品・場所・技能・権利の拡張案は [FOOD_ECOLOGY_AND_MARKET_PLAN.md](baseline/FOOD_ECOLOGY_AND_MARKET_PLAN.md)。

## 現在あるもの

- 本編M0〜M2の機構とM3の自動90日シナリオは実装済み。M3の人間試遊は未実施。A3の固定20人・協同事業経済は90日動くが、個人主導の一般的な社会自律を証明しない。旧実装は回帰比較として維持する。
- `packages/sim/individual-life.ts` と `packages/ai/individual-life.ts`: 世帯・市場なしで3人が本人判断により移動/採集/食事/休息する小世界。標準90日で270食採集・270食消費、空腹0。
- `packages/sim/individual-market.ts` と `packages/ai/individual-market.ts`: Sが市場を所有するが、現金・食料の所有は人物に残る。Sが初期資金10から4通貨の留保を考えて発注し、Cが仕入金を運び、Fが単価/数量を作業前に承諾して採り、渡した実量だけ現地で支払い、Sが販売する。ベリーは収穫日を含む3日間有効。取引のみの90日対照は収穫5・販売4・腐敗5で停止する。
- `newLivingMarketWorld` は同じ市場にB1/B2本人所有の家・備蓄箱・空腹・買物移動・食事を追加する別の小実験。標準90日で収穫8・販売数量7・食事7・腐敗1、S/F/C/B1/B2の現金28/8/12/0/2、B1/B2の空腹86/87。**安定していない。** 詳細は [LIVING_MARKET_EXPERIMENT.md](baseline/LIVING_MARKET_EXPERIMENT.md)。本人が外出を拒む対照では中央は買物/食事を代行しない。保存/再実行/物量・通貨保存/因果Eventをテスト済み。
- CLIは `npm run autonomy:life -- 30`、`npm run autonomy:market -- 7`、`npm run autonomy:living -- 30`（それぞれ最大90日）。デバッグ画面は `npm run dev` 後の `/?individual=life`、`/?individual=market`、`/?individual=living`。VS Codeの `.vscode/launch.json` に対応する起動設定あり。作業環境のWSLでLinux版Nodeが必要なら `export PATH="$HOME/.local/node/bin:$PATH"` を先に実行する。

## 今すぐ解くべきこと

買主B1/B2に所得を生む実在の仕事または生産物がない。Sが利益を得ても買主の現金は戻らず、現物があっても空腹になる。次の縦断実装では、**誰がBの何を必要とし、なぜ実在の通貨を払うか**を具体的な仕事/財と本人の局所判断で成立させること。毎日の一律給付、帳尻合わせの賃金、世帯/市場からの自動分配を入れない。Bの提案、相手の受諾、物理的な作業または納品、対面/委託による支払をEventで分け、拒否・不足・未払を許す。F/C/Sも食べる同じ身体・食品ロットの仕組みへ移す。

次の仕事候補は[食品・空間の計画](baseline/FOOD_ECOLOGY_AND_MARKET_PLAN.md)にある森の採集、農地の作業、運搬補助、食品とは異なる必要財など。ただし「BがSへ食料を売り、その同じ食料をSから買うだけ」の無意味な循環を避ける。買い手が必要とする理由、仕事に要する時間/体力/権利、本人が見た情報、本人の利益を先に数表と対照fixtureで確認してから実装する。複数食品/栄養差、森/農地の成長段階、技能、なわばり、直接販売は後続の拡張候補で、現在は未実装。

市場のS/F/Cはなお中央の `phase` 順序で呼ばれ、B1/B2の生活にも日次phaseが残る。全員の起床と情報到達で仕事が連結する一般ランナー、旅の距離/荷重/体力積算、契約証拠から `PhysicalAuthority.ownerIds` への安全な権限導出も未実装。新しい対照の成功を全員自律と呼ばない。

## 検証とセーブ

直近の最終検証は `npm test` 16ファイル108/108、`npm run typecheck`、`npm run content:validate`、`npm run test:browser` 12/12（本番ビルドを含む）が成功。新しい生活市場の性能は未計測。ブラウザテストは追跡済みの `artifacts/debug-screen.png` と `artifacts/e1-spatial-debug.png` を再生成するので、意図的な更新でなければ差分を戻す。変更後は対応するテストを再実行し、失敗/未計測を成功と書かない。市場セーブは `schemaVersion: 2`、新小実験のseedは保存されるが現在は乱数を使わず、外部Commandの保存再適用はまだない。

次のチャットでも [STATUS.md](STATUS.md) と [DECISIONS.md](DECISIONS.md) を更新する。新たな受入を満たしたらREADME、起動設定、テスト結果も更新する。これまでの依頼では変更を `main` にコミット・プッシュすることが許可されている。
