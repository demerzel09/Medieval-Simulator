// 最小の骨格（Δt ごとの法則）の検査。docs/DESIGN.md「更新規則と影響範囲」「細部へ降りる前に満たす条件」に対応する。
import { describe, expect, it } from 'vitest';
import { World, buildFruitScenario, runFruitDays, massTotal, fruitLaws, DAY, DT, HOUR } from '../packages/skeleton/index.js';
import type { ThingSnapshot } from '../packages/skeleton/index.js';

const num = (t: ThingSnapshot | undefined, a: string): number => (typeof t?.attrs[a] === 'number' ? (t!.attrs[a] as number) : 0);
const str = (t: ThingSnapshot | undefined, a: string): string => (typeof t?.attrs[a] === 'string' ? (t!.attrs[a] as string) : '');
const fruitsOn = (w: World, holder: string) => w.query((t) => t.kind === 'fruit' && str(t, 'attachedTo') === holder);

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

describe('skeleton: 影響範囲の種類（視界・手の届く範囲）と心象', () => {
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
    // B を 10m 離す。
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costAttr: 'nutrition', costTo: 'nature', cost: 0 });
    w.tick(DT);
    expect(fruitsOn(w, 'A').length).toBe(1);
    expect(fruitsOn(w, 'B').length).toBe(0);
  });

  it('二人が同じ最後の実に手を伸ばすと、順番で先の一人に移り、もう一人には何も起きない', () => {
    const w = twoPickersOneFruit();
    w.tick(DT);
    expect(fruitsOn(w, 'A').length + fruitsOn(w, 'B').length).toBe(1);
    expect(fruitsOn(w, 'tree').length).toBe(0);
    const picks = w.ledger.filter((e) => 'law' in e && e.law === 'pick');
    expect(picks.length).toBe(1);
  });

  it('食べた実は心象からも消える（見直し）', () => {
    const w = twoPickersOneFruit();
    w.tick(DT); // A が採る
    const holder = fruitsOn(w, 'A').length === 1 ? 'A' : 'B';
    w.seed({ kind: 'intend', person: holder, intent: 'eat' });
    w.tick(DT); // 知覚 → 見直し → 食べる、の順なので、この刻みの終わりには実は消えているが心象には残る
    expect(fruitsOn(w, holder).length).toBe(0);
    w.tick(DT); // 次の刻みの見直しで心象から消える
    const k = w.thing(holder)!.attrs['knowledge'] as Record<string, unknown>;
    expect(k['fruit#1']).toBeUndefined();
    // 実 1 が胃に入り、二刻みぶん消化が進んでいる（0.5/時 × 10 分 × 2）。
    expect(num(w.thing(holder), 'stomach')).toBeCloseTo(1 - 2 * (0.5 / 60) * 10, 6);
  });
});

describe('skeleton: 属性は法則の流れでしか変わらず、足りなければ流れが細る', () => {
  it('不足した transfer は残量だけ移り、負にならない', () => {
    const w = new World();
    w.addThing('a', 'x', { v: 0.3 });
    w.addThing('b', 'x', { v: 0 });
    w.addLaw({ id: 'drain', version: 't', scope: () => [{ a: 'a' }], flow: () => [{ kind: 'transfer', attr: 'v', from: 'a', to: 'b', amount: 1 }] });
    w.tick(1);
    expect(num(w.thing('a'), 'v')).toBe(0);
    expect(num(w.thing('b'), 'v')).toBeCloseTo(0.3, 9);
    const entry = w.ledger.find((e) => 'law' in e && e.law === 'drain');
    expect(entry && 'applied' in entry ? entry.applied : NaN).toBeCloseTo(0.3, 9);
  });

  it('栄養が尽きた人物は刻みの終わりに世界が死亡と確定し、以後の法則の範囲から外れる', () => {
    const w = new World();
    w.addThing('nature', 'nature', { nutrition: 0, waste: 0 });
    w.addThing('P', 'person', { alive: 'yes', x: 0, y: 0, nutrition: 0.05, stomach: 0, wearPerHour: 0.6, digestPerHour: 0.5, digestYield: 0.8, intent: 'idle', knowledge: {} });
    for (const law of fruitLaws) w.addLaw(law);
    w.tick(DT);
    expect(str(w.thing('P'), 'alive')).toBe('no');
    const before = w.ledger.length;
    w.tick(DT);
    expect(w.ledger.filter((e) => 'law' in e && e.law === 'wear').length).toBe(1); // 二刻み目は消耗しない
    expect(w.ledger.length).toBeGreaterThanOrEqual(before);
  });
});

void DAY;
