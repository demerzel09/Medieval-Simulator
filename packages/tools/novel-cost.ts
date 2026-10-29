// 試しの費用を上げた世界で、上の層の差が生死に効くか（docs/RESEARCH.md 10.10）。歩く費用（札 walkCostPerMeter）を倍率で上げ、
// 上の層の段（affMeta 0・3）と、学んだ知識を持って行くかを変えて、生死と実りの無い試しを比べる。使い方: npx tsx packages/tools/novel-cost.ts
import { runNovel, portableKnowledge, type NovelName } from '../skeleton/novel.js';
const base = 0.0005;
for (const mult of [5, 10]) {
  const attr = (meta: number) => ({ affMeta: meta, walkCostPerMeter: base * mult });
  const k = (from: NovelName, meta: number) => portableKnowledge(runNovel(from, 30, { attr: attr(meta) }).world, 'P1');
  const rows: [string, NovelName, NovelName | undefined, number][] = [
    ['grain naive', 'grain', undefined, 0], ['grain naive', 'grain', undefined, 3],
    ['grainApart naive', 'grainApart', undefined, 0], ['grainApart naive', 'grainApart', undefined, 3],
    ['barley from grain', 'barley', 'grain', 0], ['barley from grain', 'barley', 'grain', 3],
    ['nut naive', 'nut', undefined, 0], ['nut naive', 'nut', undefined, 3],
    ['gall from fruit', 'gall', 'fruit', 0], ['gall from fruit', 'gall', 'fruit', 3],
  ];
  for (const [label, world, from, meta] of rows) {
    const knowledge = from ? k(from, meta) : undefined;
    const r = runNovel(world, 30, { attr: attr(meta), knowledge });
    let futile = 0;
    for (const [key, e] of Object.entries(r.world.thing('P1')!.rel)) if (key.startsWith('aff:s:') && e['s'] === 0) futile += (e['n'] as number) - ((knowledge?.[key]?.['n'] as number | undefined) ?? 0);
    console.log(`walk x${mult} | ${label} m${meta} | ${r.outcome.alive ? 'alive' : `died d${r.outcome.diedDay}`} | futile ${futile}`);
  }
  for (const p of ['person', 'farmer']) console.log(`walk x${mult} | grain ${p} | ${(() => { const r = runNovel('grain', 30, { person: p, attr: { walkCostPerMeter: base * mult } }); return r.outcome.alive ? 'alive' : `died d${r.outcome.diedDay}`; })()}`);
}
