# 次のチャットへの引き継ぎ

更新: 2026-09-27。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時はHEAD・`git status --short`・適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。

最新の追加は[履歴・経路・土地の版2](baseline/VILLAGE_RECORDING_AND_LAND_V2.md)。ユーザーは画面よりも、各人の後から読める行動履歴、実行を再現・比較できる記録、矩形地図の経路と途中変更、土地に結び付いた作物/果樹/野草/動物を優先した。世界セーブはschemaVersion 2、記録はformatVersion 2。`--record`、`replay`、`history`、`compare` をCLIで使用する。A*の道中保存・再探索/行き先変更、穀物の耕作→播種→72時間成長→収穫、果樹/野草/草の再生、ウサギの移動/摂食/成長を実装した。通常90日生活は野生ベリーの循環で維持し、土地の生産で90日生活を支える受入は未達。
通常90日の再実行記録は [autonomous-village-90.v2.json.gz](../fixtures/recordings/autonomous-village-90.v2.json.gz) に同梱し、CLIで再生済み。任意の別条件は `--scenario` と `--record /tmp/name.json.gz` で記録し、`compare` で最初の差分を確認する。

## 完了した区切り

[90日計画](baseline/AUTONOMOUS_90_DAY_PLAN.md)の段階0〜4は完了。[実行結果](baseline/AUTONOMOUS_VILLAGE_RESULT.md)を正本とする。`autonomous_village` はS/F/C/B1/B2を共通の起床・情報配送・PersonalityModel・物理Gatewayで動かす独立モード。正常fixtureで5人全員が毎日食事・薪使用を90日続けた。食料・薪は各450採集/消費、現金26保存。注文・納品各90、食品・薪販売各270。通常実行にも一時的な未遂9件が残る。CLIは `npm run autonomy:village -- 90`、日別は `--daily`、Eventは `--events`。F5の「自律: 5人の90日生活」も追加。

段階0の算術fixtureは通貨22・体力8/10。実行fixtureは物理的な待ち時間に合わせてFの初期通貨4、体力16/20とし、別ファイル `fixtures/autonomous-village.ts` で管理する。両者を混同しない。通常のrule人格はseedを保存するが乱数を使わず、同seed・同Command・途中保存で状態/Eventハッシュが一致する。拒否・欠員・資金/資源不足・通信遅延、権限外採集、部分納品、資源競合をテストする。

## 設計上の境界

本人が届いた刺激、現地観察、身体、主観記憶、利害から試行する。世界は時計、情報到達、局所物理、権利と契約の証拠検査、試行結果だけを確定する。中央が仕事・食事・価格・所得を割り当てない。`packages/ai/personality.ts` のインターフェースはrule/NN/LLM/人間の境界。旧本編/A3/`individual_*` は回帰用として独立に維持する。[設計基準](DESIGN.md)と[採用中の判断](DECISIONS.md)を参照。

## 次の作業と限界

実装順と受入条件は[版2以降の土地経済計画](baseline/LAND_ECONOMY_NEXT_PLAN.md)を正本とする。順1の[90日収支候補](baseline/LAND_ECONOMY_FEASIBILITY_V1.md)とCLI `npm run autonomy:land-feasibility` は実装済み。4区画・種4・穀物技能2・初期野生食料20/再生0（5食を予備）・初期体力20という候補なら算術上は穀物435＋野生15＝450食、通貨26保存。3区画は7日目、種2は3日目に予定した供給が止まる。これは人物の行動を実行した結果ではない。

次は順2。複数区画の栽培と取引・5人の食事を同じランナーへ接続し、3〜7日の小fixtureで保存/再実行、作業権限・種・技能・容量の拒否、食品・種・通貨の保存を検査する。まずFが畑の収穫物を森へ持ち帰り、現行のCとの合流・引渡しを使えるか検証する。時刻が間に合わなければ失敗として記録する。最後に栽培食品を主食とする正常90日と不足・不作・通行止めの対照を記録する。果樹・野草の過程、季節、動物の繁殖・死亡、道路の複数人競合、契約証拠の一般化、人格/人口/地理差はその後の段階。画面より記録による検証を優先する。本編M3の人間試遊は未実施。

## 検証と記録

土地経済の算術候補追加後は `npm test -- --testTimeout 15000` が22ファイル137件成功、型検査・ビルド、`npm run autonomy:land-feasibility` が成功。版2の通常90日と記録再実行は直前の実装で成功済み。90日記録は非圧縮JSON約12 MB、[圧縮済み](../fixtures/recordings/autonomous-village-90.v2.json.gz)約0.8 MB、Event26,638件。既定5秒の全体テストでは過去に旧M3の1件が並列負荷でタイムアウトした。今回は画面を追加していないためブラウザテストは実施していない。変更はこれまでの依頼により `main` のコミット・プッシュが許可されている。
