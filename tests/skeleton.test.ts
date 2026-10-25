// 最小の骨格（全事物の組への Δt の法則、値の四区分、情報層の事象）の検査。
// docs/DESIGN.md「更新規則と影響範囲」「細部へ降りる前に満たす条件」に対応する。
import { describe, expect, it } from 'vitest';
import { World, buildFruitScenario, runFruitDays, massTotal, fruitLaws, fruitDefs, sight, edibleOn, DAY, DT, HOUR } from '../packages/skeleton/index.js';
import type { ThingSnapshot } from '../packages/skeleton/index.js';

const res = (t: ThingSnapshot | undefined, r: string): number => t?.res[r] ?? 0;
const state = (t: ThingSnapshot | undefined, s: string): string => (typeof t?.state[s] === 'string' ? (t!.state[s] as string) : '');
const stateNum = (t: ThingSnapshot | undefined, s: string): number => (typeof t?.state[s] === 'number' ? (t!.state[s] as number) : 0);
const events = (w: World, name: string) => w.ledger.filter((e) => 'event' in e && e.event === name);
const flows = (w: World, law: string) => w.ledger.filter((e) => 'law' in e && e.law === law);

const PERSON_ATTR = {
  eats: 'plant', picks: true, visibility: 100, sight: 60, reach: 1.5, smell: 3, speedPerHour: 60, walkCostPerMeter: 0,
  pickPerHour: 6, eatPerHour: 12, digestPerHour: 0.5, digestYield: 0.8, wearPerHour: 0, homeX: 1, homeY: 0,
};
const FRUIT = (id: string) => ({ kind: 'spawn' as const, id, def: 'fruit', state: { attachedTo: 'tree' }, from: 'nature', fromRes: 'fruitStock', amount: 1 });

/** 二人が手の届く所にいる、実が一つだけの木。 */
function twoPickersOneFruit(): World {
  const w = new World();
  for (const d of fruitDefs) w.addDef(d);
  w.addThing('nature', 'nature', { attr: { sink: true, grows: true, rotPerHour: 0 }, res: { fruitStock: 100, growth: 100, growthSpent: 0, waste: 0, nutrition: 0, freshness: 0 } });
  w.addThing('tree', 'tree', { attr: { bears: 'fruit', visibility: 300, cap: 12, ripenPerHour: 0 }, state: { x: 0, y: 0 }, res: { growth: 0 } });
  for (const id of ['A', 'B']) {
    w.addThing(id, 'person', {
      attr: PERSON_ATTR,
      state: { alive: 'yes', x: 1, y: 0, intent: 'pick', target: 'tree', targetX: 0, targetY: 0 },
      res: { nutrition: 6, stomach: 0 },
    });
  }
  w.seed(FRUIT('fruit#1'));
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
    for (const f of scenario.world.query((t) => 'edible' in t.attr)) {
      expect(['tree', 'P1', 'P2']).toContain(state(f, 'attachedTo'));
    }
  });

  it('資源の総量は保存される（自然の蓄え、実、胃、栄養、廃棄、熱の和が変わらない）', () => {
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

describe('skeleton: 値の四区分（属性・状態・関係・資源）', () => {
  it('属性（仕様）は法則が読めるが、効果では書けない。資源は書ける', () => {
    const w = new World();
    w.addThing('a', 'x', { attr: { rate: 0.5 }, res: { v: 1 } });
    w.addThing('b', 'x', { attr: { rate: 0.5 }, res: { v: 0 } });
    w.addLaw({ id: 'flow', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', res: 'v', from: 'a', to: 'b', amount: a.attr['rate'] as number }] : []) });
    w.tick(1);
    expect(res(w.thing('b'), 'v')).toBeCloseTo(0.5, 9); // 属性 rate を読んで資源 v を移した
    const bad = new World();
    bad.addThing('a', 'x', { attr: { rate: 0.5 }, res: { v: 1 } });
    bad.addThing('b', 'x', { attr: { rate: 0.5 }, res: { v: 0 } });
    bad.addLaw({ id: 'rewrite', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', res: 'rate', from: 'a', to: 'b', amount: 0.1 }] : []) });
    expect(() => bad.tick(1)).toThrow(/spec attribute/);
    expect(Object.isFrozen(w.thing('a')!.attr)).toBe(true);
  });

  it('法則は種類ではなく札の組で相手を選ぶ。札が合わなければ食べられない', () => {
    const w = twoPickersOneFruit();
    w.addThing('C', 'person', {
      attr: { ...PERSON_ATTR, eats: 'meat' }, // 肉を食べる者に植物性の実は合わない
      state: { alive: 'yes', x: 1, y: 0, intent: 'eat', target: '', targetX: 0, targetY: 0 },
      res: { nutrition: 6, stomach: 0 },
    });
    w.seed({ ...FRUIT('fruit#2'), state: { attachedTo: 'C' } });
    w.tick(DT);
    expect(edibleOn(w, 'C').length).toBe(1); // 持っているが食べられない
    expect(res(w.thing('C'), 'stomach')).toBe(0);
  });

  it('札は資源の有無で代用しない。鮮度の受け皿である自然には腐敗が当たらない', () => {
    const w = twoPickersOneFruit(); // 自然は資源 freshness を持つが、札 perishable を持たない
    w.run(DAY, DT);
    expect(w.thing('nature')).toBeDefined();
    expect(flows(w, 'rot').every((e) => 'a' in e && e.a !== 'nature')).toBe(true);
  });

  it('種類の定義はデータで、親の既定値を継いで自分の値で上書きする。振る舞いは継がない', () => {
    const w = new World();
    for (const d of fruitDefs) w.addDef(d);
    w.addDef({ name: 'strong', parent: 'person', attr: { pickPerHour: 12 } }); // 採るのが速い人
    const strong = w.def('strong');
    expect(strong.attr['eats']).toBe('plant'); // 親から
    expect(strong.attr['pickPerHour']).toBe(12); // 自分で上書き
    expect(strong.res['nutrition']).toBe(6);
    w.addFromDef('S', 'strong', { attr: { sight: 10 } });
    expect(w.thing('S')!.attr['pickPerHour']).toBe(12);
    expect(w.thing('S')!.attr['sight']).toBe(10); // 生成時の上書き
    expect(w.thing('S')!.kind).toBe('strong');
    expect(() => w.addDef({ name: 'orphan', parent: 'nobody' })).toThrow(/unknown parent/);
  });

  it('生成は定義から行い、木が生む実の種類は木の札 bears が指す定義で決まる', () => {
    const { world } = buildFruitScenario({ ripenPerHour: 6 }); // 10 分ごとに 1 個
    world.tick(DT); // 育ちがたまる
    world.tick(DT); // 刻みの始めの育ちで生む（同期更新なので一刻み遅れる）
    const fruits = world.query((t) => 'edible' in t.attr);
    expect(fruits.length).toBe(7);
    expect(fruits.some((f) => f.id === 'tree/fruit#1')).toBe(true); // 生む側ごとの採番
    for (const f of fruits) {
      expect(f.kind).toBe('fruit');
      expect(f.attr['perishable']).toBe(true);
      expect(f.res['quantity']).toBe(1);
    }
  });

  it('心象は関係（相手ごとの状態）として、いつ・どこで・何を見たかを持つ', () => {
    const { world } = buildFruitScenario();
    world.tick(DT);
    const rel = world.thing('P1')!.rel;
    expect(rel['tree']).toBeDefined();
    expect(rel['tree']!['bears']).toBe('fruit');
    expect(rel['tree']!['x']).toBe(40);
    expect(rel['tree']!['at']).toBe(0);
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

  it('組をどの順に数えても結果は同じ（逆順・乱順で最終状態と記録の集合が一致）', () => {
    const final = (order: 'sorted' | 'reverse' | 'shuffle') => {
      const { scenario } = runFruitDays(5, { persons: 2, pairOrder: order });
      const things = scenario.world.query(() => true).map((t) => ({ id: t.id, state: t.state, res: t.res, rel: t.rel }));
      const entries = scenario.world.ledger.map((e) => JSON.stringify(e)).sort();
      return { things: JSON.stringify(things), entries };
    };
    const a = final('sorted');
    const b = final('reverse');
    const c = final('shuffle');
    expect(b.things).toBe(a.things);
    expect(c.things).toBe(a.things);
    expect(b.entries).toEqual(a.entries);
    expect(c.entries).toEqual(a.entries);
  });

  it('同じ資源への要求が手持ちを超えると、持ち主が比例で縮める（取り消しではなく細る）', () => {
    const w = new World();
    w.addThing('a', 'x', { res: { v: 1 } });
    w.addThing('b', 'x', { res: { v: 0 } });
    w.addThing('c', 'x', { res: { v: 0 } });
    w.addLaw({ id: 'drain', version: 't', pair: (a, b) => (a.id === 'a' && b.id !== 'a' ? [{ kind: 'transfer', res: 'v', from: 'a', to: b.id, amount: 0.8 }] : []) });
    w.tick(1); // b と c がそれぞれ 0.8 を求め、合計 1.6 > 1
    expect(res(w.thing('a'), 'v')).toBeCloseTo(0, 9);
    expect(res(w.thing('b'), 'v')).toBeCloseTo(0.5, 9);
    expect(res(w.thing('c'), 'v')).toBeCloseTo(0.5, 9);
    expect(w.stats.limited).toBe(2);
  });

  it('不可分な物の取り合いは、持ち主の関係（favor）か要求者の札（priority）で優先が決まり、無ければ id 順', () => {
    const w = twoPickersOneFruit(); // A と B が同じ最後の実を狙う。既定では id 順で A
    w.tick(DT);
    expect(edibleOn(w, 'A').length).toBe(1);
    const w2 = twoPickersOneFruit();
    w2.addThing('nature2', 'x', {}); // 変更なし。優先は B の札で付ける
    const B = w2.thing('B')!;
    void B;
    const w3 = new World();
    for (const d of fruitDefs) w3.addDef(d);
    w3.addThing('nature', 'nature', { attr: { sink: true, grows: true, rotPerHour: 0 }, res: { fruitStock: 100, growth: 100, growthSpent: 0, waste: 0, nutrition: 0, freshness: 0 } });
    w3.addThing('tree', 'tree', { attr: { bears: 'fruit', visibility: 300, cap: 12, ripenPerHour: 0 }, state: { x: 0, y: 0 }, res: { growth: 0 } });
    w3.addThing('A', 'person', { attr: PERSON_ATTR, state: { alive: 'yes', x: 1, y: 0, intent: 'pick', target: 'tree', targetX: 0, targetY: 0 }, res: { nutrition: 6, stomach: 0 } });
    w3.addThing('B', 'person', { attr: { ...PERSON_ATTR, priority: 1 }, state: { alive: 'yes', x: 1, y: 0, intent: 'pick', target: 'tree', targetX: 0, targetY: 0 }, res: { nutrition: 6, stomach: 0 } });
    w3.seed(FRUIT('fruit#1'));
    for (const law of fruitLaws) w3.addLaw(law);
    w3.tick(DT);
    expect(edibleOn(w3, 'B').length).toBe(1); // 札 priority で B が先
    expect(edibleOn(w3, 'A').length).toBe(0);
  });

  it('法則の効果は組の二つの事物（と組から生まれた事物）にしか触れられない', () => {
    const w = new World();
    w.addThing('a', 'x', { res: { v: 1 } });
    w.addThing('b', 'x', { res: { v: 0 } });
    w.addThing('c', 'x', { res: { v: 0 } });
    w.addLaw({ id: 'leak', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', res: 'v', from: 'a', to: 'c', amount: 1 }] : []) });
    expect(() => w.tick(1)).toThrow(/outside pair/);
  });

  it('自分自身との組も当てられる（a === b）', () => {
    const w = new World();
    w.addThing('a', 'x', { res: { v: 1, u: 0 } });
    w.addLaw({ id: 'self', version: 't', pair: (a, b) => (a.id === b.id ? [{ kind: 'convert', from: a.id, fromRes: 'v', amount: 0.5, to: a.id, toRes: 'u', produced: 0.5, lossTo: a.id, lossRes: 'u' }] : []) });
    w.tick(1);
    expect(res(w.thing('a'), 'v')).toBeCloseTo(0.5, 9);
    expect(res(w.thing('a'), 'u')).toBeCloseTo(0.5, 9);
  });

  it('不足した transfer は残量だけ移り、負にならない', () => {
    const w = new World();
    w.addThing('a', 'x', { res: { v: 0.3 } });
    w.addThing('b', 'x', { res: { v: 0 } });
    w.addLaw({ id: 'drain', version: 't', pair: (a, b) => (a.id === 'a' && b.id === 'b' ? [{ kind: 'transfer', res: 'v', from: 'a', to: 'b', amount: 1 }] : []) });
    w.tick(1);
    expect(res(w.thing('a'), 'v')).toBe(0);
    expect(res(w.thing('b'), 'v')).toBeCloseTo(0.3, 9);
    const entry = flows(w, 'drain')[0];
    expect(entry && 'applied' in entry ? entry.applied : NaN).toBeCloseTo(0.3, 9);
  });

  it('能力 × Δt がその刻みの容量で、採る 6 個/時 は 10 分の刻みでは 1 個', () => {
    const w = twoPickersOneFruit();
    // B を離し、木に実を 5 個足す。A は 6 個/時 なので 10 分の刻みでは 1 個しか採れない。
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costRes: 'nutrition', costTo: 'nature', cost: 0 });
    for (let i = 2; i <= 6; i++) w.seed(FRUIT(`fruit#${i}`));
    w.tick(DT);
    expect(edibleOn(w, 'A').length).toBe(1);
    expect(edibleOn(w, 'tree').length).toBe(5);
  });
});

describe('skeleton: 範囲は属性と距離で決まり、知識は情報層の事象で入る', () => {
  it('木は家から見えるが、実は見える範囲が狭いので近づくまで見えない', () => {
    const { world } = buildFruitScenario(); // 木まで 40m、人の視界 60m、木の visibility 300、実の visibility 30
    world.tick(DT);
    const k = world.thing('P1')!.rel;
    expect(k['tree']?.['bears']).toBe('fruit');
    expect(Object.values(k).some((e) => 'edible' in e)).toBe(false);
    world.run(2 * HOUR, DT); // 木へ近づく
    const k2 = world.thing('P1')!.rel;
    expect(Object.values(k2).some((e) => 'edible' in e)).toBe(true);
  });

  it('視界が木まで届かなければ木を知ることがなく、探索が無いので動けずに死ぬ', () => {
    const { scenario, daily } = runFruitDays(5, { sight: 20 });
    expect(scenario.world.thing('P1')!.rel['tree']).toBeUndefined();
    expect(daily[daily.length - 1]!['P1.alive']).toBe('no');
  });

  it('手の届く範囲の外からは採れない', () => {
    const w = twoPickersOneFruit();
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costRes: 'nutrition', costTo: 'nature', cost: 0 }); // B を 10m 離す
    w.tick(DT);
    expect(edibleOn(w, 'A').length).toBe(1);
    expect(edibleOn(w, 'B').length).toBe(0);
  });

  it('二人が同じ最後の実に手を伸ばすと、順番で先の一人に移り、もう一人には何も起きない', () => {
    const w = twoPickersOneFruit();
    w.tick(DT);
    expect(edibleOn(w, 'A').length + edibleOn(w, 'B').length).toBe(1);
    expect(edibleOn(w, 'tree').length).toBe(0);
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
    const holder = edibleOn(w, 'A').length === 1 ? 'A' : 'B';
    w.seed({ kind: 'intend', person: holder, intent: 'eat' });
    w.tick(DT); // 食べる → 同じ刻みの観測で、自分に付いているはずの実が無い → 消えた
    expect(edibleOn(w, holder).length).toBe(0);
    expect(w.thing(holder)!.rel['fruit#1']).toBeUndefined();
    expect(events(w, 'vanish').some((e) => 'about' in e && e.about === 'fruit#1')).toBe(true);
    // 同期更新: 消化はこの刻みの始めの胃（空）を見るので、食べた実の消化は次の刻みから（連鎖は一刻み遅れる）。
    expect(res(w.thing(holder), 'stomach')).toBeCloseTo(1, 9);
    w.tick(DT);
    expect(res(w.thing(holder), 'stomach')).toBeCloseTo(1 - (0.5 / 60) * 10, 6);
  });

  it('遠くて見えないだけの実は、消えたことにならず心象に残る', () => {
    const { world } = buildFruitScenario();
    world.run(2 * HOUR, DT); // 木まで行って実を見る
    expect(Object.values(world.thing('P1')!.rel).some((e) => 'edible' in e)).toBe(true);
    world.run(6 * HOUR, DT); // 採って家へ戻る
    const p = world.thing('P1')!;
    expect(stateNum(p, 'x')).toBeLessThan(2);
    const treeFruitsKnown = Object.entries(p.rel).filter(([, e]) => 'edible' in e && e['attachedTo'] === 'tree');
    expect(treeFruitsKnown.length).toBeGreaterThanOrEqual(1); // 家からは見えないが、覚えている
    for (const [id] of treeFruitsKnown) expect(state(world.thing(id), 'attachedTo')).toBe('tree'); // 覚えている実は実際に木にある
    expect(treeFruitsKnown.length).toBeLessThanOrEqual(edibleOn(world, 'tree').length); // 留守中に実った分は知らない
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
    w.addThing('nature', 'nature', { attr: { sink: true }, res: { nutrition: 0, waste: 0 } });
    w.addThing('P', 'person', { attr: { wearPerHour: 0.6, digestPerHour: 0.5, digestYield: 0.8 }, state: { alive: 'yes', x: 0, y: 0, intent: 'idle' }, res: { nutrition: 0.05, stomach: 0 } });
    for (const law of fruitLaws) w.addLaw(law);
    w.tick(DT);
    expect(state(w.thing('P'), 'alive')).toBe('no');
    expect(events(w, 'death').length).toBe(1);
    w.tick(DT);
    expect(flows(w, 'wear').length).toBe(1); // 二刻み目は消耗しない
  });
});
