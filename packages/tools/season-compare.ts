// 季節の果樹園で個性を比べる（docs/DESIGN.md「時期と巡回」の表の数値の出どころ）。
// 使い方: npx tsx packages/tools/season-compare.ts solo [生産量の並び 0.25,0.2,0.15,0.12,0.1] [ずれ 日]
//           一人ずつ、心と個性の組（採取者、巡回者の食欲 4・7・9.5、学ぶ速さ 0）を置き、72 日（3 年）で死んだ日を並べる。
//         npx tsx packages/tools/season-compare.ts group [生産量 0.25] [ずれ 日]
//           6 つの個性を同じ果樹園に置き、置く順（id と家の脇の位置）を 6 通り回して、生存日数の平均を出す。
//         npx tsx packages/tools/season-compare.ts arrivals [生産量 0.25] [ずれ 日] [置く人の JSON]
//           木に着いた回数、そのうち実る時期だった回数、実が付いていた回数（年ごと）を数える。
import { buildSeasonScenario, edibleOn, inSeason, seasonOutcome, DAY, DT, SEASON_YEAR } from '../skeleton/index.js';
import type { SeasonOptions } from '../skeleton/index.js';

type Person = NonNullable<SeasonOptions['persons']>[number];
const DAYS = 72;
const [mode = 'solo', a1, a2, a3] = process.argv.slice(2);

const kinds: [string, Omit<Person, 'id'>][] = [
  ['forager', { def: 'person' }],
  ['a4', { def: 'patroller', attr: { appetite: 4 } }],
  ['a4-lr0', { def: 'patroller', attr: { appetite: 4, learnRate: 0 } }],
  ['a7', { def: 'patroller', attr: { appetite: 7 } }],
  ['a7-lr0', { def: 'patroller', attr: { appetite: 7, learnRate: 0 } }],
  ['a7-slow', { def: 'patroller', attr: { appetite: 7, learnRate: 0.1 } }],
  ['a9.5', { def: 'patroller', attr: { appetite: 9.5 } }],
];
const pick = (names: string[]) => kinds.filter(([n]) => names.includes(n));

if (mode === 'solo') {
  const jitterDays = Number(a2 ?? 0);
  for (const r of (a1 ?? '0.25,0.2,0.15,0.12,0.1').split(',').map(Number)) {
    const row = pick(['forager', 'a4-lr0', 'a4', 'a7-lr0', 'a7', 'a9.5']).map(([name, v]) => {
      const { world, persons } = buildSeasonScenario({ persons: [{ id: 'X', ...v }], ripenPerHour: r, jitterDays });
      world.run(DAYS * DAY, DT);
      const o = seasonOutcome(world, persons)[0]!;
      return `${name}: ${o.alive ? 'alive' : o.diedDay}`;
    });
    console.log(`ripen ${r}/h, jitter ${jitterDays}d  ${row.join(' | ')}`);
  }
} else if (mode === 'group') {
  const r = Number(a1 ?? 0.25);
  const jitterDays = Number(a2 ?? 0);
  const types = pick(['forager', 'a4', 'a7', 'a9.5', 'a7-lr0', 'a7-slow']);
  const days = new Map<string, number[]>();
  for (let rot = 0; rot < types.length; rot++) {
    const order = types.map((_, i) => types[(i + rot) % types.length]!);
    const { world, persons } = buildSeasonScenario({ persons: order.map(([, v], i) => ({ id: `P${i}`, ...v })), ripenPerHour: r, jitterDays });
    world.run(DAYS * DAY, DT);
    const out = seasonOutcome(world, persons);
    console.log(`order ${rot}: ` + out.map((o, i) => `${order[i]![0]} ${o.alive ? 'alive' : o.diedDay}`).join(', '));
    out.forEach((o, i) => days.set(order[i]![0], [...(days.get(order[i]![0]) ?? []), o.alive ? DAYS : o.diedDay!]));
  }
  console.log(`ripen ${r}/h, jitter ${jitterDays}d, mean survival days: ` + [...days].map(([k, v]) => `${k} ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1)}`).join(' | '));
} else if (mode === 'arrivals') {
  const persons: Person[] = a3 ? JSON.parse(a3) : [{ id: 'P1', def: 'patroller' }];
  const { world, persons: ids } = buildSeasonScenario({ persons, ripenPerHour: Number(a1 ?? 0.25), jitterDays: Number(a2 ?? 0) });
  const trees = world.query((t) => typeof t.attr['bears'] === 'string').map((t) => t.id);
  const at = new Map<string, string>();
  const count = new Map<string, { arrivals: number; inSeason: number; withFruit: number[] }>();
  for (let t = 0; t < DAYS * DAY; t += DT) {
    world.tick(DT);
    for (const p of ids) {
      if (world.thing(p)!.state['alive'] !== 'yes') continue;
      const tree = trees.find((x) => world.distance(p, x) <= 1.5) ?? '';
      if (tree && at.get(p) !== tree) {
        const c = count.get(p) ?? { arrivals: 0, inSeason: 0, withFruit: [0, 0, 0] };
        c.arrivals += 1;
        if (inSeason(world.thing(tree)!, world.now)) c.inSeason += 1;
        if (edibleOn(world, tree).length > 0) c.withFruit[Math.min(2, Math.floor(world.now / SEASON_YEAR))]! += 1;
        count.set(p, c);
      }
      at.set(p, tree);
    }
  }
  for (const o of seasonOutcome(world, ids)) {
    const c = count.get(o.id);
    console.log(`${o.id} (${o.kind}): ${o.alive ? 'alive' : `died day ${o.diedDay}`}, eaten ${o.eaten}, arrivals ${c?.arrivals ?? 0}, in season ${c?.inSeason ?? 0}, with fruit by year ${c?.withFruit.join('/') ?? '-'}`);
  }
} else {
  console.error(`unknown mode ${mode} (solo | group | arrivals)`);
  process.exit(1);
}
