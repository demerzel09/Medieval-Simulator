# 次のチャットへの引き継ぎ

更新: 2026-09-27。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時はHEAD、`git status --short`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。

## 現在地

[土地経済計画](baseline/LAND_ECONOMY_NEXT_PLAN.md)の順1〜4を実装した。順1は[90日収支の算術候補](baseline/LAND_ECONOMY_FEASIBILITY_V1.md)、順2〜4は[5人の実走と対照](baseline/LAND_ECONOMY_V3_RESULT.md)を正本とする。従来の版2基準90日は野生ベリー中心の独立fixtureとして保存し、[同梱記録](../fixtures/recordings/autonomous-village-90.v2.json.gz)を引き続き再実行できる。

新しい土地経済fixtureでは、4つの穀物区画、Fの初期種4と穀物技能2、野生ベリー初期20・再生0で5人の90日を実行した。全員が各日1食と薪1を使用し、食料450食の内訳は穀物435・野生ベリー15。日61〜90の150食は穀物。通貨26保存、正常系の拒否・失敗0。栽培・所有・運搬・販売・食事を食品ロットの産地まで追跡し、途中保存と[90日記録](../fixtures/recordings/autonomous-village-land-90.v2.json.gz)の再実行が一致した。

順4では区画・種・収量不足、畑の遠距離化、途中の道路閉鎖、Fの拒否・技能不足、通信遅延、動物の餌不足を対照にした。果樹の開花、季節、ウサギの繁殖/死亡、非site道路セルの複数人競合を局所法則として追加した。対照記録は `fixtures/recordings/autonomous-village-land-{few-plots-7,long-field-3,road-blocked-3}.v2.json.gz`。

## 実行・設計境界

```bash
npm run autonomy:village -- 90 --scenario land-economy --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-land-90.v2.json.gz
npm run autonomy:village -- history fixtures/recordings/autonomous-village-land-90.v2.json.gz F /tmp/land-farmer-history.json
npm run autonomy:village -- compare fixtures/recordings/autonomous-village-land-long-field-3.v2.json.gz fixtures/recordings/autonomous-village-land-road-blocked-3.v2.json.gz
```

本人は到達した情報・現地観察・身体・主観記憶・利害から試行する。世界は時計、情報到達、局所物理、権利と契約の証拠、試行結果だけを確定し、仕事や食事を割り当てない。`PersonalityModel` はrule/NN/LLM/人間の境界。土地利用権はFの固定権限で、所有移転・共同利用は未実装。通常90日は単一地図・固定価格信念・rule人格の受入で、人格・人口・地理を変えた一般性は未検証。[設計基準](DESIGN.md)と[採用中の判断](DECISIONS.md)を参照。

## 次の候補と検証

次は土地利用権の移転・共同利用、注文専用の契約証拠の一般化、複数作物と技能・価格・人格・人口・地理を変えた対照から選ぶ。各対照は別fixture・記録として再現し、正常90日の結果をそのまま一般化しない。本編M3の3〜5人の人間試遊は別途未実施。実測と限界の一覧は[STATUS](STATUS.md)。

変更後は `npm test -- --testTimeout 30000`、`npm run typecheck`、`npm run content:validate`、`npm run build`、旧版と土地経済の記録再実行を確認する。今回は画面を追加していないためブラウザテストは実施していない。ユーザーの既存の許可により `main` のコミット・プッシュが可能。
