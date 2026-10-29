// 実験の世界の一人の歩みを、刻みごとに表示する（docs/RESEARCH.md 10.10 の失敗を調べるため）。
// 使い方: npx tsx packages/tools/novel-trace.ts 世界 学んだ世界|- 上の層の段 配置 時間 何刻みおき [始める時]
import { buildNovel, runNovel, portableKnowledge, type NovelName } from '../skeleton/novel.js';
import { DT, HOUR } from '../skeleton/fruit.js';
import { readOptions } from '../skeleton/affordance.js';
const [world, from, metaS, layout, hoursS, everyS, startS] = process.argv.slice(2);
const meta = Number(metaS);
const lay = layout as 'base' | 'near' | 'far';
const k = from !== '-' ? portableKnowledge(runNovel(from as NovelName, 30, { attr: { affMeta: meta }, layout: lay }).world, 'P1') : undefined;
const { world: w } = buildNovel(world as NovelName, { attr: { affMeta: meta }, knowledge: k, layout: lay });
for (let i = 0; i < (Number(hoursS) * HOUR) / DT; i++) {
  w.tick(DT);
  if (i % Number(everyS) || w.now / HOUR < Number(startS ?? 0)) continue;
  const p = w.thing('P1')!;
  if (p.state['alive'] !== 'yes') { console.log((w.now / HOUR).toFixed(1), 'dead'); break; }
  const opts = readOptions(p.rel).slice(0, 4).map((o) => `${o.intent}/${o.act}:${o.obj}@${o.target}[f${o.food.toFixed(2)} r${o.ready.toFixed(2)} w${o.raw.toFixed(2)} i${o.info.toFixed(2)} t${o.ticks.toFixed(1)}${o.keep ? ' K' : ''}]`);
  const held = Object.entries(p.rel).filter(([, e]) => e['attachedTo'] === 'P1').map(([, e]) => e['kind']).join(',');
  const v = p.rel['aff:value'];
  console.log((w.now / HOUR).toFixed(1), p.state['intent'], p.state['target'], `(${Number(p.state['x']).toFixed(0)},${Number(p.state['y']).toFixed(0)})`, 'n', (p.res['nutrition'] ?? 0).toFixed(2), 's', (p.res['stomach'] ?? 0).toFixed(1), 'held', held, `v${Number(v?.['ready']).toFixed(1)}/${Number(v?.['raw']).toFixed(1)}`, '|', opts.join(' '));
}
