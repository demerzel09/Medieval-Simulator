# 設定のファイル（骨格の場面）

ここにあるのは、骨格（`packages/skeleton/`）の世界を作る設定のファイルです。書くのは、使う部品の組、追加の定義、世界の設定、置く物の一覧だけです。法則・感覚・記憶の規則・心はコードにあり、設定からは名前で呼びます。

## 走らせる・記録する・確かめる

```
npm run scenario -- run scenarios/season-forest.json                     # 走らせて、記録の内訳と生死を出す
npm run scenario -- run scenarios/season-forest.json --days 10 --record out.json.gz   # 記録のファイルを書く
npm run scenario -- verify out.json.gz                                    # 記録から再生・設定から走らせ直しで同じになるか
npm run scenario -- export season-forest > scenarios/season-forest.json  # 構築関数の場面を設定に書き出す
```

記録のファイル（`skeleton-recording/1`）には、設定そのもの、使った法則・感覚・記憶の規則の名と版、初期状態、記録（ledger）、最後の状態の要約が入ります。`verify` は三つを確かめます。
- 部品の版が、いまのコードと同じか
- 記録から再生すると、最後の状態と記録が同じになるか
- 設定から走らせ直すと、同じになるか

## 書き方（`skeleton-scenario/1`）

```json
{
  "format": "skeleton-scenario/1",
  "name": "例",
  "description": "説明",
  "modules": ["fruit", "season"],
  "defs": [{ "name": "bigTree", "parent": "treeA", "attr": { "cap": 24 } }],
  "world": { "days": 72, "dt": 10, "pairOrder": "sorted" },
  "things": [
    { "id": "nature", "def": "nature" },
    { "id": "wood", "def": "forest", "x": 0, "y": 0 },
    { "id": "T", "def": "bigTree", "x": 0, "y": 0, "attr": { "ripenPerHour": 0.5, "sowPerDay": 2, "lifespan": 34560 } },
    { "id": "home", "def": "home", "x": 60, "y": 0 },
    { "id": "P1", "def": "patroller", "x": 61, "y": 0, "attr": { "appetite": 7 } }
  ]
}
```

- **`modules`**: 部品の組の名です。
  - `fruit`: 自然・木・実・刃物・人・家と、その法則、視覚、採取者の心
  - `grain`: 穀物の畑・穀物・粥・炉と、加工の法則
  - `season`: 時期のある木・森・巡回者と、枯れる・まく法則、見込みの記憶の規則、巡回者の心
- **`defs`**: 追加の定義（データ）です。同じ名の定義があれば置き換えます。親の定義から既定値を継ぎます。
- **`things`**: 一覧の順に、定義から置きます。
  - `x`・`y` は位置です。`attr`・`state`・`res`・`rel` は、定義の既定値への上書きです。
  - 心は札 `mind` で付きます。家への所属は法則「住む」で得るので、書く必要はありません。木がどの森に属するかも、位置で決まります。
  - 物どうしのつながりとして書けるのは、位置と、付いている関係（`state.attachedTo`。木に付いた実、人の持ち物）と、置いたときの心象（`rel`。例えば穀物を加工すると食べ物になるという知識）だけです。
- **自然（札 `grows`・`sink` を持つ `nature`）**: 実り・腐り・種まきの相手なので、果実の段では一つ置きます。
- **時間**: 時間は分で書きます（1 日 = 1440、季節の一年 = 24 日 = 34560）。
- **id の番号**: `頭#番号` の形の id を置くと、その番号までは、後で生まれる物の id に使われません。

## 置いてあるファイル
いまのファイルは、構築関数の場面（`packages/skeleton/`）を `export` で書き出したものです。初期の実を木に付ける記録（`seed`）を除いて、構築関数の場面と同じ記録・同じ状態になります（テスト）。
- `fruit-one`・`fruit-two`: 一本の木と採取者一人・二人
- `placed-village`: 置くだけの村
- `grain-naive`・`grain-knows`: 穀物の段（違いは心象の知識だけ）
- `season-orchard`: 時期の違う三種の木が森ごとに一本、巡回者 2・採取者 2
- `season-forest`: 森が六つで、木は種をまき、寿命で枯れる。二段で覚える巡回者と、一本ずつ覚える巡回者

構築関数の計算で決めていた値（森の木の位置、家の周りの人の位置、場面の選択から写した属性）は、ここでは書き出した結果の数値になっています。
