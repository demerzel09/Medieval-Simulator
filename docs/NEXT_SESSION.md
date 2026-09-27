# 次のチャットへの引き継ぎ

更新: 2026-09-27。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時はHEAD・`git status --short`・適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。

## 完了した区切り

[90日計画](baseline/AUTONOMOUS_90_DAY_PLAN.md)の段階0〜4は完了。[実行結果](baseline/AUTONOMOUS_VILLAGE_RESULT.md)を正本とする。`autonomous_village` はS/F/C/B1/B2を共通の起床・情報配送・PersonalityModel・物理Gatewayで動かす独立モード。正常fixtureで5人全員が毎日食事・薪使用を90日続けた。食料・薪は各450採集/消費、現金26保存。注文・納品各90、食品・薪販売各270。通常実行にも一時的な未遂9件が残る。CLIは `npm run autonomy:village -- 90`、日別は `--daily`、Eventは `--events`。F5の「自律: 5人の90日生活」も追加。

段階0の算術fixtureは通貨22・体力8/10。実行fixtureは物理的な待ち時間に合わせてFの初期通貨4、体力16/20とし、別ファイル `fixtures/autonomous-village.ts` で管理する。両者を混同しない。通常のrule人格はseedを保存するが乱数を使わず、同seed・同Command・途中保存で状態/Eventハッシュが一致する。拒否・欠員・資金/資源不足・通信遅延、権限外採集、部分納品、資源競合をテストする。

## 設計上の境界

本人が届いた刺激、現地観察、身体、主観記憶、利害から試行する。世界は時計、情報到達、局所物理、権利と契約の証拠検査、試行結果だけを確定する。中央が仕事・食事・価格・所得を割り当てない。`packages/ai/personality.ts` のインターフェースはrule/NN/LLM/人間の境界。旧本編/A3/`individual_*` は回帰用として独立に維持する。[設計基準](DESIGN.md)と[採用中の判断](DECISIONS.md)を参照。

## 次の候補と限界

版1は5人・単一地理・一つのrule人格・固定の食料/薪/価格信念での受入。一般的な人口・地理・技能・季節・複数食品・契約形式、LLM人格は未検証。次は距離と複数地点、技能・食品差、一般化した契約証拠、人格と初期条件の対照を小fixtureから増やす。90日の成立を別条件へ無条件に外挿しない。本編M3の人間試遊は未実施。

## 検証と記録

新しいテストは `tests/autonomous-village.test.ts`。最終検証は `npm test -- --testTimeout 15000` が19ファイル127件成功、型検査・内容検証・ビルド・90日CLIも成功。既定5秒の全体テストでは旧M3の1件が並列負荷でタイムアウトした。今回はブラウザテストを実施していない。ブラウザテストは追跡済みの画像を再生成するので、意図しない差分を確認する。変更はこれまでの依頼により `main` のコミット・プッシュが許可されている。
