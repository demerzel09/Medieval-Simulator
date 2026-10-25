const fs = require('fs');
const { JSDOM } = require('../node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.navigator = dom.window.navigator;
for (const k of ['HTMLElement','SVGElement','Element','Node','DocumentFragment','MutationObserver','getComputedStyle','DOMParser']) { if (!(k in globalThis)) globalThis[k] = dom.window[k]; }
const mermaid = require('./node_modules/mermaid/dist/mermaid.min.js');
mermaid.initialize({ startOnLoad: false });
for (const f of process.argv.slice(2)) {
  const txt = fs.readFileSync(f, 'utf8');
  try { const r = mermaid.parse(txt); console.log(`${f}: OK (${r})`); }
  catch (e) { console.log(`${f}: ERROR ${String(e.str || e.message || e).split('\n').slice(0,4).join(' | ')}`); }
}
