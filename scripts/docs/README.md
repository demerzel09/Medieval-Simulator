# 文書と図の検査スクリプト

設計文書の検証に使う補助スクリプト。scratchpad（会話ごとの一時領域）から移したもので、これ自体は正本ではない。閲覧用ページの正本は `docs/figures/big-structure-page.html`（公開先は https://claude.ai/artifact/1NpxGSDuVAjkQRjhiiU1BR ）。

| スクリプト | 役割 | 前提 |
|---|---|---|
| `check-md-links.mjs` | Markdown の相対リンク・見出しアンカー・`<a id>` の到達と、コードフェンスの対応を検査する | Node だけ。`node scripts/docs/check-md-links.mjs . docs/DESIGN.md docs/STATUS.md …` |
| `render-mermaid.cjs` | `.mmd` を Mermaid 11.4.1・10.9.1・9.1.7 の既定設定でヘッドレス描画し、エラーと大きさを出す | 下の Mermaid 置き場 `DIR` と、リポジトリの playwright。`NODE_PATH=$PWD/node_modules node scripts/docs/render-mermaid.cjs DIR a.mmd b.mmd` |
| `render-page.cjs` | 閲覧用ページの `<pre class="mermaid" data-id="figN">` を Mermaid 11.4.1 で SVG に描画して埋め込む（id は衝突しないよう data-id を使う） | 同上。`NODE_PATH=$PWD/node_modules node scripts/docs/render-page.cjs DIR docs/figures/big-structure-page.html` |
| `parse-mermaid-9.cjs` | `.mmd` が Mermaid 9.1.7 で `parse` に通るかを調べる | `DIR/node_modules/jsdom` と `DIR/old/node_modules/mermaid@9.1.7`。`cd DIR/old && node /path/to/parse-mermaid-9.cjs ../x.mmd` の形で、相対パスは置き場に依存する |
| `browser-check.cjs` | Vite の開発サーバを起動し、`skeleton.html` をヘッドレス Chromium で開いて 3 日進め、描画とコンソールエラーを確認する | リポジトリの playwright。`NODE_PATH=$PWD/node_modules node scripts/docs/browser-check.cjs out.png` |

## Mermaid の置き場 `DIR` の作り方

Mermaid はリポジトリの依存ではないので、一時ディレクトリに入れる。

```
mkdir -p /tmp/mmd/v10 /tmp/mmd/old && cd /tmp/mmd
npm init -y >/dev/null && npm i --silent mermaid@11.4.1 jsdom
(cd v10 && npm init -y >/dev/null && npm i --silent mermaid@10.9.1)
(cd old && npm init -y >/dev/null && npm i --silent mermaid@9.1.7)
```

`render-mermaid.cjs` と `render-page.cjs` は `DIR/node_modules/mermaid`（11.4.1）、`DIR/v10/node_modules/mermaid`（10.9.1）、`DIR/old/node_modules/mermaid`（9.1.7）を見る。

## 閲覧用ページの更新の手順

1. DESIGN.md の Mermaid を直す（正本）。
2. ページの該当図を直す。手書き SVG（図1〜図4）は HTML の中を直接編集する。Mermaid 描画の図（図A・図B・図5〜図7）は `<svg id="figN">…</svg>` を `<pre class="mermaid" data-id="figN">` のブロックに戻してから `render-page.cjs` で描画し直す。
3. `check-md-links.mjs` と `git diff --check` を通し、ページを Artifact として同じ URL に再公開する。

Mermaid の構文は、矢印つき辺と `<br/>` 入りの箱だけの基本形に限る（subgraph、点線、二重括弧の箱、辺のラベルの括弧は避ける）。ユーザーの VS Code プレビューで DESIGN.md の最初のブロックが出ない件は未解決（2026-10-25）。
