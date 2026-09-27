# 次のチャットへの引き継ぎ

更新: 2026-09-27。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時にはHEAD・`git status --short`・適用される `AGENTS.md` を確認する。今回の作業開始時HEADは `217b69a`、`AGENTS.md` は見つかっていない。

追記: 今回 `packages/sim/individual-work.ts` と `packages/ai/individual-work.ts` に2人・1件の買取縦断fixtureを追加した。Sの提示は2時間後にFへ届き、Fの承諾・採集・現物引渡し、Sへの通知後の現金支払が各人の起床と試行で進む。未到達IDの承諾・引渡しを知らない支払、拒否、納品保留、保存再開/90日再実行をテストする。CLIは `npm run autonomy:work -- 8`。生活市場への統合、F/C/Sの食事、一般権限、複数取引は次の仕事。今回のテスト結果と作業ツリーは再開前に確認する。

## 目標と変えてはいけない境界

最優先は、本人に届いた情報・身体・記憶・文化・利害から人物が自分で行動し、世界が環境変化とその試行の結果だけを確定する、持続して進行できる世界。生活・社会の存続も破綻も結果として残し、中央が仕事・所得・食料・価格を割り当てて安定させない。情報の到達と起床、権利・約束・制度の記録もこの境界を接続する。`packages/ai/personality.ts` の `PersonalityModel` は人格の外側の境界。rule/NN/LLM/人間はその内部方式。現在の `packages/sim` は物理法則だけでなく中央日次経済とphase順序を含む広い実装で、目標の世界法則と同義ではない。政治・外交・戦争の拡張は当面の優先度を下げ、旧本編は回帰用に維持する。正確な境界は [DESIGN.md](DESIGN.md) と [DECISIONS.md](DECISIONS.md)。

現行の設計基準は [DESIGN.md](DESIGN.md)、初版企画書は [原本](foundations/ORIGINAL_GAME_DESIGN.md)、人格の意味分割は [AGENT_INTERFACES_v2.md](foundations/AGENT_INTERFACES_v2.md)、自律行動の境界は [AUTONOMY_INTERFACE_CONTRACT.md](foundations/AUTONOMY_INTERFACE_CONTRACT.md)。直近の実装判断は [DECISIONS.md](DECISIONS.md)、現行の実装/未実装/検証は [STATUS.md](STATUS.md)（時系列は [履歴](archive/STATUS_HISTORY_2026-09-27.md)）。食品・場所・技能・権利の拡張案は [FOOD_ECOLOGY_AND_MARKET_PLAN.md](baseline/FOOD_ECOLOGY_AND_MARKET_PLAN.md)。

## 現在あるもの

- 本編M0〜M2の機構とM3の自動90日シナリオは実装済み。M3の人間試遊は未実施。A3の固定20人・協同事業経済は90日動くが、個人主導の一般的な社会自律を証明しない。旧実装は回帰比較として維持する。
- `packages/sim/individual-life.ts` と `packages/ai/individual-life.ts`: 世帯・市場なしで3人が本人判断により移動/採集/食事/休息する小世界。標準90日で270食採集・270食消費、空腹0。
- `packages/sim/individual-market.ts` と `packages/ai/individual-market.ts`: Sが市場を所有するが、現金・食料の所有は人物に残る。Sが初期資金10から4通貨の留保を考えて発注し、Cが仕入金を運び、Fが単価/数量を作業前に承諾して採り、渡した実量だけ現地で支払い、Sが販売する。ベリーは収穫日を含む3日間有効。取引のみの90日対照は収穫5・販売4・腐敗5で停止する。
- `newLivingMarketWorld` は同じ市場にB1/B2本人所有の家・備蓄箱・空腹・買物移動・食事、薪の採集・納品・所得を追加する別の小実験。標準90日でベリー収穫10・販売/食事9・腐敗1、薪採集/燃焼9、B1/B2の薪所得10/8。S/F/C/B1/B2の現金20/10/14/4/2、B1/B2の空腹85/86。**安定していない。** 詳細は [LIVING_MARKET_EXPERIMENT.md](baseline/LIVING_MARKET_EXPERIMENT.md)。拒否/未作業/未納品、保存/再実行/物量・通貨保存/因果Eventをテスト済み。
- CLIは `npm run autonomy:life -- 30`、`npm run autonomy:market -- 7`、`npm run autonomy:living -- 30`（それぞれ最大90日）。デバッグ画面は `npm run dev` 後の `/?individual=life`、`/?individual=market`、`/?individual=living`。VS Codeの `.vscode/launch.json` に対応する起動設定あり。作業環境のWSLでLinux版Nodeが必要なら `export PATH="$HOME/.local/node/bin:$PATH"` を先に実行する。

## 今すぐ解くべきこと

B1/B2の薪仕事は実在するが、Sの食品販売が止まると薪需要も止まる。所得18を得ても90日末の空腹は85/86で、生活経済は成立しない。次は中央phaseによる役割呼出しを人物ごとの起床・情報到達・試行と世界法則に置き換える小さな縦断面を最優先にする。続いてF/C/Sも食べる同じ身体・食品ロットの仕組みへ移し、S以外の実需と雇用を増やした反事実を作る。毎日の一律給付、帳尻合わせの賃金、世帯/市場からの自動分配は入れない。

次の実装に入る前に、`individual_life` の本人判断・起床処理、`individual_market` の中央phase、`physical.ts` の物体操作を読み、最初の縦断fixtureを決める。受入では「届いていない情報で判断しない」「本人が拒めば仕事が進まない」「simが欠員を代行しない」「世界の試行結果と人物の認識を分ける」を、保存・再実行と対照実験で確認する。`packages/sim` という既存ディレクトリ名を物理simの完成境界とみなさない。

後続の仕事候補は[食品・空間の計画](baseline/FOOD_ECOLOGY_AND_MARKET_PLAN.md)にある農地の作業、運搬補助、食品とは異なる必要財など。薪だけではSの売場に依存するため、買い手の別の実需、仕事に要する時間/体力/権利、本人が見た情報、本人の利益を数表と対照fixtureで確認する。複数食品/栄養差、森/農地の成長段階、技能、なわばり、直接販売は未実装。

市場のS/F/Cと薪仕事はなお中央の `phase` 順序で呼ばれ、B1/B2の生活にも日次phaseが残る。全員の起床と情報到達で仕事が連結する一般ランナー、旅の距離/荷重/体力積算、契約証拠から `PhysicalAuthority.ownerIds` への安全な権限導出も未実装。新しい対照の所得発生を全員自律や安定と呼ばない。

## 検証とセーブ

直近のコード変更後の最終検証は `npm test` 16ファイル110/110、`npm run typecheck`、`npm run content:validate`、`npm run test:browser` 12/12（本番ビルドを含む）が成功。薪所得を表示するブラウザ個別テスト3/3も成功。その後の `530cae5` は文書のみの変更で、コードテストを新たに実行した結果ではない。`launch.json` の33設定は24件のCLI実行と9件の画面URLを監査し、実行不能な設定は見つからなかった。生活市場の性能は未計測。ブラウザテストは追跡済みの `artifacts/debug-screen.png` と `artifacts/e1-spatial-debug.png` を再生成するので、意図的な更新でなければ差分を戻す。変更後は対応するテストを再実行し、失敗/未計測を成功と書かない。取引のみの市場セーブは `schemaVersion: 2`、薪仕事を伴う生活市場は版3。seedは保存されるが現在は乱数を使わず、外部Commandの保存再適用はまだない。

次のチャットでも [STATUS.md](STATUS.md) と [DECISIONS.md](DECISIONS.md) を更新する。新たな受入を満たしたらREADME、起動設定、テスト結果も更新する。これまでの依頼では変更を `main` にコミット・プッシュすることが許可されている。
