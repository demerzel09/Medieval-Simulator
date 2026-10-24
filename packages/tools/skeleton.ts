// 最小の骨格を数日分走らせ、日次の要約と記録の件数を表示する。
// 使い方: npm run skeleton -- 3        （3日分）
//         npm run skeleton -- 3 --ledger （記録も表示）

import { runDays } from '../skeleton/index.js';

const days = Number(process.argv[2] ?? '3');
const showLedger = process.argv.includes('--ledger');
const { scenario, daily } = runDays(days);

for (const row of daily) console.log(JSON.stringify(row));

const byKind: Record<string, number> = {};
for (const e of scenario.world.ledger) {
  const key = e.kind === 'complete' || e.kind === 'cancel' ? `${e.kind}:${e.type}` : e.kind === 'attempt' ? `attempt:${e.type}:${e.accepted ? 'ok' : 'rejected'}` : e.kind;
  byKind[key] = (byKind[key] ?? 0) + 1;
}
console.log('ledger:', JSON.stringify(byKind));

if (showLedger) for (const e of scenario.world.ledger) console.log(JSON.stringify(e));
