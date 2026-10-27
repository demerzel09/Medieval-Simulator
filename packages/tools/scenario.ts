// 設定のファイルから世界を走らせ、記録のファイルに残し、記録から再現できるかを確かめる。
// 使い方: npm run scenario -- run scenarios/season-forest.json [--days 日] [--record 出力.json.gz]
//           設定から走らせ、記録の内訳と、心を持つ物の生死を出す。--record で記録のファイル（設定・部品の名と版・初期状態・記録・最後の要約）を書く。
//         npm run scenario -- verify 記録.json.gz
//           部品の版がいまのコードと同じか、記録から再生して最後の状態と記録が同じか、設定から走らせ直して記録が同じかを確かめる。
//         npm run scenario -- export 場面の名 > scenarios/名.json
//           構築関数で作った場面を、設定のファイルに書き出す（fruit-one・fruit-two・placed-village・grain-naive・grain-knows・season-orchard・season-forest）。
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildFromConfig, buildFruitScenario, buildGrainScenario, buildPlacedScenario, buildSeasonScenario, exportConfig, finalOf, registryMismatch, replayRecording, runConfig, DAY } from '../skeleton/index.js';
import type { Recording, ScenarioConfig, World } from '../skeleton/index.js';

const [command, target, ...rest] = process.argv.slice(2);
const valueOf = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const readJson = <T>(path: string): T => {
  const bytes = readFileSync(path);
  return JSON.parse((path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
};

/** 構築関数の場面と、書き出す設定の名・説明・部品の組・日数。 */
const scenes: Record<string, () => { world: World; base: Omit<ScenarioConfig, 'format' | 'things' | 'defs'> }> = {
  'fruit-one': () => ({ world: buildFruitScenario().world, base: { name: 'fruit-one', description: '一本の木（40m 先）と家と採取者一人。', modules: ['fruit'], world: { days: 30 } } }),
  'fruit-two': () => ({ world: buildFruitScenario({ persons: 2 }).world, base: { name: 'fruit-two', description: '一本の木を採取者二人で使う。', modules: ['fruit'], world: { days: 30 } } }),
  'placed-village': () => ({ world: buildPlacedScenario().world, base: { name: 'placed-village', description: '家 3・木 3・採取者 5 を任意の座標に置いただけの村。', modules: ['fruit'], world: { days: 30 } } }),
  'grain-naive': () => ({ world: buildGrainScenario().world, base: { name: 'grain-naive', description: '実の足りない木と穀物の畑と炉。穀物が粥になると知らない人。', modules: ['fruit', 'grain'], world: { days: 30 } } }),
  'grain-knows': () => ({ world: buildGrainScenario({ knows: true }).world, base: { name: 'grain-knows', description: '同じ場所で、穀物が炉で粥になると知っている人（違いは心象の知識だけ）。', modules: ['fruit', 'grain'], world: { days: 30 } } }),
  'season-orchard': () => ({
    world: buildSeasonScenario({ treesPerForest: 1, ripenPerHour: 0.25 }).world,
    base: { name: 'season-orchard', description: '実る時期の違う三種の木が森ごとに一本。巡回者 2・採取者 2。', modules: ['fruit', 'season'], world: { days: 72 } },
  }),
  'season-forest': () => ({
    world: buildSeasonScenario({ persons: [{ id: 'P1', def: 'patroller' }, { id: 'P2', def: 'patroller', attr: { kindRate: 0, learnRate: 0.5 } }], spreadDays: 3, lifespanDays: 24, sowPerDay: 2 }).world,
    base: {
      name: 'season-forest',
      description: '三種の木の森が六つ（7 本ずつ）。木は種をまき、寿命 24 日（0.5〜1.5 倍）で枯れる。木ごとに毎年同じ時期の違い ±3 日。巡回者は二段で覚える P1 と一本ずつ覚える P2。',
      modules: ['fruit', 'season'],
      world: { days: 72 },
    },
  }),
};

function summary(w: World) {
  const counts: Record<string, number> = {};
  for (const e of w.ledger) {
    const k = 'law' in e ? `${e.law}:${e.effect.kind}` : `event:${e.event}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const minded = w.query((t) => typeof t.attr['mind'] === 'string');
  const lives = minded.map((t) => {
    const died = w.ledger.find((e) => 'law' in e && e.law === 'starve' && e.a === t.id);
    return `${t.id} (${t.kind}) ${t.state['alive'] === 'yes' ? 'alive' : `died day ${died ? (died.at / DAY).toFixed(1) : '?'}`}`;
  });
  return { counts, lives };
}

if (command === 'run' && target) {
  const config = readJson<ScenarioConfig>(target);
  const days = valueOf('days') !== undefined ? Number(valueOf('days')) : undefined;
  const started = performance.now();
  const { world: end, recording: rec } = runConfig(config, days);
  const elapsed = performance.now() - started;
  const { counts, lives } = summary(end);
  console.log(`# ${config.name ?? target}: ${config.description ?? ''}`);
  console.log(`days ${rec.until / DAY}, dt ${rec.dt} min, things at end ${rec.final.things}, ledger ${rec.final.ledger}, elapsed ${elapsed.toFixed(0)} ms`);
  console.log(`ledger: ${JSON.stringify(counts)}`);
  for (const l of lives) console.log(l);
  const out = valueOf('record');
  if (out) {
    const text = JSON.stringify(rec);
    writeFileSync(out, out.endsWith('.gz') ? gzipSync(text) : text);
    console.log(`recorded ${out} (${(text.length / 1e6).toFixed(1)} MB as JSON)`);
  }
} else if (command === 'verify' && target) {
  const rec = readJson<Recording>(target);
  const mismatch = registryMismatch(rec);
  console.log(mismatch.length ? `registry differs: ${mismatch.join(', ')}` : 'registry: same laws, senses and memories (names and versions)');
  const replayed = finalOf(replayRecording(rec));
  const same = (a: Recording['final'], b: Recording['final']) => a.thingsHash === b.thingsHash && a.ledgerHash === b.ledgerHash;
  console.log(`replay from the recording: ${same(replayed, rec.final) ? 'state and ledger identical' : `DIFFERENT ${JSON.stringify(replayed)} vs ${JSON.stringify(rec.final)}`}`);
  const rerun = buildFromConfig(rec.scenario);
  rerun.run(rec.until, rec.dt);
  console.log(`rerun from the scenario: ${same(finalOf(rerun), rec.final) ? 'state and ledger identical' : 'DIFFERENT'}`);
  if (mismatch.length || !same(replayed, rec.final) || !same(finalOf(rerun), rec.final)) process.exit(1);
} else if (command === 'export' && target && scenes[target]) {
  const { world, base } = scenes[target]!();
  process.stdout.write(JSON.stringify(exportConfig(world, base), null, 2) + '\n');
} else {
  console.error(`usage: run <scenario.json> [--days N] [--record out.json.gz] | verify <recording.json.gz> | export <${Object.keys(scenes).join(' | ')}>`);
  process.exit(1);
}
