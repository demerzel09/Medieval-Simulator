// 最小の骨格（果実の環）を数日分走らせ、日次の要約と記録の件数を表示する。
// 使い方: npm run skeleton -- 30                 （採取者 1 人）
//         npm run skeleton -- 30 --persons 2     （同じ木を 2 人で使う）
//         npm run skeleton -- 30 --sight 20      （家から木が見えない視界）
//         npm run skeleton -- 30 --ripen 0.5     （実る速さ 実/時）
//         --ledger で記録の内訳も表示

import { runFruitDays } from '../skeleton/index.js';

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? '3');
const valueOf = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const persons = Number(valueOf('persons') ?? '1');
const ripenPerHour = Number(valueOf('ripen') ?? '0.25');
const sight = Number(valueOf('sight') ?? '60');

const { scenario, daily } = runFruitDays(days, { persons, ripenPerHour, sight });
console.log(`# fruit: ${persons} forager(s), ripen ${ripenPerHour}/h, sight ${sight}m, dt 10min`);
for (const row of daily) console.log(JSON.stringify(row));

const byLaw: Record<string, number> = {};
for (const e of scenario.world.ledger) {
  const key = 'law' in e ? `${e.law}:${e.effect.kind}` : e.kind;
  byLaw[key] = (byLaw[key] ?? 0) + 1;
}
console.log('ledger:', JSON.stringify(byLaw));
if (args.includes('--ledger')) for (const e of scenario.world.ledger.slice(0, 200)) console.log(JSON.stringify(e));
