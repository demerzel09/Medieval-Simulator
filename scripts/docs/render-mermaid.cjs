// Render several .mmd files with several Mermaid versions in headless Chromium, default settings (as a Markdown preview would),
// and report render errors. Usage: node render-multi.cjs <DIR> <file.mmd>...
const { chromium } = require('playwright');
const fs = require('fs');
const [DIR, ...files] = process.argv.slice(2);
const versions = [
  ['11.4.1', DIR + '/node_modules/mermaid/dist/mermaid.min.js'],
  ['10.9.1', DIR + '/v10/node_modules/mermaid/dist/mermaid.min.js'],
  ['9.1.7', DIR + '/old/node_modules/mermaid/dist/mermaid.min.js'],
];
(async () => {
  const browser = await chromium.launch();
  for (const [ver, path] of versions) {
    const src = fs.readFileSync(path, 'utf8');
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
      await page.setContent('<html><body style="margin:0;background:#fff"><div id="out"></div></body></html>');
      await page.addScriptTag({ content: src });
      const result = await page.evaluate(async (code) => {
        try {
          mermaid.initialize({ startOnLoad: false });
          const r = await mermaid.render('g1', code);
          const svg = (r && r.svg) || (typeof r === 'string' ? r : undefined);
          if (!svg) return 'no svg returned';
          document.getElementById('out').innerHTML = svg;
          const el = document.querySelector('#out svg');
          const bb = el ? el.getBoundingClientRect() : null;
          const texts = el ? el.querySelectorAll('text, foreignObject').length : 0;
          return `rendered ${svg.length} chars, box ${bb ? Math.round(bb.width) + 'x' + Math.round(bb.height) : 'none'}, labels ${texts}`;
        } catch (e) { return 'RENDER ERROR: ' + ((e && (e.message || e.str)) || String(e)).slice(0, 300); }
      }, code);
      const name = file.replace(/.*\//, '').replace(/\.mmd$/, '');
      await page.screenshot({ path: `${DIR}/multi-${ver}-${name}.png`, fullPage: true });
      console.log(`[${ver}] ${name}: ${result}${errors.length ? ' || ' + errors.join(' || ') : ''}`);
      await page.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
