// 季節の果樹園で個性を比べる（docs/DESIGN.md の表「時期と巡回」「種類と一本の二段の見込み、森と木の一生」の数値の出どころ）。
// solo・group・arrivals・levels は、森ごとに一本の果樹園（以前の一本ずつの果樹園と同じ配置）で走らせる。lifespan は森の果樹園（森ごとに 7 本）で走らせる。
// 使い方: npx tsx packages/tools/season-compare.ts solo [生産量の並び 0.25,0.2,0.15,0.12,0.1] [ずれ 日]
//           一人ずつ、心と個性の組（採取者、巡回者の食欲 4・7・9.5、学ぶ速さ 0）を置き、72 日（3 年）で死んだ日を並べる。
//         npx tsx packages/tools/season-compare.ts group [生産量 0.25] [ずれ 日]
//           6 つの個性を同じ果樹園に置き、置く順（id と家の脇の位置）を 6 通り回して、生存日数の平均を出す。
//         npx tsx packages/tools/season-compare.ts arrivals [生産量 0.25] [ずれ 日] [置く人の JSON]
//           木に着いた回数、そのうち実る時期だった回数、実が付いていた回数（年ごと）を数える。
//         npx tsx packages/tools/season-compare.ts levels [生産量の並び 0.25,0.15,0.12] [ずれ 日] [食欲 4] [種の数 1] [世界の選択]
//           見込みの覚え方 4 通り（学ばない・一本ずつ・種類だけ・両方）を一人ずつ置き、死んだ日と、着いたときに実があった割合（年ごと）を並べる。
//           種の数が 2 以上なら、種 seed 0, 1, … で繰り返し、生き残った数・平均の生存日数・実があった割合（全体）を並べる。
//           世界の選択は , で区切って並べる: shared（年ごとのずれを種類で共通に。既定は木一本ごと）、spread:日（木一本ごとに毎年同じ時期の違い ±日）、life:日（木の寿命）。
//         npx tsx packages/tools/season-compare.ts theories [生産量の並び 0.25,0.15] [食欲 4] [種の数 10] [世界の選択] [理論の並び]
//           誤差の割り当ての理論（variants の表。札 models・assigner と学ぶ速さ）を一人ずつ置き、生き残った数・平均の生存日数・実があった割合（全体、
//           2 年目以降の知って 1 年未満の木と 1 年以上の木）を並べる。世界の選択に forest を足すと森の果樹園（森ごとに 7 本、life があれば種をまく）。
//         npx tsx packages/tools/season-compare.ts lifespan [寿命の並び 日 0,72,24,12,6] [一本の生産量 0.036] [食欲 7] [種の数 10] [木ごとの時期の違い 日 3] [まく速さ 回/日 2]
//           木の寿命ごとに（寿命があれば木は種をまく）、覚え方 4 通りを比べる。2 年目以降に木へ着いたときに実があった割合を、その木を知ってから 1 年未満（新しい木）と 1 年以上（なじみの木）に分ける。
import { buildSeasonScenario, edibleOn, inSeason, predict, seasonOutcome, DAY, DT, SEASON_YEAR } from '../skeleton/index.js';
import type { SeasonOptions } from '../skeleton/index.js';

type Person = NonNullable<SeasonOptions['persons']>[number];
const DAYS = 72;
const [mode = 'solo', a1, a2, a3] = process.argv.slice(2);

const kinds: [string, Omit<Person, 'id'>][] = [
  ['forager', { def: 'person' }],
  ['a4', { def: 'patroller', attr: { appetite: 4 } }],
  ['a4-lr0', { def: 'patroller', attr: { appetite: 4, kindRate: 0, learnRate: 0 } }],
  ['a7', { def: 'patroller', attr: { appetite: 7 } }],
  ['a7-lr0', { def: 'patroller', attr: { appetite: 7, kindRate: 0, learnRate: 0 } }],
  ['a7-slow', { def: 'patroller', attr: { appetite: 7, kindRate: 0.05, learnRate: 0.05 } }],
  ['a9.5', { def: 'patroller', attr: { appetite: 9.5 } }],
];
const pick = (names: string[]) => kinds.filter(([n]) => names.includes(n));

/** 見込みの覚え方。kindRate は種類の見込みを、learnRate は一本ごとのずれを直す速さ。一本の木の見込みが動く速さ（和）は揃える。 */
const levels: [string, { kindRate: number; learnRate: number }][] = [
  ['none', { kindRate: 0, learnRate: 0 }],
  ['tree', { kindRate: 0, learnRate: 0.5 }],
  ['kind', { kindRate: 0.5, learnRate: 0 }],
  ['both', { kindRate: 0.25, learnRate: 0.25 }],
];

/**
 * 比べる理論（心象のモデルの組と誤差の割り当て。docs/RESEARCH.md 10.7）。協調型は同じ誤差を分け合い、競合型は各モデルが単独で全体を予測する。
 * 競合型の速さは、一つのモデルが単独で直る速さ（一本ずつの協調型と同じ 0.5）。
 */
const variants: [string, Record<string, number | string>][] = [
  ['none', { models: 'forage', assigner: 'additive', kindRate: 0, learnRate: 0 }],
  ['coop-tree', { models: 'forage', assigner: 'additive', kindRate: 0, learnRate: 0.5 }],
  ['coop-both', { models: 'forage', assigner: 'additive', kindRate: 0.25, learnRate: 0.25 }],
  ['mosaic', { models: 'forage-compete', assigner: 'responsibility', kindRate: 0.5, learnRate: 0.5 }],
  ['winner', { models: 'forage-compete', assigner: 'winner', kindRate: 0.5, learnRate: 0.5 }],
  ['art', { models: 'forage-compete', assigner: 'art', kindRate: 0.5, learnRate: 0.5 }],
  ['kalman', { models: 'forage-compete', assigner: 'uncertainty' }],
];

type World = ReturnType<typeof buildSeasonScenario>['world'];
type Count = { arrivals: number; inSeason: number; withFruit: number[]; byYear: number[]; fresh: [number, number]; familiar: [number, number]; sq: number; sqN: number };

/** 世界の選択（levels の 5 番目）を場面の選択に直す。 */
const worldOptions = (spec = ''): SeasonOptions => {
  const out: SeasonOptions = {};
  for (const part of spec.split(',').filter(Boolean)) {
    if (part === 'shared') out.sharedJitter = true;
    else if (part.startsWith('spread:')) out.spreadDays = Number(part.slice(7));
    else if (part.startsWith('life:')) { out.lifespanDays = Number(part.slice(5)); out.sowPerDay = 2; }
    else if (part === 'forest') out.treesPerForest = 7;
  }
  return out;
};

/**
 * 刻みごとに、人が木に着いた回数、そのうち実る時期だった回数、実が付いていた回数（年ごと）を数えながら DAYS 日走らせる。
 * 2 年目以降に着いた回数と実があった回数は、その木を心象に初めて写してから 1 年未満（fresh）と以上（familiar）に分けても数える。
 * 見込みの正しさは選び方と切り分けて測る: 向かっている木に着いたとき、着く前の刻みのその木の見込みと、着いたときに実際に付いている実の数の差の二乗を足す（sq・sqN）。
 * 木は枯れて生まれ替わるので、刻みごとに数え直す。数えるのは観測だけで、世界には何もしない。
 */
function countArrivals(persons: Person[], options: SeasonOptions) {
  const { world, persons: ids } = buildSeasonScenario({ persons, treesPerForest: 1, ...options });
  const at = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  const count = new Map<string, Count>();
  const aimed = new Map<string, { tree: string; forecast: number }>();
  for (let t = 0; t < DAYS * DAY; t += DT) {
    for (const p of ids) {
      const self = world.thing(p)!;
      const target = String(self.state['target'] ?? '');
      const entry = target ? self.rel[target] : undefined;
      if (self.state['alive'] === 'yes' && entry && 'bears' in entry) aimed.set(p, { tree: target, forecast: predict(self, entry, world.now + DT) });
      else aimed.delete(p);
    }
    world.tick(DT);
    const trees = world.query((x) => typeof x.attr['bears'] === 'string').map((x) => x.id);
    for (const p of ids) {
      const self = world.thing(p)!;
      if (self.state['alive'] !== 'yes') continue;
      for (const id of trees) if (self.rel[id] && !firstSeen.has(`${p}|${id}`)) firstSeen.set(`${p}|${id}`, world.now);
      const tree = trees.find((x) => world.distance(p, x) <= 1.5) ?? '';
      if (tree && at.get(p) !== tree) {
        const c = count.get(p) ?? { arrivals: 0, inSeason: 0, withFruit: [0, 0, 0], byYear: [0, 0, 0], fresh: [0, 0], familiar: [0, 0], sq: 0, sqN: 0 };
        const aim = aimed.get(p);
        if (aim && aim.tree === tree) { c.sq += (aim.forecast - edibleOn(world, tree).length) ** 2; c.sqN += 1; }
        const year = Math.min(2, Math.floor(world.now / SEASON_YEAR));
        const fruit = edibleOn(world, tree).length > 0;
        c.arrivals += 1;
        c.byYear[year]! += 1;
        if (inSeason(world.thing(tree)!, world.now)) c.inSeason += 1;
        if (fruit) c.withFruit[year]! += 1;
        if (year >= 1) {
          const bucket = world.now - (firstSeen.get(`${p}|${tree}`) ?? world.now) < SEASON_YEAR ? c.fresh : c.familiar;
          bucket[0] += 1;
          if (fruit) bucket[1] += 1;
        }
        count.set(p, c);
      }
      at.set(p, tree);
    }
  }
  return { world: world as World, ids, count };
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

if (mode === 'solo') {
  const jitterDays = Number(a2 ?? 0);
  for (const r of (a1 ?? '0.25,0.2,0.15,0.12,0.1').split(',').map(Number)) {
    const row = pick(['forager', 'a4-lr0', 'a4', 'a7-lr0', 'a7', 'a9.5']).map(([name, v]) => {
      const { world, persons } = buildSeasonScenario({ persons: [{ id: 'X', ...v }], ripenPerHour: r, jitterDays, treesPerForest: 1 });
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
    const { world, persons } = buildSeasonScenario({ persons: order.map(([, v], i) => ({ id: `P${i}`, ...v })), ripenPerHour: r, jitterDays, treesPerForest: 1 });
    world.run(DAYS * DAY, DT);
    const out = seasonOutcome(world, persons);
    console.log(`order ${rot}: ` + out.map((o, i) => `${order[i]![0]} ${o.alive ? 'alive' : o.diedDay}`).join(', '));
    out.forEach((o, i) => days.set(order[i]![0], [...(days.get(order[i]![0]) ?? []), o.alive ? DAYS : o.diedDay!]));
  }
  console.log(`ripen ${r}/h, jitter ${jitterDays}d, mean survival days: ` + [...days].map(([k, v]) => `${k} ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1)}`).join(' | '));
} else if (mode === 'arrivals') {
  const persons: Person[] = a3 ? JSON.parse(a3) : [{ id: 'P1', def: 'patroller' }];
  const { world, ids, count } = countArrivals(persons, { ripenPerHour: Number(a1 ?? 0.25), jitterDays: Number(a2 ?? 0) });
  for (const o of seasonOutcome(world, ids)) {
    const c = count.get(o.id);
    console.log(`${o.id} (${o.kind}): ${o.alive ? 'alive' : `died day ${o.diedDay}`}, eaten ${o.eaten}, arrivals ${c?.arrivals ?? 0}, in season ${c?.inSeason ?? 0}, with fruit by year ${c?.withFruit.join('/') ?? '-'}`);
  }
} else if (mode === 'levels') {
  const jitterDays = Number(a2 ?? 0);
  const appetite = Number(a3 ?? 4);
  const seeds = Number(process.argv[6] ?? 1);
  const spec = process.argv[7] ?? '';
  for (const r of (a1 ?? '0.25,0.15,0.12').split(',').map(Number)) {
    const row = levels.map(([name, v]) => {
      const persons: Person[] = [{ id: 'X', def: 'patroller', attr: { appetite, ...v } }];
      if (seeds <= 1) {
        const { world, ids, count } = countArrivals(persons, { ripenPerHour: r, jitterDays, ...worldOptions(spec) });
        const o = seasonOutcome(world, ids)[0]!;
        const c = count.get('X');
        const byYear = c ? c.withFruit.map((n, i) => (c.byYear[i] ? Math.round((100 * n) / c.byYear[i]!) : '-')).join('/') : '-';
        return `${name} ${o.alive ? 'alive' : o.diedDay} (${byYear}%)`;
      }
      let alive = 0, days = 0, hits = 0, arrivals = 0;
      for (let seed = 0; seed < seeds; seed++) {
        const { world, ids, count } = countArrivals(persons, { ripenPerHour: r, jitterDays, seed, ...worldOptions(spec) });
        const o = seasonOutcome(world, ids)[0]!;
        const c = count.get('X');
        if (o.alive) alive += 1;
        days += o.alive ? DAYS : o.diedDay!;
        hits += c ? c.withFruit.reduce((x, y) => x + y, 0) : 0;
        arrivals += c?.arrivals ?? 0;
      }
      return `${name} ${alive}/${seeds} alive, ${(days / seeds).toFixed(1)}d, ${pct(hits, arrivals)}`;
    });
    console.log(`ripen ${r}/h, jitter ${jitterDays}d${spec ? ` [${spec}]` : ''}, appetite ${appetite}  ${row.join(' | ')}`);
  }
} else if (mode === 'theories') {
  const appetite = Number(a2 ?? 4);
  const seeds = Number(a3 ?? 10);
  const spec = process.argv[6] ?? '';
  const only = process.argv[7] ? process.argv[7].split(',') : undefined;
  for (const r of (a1 ?? '0.25,0.15').split(',').map(Number)) {
    const rows = variants.filter(([n]) => !only || only.includes(n)).map(([name, v]) => {
      let alive = 0, days = 0, hits = 0, arrivals = 0, sq = 0, sqN = 0;
      const fresh: [number, number] = [0, 0];
      const familiar: [number, number] = [0, 0];
      for (let seed = 0; seed < seeds; seed++) {
        const { world, ids, count } = countArrivals([{ id: 'X', def: 'patroller', attr: { appetite, ...v } }], { ripenPerHour: r, seed, ...worldOptions(spec) });
        const o = seasonOutcome(world, ids)[0]!;
        const c = count.get('X');
        if (o.alive) alive += 1;
        days += o.alive ? DAYS : o.diedDay!;
        if (c) {
          hits += c.withFruit.reduce((x, y) => x + y, 0);
          arrivals += c.arrivals;
          sq += c.sq;
          sqN += c.sqN;
          for (const [into, from] of [[fresh, c.fresh], [familiar, c.familiar]] as const) { into[0] += from[0]; into[1] += from[1]; }
        }
      }
      return `${name.padEnd(9)} ${alive}/${seeds} alive, ${(days / seeds).toFixed(1).padStart(4)}d, hit ${pct(hits, arrivals)} of ${arrivals}, new ${pct(fresh[1], fresh[0])}, familiar ${pct(familiar[1], familiar[0])}, forecast rmse ${sqN ? Math.sqrt(sq / sqN).toFixed(2) : '-'} (${sqN})`;
    });
    console.log(`ripen ${r}/h, appetite ${appetite}${spec ? ` [${spec}]` : ''}\n  ${rows.join('\n  ')}`);
  }
} else if (mode === 'lifespan') {
  const r = Number(a2 ?? 0.036);
  const appetite = Number(a3 ?? 7);
  const seeds = Number(process.argv[6] ?? 10);
  const spreadDays = Number(process.argv[7] ?? 3);
  const sowPerDay = Number(process.argv[8] ?? 2);
  for (const life of (a1 ?? '0,72,24,12,6').split(',').map(Number)) {
    const row = levels.map(([name, v]) => {
      let alive = 0, days = 0;
      const fresh: [number, number] = [0, 0];
      const familiar: [number, number] = [0, 0];
      for (let seed = 0; seed < seeds; seed++) {
        const { world, ids, count } = countArrivals([{ id: 'X', def: 'patroller', attr: { appetite, ...v } }], { ripenPerHour: r, seed, spreadDays, lifespanDays: life, sowPerDay: life ? sowPerDay : 0, treesPerForest: 7 });
        const o = seasonOutcome(world, ids)[0]!;
        const c = count.get('X');
        if (o.alive) alive += 1;
        days += o.alive ? DAYS : o.diedDay!;
        if (c) for (const [into, from] of [[fresh, c.fresh], [familiar, c.familiar]] as const) { into[0] += from[0]; into[1] += from[1]; }
      }
      return `${name} ${alive}/${seeds} alive, ${(days / seeds).toFixed(1)}d, new ${pct(fresh[1], fresh[0])} of ${fresh[0]}, familiar ${pct(familiar[1], familiar[0])} of ${familiar[0]}`;
    });
    console.log(`lifespan ${life || '∞'}d, ripen ${r}/h, appetite ${appetite}, spread ±${spreadDays}d\n  ${row.join('\n  ')}`);
  }
} else {
  console.error(`unknown mode ${mode} (solo | group | arrivals | levels | theories | lifespan)`);
  process.exit(1);
}
