# 次のチャットへの引き継ぎ

更新: 2026-10-01。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時はHEAD、`git status --short`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。

## 現在地

全員の直接採集と余剰市場v9 `land-wild-food` を追加し、同じF5はこれを標準表示する。[野生食品と余剰市場の結果](baseline/WILD_FOOD_MARKET_V9_RESULT.md)。全員が固定の基礎採集能力4を持ち、現地の野草・ベリーを経路と体力を使って採り、現金なしで食べる。余剰は1食を残して市場で提示し、買い手の判断で現物と代金を同時移転する。この例では90日各日全員1食、ベリー売買17回、競合による作業失敗7回。旧4単位卸売・運賃デモはv9人格では使わない。野生採集を含む例であり、加工経済の持続性ではない。

**次の方針を変更済み**：[穀物・パンと技能・職の計画](baseline/FOOD_ECONOMY_SKILLS_PLAN.md)。固定職で持続することを先に必須にせず、まず穀物→パンの原料・加工・所有・売買の矛盾を除く。その後、技能獲得と本人の職選択を組み込み、需要に応じた切替で経済の持続性を測る。ここを最初の持続性の目標とする。薪と雇用は停止継続。製パン・技能獲得・転職は未実装。

以下はv8までの経緯。

v8時点では所有畑版 `land-owned-farms` を追加し、F5で標準表示した。[所有畑と穀物保存の実測](baseline/OWNED_FARMS_V8_RESULT.md)を参照。穀物は腐敗しない。F/B1/B2は技能2・初期種4・所有4区画ずつの農夫となり、所有者だけが耕作・播種・収穫する。各畑は成熟1・5日成長中1・未耕作2から開始し、農夫3人は90日各日1食を確保。薪と雇用は導入しない。S3食・C1食で、5人の食料市場の資金循環はまだ成立しない。次は雇用を前提にせず、農夫の余剰穀物とS/Cの財・サービスの取引を設計する。画面の枠色で所有農夫を表示し、セルに所有者と畑ID、凡例に見分け方を載せた。旧v6・v7も記録選択で比較可能。

以下はv7までの経緯。

v7時点では薪の固定森資源を停止した対照を追加し、F5で標準表示した。画面の記録選択で旧v6に切り替えられる。薪採集・売買・燃料要求・日次補充はすべて停止し、木こり2人は森へ採集に行かない。初期資金や別収入は足していないため、薪販売に依存していた所得循環が止まる。90日の食事はS3・F10・C1・B1/B2各0で、正常90日ではない。[原因と停止結果](baseline/WOOD_PAUSED_V7_RESULT.md)を参照。v7時点の案は作業報酬だったが、ユーザーは雇用を導入せず所有農夫が耕作する方針を指定し、上記v8へ進めた。木・斧・木こり技能の実装は後続候補。

以下は保存してある旧v6までの結果。

[土地経済計画](baseline/LAND_ECONOMY_NEXT_PLAN.md)の順1〜4を実装した。順1は[90日収支の算術候補](baseline/LAND_ECONOMY_FEASIBILITY_V1.md)、順2〜4は[5人の実走と対照](baseline/LAND_ECONOMY_V3_RESULT.md)を正本とする。従来の版2基準90日は野生ベリー中心の独立fixtureとして保存し、[同梱記録](../fixtures/recordings/autonomous-village-90.v2.json.gz)を引き続き再実行できる。

F5の「自律: 土地経済90日の生態デバッグ画面」は[全域版](baseline/WIDE_WORLD_V5_RESULT.md)と[局所探索版](baseline/PLANT_EXPLORATION_RESULT.md)を継いだ[生態版](baseline/ECOLOGICAL_LAND_V6_RESULT.md)の90日記録を40×24セル・1280×768ピクセルで描く。ベリーは4株の別セルで7日再生、野草は8地点で4日再生し2単位/食、畑12区画は6日生育・収穫後3日休止。Fは最初の3日に野草・果樹を採り、取引用ベリーも3日間で別の株を採る。画面では5/15/30/60分刻み、再生・停止・4倍速で `travel_step` の記録を追える。分表示は時間内の移動順から割り当てる目安。黄色いA*経路線は任意表示で、通過履歴とは区別する。右側の折り畳み可能な枠に人物・経路選択と判断履歴を置き、凡例タブで生育・地面・障害物・人物の見分け方を示す。セルをクリックすると地形と植物の生育段階を読める。URLは `/?village=land-economy`。

旧5×5の土地経済fixtureでは、4つの穀物区画、Fの初期種4と穀物技能2、野生ベリー初期20・再生0で5人の90日を実行した。全員が各日1食と薪1を使用し、食料450食の内訳は穀物435・野生ベリー15。日61〜90の150食は穀物。通貨26保存、正常系の拒否・失敗0。栽培・所有・運搬・販売・食事を食品ロットの産地まで追跡し、途中保存と[90日記録](../fixtures/recordings/autonomous-village-land-90.v2.json.gz)の再実行が一致した。

順4では区画・種・収量不足、畑の遠距離化、途中の道路閉鎖、Fの拒否・技能不足、通信遅延、動物の餌不足を対照にした。果樹の開花、季節、ウサギの繁殖/死亡、非site道路セルの複数人競合を局所法則として追加した。対照記録は `fixtures/recordings/autonomous-village-land-{few-plots-7,long-field-3,road-blocked-3}.v2.json.gz`。

## 実行・設計境界

```bash
npm run autonomy:village -- 90 --scenario land-wild-food --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-wild-food-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-owned-farms --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-owned-farms-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-wood-paused --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-wood-paused-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-ecology --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-ecological-90.v2.json.gz
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-exploring-90.v2.json.gz
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-wide-90.v2.json.gz
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-spatial-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-economy --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-land-90.v2.json.gz
npm run autonomy:village -- history fixtures/recordings/autonomous-village-land-90.v2.json.gz F /tmp/land-farmer-history.json
npm run autonomy:village -- compare fixtures/recordings/autonomous-village-land-long-field-3.v2.json.gz fixtures/recordings/autonomous-village-land-road-blocked-3.v2.json.gz
```

本人は到達した情報・現地観察・身体・主観記憶・利害から試行する。世界は時計、情報到達、局所物理、権利と契約の証拠、試行結果だけを確定し、仕事や食事を割り当てない。`PersonalityModel` はrule/NN/LLM/人間の境界。旧版の土地利用権はFに固定。所有畑v8ではF/B1/B2の各所有者に固定し、所有移転・共同利用・雇用は未実装。通常90日は単一地図・固定価格信念・rule人格の受入で、人格・人口・地理を変えた一般性は未検証。[設計基準](DESIGN.md)と[採用中の判断](DECISIONS.md)を参照。

## 次の候補と検証

優先する次の設計は、穀物からパンへの加工と現物・所有・売買の整合。その後に技能獲得と職選択を導入して持続性を測る。雇用は当面導入しない。続く候補は遠方の未知植物を探す経路、植物ごとの識別技能、薪の固定森資源をセル別の木へ置き換えること、採集競合、地形別の移動コストから進める。[生態版](baseline/ECOLOGICAL_LAND_V6_RESULT.md)でもFの能動的な野草・果樹採集は最初の3日と森周辺に限る。休止期間は土壌栄養や輪作判断の代替であり、それら自体は未実装。土地利用権の移転・共同利用や契約証拠の一般化も未実装。各対照は別fixture・記録として再現し、正常90日の結果を一般化しない。本編M3の3〜5人の人間試遊は別途未実施。実測と限界の一覧は[STATUS](STATUS.md)。

変更後は `npm test -- --testTimeout 60000`、`npm run typecheck`、`npm run content:validate`、`npm run build`、旧版と土地経済の記録再実行を確認する。記録画面のブラウザテストは追加済み。ユーザーの既存の許可により `main` のコミット・プッシュが可能。
