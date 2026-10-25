// 骨格（採取だけの経済）のブラウザ画面。既存の村デバッグ画面と同じ見た目で、果実の環を走らせて見る。
// 地図（木・実・人・家・視界と手の届く範囲）、選んだ事物の値の四区分（属性・状態・関係・資源）、日次要約、記録の内訳、計測。
// 起動: launch.json「骨格: ブラウザ画面（採取だけの経済）」または `npm run dev` → http://127.0.0.1:5173/skeleton.html
// 問い合わせ: ?persons=2&sight=20&ripen=0.25&tree=40

import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '../web/style.css';
import { buildFruitScenario, summarize, edibleOn, fruitDef, DT, HOUR, DAY, type Scenario, type ThingSnapshot, type LedgerEntry } from '../../packages/skeleton/index.js';

const q = new URLSearchParams(window.location.search);
const numParam = (k: string, d: number) => {
  const v = Number(q.get(k));
  return Number.isFinite(v) && q.get(k) !== null ? v : d;
};
const options = { persons: numParam('persons', 1), sight: numParam('sight', 60), ripenPerHour: numParam('ripen', 0.25), treeDistance: numParam('tree', 40) };

let scenario: Scenario = buildFruitScenario(options);
let daily: Record<string, number | string>[] = [];
let lastDay = 0;
let running = false;
let ticksPerFrame = 6;
let selected = 'P1';

const root = document.getElementById('root')!;
root.innerHTML = `
<style>
  .sk { padding: 12px 16px; display: grid; gap: 12px; }
  .sk header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sk h1 { font-size: 1.1rem; margin: 0 12px 0 0; }
  .sk .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .sk .controls label { display: inline-flex; gap: 4px; align-items: center; color: #bfc8c1; }
  .sk .controls input { width: 64px; background: #1b2826; color: #e6e3d5; border: 1px solid #526157; border-radius: 4px; padding: 4px 6px; }
  .sk .controls select { background: #1b2826; color: #e6e3d5; border: 1px solid #526157; border-radius: 4px; padding: 4px 6px; }
  .sk .time { font-weight: 700; color: #d6b476; margin-left: auto; }
  .sk .grid { display: grid; grid-template-columns: minmax(0, 640px) minmax(320px, 1fr); gap: 12px; }
  .sk canvas { background: #1e3430; border: 1px solid #35403a; border-radius: 4px; max-width: 100%; height: auto; display: block; }
  .sk .panel { background: #1b2826; border: 1px solid #35403a; border-radius: 4px; padding: 10px 12px; min-width: 0; }
  .sk .panel h2 { font-size: 0.95rem; margin: 0 0 6px; color: #d6b476; }
  .sk table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  .sk th, .sk td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #2c3a35; vertical-align: top; }
  .sk th { color: #9fb0a6; font-weight: 400; white-space: nowrap; }
  .sk td.k { color: #bfc8c1; white-space: nowrap; }
  .sk .kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .sk .kinds h3 { font-size: 0.85rem; margin: 0 0 4px; color: #9fb0a6; }
  .sk .wrap { overflow-x: auto; }
  .sk .events { font-size: 12px; color: #bfc8c1; max-height: 160px; overflow-y: auto; white-space: pre; font-family: ui-monospace, monospace; }
  .sk .note { color: #9fb0a6; font-size: 12px; }
  @media (max-width: 1000px) { .sk .grid { grid-template-columns: 1fr; } }
</style>
<div class="sk">
  <header>
    <h1>骨格: 採取だけの経済（果実の環）</h1>
    <div class="controls">
      <label>人数 <input id="persons" type="number" min="1" max="6" value="${options.persons}"></label>
      <label>視界 m <input id="sight" type="number" min="1" max="500" value="${options.sight}"></label>
      <label>実る 個/時 <input id="ripen" type="number" min="0" max="5" step="0.05" value="${options.ripenPerHour}"></label>
      <label>木まで m <input id="tree" type="number" min="1" max="300" value="${options.treeDistance}"></label>
      <button id="rebuild">作り直す</button>
      <button id="step">1刻み（10分）</button>
      <button id="hour">1時間</button>
      <button id="day">1日</button>
      <button id="run" class="primary">走る</button>
      <label>速さ <select id="speed"><option value="1">1刻み/フレーム</option><option value="6" selected>1時間/フレーム</option><option value="36">6時間/フレーム</option><option value="144">1日/フレーム</option></select></label>
    </div>
    <div class="time" id="time"></div>
  </header>
  <div class="grid">
    <div>
      <canvas id="map" width="640" height="420"></canvas>
      <p class="note">地図: 木（緑）と実（橙。木の周りと、持つ人の脇）、人（黄。破線の円は視界、小さな円は手の届く範囲）、家（白。周りの点は家に置いた実）。実の見える範囲（30m）は薄い円。1 目盛 10m。</p>
    </div>
    <div class="panel">
      <h2>事物の値の四区分 <select id="thing"></select></h2>
      <div class="kinds" id="kinds"></div>
    </div>
  </div>
  <div class="grid">
    <div class="panel"><h2>日次要約</h2><div class="wrap" id="daily"></div></div>
    <div class="panel"><h2>記録の内訳と計測</h2><div id="counts"></div><h2 style="margin-top:8px">事象（直近）</h2><div class="events" id="events"></div></div>
  </div>
</div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;

function fmtTime(min: number): string {
  const d = Math.floor(min / DAY);
  const h = Math.floor((min % DAY) / HOUR);
  const m = Math.floor(min % HOUR);
  return `${d}日 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const fmt = (v: unknown): string => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v));

// ---- 地図 ----
function drawMap() {
  const w = scenario.world;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1e3430';
  ctx.fillRect(0, 0, W, H);
  // 木と家が収まる縮尺。1 目盛 = 10m。
  const tree = w.thing('tree');
  const tx = typeof tree?.state['x'] === 'number' ? (tree.state['x'] as number) : 40;
  const span = Math.max(80, tx + 40);
  const scale = Math.min((W - 80) / span, (H - 80) / 80);
  const ox = 40 + 20 * scale;
  const oy = H / 2;
  const px = (x: number, y: number) => [ox + x * scale, oy + y * scale] as const;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let gx = -20; gx <= span; gx += 10) {
    const [x] = px(gx, 0);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let gy = -40; gy <= 40; gy += 10) {
    const [, y] = px(0, gy);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // 家（事物。札 stores）と、家に置いた実
  for (const h of w.query((t) => 'stores' in t.attr)) {
    const pos = w.positionOf(h.id);
    if (!pos) continue;
    const [hx, hy] = px(pos.x, pos.y);
    ctx.fillStyle = '#e6e3d5';
    ctx.fillRect(hx - 5, hy - 5, 10, 10);
    const stored = edibleOn(w, h.id);
    stored.forEach((f, i) => {
      const a = (i / Math.max(1, stored.length)) * Math.PI * 2;
      const fr = Number(f.res['freshness'] ?? 0) / Number(fruitDef.res?.['freshness'] ?? 2);
      ctx.fillStyle = `rgba(230,140,60,${0.35 + 0.65 * Math.max(0, Math.min(1, fr))})`;
      ctx.beginPath(); ctx.arc(hx + Math.cos(a) * 12, hy + Math.sin(a) * 12, 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#e6e3d5';
    ctx.font = '12px "Noto Sans JP", sans-serif';
    ctx.fillText(`${h.id} 実${stored.length}`, hx - 16, hy + 30);
  }
  // 木と実
  if (tree) {
    const [x, y] = px(tx, Number(tree.state['y'] ?? 0));
    const fruits = edibleOn(w, 'tree');
    const vis = Number(fruitDef.attr?.['visibility'] ?? 30);
    ctx.strokeStyle = 'rgba(214,180,118,0.25)';
    ctx.beginPath(); ctx.arc(x, y, vis * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#3f8a4f';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    fruits.forEach((f, i) => {
      const a = (i / Math.max(1, fruits.length)) * Math.PI * 2;
      const fr = Number(f.res['freshness'] ?? 0) / Number(fruitDef.res?.['freshness'] ?? 2);
      ctx.fillStyle = `rgba(230,140,60,${0.35 + 0.65 * Math.max(0, Math.min(1, fr))})`;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#e6e3d5';
    ctx.font = '12px "Noto Sans JP", sans-serif';
    ctx.fillText(`木 実${fruits.length}`, x - 16, y + 30); // 人の名札（右上・右下）と重ならない位置
  }
  // 人
  scenario.persons.forEach((p, i) => {
    const t = w.thing(p);
    if (!t) return;
    const pos = w.positionOf(p);
    if (!pos) return;
    const [x, y] = px(pos.x, pos.y);
    const dead = t.state['alive'] !== 'yes';
    ctx.strokeStyle = dead ? 'rgba(150,150,150,0.3)' : 'rgba(214,180,118,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, Number(t.attr['sight'] ?? 0) * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, Number(t.attr['reach'] ?? 0) * scale), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = dead ? '#777' : p === selected ? '#ffe08a' : '#d6b476';
    ctx.beginPath(); ctx.arc(x, y + (i % 2 ? 6 : -6), 6, 0, Math.PI * 2); ctx.fill();
    const held = edibleOn(w, p);
    held.forEach((_, j) => {
      ctx.fillStyle = 'rgba(230,140,60,0.9)';
      ctx.beginPath(); ctx.arc(x + 10 + j * 7, y + (i % 2 ? 6 : -6), 2.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#e6e3d5';
    ctx.font = '12px "Noto Sans JP", sans-serif';
    ctx.fillText(`${p} 栄養${Number(t.res['nutrition'] ?? 0).toFixed(1)} ${String(t.state['intent'])}${dead ? ' 死亡' : ''}`, x + 10, y + (i % 2 ? 22 : -14));
  });
}

// ---- 四区分 ----
function kindTable(title: string, rows: [string, unknown][]): string {
  const body = rows.length ? rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${fmt(v)}</td></tr>`).join('') : '<tr><td class="note">（無し）</td></tr>';
  return `<div><h3>${title}</h3><table>${body}</table></div>`;
}
function drawKinds() {
  const w = scenario.world;
  const sel = $<HTMLSelectElement>('thing');
  const ids = w.query((t) => !('edible' in t.attr)).map((t) => t.id).concat(edibleOn(w, 'tree').slice(0, 3).map((f) => f.id));
  if (!ids.includes(selected)) selected = ids[0] ?? '';
  sel.innerHTML = ids.map((id) => `<option value="${id}"${id === selected ? ' selected' : ''}>${id}</option>`).join('');
  const t: ThingSnapshot | undefined = w.thing(selected);
  if (!t) { $('kinds').innerHTML = ''; return; }
  const rel = Object.entries(t.rel).map(([about, e]) => [about, `${fmtTime(Number(e['at']))} (${fmt(e['x'])}, ${fmt(e['y'])}) ${Object.entries(e).filter(([k]) => !['at', 'x', 'y'].includes(k)).map(([k, v]) => `${k}=${fmt(v)}`).join(' ')}`] as [string, unknown]);
  $('kinds').innerHTML =
    kindTable('属性（仕様。更新は書かない）', Object.entries(t.attr)) +
    kindTable('状態', Object.entries(t.state)) +
    kindTable('資源（釣り合う量）', Object.entries(t.res)) +
    kindTable(`関係（心象 ${rel.length} 件）`, rel);
}

// ---- 日次・記録 ----
function drawDaily() {
  if (!daily.length) { $('daily').innerHTML = '<p class="note">1日走ると行が増える。</p>'; return; }
  const keys = Object.keys(daily[0]!);
  const rows = daily.slice(-14).map((r) => `<tr>${keys.map((k) => `<td>${fmt(r[k])}</td>`).join('')}</tr>`).join('');
  $('daily').innerHTML = `<table><thead><tr>${keys.map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}
function drawCounts() {
  const w = scenario.world;
  const counts: Record<string, number> = {};
  for (const e of w.ledger) {
    const key = 'law' in e ? `${e.law}:${e.effect.kind}` : `event:${e.event}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const s = w.stats;
  const t = Math.max(1, s.ticks);
  $('counts').innerHTML =
    `<table>${Object.entries(counts).map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('')}</table>` +
    `<p class="note">事物 ${w.thingCount}、刻み ${s.ticks}。組の検査 ${(s.pairChecks / t).toFixed(0)}/刻み、影響範囲にある組 ${(s.activePairs / t).toFixed(0)}/刻み、法則の評価 ${(s.pairEvaluations / t).toFixed(0)}/刻み、観測 ${(s.observations / t).toFixed(0)}/刻み。記録 ${w.ledger.length} 件。</p>`;
  const ev = w.ledger.filter((e): e is Exclude<LedgerEntry, { law: string }> => 'event' in e).slice(-30).reverse();
  $('events').textContent = ev.map((e) => `${fmtTime(e.at)}  ${e.event.padEnd(6)} ${e.person}${'about' in e ? ' ← ' + e.about : ''}${'intent' in e ? ' ' + e.intent + (e.target ? ' → ' + e.target : '') : ''}`).join('\n');
}

function redraw() {
  $('time').textContent = fmtTime(scenario.world.now);
  drawMap();
  drawKinds();
  drawDaily();
  drawCounts();
}

function advance(ticks: number) {
  const w = scenario.world;
  for (let i = 0; i < ticks; i++) {
    w.tick(DT);
    const day = Math.floor(w.now / DAY);
    if (day > lastDay) {
      daily.push(summarize(w, scenario.persons));
      lastDay = day;
    }
  }
}

function rebuild() {
  running = false;
  $('run').textContent = '走る';
  const opts = { persons: Number($<HTMLInputElement>('persons').value) || 1, sight: Number($<HTMLInputElement>('sight').value) || 60, ripenPerHour: Number($<HTMLInputElement>('ripen').value) || 0.25, treeDistance: Number($<HTMLInputElement>('tree').value) || 40 };
  scenario = buildFruitScenario(opts);
  daily = [];
  lastDay = 0;
  selected = 'P1';
  const url = new URL(window.location.href);
  url.searchParams.set('persons', String(opts.persons));
  url.searchParams.set('sight', String(opts.sight));
  url.searchParams.set('ripen', String(opts.ripenPerHour));
  url.searchParams.set('tree', String(opts.treeDistance));
  history.replaceState(null, '', url);
  redraw();
}

$('rebuild').addEventListener('click', rebuild);
$('step').addEventListener('click', () => { advance(1); redraw(); });
$('hour').addEventListener('click', () => { advance(HOUR / DT); redraw(); });
$('day').addEventListener('click', () => { advance(DAY / DT); redraw(); });
$('run').addEventListener('click', () => { running = !running; $('run').textContent = running ? '止める' : '走る'; });
$<HTMLSelectElement>('speed').addEventListener('change', (e) => { ticksPerFrame = Number((e.target as HTMLSelectElement).value); });
$<HTMLSelectElement>('thing').addEventListener('change', (e) => { selected = (e.target as HTMLSelectElement).value; drawKinds(); drawMap(); });

function frame() {
  if (running) {
    advance(ticksPerFrame);
    redraw();
  }
  requestAnimationFrame(frame);
}
redraw();
requestAnimationFrame(frame);
