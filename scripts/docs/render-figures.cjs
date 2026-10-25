// docs/figures/src/*.mmd を Mermaid で描画し、docs/figures/*.svg に書く。
// 文書は SVG の画像を参照する（プレビューや HTML 出力の Mermaid 拡張に依存しない）。
// 使い方: NODE_PATH=$PWD/node_modules node scripts/docs/render-figures.cjs <mermaid.min.js のパス> [名前...]
//   名前を省くと src の全ファイル。Mermaid は一時ディレクトリに npm i mermaid@11.12.2 などで入れる（README 参照）。
// 文字は <text> で出す（htmlLabels: false）。<img> で表示できる自己完結の SVG にするため。
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const [mermaidPath, ...names] = process.argv.slice(2);
if (!mermaidPath) {
  console.error('usage: node render-figures.cjs <mermaid.min.js> [name...]');
  process.exit(2);
}
const root = path.resolve(__dirname, '../..');
const srcDir = path.join(root, 'docs/figures/src');
const outDir = path.join(root, 'docs/figures');
(async () => {
  const files = (names.length ? names.map((n) => (n.endsWith('.mmd') ? n : n + '.mmd')) : fs.readdirSync(srcDir).filter((f) => f.endsWith('.mmd'))).sort();
  const src = fs.readFileSync(mermaidPath, 'utf8');
  const version = (src.match(/version:"(\d+\.\d+\.\d+)"/) || [])[1] ?? '?';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.setContent('<html><body style="margin:0;background:#fff"></body></html>');
  await page.addScriptTag({ content: src });
  for (const file of files) {
    const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const id = 'f_' + file.replace(/\.mmd$/, '').replace(/[^a-zA-Z0-9]/g, '_');
    const result = await page.evaluate(async ([code, id]) => {
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: false }, sequence: { useMaxWidth: false }, class: { useMaxWidth: false }, fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' });
        const { svg } = await mermaid.render(id, code);
        return { svg };
      } catch (e) {
        return { error: String((e && (e.message || e.str)) || e).slice(0, 300) };
      }
    }, [code, id]);
    if (result.error) {
      console.error(`${file}: ERROR ${result.error}`);
      process.exitCode = 1;
      continue;
    }
    let svg = result.svg;
    if (/<foreignObject/.test(svg)) console.warn(`${file}: warning: foreignObject present; <img> may not show it`);
    // <img> で本来の大きさになるよう、viewBox から幅と高さを明示する（width="100%" や style の max-width は外す）。
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
    if (vb) {
      const w = Math.ceil(Number(vb[3]));
      const h = Math.ceil(Number(vb[4]));
      svg = svg.replace(/^<svg([^>]*)>/, (m, attrs) => '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sstyle="[^"]*"/, '') + ` width="${w}" height="${h}">`);
    }
    if (!/^<\?xml/.test(svg)) svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
    const out = path.join(outDir, file.replace(/\.mmd$/, '.svg'));
    fs.writeFileSync(out, svg);
    const size = (svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/) || []).slice(1, 3).map((v) => Math.round(Number(v))).join('x');
    console.log(`${file} → ${path.relative(root, out)} (${size}, mermaid ${version})`);
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
