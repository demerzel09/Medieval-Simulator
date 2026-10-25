// Render <pre class="mermaid" data-id="X"> blocks in an HTML file to inline SVG with Mermaid 11.4.1,
// using the given id so the SVG's scoped <style> and marker ids don't collide with figures already embedded.
const { chromium } = require('playwright');
const fs = require('fs');
const [DIR, htmlPath] = process.argv.slice(2);
(async () => {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const re = /<pre class="mermaid" data-id="(\w+)">\n([\s\S]*?)<\/pre>/g;
  const blocks = [...html.matchAll(re)].map((m) => ({ id: m[1], code: m[2] }));
  const src = fs.readFileSync(DIR + '/node_modules/mermaid/dist/mermaid.min.js', 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="out"></div></body></html>');
  await page.addScriptTag({ content: src });
  const svgs = [];
  for (const { id, code } of blocks) {
    const svg = await page.evaluate(async ([code, id]) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: false }, fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' });
      const { svg } = await mermaid.render(id, code);
      return svg;
    }, [code, id]);
    svgs.push(svg);
  }
  await browser.close();
  let n = 0;
  html = html.replace(re, () => svgs[n++]);
  fs.writeFileSync(htmlPath, html);
  const ids = [...html.matchAll(/<svg id="(\w+)"/g)].map((m) => m[1]);
  console.log(`blocks=${blocks.length} replaced=${n} svg-ids=${ids.join(',')} sizes=${svgs.map((s) => (s.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/) || []).slice(1, 3).map(Number).map(Math.round).join('x')).join(',')}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
