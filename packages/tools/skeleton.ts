// 最小の骨格（果実の環）を数日分走らせ、日次の要約と記録の件数、全組の計算量を表示する。
// 使い方: npm run skeleton -- 30                 （採取者 1 人）
//         npm run skeleton -- 30 --persons 2     （同じ木を 2 人で使う）
//         npm run skeleton -- 30 --sight 20      （家から木が見えない視界）
//         npm run skeleton -- 30 --ripen 0.5     （実る速さ 実/時）
//         npm run skeleton -- 30 --tree-distance 200 （木までの距離 m。視界の外なら採取者は探索して見つける）
//         --spacing 2 で探索の渦巻きの腕の間隔を視界の 2 倍に（方針の値。既定 1）
//         --all-pairs で影響範囲の絞り込みを切る（比較用）
//         --order reverse|shuffle で組を数える順を変える（結果は変わらない。比較用）
//         --ledger で記録の先頭 200 件も表示
//         --replay で、初期状態と記録から再生した世界が走らせた世界と同じかを確かめる（法則と心を使わない再生）
//         --placed で、置くだけの村（家 3・木 3・採取者 5 を任意の座標に。構築関数の配置によらない）を走らせる
//         --grain で、実の足りない木と穀物の畑と炉（間接さの段 2）。--knows を足すと、穀物が炉で粥になると知っている人（違いは心象の知識だけ）
//         --season で、実る時期の違う三種の木の森の果樹園（一年 24 日。森ごとに 7 本）と、巡回者 2・採取者 2。--ripen 木一本の実/時、--jitter 年ごとのずれ（日）、--seed 種、
//           --spread 木ごとの毎年同じ時期の違い（日）、--lifespan 木の寿命（日。寿命があれば木は --sow 回/日 で種をまく。既定 2）、--forest-trees 森ごとに初めに置く木の数、
//           --who '[{"id":"P1","def":"patroller","attr":{"appetite":7}}]' で置く人と個性を指定（例: npm run skeleton -- 72 --season --ripen 0.15）

import { ForagerMind, runSeasonDays, seasonOutcome, replaySeason, runFruitDays, runGrainDays, replayFruit, buildPlacedScenario, summarize, edibleOn, DAY, DT } from '../skeleton/index.js';

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? '3');
const valueOf = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const persons = Number(valueOf('persons') ?? '1');
const ripenPerHour = Number(valueOf('ripen') ?? '0.25');
const sight = Number(valueOf('sight') ?? '60');
const treeDistance = Number(valueOf('tree-distance') ?? '40');
const spacing = valueOf('spacing');
const mind = spacing !== undefined ? () => new ForagerMind(3, 4, Number(spacing)) : undefined;
const allPairs = args.includes('--all-pairs');
const pairOrder = (valueOf('order') ?? 'sorted') as 'sorted' | 'reverse' | 'shuffle';

const started = performance.now();
const placed = args.includes('--placed');
const grain = args.includes('--grain');
const knows = args.includes('--knows');
const season = args.includes('--season');
const who = valueOf('who');
const seasonOptions = {
  persons: who ? JSON.parse(who) : undefined,
  ripenPerHour: valueOf('ripen') !== undefined ? ripenPerHour : undefined,
  jitterDays: valueOf('jitter') !== undefined ? Number(valueOf('jitter')) : undefined,
  seed: valueOf('seed') !== undefined ? Number(valueOf('seed')) : undefined,
  spreadDays: valueOf('spread') !== undefined ? Number(valueOf('spread')) : undefined,
  lifespanDays: valueOf('lifespan') !== undefined ? Number(valueOf('lifespan')) : undefined,
  sowPerDay: valueOf('lifespan') !== undefined ? Number(valueOf('sow') ?? '2') : undefined,
  treesPerForest: valueOf('forest-trees') !== undefined ? Number(valueOf('forest-trees')) : undefined,
  pairOrder,
};
const run = season
  ? runSeasonDays(days, seasonOptions)
  : placed
  ? runPlaced(days)
  : grain
    ? runGrainDays(days, { knows, treeRipenPerHour: valueOf('ripen') !== undefined ? ripenPerHour : undefined })
    : runFruitDays(days, { persons, ripenPerHour, sight, treeDistance, allPairs, pairOrder, mind });
const { scenario, daily, initial } = run;
const elapsed = performance.now() - started;
console.log(
  season
    ? `# season: six forests of three tree kinds fruiting 6 of 24 days each, ${seasonOptions.treesPerForest ?? 7} tree(s) per forest, ${seasonOptions.persons ? seasonOptions.persons.length : 4} person(s), ripen ${seasonOptions.ripenPerHour ?? 0.036}/h per tree, jitter ${seasonOptions.jitterDays ?? 0}d, spread ${seasonOptions.spreadDays ?? 0}d, lifespan ${seasonOptions.lifespanDays ?? '∞'}d, dt 10min`
    : placed
    ? `# placed village: 3 homes, 3 trees, 5 foragers, dt 10min`
    : grain
      ? `# grain: scarce tree, field, hearth, 1 ${knows ? 'farmer (knows grain becomes gruel at a hearth)' : 'forager (no knowledge of grain)'}, dt 10min`
      : `# fruit: ${persons} forager(s), ripen ${ripenPerHour}/h, sight ${sight}m, tree at ${treeDistance}m${spacing !== undefined ? `, explore spacing ${spacing}` : ''}, dt 10min`,
);
for (const row of daily) console.log(JSON.stringify(row));
if (placed) {
  for (const p of scenario.persons) {
    const t = scenario.world.thing(p)!;
    const home = Object.entries(t.rel).find(([, e]) => e['home'] === true)?.[0] ?? '-';
    const trees = Object.entries(t.rel).filter(([, e]) => 'bears' in e).map(([id]) => id).join(',') || '-';
    console.log(`${p}: alive=${t.state['alive']} nutrition=${(t.res['nutrition'] ?? 0).toFixed(2)} home=${home} knownTrees=${trees} holding=${edibleOn(scenario.world, p).length}`);
  }
}

if (season) for (const o of seasonOutcome(scenario.world, scenario.persons)) console.log(`${o.id} (${o.kind}): ${o.alive ? 'alive' : `died day ${o.diedDay}`}, eaten ${o.eaten}, visits ${JSON.stringify(o.visits)}`);

function runPlaced(days: number) {
  const scenario = buildPlacedScenario();
  const initial = scenario.world.save();
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    scenario.world.run((day + 1) * DAY, DT);
    daily.push(summarize(scenario.world, scenario.persons));
  }
  return { scenario, daily, initial };
}

const counts: Record<string, number> = {};
for (const e of scenario.world.ledger) {
  const key = 'law' in e ? `${e.law}:${e.effect.kind}` : `event:${e.event}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log('ledger:', JSON.stringify(counts));
const s = scenario.world.stats;
console.log(
  `pairs: things ${scenario.world.thingCount}, ticks ${s.ticks}, pair checks ${s.pairChecks} (${(s.pairChecks / s.ticks).toFixed(0)}/tick), active pairs ${s.activePairs} (${(s.activePairs / s.ticks).toFixed(0)}/tick), law evaluations ${s.pairEvaluations} (${(s.pairEvaluations / s.ticks).toFixed(0)}/tick), bundles ${s.bundles}, limited ${s.limited}, observations ${s.observations}, elapsed ${elapsed.toFixed(0)} ms`,
);
if (args.includes('--ledger')) for (const e of scenario.world.ledger.slice(0, 200)) console.log(JSON.stringify(e));
if (args.includes('--replay')) {
  const t0 = performance.now();
  const replayed = (season ? replaySeason : replayFruit)(initial, scenario.world.ledger, scenario.world.now);
  const dump = (w: typeof replayed) => JSON.stringify(w.query(() => true));
  const same = dump(replayed) === dump(scenario.world);
  const sameLedger = JSON.stringify(replayed.ledger) === JSON.stringify(scenario.world.ledger.filter((e) => !('law' in e && e.law === 'seed')));
  console.log(`replay: state ${same ? 'identical' : 'DIFFERENT'}, ledger ${sameLedger ? 'identical' : 'DIFFERENT'} (${replayed.ledger.length} entries), elapsed ${(performance.now() - t0).toFixed(0)} ms`);
}
