# 土地経済の実走結果 — 5人・90日

更新: 2026-09-27。[実装計画](LAND_ECONOMY_NEXT_PLAN.md)の順2〜4。順1の[算術候補](LAND_ECONOMY_FEASIBILITY_V1.md)を、同じ5人世界の起床・人格判断・物理Gatewayで実行した結果。旧版の野生ベリー中心の[版2記録](VILLAGE_RECORDING_AND_LAND_V2.md)とは別のfixture・記録である。

## 実装した因果の連鎖

[候補fixture](../../fixtures/land-economy-90.ts)から穀物4区画、Fの初期種4、穀物技能2、野生ベリー初期20・再生0、全員の初期体力20を新モードへ渡す。穀物区画は同じfield siteの別パッチで、Fの土地利用権を明示する。Fは**現地で見た段階**と作物技能から耕作・播種・収穫を選ぶ。Cが森でFに会えるまで注文の口頭中継を待ち、Fは畑から森へ食品を持ち帰って引き渡す。現物・委託金・所有権が揃った時だけCが購入し、市場へ運んだ食品をSが販売する。F/C/S/B1/B2はそれぞれ本人の食品ロットを食べる。世界は職業別の作業を代行しない。

収穫ロットに植物パッチID・種・産地・収穫日を残し、分割・運搬・販売・食事まで引き継ぐ。Eventにも食品の由来を含め、日別CLIで食事の由来を集計する。場所の観察には同じsiteにいる人物を含め、CはFが森にいない時に中継を試行せず待つ。旧 `autonomous_village` 版2のfixtureにはこの追加観察・法則を適用せず、[同梱の旧90日記録](../../fixtures/recordings/autonomous-village-90.v2.json.gz)がそのまま再実行できる。

## 正常90日の実測

`npm run autonomy:village -- 90 --scenario land-economy --daily` と[同梱の記録](../../fixtures/recordings/autonomous-village-land-90.v2.json.gz)で再現できる。

この5×5の場所モデルを画面に拡大した旧表示は意図した空間モデルではなかった。後続の[40×24セルの空間版](SPATIAL_GRID_V4_RESULT.md)では、作物と移動を実際のセルに置き、1280×768ピクセルの画面と別の90日記録を使う。

| 指標 | 実測 |
|---|---:|
| 全員の食事・薪使用 | 各日1回、各90回。欠食・未使用0 |
| 食品の収穫・食事・腐敗 | 450・450・0 |
| 食事の由来 | 穀物435、野生ベリー15 |
| 日61〜90の食事 | 150/150食が穀物 |
| 穀物収穫・食品配送 | 各87・90回 |
| 薪の採集・使用 | 各450 |
| 野生ベリー末日残量 | 5。日次再生0 |
| 通貨 | 初期・末日とも26 |
| 正常系の拒否・作業失敗 | 0 |
| Event・圧縮記録 | 29,063件・約0.84 MB |

森―畑―森の移動、72時間成長、袋容量、F/Cの同時所在、通知到達を時刻ごとに通過した。4日目の途中セーブを復元して同時刻まで進めた状態ハッシュが一致した。記録済み人格応答からの90日Gateway再実行は状態・Eventハッシュが一致した。世界セーブはschemaVersion 2、記録はformatVersion 2を維持し、土地経済の規則を `autonomous-village-land-economy-v2` として旧規則から区別する。

```bash
npm run autonomy:village -- replay fixtures/recordings/autonomous-village-land-90.v2.json.gz
npm run autonomy:village -- history fixtures/recordings/autonomous-village-land-90.v2.json.gz F /tmp/land-farmer-history.json
```

## 不足・経路変更の対照

各対照を独立に実行・記録し、資源や資金を世界側で補わない。`--scenario` は `land-few-plots`、`land-few-seeds`、`land-poor-yield`、`land-farmer-refuses`、`land-no-skill`、`land-late-information`、`land-long-field`、`land-road-blocked`、`land-starvation` を選べる。

| 条件 | 実走の最初の目立つ変化 |
|---|---|
| 4→3区画 | 7日目にSらが欠食。Fは同日再播種で穀物を収穫できても、畑から取引までの時刻が間に合わない。 |
| 初期種4→2 | 3日目の播種を拒否。Sらの食事が途切れる。 |
| 穀物収量5→4 | 4日目から4食の収穫ではFの自家消費と4食の納品が両立しない。 |
| Fが拒否、穀物技能0、注文の到達24時間遅延 | 通常の初日取引が成立せず、買主側は初日から欠食。 |
| 森―畑の距離を延長 | 通行止めなしでも3日目に取引時刻が間に合わない。算術上の時間合計だけでは十分でないことを示す。 |
| 移動中に2セル通行止め | Fが道中でA*再探索を記録。長距離・閉鎖なしの条件との差分は1日目5時間目の地形Eventから始まり、生活結果も変わる。 |
| 草・野草の供給0 | ウサギ2匹が餌を得られず飢餓死し、植物・動物・物体木の数量が一致する。 |

区画対照では、[算術候補](LAND_ECONOMY_FEASIBILITY_V1.md)の「前日に収穫した区画を翌日に播く」予定なら7日目に成熟区画がない。一方、実世界のFは同日再播種も選ぶため7日目にも収穫するが、時刻順の結果として納品が遅れる。この差は算術モデルを実走へ置き換える必要を示す。

[3区画の7日記録](../../fixtures/recordings/autonomous-village-land-few-plots-7.v2.json.gz)は正常記録と比較できる。[長距離だけの3日記録](../../fixtures/recordings/autonomous-village-land-long-field-3.v2.json.gz)と[途中閉鎖の3日記録](../../fixtures/recordings/autonomous-village-land-road-blocked-3.v2.json.gz)は初期地図・fixtureが等しく、地形Commandだけが異なる。

```bash
npm run autonomy:village -- compare fixtures/recordings/autonomous-village-land-long-field-3.v2.json.gz fixtures/recordings/autonomous-village-land-road-blocked-3.v2.json.gz
```

## 生態と道路の局所法則

土地経済の生態規則では、果樹は果実採集後に再生・開花を経て結実し、野草と草はそれぞれの周期で再生する。30日ごとに季節が変わり、正常90日は春→夏→秋となる。冬は果樹の結実を止め、野草・草の再生に2倍の時間を要する。穀物の72時間成長はこの90日条件では季節で変えない。ウサギは雌雄・成長・餌・位置を持ち、成体の給餌と近隣の相手が揃うと繁殖し、飢餓または寿命で死ぬ。正常90日の出生・死亡は各6で、初期2匹から末日2匹。個体の生成・移動・死亡を物体木にも反映し、初期個体＋出生−死亡＝現存個体を検算する。

通行中の人物が同じ非siteセルを占めようとした時は、観察できる現在位置から迂回路を探索し、なければ待つ。既に使った時間と体力は戻さない。市場・森などsite内の複数人同居は許す。これはセル単位の道路競合で、連続座標の衝突や群衆流動ではない。

## 適用範囲と次の課題

成立したのは5人・単一地図・固定価格信念・rule人格・4区画の正常条件である。土地利用権はFの固定権限で、所有移転や共同利用は扱わない。果実・野草は成長と採集を検証したが、通常90日の主食に組み込んでいない。冬は局所法則の対照で確認し、正常90日は秋まで。動物の繁殖は食物連鎖全体の均衡を保証しない。次は契約権限、作物・技能・価格・人口・地理を変えた一般化を個別に検証する。本編M3の人間試遊も別途未実施。
