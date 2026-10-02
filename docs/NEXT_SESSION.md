# 次のチャットへの引き継ぎ

更新: 2026-10-02。作業ディレクトリは `/home/demerzel/workspace/Medieval-Simulator`。再開時はHEAD、`git status --short`、適用される `AGENTS.md` を確認する。Nodeが見つからない場合は `export PATH="$HOME/.local/node/bin:$PATH"`。

## 直近の確認：Fの市場訪問と穀物の名称

v15のFを監査した。初期の携帯品は播種用在庫4、売却用の収穫穀物0、現金4。市場訪問はパン購入が目的であり、売る必要がないと判断した場面とは区別する。1日目04時に家から市場へ出発し、06時には気温9・睡眠不足10、継続時の予測寒さ8.2により帰宅と睡眠を選ぶ。初回の穀物収穫は8日目11時（hour179）、市場売却は同日16時（hour184）。何もせず戻ること自体を失敗条件にせず、本人の目的・観察・身体・予測で理由を確認する。

市場の待機記憶には不具合がある。`visitStartedAt` が初回の移動提案hour3のまま帰宅・睡眠後にも残り、次の市場到着hour18で待機時間を使い切った扱いになる。待機時間を現地到着から数え、退出・中断で訪問を区切る修正が必要。旧記録の再現を維持するため、新規則版で検査・記録する。まだ修正していない。

表示の「穀物の種」を「播種用の穀物」に変更し、現行記録の販売・製パン用穀物と混同しないようにする。ユーザーは播種用の種を独立物品として複雑化させず、穀物の量・重量・運搬負担を表す方針を希望。播種にも製パンにも使う同じ穀物を本人が取り分ける方式と、現行の別在庫を用途名で表示する方式のどちらにするか確認中。統合と質量変更は未実装。統合の場合は初期在庫・播種消費・収穫・種の別生成・原料保存則も変更する必要がある。現在の質量は種・食品とも1/単位、携帯10で移動体力消費増、20で歩進捗も遅くなる粗いモデル。

## 現在の標準：人物ステータスと自宅保管 v15

[実装と実測](baseline/HOME_STORAGE_V15_RESULT.md)。同じF5の生態デバッグ画面でv15を標準表示する。「ステータス」タブに現金合計、身体の数値と快不快バー、携帯中・家・市場の物品を表示し、「人物の履歴」「凡例」と切り替える。状態は物体木からの初期／各時間末の記録で、所持品の数量・質量・所有・期限を追える。行動Eventに巨大な状態JSONは表示しない。

本人所有の収納箱を各自宅に追加。自宅で現金と食品・種・薪を預け、取り出せる。物理的な所有・現地・数量・容量、食品の腐敗を検査する。人格には自宅にいる時だけ収納内容を渡す。帰宅日課は足さず、必要な携帯現金8・食品2食を目安に余りを保管する初期rule。快不快は身体の負担を表示する指標で、独立感情・学習済み価値ではない。

90日では家への現金収納9回、物品収納23回・持ち出し15回。穀物売買43・パン92件、全員合計各90食（パン151）。通貨26保存、Sの携帯8・家18へ偏る。状態 `b99d21d4`、Event `c55d144a`。技能獲得・職選択、小モデル競合B以降、経済持続の受入は後続。初期ランダム移動先の案も未実装。CLIは `land-home-storage`。

検証：旧版37ファイル204/204、最終版v15対象5/5、ブラウザ9/9、型検査を含む本番ビルド・コンテンツ検査・文書リンク・差分検査に成功。全体38ファイル209件の実行中に収納箱検査と取り出し元ログを補強したため、途中版で不一致となったv15の2項目は最終版の5/5再実行で確認した。新90日記録の世界再実行と、10日の途中保存再開・状態の実物照合を検査した。

## 保存してある食品市場の基準 v14

農民が家と畑だけを往復する原因は、v12/v13では全員が自宅で製パンでき、市場へ行く必要がなかったこと。ユーザーの指摘を受け、[穀物売却・市場製パン・パン購入v14](baseline/FOOD_MARKET_V14_RESULT.md)を追加した。v14は表示する記録の選択で比較できる。農夫F/B1/B2は収穫穀物を市場で売り、実際に受け取った代金でパンを買う。初期製パン技能はSのみ1、他は0。Sは購入穀物を市場の本人所有庫に保存し、現地で加工・販売する。野草・ベリーによる自食は維持。技能獲得・職選択・雇用・薪は未実装／停止のまま。

90日の全員の食事と実在する売買を検証する一方、通貨はSへ偏る。市場が永続的に循環したとは扱わない。原料・加工・所有・支払いの整合を先に確立し、次に需要と技能・職選択で持続性を改善する既存方針を継承する。v13の予測対応はv14にも含む。小モデル競合B以降は未実装。最初のランダムな移動先から経験を得る案も未実装で、現在は初期信念と既知の目標を使う。

検証：全体37ファイル204件を実行し、203件成功・旧v11再生1件のみ60秒の時間制限超過。上限を120秒に延ばして旧v11の3/3を再検査し成功（61秒）。v14対象4/4、ブラウザ8/8、型検査・本番ビルド・コンテンツ検査、文書リンク・差分検査に成功。実装の結果不一致はない。

## 続ける予測設計（2026-10-02の合意）

[状況別の予測モデルと快・不快による行動選択](baseline/MODULAR_PREDICTION_AND_ACTION_PLAN.md)の段階Aを[v13](baseline/PREDICTION_LEDGER_V13_RESULT.md)で実装した。v13のCLIは `land-predictions`。画面標準は上記v15へ更新した。予測誤差でモデルの信頼・係数を更新し、快・不快と費用で行動を評価する。小モデルを状況に応じて選び、短い行動列へつなぐ。

着手順は **A: 移動の事前予測と実結果の対応 → B: 小モデルの競合と係数更新 → C: 行動評価・短い連鎖・再検討 → D: 食品経済の90日と対照**。Aは既存の行動優先順を継承し、予測ID・試行／Process ID・結果・除外理由を記録する。実測の移動経験は到達した完了結果から更新する。拒否・中断・遅延・重複配送・保存再開と90日を検証した。次の着手はBの初期距離モデルと経験モデルの同時予測・比較。行動選択を一度に置き換えない。v12と旧版の規則・記録は維持する。技能・職選択、雇用・木こりの位置づけは変更なし。

## v13の実測

977件の移動予測を完了結果と照合し、975件の時間見込みを比較、絶対誤差合計8時間。未知行先の初回2件は誤差を作らない。全員90日各日1食、パン270・ベリー122・野草58食。状態 `75d1ed7d`、Event `64a365b8`。移動の除外・未決0、植物採集競合4。検証は全体36ファイル200/200、v13対象12/12、型検査・本番ビルド・コンテンツ検査が成功。7日の各人格応答の再計算と保存再開、新90日記録および旧記録の世界再実行を検査した。画面変更なし、今回のブラウザテストは未実施。記録は圧縮約20MiB、展開約315MBで、差分化は後続。

## 保存してあるv12の基準

欲求・経験と予防行動v12 `land-needs` は以前の標準。[実装と実測](baseline/ANTICIPATORY_NEEDS_V12_RESULT.md)。世界に昼夜の気温、自宅の保温、活動体力と睡眠不足、睡眠・短い休憩の別、人物別の経過時間による空腹を追加。本人は重要な経験と通常の集計、時刻別の観測気温、移動時間・睡眠回復から先を見積もる。目的を維持し、備蓄が十分なら農作業や不要な販売を控える。帰宅は固定日課にしない。単一seed90日で全員各日1食、パン270・ベリー122・野草58食、穀物収穫315、残り各農夫13、睡眠完了450、試行拒否0・採集競合4。状態ハッシュ `23c66cd9`。売買0なので加工経済の持続性ではない。技能獲得・職選択は未実装。次は上記のA〜Dで予測と行動判断を具体化し、食品市場の循環を確認して技能・職選択へ接続する。薪・雇用は停止継続。

検証：単体テスト35ファイル188/188成功（逐次実行）、最終版のv12対象8/8成功、記録画面7/7成功。型検査を含む本番ビルド、コンテンツ検査、文書リンクと差分検査に成功。v12の90日記録と旧規則の記録をGatewayで再実行し、状態・Eventを照合した。

以下はv11までの経緯。

穀物保存・パン加工v11 `land-bread` は当時の標準。[実測と仕様](baseline/BREAD_STORAGE_V11_RESULT.md)。穀物は直接食べられず腐敗しない。収穫後は自宅か市場の本人所有の穀物庫へ運んで保存し、2時間で穀物1→パン1へ加工する。パンは製造日から3日で腐敗する。新記録で全員90日各日1食、パン269食、直接穀物0食、野生食品181食を確認した。旧v8〜v10の食事結果には直接穀物の摂食が含まれるため、新仕様の検証根拠には使わない。状態ハッシュ `20d25206`。製粉・製パンは一工程、基礎加工能力は固定。次は[身体・環境と行動選択](baseline/NEEDS_AND_ACTION_SELECTION_PLAN.md)の設計に従い、備蓄・売れ行きを反映する判断、気温・疲労・睡眠と場所の条件を整え、食品経済と統合して対照を確認する。帰宅を固定日課にしない。強い快・不快の経験と行動の所要時間を記憶し、将来の身体状態と対処時間を予測して不快が強まる前に行動する設計を含む。その後に技能獲得と本人の職選択。雇用・薪は停止継続。

検証: 単体テスト34ファイル180/180成功（`npm test -- --testTimeout 240000 --maxWorkers 1`）、記録画面のブラウザ6/6成功、型検査を含む本番ビルド、コンテンツ検査に成功。並列実行では旧90日テストとv11再生が時間制限を超えたため、逐次実行で確認した。新しい90日記録と旧記録のGateway再実行も一致した。

2026-10-02の行動監査とユーザー合意：パン提示268回・パン売買0回でも販売を反復し、農夫の穀物は各78〜79単位まで蓄積する。休息はほぼ作物セルで始まるが、帰宅しないこと自体が問題ではない。帰宅の利点を生む身体・環境が不足している。昼夜の温度差、睡眠不足、場所別の回復を世界側で扱い、本人は感じる欲求・既知の場所・負担から行動を選ぶ。設計文書を更新した段階で、気温・睡眠不足・場所別回復の追加実装はまだ行っていない。

以下はv10までの経緯。

現地作業v10 `land-local-work` を追加し、F5の標準記録を更新。[移動・待機の修正](baseline/LOCAL_WORK_V10_RESULT.md)。v9は採集を1時間内に往復して出発セルに戻り、農夫も作業がないと畑の中心へ戻るため、文字セルへ留まって見えた。v10は植物へ通常移動して現地で採集（野草2単位は2時間、ベリー3単位は3時間）し、その場で食事・休息する。農夫は自己所有の作物セルで作業・待機し、中心へ自動で戻らない。市場へは売買目的で移動する。全員90日各日1食、農夫3人各19回収穫、余剰売買6回、再実行一致。旧v9も選択で比較可能。全体177テスト、最終版の対象2テスト・ブラウザ5件成功。

以下はv9までの経緯。

v9時点では全員の直接採集と余剰市場 `land-wild-food` を追加し、F5で標準表示した。[野生食品と余剰市場の結果](baseline/WILD_FOOD_MARKET_V9_RESULT.md)。全員が固定の基礎採集能力4を持ち、現地の野草・ベリーを経路と体力を使って採り、現金なしで食べる。余剰は1食を残して市場で提示し、買い手の判断で現物と代金を同時移転する。この例では90日各日全員1食、ベリー売買17回、競合による作業失敗7回。旧4単位卸売・運賃デモはv9人格では使わない。野生採集を含む例であり、加工経済の持続性ではない。

**次の方針を変更済み**：まず現在の採集・自食・余剰市場の在庫・所有・支払い・再生待ちを確立し、次に製パンへ進む。食品以外の新しい収入手段を先に足さず、その対応は結果を見てから考える。[穀物・パンと技能・職の計画](baseline/FOOD_ECONOMY_SKILLS_PLAN.md)。固定職で持続することを先に必須にせず、まず穀物→パンの原料・加工・所有・売買の矛盾を除く。その後、技能獲得と本人の職選択を組み込み、需要に応じた切替で経済の持続性を測る。ここを最初の持続性の目標とする。薪と雇用は停止継続。v10まで製パン・技能獲得・転職は未実装だった。v11では製パンを追加し、技能獲得・転職は未実装。

2026-10-02に現行の整合性を再確認。対象6テスト成功。提示後の腐敗・数量不足・売り手の離脱では購入を拒否し、現物と代金は動かない。sim実装・同梱記録は変更なし。

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
npm run autonomy:village -- 90 --scenario land-home-storage
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-home-storage-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-food-market
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-food-market-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-predictions
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-predictions-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-needs --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-needs-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-bread --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-bread-90.v2.json.gz
npm run autonomy:village -- 90 --scenario land-local-work --daily
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-local-work-90.v2.json.gz
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

[身体・環境と行動選択の計画](baseline/NEEDS_AND_ACTION_SELECTION_PLAN.md)の順1〜4はv12で初期実装し、食品経済と接続した。直近は[小モデルの設計](baseline/MODULAR_PREDICTION_AND_ACTION_PLAN.md)のA〜Dを順に実装する。環境変化への予測更新と行為途中の再検討を含み、一般の避難場所、備蓄量の学習、原料・パン市場の循環と不足対照へ拡張する。その後に技能獲得と職選択を導入して持続性を測る。雇用は当面導入しない。続く候補は遠方の未知植物を探す経路、植物ごとの識別技能、薪の固定森資源をセル別の木へ置き換えること、採集競合、地形別の移動コストから進める。[生態版](baseline/ECOLOGICAL_LAND_V6_RESULT.md)でもFの能動的な野草・果樹採集は最初の3日と森周辺に限る。休止期間は土壌栄養や輪作判断の代替であり、それら自体は未実装。土地利用権の移転・共同利用や契約証拠の一般化も未実装。各対照は別fixture・記録として再現し、正常90日の結果を一般化しない。本編M3の3〜5人の人間試遊は別途未実施。実測と限界の一覧は[STATUS](STATUS.md)。

変更後は `npm test -- --testTimeout 240000 --maxWorkers 1`、`npm run typecheck`、`npm run content:validate`、`npm run build`、旧版と土地経済の記録再実行を確認する。記録画面のブラウザテストは追加済み。ユーザーの既存の許可により `main` のコミット・プッシュが可能。
