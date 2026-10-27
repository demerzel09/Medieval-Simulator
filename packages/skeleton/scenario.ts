// 設定から世界を作り、走らせ、記録して再現する。設定（JSON）に書くのは、使う部品の組、追加の定義（データ）、世界の設定、置く物の一覧だけ。
// 法則・感覚・記憶の規則・心はコード（世界の物理と、差し替えられる方針）なので、設定からは名前で呼ぶ。記録には使った名と版を残す。
// 置く物どうしのつながりは、配置（位置と、付いている関係 attachedTo）と、置いたときの心象（関係 rel。知識）だけで、構築関数の計算は入らない。

import type { LedgerEntry, Memory, Mind, Relations, Resources, Scalar, Sense, State, ThingDef, ThingId, WorldState } from './types.js';
import { World, type WorldOptions } from './world.js';
import { DAY, DT, ForagerMind, fruitDefs, fruitLaws, sight } from './fruit.js';
import { grainDefs, processLaw } from './grain.js';
import { forageModels, seasonDefs, seasonMind, sow, wither } from './season.js';
import type { Law } from './types.js';

/** 部品の組: 定義・法則・感覚・記憶の規則・心の種類。設定の modules で名前を挙げると、その組を世界に登録する。 */
export interface Module {
  defs: ThingDef[];
  laws: Law[];
  senses: Sense[];
  memories: Memory[];
  minds: Record<string, () => Mind>;
}

/** 目録。組の名 → 部品。fruit は果実の段（自然・木・実・刃物・人・家と、その法則、視覚、採取者の心）。 */
export const catalog: Record<string, Module> = {
  fruit: { defs: fruitDefs, laws: fruitLaws, senses: [sight], memories: [], minds: { forager: () => new ForagerMind() } },
  grain: { defs: grainDefs, laws: [processLaw], senses: [], memories: [], minds: {} },
  season: { defs: seasonDefs, laws: [wither, sow], senses: [], memories: [forageModels.memory], minds: { modular: seasonMind } },
};

/** 置く物。定義の名と、定義の既定値への上書き。位置は x・y（状態に入る）。 */
export interface PlacedThing {
  id: ThingId;
  def: string;
  x?: number;
  y?: number;
  attr?: Record<string, Scalar>;
  state?: State;
  res?: Resources;
  rel?: Relations;
}

/** 設定。world.days は走らせる日数、world.dt は一刻みの長さ（分）。 */
export interface ScenarioConfig {
  format: 'skeleton-scenario/1';
  name?: string;
  description?: string;
  modules: string[];
  defs?: ThingDef[];
  world?: { dt?: number; days?: number; pairOrder?: WorldOptions['pairOrder']; rangeAttrs?: string[]; allPairs?: boolean };
  things: PlacedThing[];
}

/** 記録に残す、使った部品の名と版。 */
export interface Registry {
  modules: string[];
  laws: { id: string; version: string }[];
  senses: { id: string; version: string }[];
  memories: { id: string; version: string }[];
  minds: string[];
}

const modulesOf = (config: ScenarioConfig): Module[] =>
  config.modules.map((name) => {
    const m = catalog[name];
    if (!m) throw new Error(`unknown module ${name} (known: ${Object.keys(catalog).join(', ')})`);
    return m;
  });

/** 設定が使う部品の名と版。 */
export function registryOf(config: ScenarioConfig): Registry {
  const ms = modulesOf(config);
  return {
    modules: [...config.modules],
    laws: ms.flatMap((m) => m.laws.map((l) => ({ id: l.id, version: l.version }))),
    senses: ms.flatMap((m) => m.senses.map((s) => ({ id: s.id, version: s.version }))),
    memories: ms.flatMap((m) => m.memories.map((s) => ({ id: s.id, version: s.version }))),
    minds: ms.flatMap((m) => Object.keys(m.minds)),
  };
}

/** 定義を、親が先に来る順に並べる。同じ名は後に挙げた方（設定の defs）で置き換える。 */
function orderedDefs(defs: ThingDef[]): ThingDef[] {
  const byName = new Map<string, ThingDef>();
  for (const d of defs) byName.set(d.name, d);
  const out: ThingDef[] = [];
  const done = new Set<string>();
  const visit = (d: ThingDef, depth = 0) => {
    if (done.has(d.name)) return;
    if (depth > 32) throw new Error(`def cycle at ${d.name}`);
    if (d.parent !== undefined) {
      const p = byName.get(d.parent);
      if (!p) throw new Error(`def ${d.name}: unknown parent ${d.parent}`);
      visit(p, depth + 1);
    }
    done.add(d.name);
    out.push(d);
  };
  for (const d of byName.values()) visit(d);
  return out;
}

/** 設定から世界を作る。部品を登録し、物を一覧の順に定義から置く。心は札 mind で付く。 */
export function buildFromConfig(config: ScenarioConfig): World {
  if (config.format !== 'skeleton-scenario/1') throw new Error(`unknown scenario format ${String(config.format)}`);
  const ms = modulesOf(config);
  const w = new World({ rangeAttrs: config.world?.rangeAttrs ?? ['sight', 'reach', 'smell'], allPairs: config.world?.allPairs ?? false, pairOrder: config.world?.pairOrder ?? 'sorted' });
  for (const d of orderedDefs([...ms.flatMap((m) => m.defs), ...(config.defs ?? [])])) w.addDef(d);
  for (const m of ms) {
    for (const l of m.laws) w.addLaw(l);
    for (const s of m.senses) w.addSense(s);
    for (const s of m.memories) w.addMemory(s);
    for (const [name, make] of Object.entries(m.minds)) w.addMind(name, make);
  }
  for (const t of config.things) {
    const state = { ...(t.state ?? {}), ...(t.x !== undefined ? { x: t.x } : {}), ...(t.y !== undefined ? { y: t.y } : {}) };
    w.addFromDef(t.id, t.def, { attr: t.attr, state, res: t.res, rel: t.rel });
  }
  return w;
}

const stepOf = (config: ScenarioConfig) => config.world?.dt ?? DT;
const untilOf = (config: ScenarioConfig, days?: number) => (days ?? config.world?.days ?? 30) * DAY;

/** 記録のファイル。設定、使った部品の名と版、初期状態、記録、最後の状態の要約。 */
export interface Recording {
  format: 'skeleton-recording/1';
  scenario: ScenarioConfig;
  registry: Registry;
  dt: number;
  until: number;
  initial: WorldState;
  ledger: LedgerEntry[];
  final: { now: number; things: number; ledger: number; thingsHash: string; ledgerHash: string };
}

/** 決定的な文字列の要約（cyrb53）。同じ値かを確かめるためだけに使う。 */
export function textDigest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** 最後の状態の要約。事物の値（id の順）と記録の要約。 */
export function finalOf(w: World): Recording['final'] {
  const things = w.query(() => true).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { now: w.now, things: things.length, ledger: w.ledger.length, thingsHash: textDigest(JSON.stringify(things)), ledgerHash: textDigest(JSON.stringify(w.ledger)) };
}

/** 設定から走らせ、走らせた世界と記録を返す。days を渡せば設定の日数の代わりに使う。onDay は一日走らせるごとに、そこまでの時刻（分）で呼ぶ（画面の進み具合）。 */
export function runConfig(config: ScenarioConfig, days?: number, onDay?: (now: number, until: number) => void): { world: World; recording: Recording } {
  const w = buildFromConfig(config);
  const initial = w.save();
  const dt = stepOf(config);
  const until = untilOf(config, days);
  for (let t = Math.min(DAY, until); ; t = Math.min(t + DAY, until)) {
    w.run(t, dt);
    onDay?.(w.now, until);
    if (t >= until) break;
  }
  return { world: w, recording: { format: 'skeleton-recording/1', scenario: config, registry: registryOf(config), dt, until, initial, ledger: w.ledger.slice(), final: finalOf(w) } };
}

/** 設定から走らせて記録する。 */
export const record = (config: ScenarioConfig, days?: number): Recording => runConfig(config, days).recording;

/** 記録の部品の版が、いまのコードの版と同じか。違う名を返す（空なら同じ）。 */
export function registryMismatch(rec: Recording): string[] {
  const now = registryOf(rec.scenario);
  const key = (xs: { id: string; version: string }[]) => xs.map((x) => `${x.id}@${x.version}`);
  const want = new Set([...key(rec.registry.laws), ...key(rec.registry.senses), ...key(rec.registry.memories)]);
  const have = new Set([...key(now.laws), ...key(now.senses), ...key(now.memories)]);
  return [...[...want].filter((x) => !have.has(x)).map((x) => `recorded ${x}`), ...[...have].filter((x) => !want.has(x)).map((x) => `current ${x}`)];
}

/**
 * 記録から時刻 until の世界を再現する（法則と心は使わず、記録の流れと意図を適用する。知覚と記憶は感覚・記憶の規則で計算し直す）。
 * until を省けば記録の終わりまで。from に途中の写し（同じ記録を再生した世界の save）を渡せば、そこから続ける（画面で時刻を動かすときの近道）。
 */
export function replayRecording(rec: Recording, until = rec.until, from: WorldState = rec.initial): World {
  const w = World.load(from, { rangeAttrs: rec.scenario.world?.rangeAttrs ?? ['sight', 'reach', 'smell'], allPairs: rec.scenario.world?.allPairs ?? false, pairOrder: rec.scenario.world?.pairOrder ?? 'sorted' });
  for (const m of modulesOf(rec.scenario)) {
    for (const s of m.senses) w.addSense(s);
    for (const s of m.memories) w.addMemory(s);
  }
  w.replay(rec.ledger, rec.dt, until);
  return w;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const diffOf = <T extends Record<string, unknown>>(value: T, base: Record<string, unknown>): Partial<T> | undefined => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (!(k in base) || !sameValue(v, base[k])) out[k] = v;
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
};

/**
 * 組み立て済みの世界を設定に書き出す（構築関数で作った場面を、設定のファイルに移すため）。物ごとに、定義の既定値と違う値だけを残す。
 * 定義は部品の組のものを使う前提で書き出さない。部品に無い定義があれば defs に入れる。初期状態の記録（seed）は、置いた後の値として書き出される。
 */
export function exportConfig(w: World, base: Omit<ScenarioConfig, 'format' | 'things' | 'defs'>): ScenarioConfig {
  const s = w.save();
  const known = new Set(modulesOf({ format: 'skeleton-scenario/1', things: [], ...base }).flatMap((m) => m.defs.map((d) => d.name)));
  const extra = s.defs.filter((d) => !known.has(d.name));
  const things = s.things.map((t): PlacedThing => {
    const d = w.def(t.kind);
    const { x, y, ...rest } = t.state;
    const out: PlacedThing = { id: t.id, def: t.kind };
    if (typeof x === 'number') out.x = x;
    if (typeof y === 'number') out.y = y;
    const attr = diffOf(t.attr, d.attr);
    const state = diffOf(rest, Object.fromEntries(Object.entries(d.state).filter(([k]) => k !== 'x' && k !== 'y')));
    const res = diffOf(t.res, d.res);
    const rel = diffOf(t.rel, d.rel);
    if (attr) out.attr = attr as Record<string, Scalar>;
    if (state) out.state = state as State;
    if (res) out.res = res as Resources;
    if (rel) out.rel = rel as Relations;
    return out;
  });
  return { format: 'skeleton-scenario/1', ...base, ...(extra.length ? { defs: extra } : {}), things };
}
