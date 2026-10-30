// 村の実験（study/new-things。docs/RESEARCH.md 10.10「他人から学び、他人と比べる」）。一回ずつ走らせて JSON の一行を出し、まとめは別に行う。
// 一回に数分かかるので、並べて走らせる。例（14 並び）:
//   npx tsx packages/tools/village.ts list > jobs.txt
//   cat jobs.txt | xargs -P 14 -L 1 sh -c 'npx tsx packages/tools/village.ts run "$0" "$1"' > out.jsonl
//   npx tsx packages/tools/village.ts sum out.jsonl
// 入れ替わる村は turn-list / turn / turn-sum で同じように走らせる。`npm run village` は使い方を出す（npm の見出しが出力に混じるので、一覧は npx tsx で取る）。
import { readFileSync } from 'node:fs';
import { runVillage, runVillageTurnover, type VillageOptions } from '../skeleton/village.js';

/** 本番の比べる条件: 炉の位置 × 村の顔ぶれ（外れ値の人数）× 学び方。歩く費用 5 倍、点数は正味、皆が上手くいっている人に付いて行く。 */
const learn: Record<string, Partial<VillageOptions>> = { solo: {}, watch: { social: 0.5 }, cmp: { social: 0.5, compare: 1 } };
const mix: Record<string, number> = { '0out': 0, '1out': 1, '4out': 4 };
const conds: Record<string, VillageOptions> = {};
for (const [hn, hearth] of [['near', undefined], ['apart', [25, 25]]] as const)
  for (const [m, outliers] of Object.entries(mix))
    for (const [l, v] of Object.entries(learn)) conds[`${hn}_${m}_${l}`] = { n: 4, outliers, need: 1, walk: 5, net: 1, follow: 1, ...(hearth ? { hearth: [...hearth] as [number, number] } : {}), ...v };
const SEEDS = ['a', 'b', 'c'];

/** 入れ替わる村の条件: 人数 × 伝わり方（見ない・見る・見て種類の知識を教わる・見て種類と場所を教わる）。 */
const channels: Record<string, { watch: boolean; teach: number; places?: boolean }> = {
  none: { watch: false, teach: 0 },
  watch: { watch: true, teach: 0 },
  teach: { watch: true, teach: 0.5 },
  tell: { watch: true, teach: 0.5, places: true },
};
const SIZES = [2, 4, 8];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
type Person = { id: string; alive: boolean; diedDay?: number; firstGruelDay?: number; gruel: number; futile: number; arrivedDay?: number };

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'list') {
  for (const name of Object.keys(conds)) for (const s of SEEDS) console.log(`${name} ${s}`);
} else if (cmd === 'run') {
  const o = { ...conds[a1!]!, seed: a2! };
  const r = runVillage(o, 30);
  console.log(JSON.stringify({ label: a1, seed: a2, outliers: o.outliers, people: r.outcome }));
} else if (cmd === 'sum') {
  const rows = readFileSync(a1!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { label: string; outliers: number; people: Person[] });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.label, [...(by.get(r.label) ?? []), r]);
  for (const [label, rs] of [...by.entries()].sort()) {
    const part = (outlier: boolean) => rs.flatMap((r) => r.people.filter((_, i) => i < r.outliers === outlier));
    const line = (ps: Person[]) => {
      if (!ps.length) return '-';
      const makers = ps.filter((p) => p.gruel > 0);
      return `alive ${ps.filter((p) => p.alive).length}/${ps.length} | made gruel ${makers.length} (before day 10: ${makers.filter((p) => p.firstGruelDay! < 10).length}) | first ${mean(makers.map((p) => p.firstGruelDay!)).toFixed(1)}d | futile ${mean(ps.map((p) => p.futile)).toFixed(0)}`;
    };
    const all = rs.flatMap((r) => r.people);
    console.log(`${label.padEnd(18)} runs ${rs.length} | all alive ${all.filter((p) => p.alive).length}/${all.length} || outliers ${line(part(true))} || shy ${line(part(false))}`);
  }
} else if (cmd === 'turn-list') {
  for (const n of SIZES) for (const ch of Object.keys(channels)) for (const s of ['a', 'b']) console.log(`${n} ${ch}:${s}`);
} else if (cmd === 'turn') {
  const n = Number(a1);
  const [ch, seed] = a2!.split(':') as [string, string];
  const c = channels[ch]!;
  const o: VillageOptions = { n, outliers: 1, need: 1, social: c.watch ? 0.5 : 0, walk: 5, net: 1, follow: 1, seed };
  const r = runVillageTurnover(o, { start: 12, life: 16, days: 44, teach: c.teach, teachPlaces: c.places });
  console.log(JSON.stringify({ n, channel: ch, seed, people: r.outcome }));
} else if (cmd === 'turn-sum') {
  const rows = readFileSync(a1!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { n: number; channel: string; people: Person[] });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(`n${r.n} ${r.channel}`, [...(by.get(`n${r.n} ${r.channel}`) ?? []), r]);
  for (const [k, rs] of [...by.entries()].sort()) {
    // 新しい人のうち、来てから 6 日の間に粥を作った人と、8 日の間に飢えて死んだ人（終わりの 6 日に来た人は数えない）。
    const nc = rs.flatMap((r) => r.people.filter((p) => p.arrivedDay! > 0 && p.arrivedDay! <= 38));
    const adopted = nc.filter((p) => p.firstGruelDay !== undefined && p.firstGruelDay - p.arrivedDay! <= 6);
    const died = nc.filter((p) => p.diedDay !== undefined && p.diedDay - p.arrivedDay! <= 8);
    console.log(`${k.padEnd(12)} runs ${rs.length} | newcomers ${nc.length} | made gruel within 6 days ${adopted.length} (${((100 * adopted.length) / nc.length).toFixed(0)}%, after ${mean(adopted.map((p) => p.firstGruelDay! - p.arrivedDay!)).toFixed(1)} days) | starved within 8 days ${died.length} | futile ${mean(nc.map((p) => p.futile)).toFixed(0)}`);
  }
} else {
  console.log('使い方: village.ts list | run <条件> <種> | sum <ファイル> | turn-list | turn <人数> <伝わり方:種> | turn-sum <ファイル>');
}
