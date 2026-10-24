// 最小の骨格（全事物の組への Δt の法則と、情報層の事象）の検査。
// docs/DESIGN.md「更新規則と影響範囲」「細部へ降りる前に満たす条件」に対応する。
import { describe, expect, it } from 'vitest';
import { World, buildFruitScenario, runFruitDays, massTotal, fruitLaws, sight, DAY, DT, HOUR } from '../packages/skeleton/index.js';
import type { ThingSnapshot } from '../packages/skeleton/index.js';

const num = (t: ThingSnapshot | undefined, a: string): number => (typeof t?.attrs[a] === 'number' ? (t!.attrs[a] as number) : 0);
const str = (t: ThingSnapshot | undefined, a: string): string => (typeof t?.attrs[a] === 'string' ? (t!.attrs[a] as string) : '');
const fruitsOn = (w: World, holder: string) => w.query((t) => t.kind === 'fruit' && str(t, 'attachedTo') === holder);
const events = (w: World, name: string) => w.ledger.filter((e) => 'event' in e && e.event === name);
const flows = (w: World, law: string) => w.ledger.filter((e) => 'law' in e && e.law === law);

/** 二人が手の届く所にいる、実が一つだけの木。 */
function twoPickersOneFruit(): World {
  const w = new World();
  w.addThing('nature', 'nature', { fruitStock: 100, growth: 100, growthSpent: 0, waste: 0, nutrition: 0, rotPerHour: 0 });
  w.addThing('tree', 'tree', { x: 0, y: 0, visibility: 300, cap: 12, growth: 0, ripenPerHour: 0, fruitFreshness: 2, fruitVisibility: 30, fruitOdor: 5 });
  for (const id of ['A', 'B']) {
    w.addThing(id, 'person', {
      alive: 'yes', x: 1, y: 0, homeX: 1, homeY: 0, visibility: 100, sight: 60, reach: 1.5, smell: 3, speedPerHour: 60, walkCostPerMeter: 0,
      pickPerHour: 6, eatPerHour: 12, digestPerHour: 0.5, digestYield: 0.8, wearPerHour: 0, nutrition: 6, stomach: 0,
      intent: 'pick', target: 'tree', targetX: 0, targetY: 0, knowledge: {},
    });
  }
  w.seed({ kind: 'spawn', id: 'fruit#1', thingKind: 'fruit', attrs: { attachedTo: 'tree', freshness: 2, visibility: 30, odor: 5 }, from: 'nature', fromAttr: 'fruitStock', amount: 1 });
  for (const law of fruitLaws) w.addLaw(law);
  w.addSense(sight);
  return w;
}

describe('skeleton: 果実を採って食べて生きる', () => {
  it('採取者一人は果実だけで30日生き、毎日栄養が正である', () => {
    const { daily } = runFruitDays(30);
    for (const row of daily) {
      expect(row['P1.alive']).toBe('yes');
      expect(Number(row['P1.nutrition'])).toBeGreaterThan(0);
    }
  });

  it('同じ木を二人で使っても両者が生き、実は一つずつ誰か一人にしか付かない', () => {
    const { scenario, daily } = runFruitDays(30, { persons: 2 });
    for (const row of daily) {
      expect(row['P1.alive']).toBe('yes');
      expect(row['P2.alive']).toBe('yes');
    }
    for (const f of scenario.world.query((t) => t.kind === 'fruit')) {
      expect(['tree', 'P1', 'P2']).toContain(str(f, 'attachedTo'));
    }
  });

  it('総量は保存される（自然の蓄え、実、胃、栄養、廃棄、熱の和が変わらない）', () => {
    const { scenario } = runFruitDays(10, { persons: 2 });
    const fresh = buildFruitScenario({ persons: 2 }).world;
    expect(massTotal(scenario.world)).toBeCloseTo(massTotal(fresh), 6);
  });

  it('同じ初期状態から同じ記録になる', () => {
    const a = runFruitDays(5);
    const b = runFruitDays(5);
    expect(JSON.stringify(a.scenario.world.ledger)).toBe(JSON.stringify(b.scenario.world.ledger));
  });
});

describe('skeleton: 物理層はすべての事物の組に法則を当てる', () => {
  it('刻みごとに（事物の数）² の組を調べ、絞り込みを切れば法則はその全組に当てられる', () => {
    const { world } = buildFruitScenario({ allPairs: true }); // 自然、木、人、実6 = 9 事物、法則 7
    world.tick(DT);
    expect(world.stats.pairChecks).toBe(9 * 9);
    expect(world.stats.pairEvaluations).toBe(9 * 9 * fruitLaws.length);
  });

  it('影響範囲にある組だけに法則を当てても、記録は全組に当てたときと同一になる（結果を変えない最適化）', () => {
    const filtered = runFruitDays(5, { persons: 2 });
    const all = runFruitDays(5, { persons: 2, allPairs: true });
    expect(JSON.stringify(filtered.scenario.world.ledger)).toBe(JSON.stringify(all.scenario.world.ledger));
    expect(filtered.scenario.world.stats.pairEvaluations).toBeLessThan(all.scenario.world.stats.pairEvaluations);
    expect(filtered.scenario.world.stats.pairChecks).toBe(all.scenario.world.stats.pairChecks);
  });

  it('法則の効果は組の二つの事物（と組から生まれた事物）にしか触れられない', () => {
    const w = new World();
    w.addThing('a', 'x', { v: 1 });
    w.addThing('b', 'x', { v: 0 });
    w.addThing('c', 'x', { v: 0 });
    w.addLaw({ id: 'leak', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', attr: 'v', from: 'a', to: 'c', amount: 1 }] : []) });
    expect(() => w.tick(1)).toThrow(/outside pair/);
  });

  it('自分自身との組も当てられる（a === b）', () => {
    const w = new World();
    w.addThing('a', 'x', { v: 1, u: 0 });
    w.addLaw({ id: 'self', version: 't', pair: (a, b) => (a.id === b.id ? [{ kind: 'convert', from: a.id, fromAttr: 'v', amount: 0.5, to: a.id, toAttr: 'u', produced: 0.5, lossTo: a.id, lossAttr: 'u' }] : []) });
    w.tick(1);
    expect(num(w.thing('a'), 'v')).toBeCloseTo(0.5, 9);
    expect(num(w.thing('a'), 'u')).toBeCloseTo(0.5, 9);
  });

  it('不足した transfer は残量だけ移り、負にならない', () => {
    const w = new World();
    w.addThing('a', 'x', { v: 0.3 });
    w.addThing('b', 'x', { v: 0 });
    w.addLaw({ id: 'drain', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', attr: 'v', from: 'a', to: 'b', amount: 1 }] : []) });
    w.tick(1);
    expect(num(w.thing('a'), 'v')).toBe(0);
    expect(num(w.thing('b'), 'v')).toBeCloseTo(0.3, 9);
    const entry = flows(w, 'drain')[0];
    expect(entry && 'applied' in entry ? entry.applied : NaN).toBeCloseTo(0.3, 9);
  });

  it('刻みの時間 Δt は行為の予算で、採る・食べるはそれを使い切ると止まる', () => {
    const w = twoPickersOneFruit();
    // B を離し、木に実を 5 個足す。A は 6 個/時 なので 10 分の刻みでは 1 個しか採れない。
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costAttr: 'nutrition', costTo: 'nature', cost: 0 });
    for (let i = 2; i <= 6; i++) {
      w.seed({ kind: 'spawn', id: `fruit#${i}`, thingKind: 'fruit', attrs: { attachedTo: 'tree', freshness: 2, visibility: 30, odor: 5 }, from: 'nature', fromAttr: 'fruitStock', amount: 1 });
    }
    w.tick(DT);
    expect(fruitsOn(w, 'A').length).toBe(1);
    expect(fruitsOn(w, 'tree').length).toBe(5);
  });
});

describe('skeleton: 範囲は属性と距離で決まり、知識は情報層の事象で入る', () => {
  it('木は家から見えるが、実は見える範囲が狭いので近づくまで見えない', () => {
    const { world } = buildFruitScenario(); // 木まで 40m、人の視界 60m、木の visibility 300、実の visibility 30
    world.tick(DT);
    const k = world.thing('P1')!.attrs['knowledge'] as Record<string, { kind: string }>;
    expect(k['tree']?.kind).toBe('tree');
    expect(Object.values(k).some((e) => e.kind === 'fruit')).toBe(false);
    world.run(2 * HOUR, DT); // 木へ近づく
    const k2 = world.thing('P1')!.attrs['knowledge'] as Record<string, { kind: string }>;
    expect(Object.values(k2).some((e) => e.kind === 'fruit')).toBe(true);
  });

  it('視界が木まで届かなければ木を知ることがなく、探索が無いので動けずに死ぬ', () => {
    const { scenario, daily } = runFruitDays(5, { sight: 20 });
    const k = scenario.world.thing('P1')!.attrs['knowledge'] as Record<string, unknown>;
    expect(k['tree']).toBeUndefined();
    expect(daily[daily.length - 1]!['P1.alive']).toBe('no');
  });

  it('手の届く範囲の外からは採れない', () => {
    const w = twoPickersOneFruit();
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costAttr: 'nutrition', costTo: 'nature', cost: 0 }); // B を 10m 離す
    w.tick(DT);
    expect(fruitsOn(w, 'A').length).toBe(1);
    expect(fruitsOn(w, 'B').length).toBe(0);
  });

  it('二人が同じ最後の実に手を伸ばすと、順番で先の一人に移り、もう一人には何も起きない', () => {
    const w = twoPickersOneFruit();
    w.tick(DT);
    expect(fruitsOn(w, 'A').length + fruitsOn(w, 'B').length).toBe(1);
    expect(fruitsOn(w, 'tree').length).toBe(0);
    expect(flows(w, 'pick').length).toBe(1);
  });

  it('知覚は刻みごとの流れではなく事象になる。現れたときと消えたときだけ記録される', () => {
    const { world } = buildFruitScenario();
    world.run(DAY, DT);
    const appear = events(world, 'appear').length;
    expect(appear).toBeGreaterThan(0);
    expect(appear + events(world, 'vanish').length).toBeLessThan(world.stats.ticks); // 刻み数より少ない
  });

  it('食べた実は、見えるはずの場所に無いので「消えた」事象になり、心象から消える', () => {
    const w = twoPickersOneFruit();
    w.tick(DT); // A が採る。知覚で A の心象に実が付いた物として写る
    const holder = fruitsOn(w, 'A').length === 1 ? 'A' : 'B';
    w.seed({ kind: 'intend', person: holder, intent: 'eat' });
    w.tick(DT); // 食べる → 同じ刻みの観測で、自分に付いているはずの実が無い → 消えた
    expect(fruitsOn(w, holder).length).toBe(0);
    const k = w.thing(holder)!.attrs['knowledge'] as Record<string, unknown>;
    expect(k['fruit#1']).toBeUndefined();
    expect(events(w, 'vanish').some((e) => 'about' in e && e.about === 'fruit#1')).toBe(true);
    // 実 1 が胃に入り、一刻みぶん消化が進んでいる（0.5/時 × 10 分）。
    expect(num(w.thing(holder), 'stomach')).toBeCloseTo(1 - (0.5 / 60) * 10, 6);
  });

  it('遠くて見えないだけの実は、消えたことにならず心象に残る', () => {
    const { world } = buildFruitScenario();
    world.run(2 * HOUR, DT); // 木まで行って実を見る
    const k1 = world.thing('P1')!.attrs['knowledge'] as Record<string, { kind: string }>;
    expect(Object.values(k1).some((e) => e.kind === 'fruit')).toBe(true);
    world.run(6 * HOUR, DT); // 採って家へ戻る
    const p = world.thing('P1')!;
    expect(num(p, 'x')).toBeLessThan(2);
    const k2 = p.attrs['knowledge'] as Record<string, { kind: string; attrs: Record<string, unknown> }>;
    const treeFruitsKnown = Object.entries(k2).filter(([, e]) => e.kind === 'fruit' && e.attrs['attachedTo'] === 'tree');
    expect(treeFruitsKnown.length).toBeGreaterThanOrEqual(1); // 家からは見えないが、覚えている
    for (const [id] of treeFruitsKnown) expect(str(world.thing(id), 'attachedTo')).toBe('tree'); // 覚えている実は実際に木にある
    expect(treeFruitsKnown.length).toBeLessThanOrEqual(fruitsOn(world, 'tree').length); // 留守中に実った分は知らない
  });
});

describe('skeleton: 心は意図だけを定め、世界が死亡を確定する', () => {
  it('意図は変わったときだけ事象になる', () => {
    const { world } = buildFruitScenario();
    world.run(DAY, DT);
    expect(events(world, 'intend').length).toBeLessThan(world.stats.ticks);
  });

  it('栄養が尽きた人物は刻みの終わりに世界が死亡と確定し、以後の法則の組から外れる', () => {
    const w = new World();
    w.addThing('nature', 'nature', { nutrition: 0, waste: 0 });
    w.addThing('P', 'person', { alive: 'yes', x: 0, y: 0, nutrition: 0.05, stomach: 0, wearPerHour: 0.6, digestPerHour: 0.5, digestYield: 0.8, intent: 'idle', knowledge: {} });
    for (const law of fruitLaws) w.addLaw(law);
    w.tick(DT);
    expect(str(w.thing('P'), 'alive')).toBe('no');
    expect(events(w, 'death').length).toBe(1);
    w.tick(DT);
    expect(flows(w, 'wear').length).toBe(1); // 二刻み目は消耗しない
  });
});
