// 新しい事物の実験（study/new-things。docs/RESEARCH.md 10.10）。試作の心（packages/skeleton/affordance.ts）を、六つの世界（packages/skeleton/novel.ts）で、
// 上の層の段（affMeta 0〜3）と、学んだ知識を持って行くかを変えて走らせ、生死・食べた数・実りの無い試し・初めての時刻を出す。
// 使い方: npm run novel [-- 日数]（既定 30 日、配置三通り。数分かかる）。
import { runNovel, portableKnowledge, type NovelName } from '../skeleton/novel.js';
type Row = { label: string; world: NovelName; from?: NovelName; meta?: number; person?: string; key: string };
const rows: Row[] = [
  { label: 'fruit: forager', world: 'fruit', person: 'person', key: 'eat:fruit' },
  { label: 'fruit: learner m3', world: 'fruit', meta: 3, key: 'eat:fruit' },
  { label: 'grain: forager (no knowledge)', world: 'grain', person: 'person', key: 'make:gruel' },
  { label: 'grain: farmer (given knowledge)', world: 'grain', person: 'farmer', key: 'make:gruel' },
  { label: 'grain: learner m0', world: 'grain', meta: 0, key: 'make:gruel' },
  { label: 'grain: learner m3', world: 'grain', meta: 3, key: 'make:gruel' },
  { label: 'grainApart: forager', world: 'grainApart', person: 'person', key: 'make:gruel' },
  { label: 'grainApart: farmer', world: 'grainApart', person: 'farmer', key: 'make:gruel' },
  { label: 'grainApart: learner m0', world: 'grainApart', meta: 0, key: 'make:gruel' },
  { label: 'grainApart: learner m3', world: 'grainApart', meta: 3, key: 'make:gruel' },
  { label: 'barley: naive m0', world: 'barley', meta: 0, key: 'make:gruel' },
  { label: 'barley: naive m3', world: 'barley', meta: 3, key: 'make:gruel' },
  { label: 'barley: from grain m0', world: 'barley', from: 'grain', meta: 0, key: 'make:gruel' },
  { label: 'barley: from grain m2', world: 'barley', from: 'grain', meta: 2, key: 'make:gruel' },
  { label: 'barley: from grain m3', world: 'barley', from: 'grain', meta: 3, key: 'make:gruel' },
  { label: 'oak: naive m0', world: 'oak', meta: 0, key: 'eat:berry' },
  { label: 'oak: from fruit m3', world: 'oak', from: 'fruit', meta: 3, key: 'eat:berry' },
  { label: 'nut: naive m0', world: 'nut', meta: 0, key: 'pick:nut' },
  { label: 'nut: naive m3', world: 'nut', meta: 3, key: 'pick:nut' },
  { label: 'nut: from fruit m3', world: 'nut', from: 'fruit', meta: 3, key: 'pick:nut' },
  { label: 'gall: naive m0', world: 'gall', meta: 0, key: 'eat:fruit' },
  { label: 'gall: from fruit m0', world: 'gall', from: 'fruit', meta: 0, key: 'eat:fruit' },
  { label: 'gall: from fruit m2', world: 'gall', from: 'fruit', meta: 2, key: 'eat:fruit' },
  { label: 'gall: from fruit m3', world: 'gall', from: 'fruit', meta: 3, key: 'eat:fruit' },
];
const days = Number(process.argv[2] ?? 30);
for (const layout of ['base', 'near', 'far'] as const) {
  const trained = new Map<string, any>();
  for (const r of rows) {
    let knowledge;
    if (r.from) {
      const k = `${r.from}:${r.meta}`;
      if (!trained.has(k)) trained.set(k, portableKnowledge(runNovel(r.from, 30, { attr: { affMeta: r.meta ?? 3 }, layout }).world, 'P1'));
      knowledge = trained.get(k);
    }
    const res = runNovel(r.world, days, { person: r.person, attr: r.person ? undefined : { affMeta: r.meta ?? 3 }, knowledge, layout });
    const rel = res.world.thing('P1')!.rel;
    let futile = 0;
    for (const [k, e] of Object.entries(rel)) if (k.startsWith('aff:s:') && e['s'] === 0) futile += (e['n'] as number) - ((knowledge?.[k]?.['n'] as number | undefined) ?? 0);
    const o: any = res.outcome;
    const eaten = Object.entries(o).filter(([k]) => k.startsWith('eat:')).reduce((a, [, v]) => a + Number(String(v).split('（')[0]), 0);
    const key = o[r.key] ? String(o[r.key]).replace(/^(\d+)（初め ([\d.]+) 時）$/, '$1 / first $2h') : '-';
    console.log([layout, r.label, o.alive ? 'alive' : `died d${o.diedDay}`, `eaten ${eaten}`, r.person ? '' : `futile ${futile}`, `${r.key} ${key}`].join(' | '));
  }
}
