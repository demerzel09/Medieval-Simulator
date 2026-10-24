// 最小の骨格を数日分走らせ、日次の要約と記録の件数を表示する。
// 使い方: npm run skeleton -- 30 --fruit            （果実の場面。採取者 1 人が果実で生きる）
//         npm run skeleton -- 30 --fruit --persons 2 （同じ果樹を 2 人で使う）
//         npm run skeleton -- 10                    （パンの場面の基準）
//         npm run skeleton -- 10 --contrast         （農夫は栄養 4 未満のときだけ食べる）
//         npm run skeleton -- 10 --wood             （薪と木こり、交換）
//         --ledger で記録も表示

import { runDays, runFruitDays, type ScenarioOptions } from '../skeleton/index.js';

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? '3');
const flag = (name: string) => args.includes(`--${name}`);
const valueOf = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let title: string;
let result: ReturnType<typeof runDays>;
if (flag('fruit')) {
  const persons = Number(valueOf('persons') ?? '1');
  const ripenEveryHours = Number(valueOf('ripen') ?? '4');
  result = runFruitDays(days, { persons, ripenEveryHours });
  title = `fruit: ${persons} forager(s), ripen every ${ripenEveryHours}h`;
} else {
  const options: ScenarioOptions = { ...(flag('contrast') ? { farmer: { eatBelow: 4 } } : {}), ...(flag('wood') ? { wood: true } : {}) };
  result = runDays(days, options);
  title = `${flag('contrast') ? 'contrast: farmer eats only below nutrition 4' : 'baseline: farmer eats whenever hungry'}${flag('wood') ? ' + wood' : ''}`;
}

console.log(`# ${title}`);
for (const row of result.daily) console.log(JSON.stringify(row));

const byKind: Record<string, number> = {};
for (const e of result.scenario.world.ledger) {
  const key = e.kind === 'complete' || e.kind === 'cancel' ? `${e.kind}:${e.type}` : e.kind === 'attempt' ? `attempt:${e.type}:${e.accepted ? 'ok' : 'rejected'}` : e.kind;
  byKind[key] = (byKind[key] ?? 0) + 1;
}
console.log('ledger:', JSON.stringify(byKind));

if (flag('ledger')) for (const e of result.scenario.world.ledger) console.log(JSON.stringify(e));
