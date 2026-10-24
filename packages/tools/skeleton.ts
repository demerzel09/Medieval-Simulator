// 最小の骨格を数日分走らせ、日次の要約と記録の件数を表示する。
// 使い方: npm run skeleton -- 10            （基準: 農夫は空腹感だけで食べ、手元に1個残して渡す）
//         npm run skeleton -- 10 --contrast （対照: 農夫は栄養の見込みが 4 未満のときだけ食べる。世界側は同じ）
//         npm run skeleton -- 10 --ledger   （記録も表示）

import { runDays, type ScenarioOptions } from '../skeleton/index.js';

const days = Number(process.argv[2] ?? '3');
const showLedger = process.argv.includes('--ledger');
const contrast = process.argv.includes('--contrast');

const options: ScenarioOptions = contrast ? { farmer: { eatBelow: 4 } } : {};
const { scenario, daily } = runDays(days, options);

console.log(contrast ? '# contrast: farmer eats only below nutrition 4' : '# baseline: farmer eats whenever hungry');
for (const row of daily) console.log(JSON.stringify(row));

const byKind: Record<string, number> = {};
for (const e of scenario.world.ledger) {
  const key = e.kind === 'complete' || e.kind === 'cancel' ? `${e.kind}:${e.type}` : e.kind === 'attempt' ? `attempt:${e.type}:${e.accepted ? 'ok' : 'rejected'}` : e.kind;
  byKind[key] = (byKind[key] ?? 0) + 1;
}
console.log('ledger:', JSON.stringify(byKind));

if (showLedger) for (const e of scenario.world.ledger) console.log(JSON.stringify(e));
