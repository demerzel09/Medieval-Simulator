// 最小の骨格（全事物の組への Δt の法則、値の四区分、情報層の事象）の検査。
// docs/DESIGN.md「更新規則と影響範囲」「細部へ降りる前に満たす条件」に対応する。
import { describe, expect, it } from 'vitest';
import { World, ForagerMind, PatrolMind, unitHash, seasonWorld, buildFromConfig, record, registryMismatch, replayRecording, finalOf, buildSeasonScenario, replaySeason, inSeason, predict, SEASON_YEAR, buildFruitScenario, buildPlacedScenario, buildGrainScenario, fruitWorld, grainWorld, runFruitDays, runGrainDays, replayFruit, massTotal, fruitLaws, fruitDefs, sight, edibleOn, place, seedFruits, DAY, DT, HOUR, KIND } from '../packages/skeleton/index.js';
import type { ScenarioConfig, ThingSnapshot } from '../packages/skeleton/index.js';
import { readFileSync } from 'node:fs';

const res = (t: ThingSnapshot | undefined, r: string): number => t?.res[r] ?? 0;
const state = (t: ThingSnapshot | undefined, s: string): string => (typeof t?.state[s] === 'string' ? (t!.state[s] as string) : '');
const stateNum = (t: ThingSnapshot | undefined, s: string): number => (typeof t?.state[s] === 'number' ? (t!.state[s] as number) : 0);
const events = (w: World, name: string) => w.ledger.filter((e) => 'event' in e && e.event === name);
const flows = (w: World, law: string) => w.ledger.filter((e) => 'law' in e && e.law === law);

const PERSON_ATTR = {
  eats: 'plant', picks: true, grip: 1, visibility: 100, sight: 60, reach: 1.5, smell: 3, speedPerHour: 60, walkCostPerMeter: 0,
  pickPerHour: 6, eatPerHour: 12, digestPerHour: 0.5, digestYield: 0.8, wearPerHour: 0,
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
      expect(['tree', 'home', 'P1', 'P2']).toContain(state(f, 'attachedTo'));
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

  it('配置するだけで動く: 定義から置いた人物に心が付き、家を知覚して住み（関係 home を得て）、場面は事物ごとの設定をしない', () => {
    const { world } = buildFruitScenario();
    expect(world.thing('P1')!.rel).toEqual({}); // 家の所属は注入されていない
    world.tick(DT); // 家を知覚し、住む意図
    expect(events(world, 'intend').some((e) => 'intent' in e && e.intent === 'settle')).toBe(true);
    world.tick(DT); // 法則 settle が関係を書く
    expect(world.thing('P1')!.rel['home']!['home']).toBe(true);
    expect(flows(world, 'settle').length).toBe(1);
    // 心は札 mind で定義から付く。登録していない種類なら付かない
    const w = new World();
    for (const d of fruitDefs) w.addDef(d);
    w.addFromDef('nature', 'nature');
    w.addFromDef('Q', 'person');
    w.addLaw(fruitLaws.find((l) => l.id === 'wear')!);
    w.tick(DT);
    expect(events(w, 'intend').length).toBe(0); // 心が無いので意図は出ない
    w.addMind('forager', () => ({ decide: () => ({ intent: 'idle' }) })); // 後から登録しても既にある事物に付く
    w.tick(DT);
    expect(w.thing('Q')!.state['intent']).toBe('idle');
  });

  it('置くだけの村: 家 3・木 3・採取者 5 を任意の座標に置くと、全員が家を得て木を知り、死ぬのは法則で、世界は 30 日破綻しない', () => {
    const { world, persons } = buildPlacedScenario();
    expect(persons.length).toBe(5);
    world.run(30 * DAY, DT);
    expect(flows(world, 'settle').length).toBe(5);
    for (const p of persons) {
      const t = world.thing(p)!;
      expect(Object.values(t.rel).some((e) => e['home'] === true)).toBe(true);
      expect(Object.values(t.rel).some((e) => 'bears' in e)).toBe(true);
    }
    const dead = persons.filter((p) => state(world.thing(p), 'alive') === 'no');
    expect(flows(world, 'starve').length).toBe(dead.length); // 死亡はすべて法則 starve の効果
    expect(persons.length - dead.length).toBeGreaterThanOrEqual(1); // 生存者数は比較条件で、心を変えれば変わる（2026-10-25 は 2 人、確かめに向かう木を着くまで替えない心にして 4 人）
    const fresh = buildPlacedScenario().world;
    expect(massTotal(world)).toBeCloseTo(massTotal(fresh), 6); // 保存則は配置によらない
  });

  it('家は事物で、自分の家は関係の印。持ち物は家へしまえ、家から採るのは木から採るのと同じ法則', () => {
    const { world } = buildFruitScenario();
    expect(world.thing('home')!.attr['stores']).toBe(true);
    expect('homeX' in world.thing('P1')!.attr).toBe(false);
    world.run(6 * HOUR, DT); // 住み、木へ行って 3 個採り、家へ戻る
    const p = world.thing('P1')!;
    expect(p.rel['home']!['home']).toBe(true); // 印は知覚の写し直しで消えない
    expect(p.rel['home']!['x']).toBe(0); // 位置は知覚で写る
    expect(stateNum(p, 'x')).toBeLessThan(2);
    expect(edibleOn(world, 'P1').length).toBe(3);
    world.seed({ kind: 'intend', person: 'P1', intent: 'stow', target: 'home' }); // しまう（一刻みに 1 個）
    world.tick(DT);
    expect(edibleOn(world, 'home').length).toBe(1);
    expect(edibleOn(world, 'P1').length).toBe(2);
    expect(flows(world, 'stow').length).toBe(1);
    world.seed({ kind: 'intend', person: 'P1', intent: 'pick', target: 'home' }); // 家から採るのは木から採るのと同じ法則
    world.tick(DT);
    expect(edibleOn(world, 'home').length).toBe(0);
    expect(edibleOn(world, 'P1').length).toBe(3);
    expect(flows(world, 'pick').some((e) => 'effect' in e && e.effect.kind === 'reassign' && e.effect.from === 'home')).toBe(true);
    // 置ける札（stores）の無い相手にはしまえない
    const w = twoPickersOneFruit();
    w.tick(DT); // A が採る
    w.seed({ kind: 'intend', person: 'A', intent: 'stow', target: 'tree' });
    w.tick(DT);
    expect(edibleOn(w, 'A').length).toBe(1);
    expect(flows(w, 'stow').length).toBe(0);
  });

  it('録画: 初期状態と記録から再生した世界は、走らせた世界と同じ状態・同じ記録になる。法則と心は要らない', () => {
    const { scenario, initial } = runFruitDays(5, { persons: 2 });
    const live = scenario.world;
    const replayed = replayFruit(initial, live.ledger, live.now);
    const dump = (w: World) => JSON.stringify(w.query(() => true));
    expect(dump(replayed)).toBe(dump(live));
    expect(replayed.now).toBe(live.now);
    const withoutSeed = live.ledger.filter((e) => !('law' in e && e.law === 'seed'));
    expect(JSON.stringify(replayed.ledger)).toBe(JSON.stringify(withoutSeed));
    // 途中の時刻 t で止めれば、そこまで走らせた世界と同じ
    const mid = replayFruit(initial, live.ledger, 2 * DAY);
    expect(dump(mid)).toBe(dump(runFruitDays(2, { persons: 2 }).scenario.world));
  });
});

describe('skeleton: 物理層はすべての事物の組に法則を当てる', () => {
  it('刻みごとに（事物の数）² の組を調べ、絞り込みを切れば法則はその全組に当てられる', () => {
    const { world } = buildFruitScenario({ allPairs: true }); // 自然、木、家、人、実6 = 10 事物、法則 11
    world.tick(DT);
    expect(world.stats.pairChecks).toBe(10 * 10);
    expect(world.stats.pairEvaluations).toBe(10 * 10 * fruitLaws.length);
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

  it('不可分な物の取り合いは、要求に載せた力（握る力＋刃物）の大きい方が取り、同点は id 順。持ち主の意思ではなく物理が決める', () => {
    const w = twoPickersOneFruit(); // A と B が同じ最後の実を狙う。力が同じなら id 順で A
    w.tick(DT);
    expect(edibleOn(w, 'A').length).toBe(1);
    const w2 = new World();
    for (const d of fruitDefs) w2.addDef(d);
    w2.addThing('nature', 'nature', { attr: { sink: true, grows: true, rotPerHour: 0 }, res: { fruitStock: 100, growth: 100, growthSpent: 0, waste: 0, nutrition: 0, freshness: 0 } });
    w2.addThing('tree', 'tree', { attr: { bears: 'fruit', visibility: 300, cap: 12, ripenPerHour: 0 }, state: { x: 0, y: 0 }, res: { growth: 0 } });
    w2.addThing('A', 'person', { attr: PERSON_ATTR, state: { alive: 'yes', x: 1, y: 0, intent: 'pick', target: 'tree', targetX: 0, targetY: 0 }, res: { nutrition: 6, stomach: 0 } });
    w2.addThing('B', 'person', { attr: { ...PERSON_ATTR, grip: 2 }, state: { alive: 'yes', x: 1, y: 0, intent: 'pick', target: 'tree', targetX: 0, targetY: 0 }, res: { nutrition: 6, stomach: 0 } });
    w2.seed(FRUIT('fruit#1'));
    for (const law of fruitLaws) w2.addLaw(law);
    w2.tick(DT);
    expect(edibleOn(w2, 'B').length).toBe(1); // 握る力 2 の B が取る
    expect(edibleOn(w2, 'A').length).toBe(0);
  });

  it('結びつきの強い実（札 bond）は力が足りなければ採れず、刃物（事物）を持てば採れる。成否は両者の属性で決まる', () => {
    const w = twoPickersOneFruit();
    w.addDef({ name: 'nut', parent: 'fruit', attr: { bond: 5 } }); // 強く付く実の種類（定義の継承）
    w.seed({ kind: 'move', thing: 'B', dx: 9, dy: 0, costFrom: 'B', costRes: 'nutrition', costTo: 'nature', cost: 0 }); // B を離す
    w.seed({ kind: 'spawn', id: 'nut#1', def: 'nut', state: { attachedTo: 'tree' }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
    w.tick(DT); // A は fruit#1（bond 0）を採るが、nut#1 は握る力 1 < 5 で採れない
    w.tick(DT);
    expect(state(w.thing('nut#1'), 'attachedTo')).toBe('tree');
    w.addFromDef('knife#1', 'knife', { state: { attachedTo: 'A' } }); // 刃物を持たせる（持ち物は事物）
    w.tick(DT);
    expect(state(w.thing('nut#1'), 'attachedTo')).toBe('A'); // 力 1 + 10 ≥ 5
  });

  it('渡すのは持ち主の行為（法則 give）で、解決の規則ではない', () => {
    const w = twoPickersOneFruit();
    w.tick(DT); // A が採る
    w.seed({ kind: 'intend', person: 'A', intent: 'give', target: 'B' });
    w.seed({ kind: 'intend', person: 'B', intent: 'idle' });
    w.tick(DT);
    expect(edibleOn(w, 'B').length).toBe(1);
    expect(edibleOn(w, 'A').length).toBe(0);
    expect(flows(w, 'give').length).toBe(1);
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

  it('視界が木まで届かなくても、木を知らない採取者は家を中心に渦巻きに歩いて探し、木を見つけて 30 日生きる', () => {
    const { world } = buildFruitScenario({ sight: 20 });
    world.tick(DT);
    expect(world.thing('P1')!.rel['tree']).toBeUndefined(); // 家からは見えない
    world.run(30 * DAY, DT);
    expect(world.thing('P1')!.rel['tree']?.['bears']).toBe('fruit');
    expect(state(world.thing('P1'), 'alive')).toBe('yes');
  });

  it('探索は相手を持たない移動（intent move、target は空）で、法則も行為も増やさない。行き先に着くまで替えず、記録から再生できる', () => {
    const { world } = buildFruitScenario({ treeDistance: 200 }); // 視界 60m の外
    const initial = world.save();
    world.run(2 * DAY, DT);
    const explores = events(world, 'intend').filter((e) => 'intent' in e && e.intent === 'move' && !e.target);
    expect(explores.length).toBeGreaterThan(10);
    expect(new Set(world.ledger.filter((e) => 'law' in e).map((e) => ('law' in e ? e.law : '')))).not.toContain('explore');
    // 渦巻き: 行き先の家からの距離は、次の行き先ほど大きい（内側は見たものとみなす）
    const radii = explores.map((e) => ('targetX' in e ? Math.hypot(e.targetX ?? 0, e.targetY ?? 0) : 0));
    for (let i = 1; i < radii.length && i < 20; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!);
    expect(world.thing('P1')!.rel['tree']).toBeDefined();
    expect(edibleOn(world, 'P1').length + flows(world, 'eat').length).toBeGreaterThan(0);
    const replayed = replayFruit(initial, world.ledger, world.now);
    expect(JSON.stringify(replayed.query(() => true))).toBe(JSON.stringify(world.query(() => true)));
  });

  it('探索の方針に万能の値は無い: 渦巻きの腕の間隔が狭いと遠い木に届かず、広いと近い木を見逃す（配置しだいで生死が入れ替わる）', () => {
    // 木を一本、家から距離 d・向き angle に置き、腕の間隔（視界に対する比）だけを変えた心で 30 日。数値は 2026-10-27 の実測。
    const survives = (spacing: number, d: number, angle: number) => {
      const w = fruitWorld({ mind: () => new ForagerMind(3, 4, spacing) });
      place(w, [{ id: 'tree', def: 'tree', x: d * Math.cos(angle), y: d * Math.sin(angle) }, { id: 'home', def: 'home' }, { id: 'P1', def: 'person' }]);
      seedFruits(w, 'tree', 6);
      w.run(3 * DAY, DT); // 探索の予算は栄養が尽きるまでの約 2 日
      return state(w.thing('P1'), 'alive') === 'yes';
    };
    expect(survives(1, 100, 0)).toBe(true); // 隙間の無い渦巻きは近い木を必ず見つける
    expect(survives(3, 100, 0)).toBe(false); // 腕の間が視界より広いと、近い木でも見逃す
    expect(survives(1, 300, 2)).toBe(false); // 隙間の無い渦巻きは 2 日で 300m に届かない
    expect(survives(3, 300, 2)).toBe(true); // 広い渦巻きは届く
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

describe('skeleton: 心は意図だけを定め、死亡は法則が決める', () => {
  it('意図は変わったときだけ事象になる', () => {
    const { world } = buildFruitScenario();
    world.run(DAY, DT);
    expect(events(world, 'intend').length).toBeLessThan(world.stats.ticks);
  });

  it('栄養が尽きた人物は、自分自身との組の法則（札 mortal）で次の刻みに死に、以後の法則の組から外れる。世界の進行は栄養を知らない', () => {
    const w = new World();
    w.addThing('nature', 'nature', { attr: { sink: true }, res: { nutrition: 0, waste: 0 } });
    w.addThing('P', 'person', { attr: { wearPerHour: 0.6, digestPerHour: 0.5, digestYield: 0.8, mortal: true }, state: { alive: 'yes', x: 0, y: 0, intent: 'idle' }, res: { nutrition: 0.05, stomach: 0 } });
    w.addThing('I', 'person', { attr: { wearPerHour: 0.6 }, state: { alive: 'yes', x: 0, y: 0, intent: 'idle' }, res: { nutrition: 0, stomach: 0 } }); // 札 mortal が無ければ死なない
    for (const law of fruitLaws) w.addLaw(law);
    w.tick(DT); // 栄養が尽きる（法則は刻みの始めの状態を読むので、死ぬのは次の刻み）
    expect(res(w.thing('P'), 'nutrition')).toBe(0);
    expect(state(w.thing('P'), 'alive')).toBe('yes');
    w.tick(DT);
    expect(state(w.thing('P'), 'alive')).toBe('no');
    expect(flows(w, 'starve').length).toBe(1);
    expect(state(w.thing('I'), 'alive')).toBe('yes');
    w.tick(DT);
    expect(flows(w, 'wear').filter((e) => 'a' in e && e.a === 'P').length).toBe(1); // 死後は消耗しない
  });
});

describe('skeleton: 間接さの段 2（穀物を自分で加工して食べる）', () => {
  it('加工: 炉の手の届く所で手に持った穀物は、量 × 札 work の時間で粥になる。炉が遠ければ進まない。穀物は食べられず、量は保存される', () => {
    const w = grainWorld();
    place(w, [
      { id: 'hearth', def: 'hearth', x: 0, y: 1 },
      { id: 'field', def: 'field', x: 5, y: 0, attr: { ripenPerHour: 0 } },
      { id: 'P', def: 'person', x: 0, y: 0 },
      { id: 'Q', def: 'person', x: 50, y: 0 },
    ]);
    for (const id of ['g#1', 'g#2']) w.seed({ kind: 'spawn', id, def: 'grain', state: { attachedTo: id === 'g#1' ? 'P' : 'Q' }, from: 'nature', fromRes: 'fruitStock', amount: 1 });
    const before = massTotal(w);
    const hold = (person: string, intent: string) => w.seed({ kind: 'intend', person, intent, target: person === 'P' ? 'g#1' : 'g#2' });
    hold('P', 'eat');
    w.tick(DT);
    expect(w.thing('g#1')).toBeDefined(); // 札 edible が無いので食べられない
    for (let i = 0; i < 7; i++) {
      hold('P', 'process');
      hold('Q', 'process'); // 炉が手の届く範囲に無い
      w.tick(DT);
    }
    // 1 時間（6 刻み）で量が加工済みへ移り、次の刻みに粥が生まれて穀物が消える
    expect(w.thing('g#1')).toBeUndefined();
    const gruel = w.query((t) => t.kind === 'gruel' && t.state['attachedTo'] === 'P');
    expect(gruel.length).toBe(1);
    expect(gruel[0]!.res['quantity']).toBeCloseTo(1, 9);
    expect(edibleOn(w, 'P').length).toBe(1);
    expect(res(w.thing('g#2'), 'quantity')).toBe(1);
    expect(massTotal(w)).toBeCloseTo(before, 9);
  });

  it('畑は木と同じ法則で穀物を生み、上限は付いている物すべてで数える（食べられない物でも上限で止まる）', () => {
    const w = grainWorld();
    place(w, [{ id: 'field', def: 'field', x: 0, y: 0 }]);
    w.run(10 * DAY, DT);
    expect(w.query((t) => t.state['attachedTo'] === 'field').length).toBe(12);
  });

  it('同じ心で、穀物が炉で粥になると知らない人は実が足りずに死に、知っている人は穀物を加工して 30 日生きる。差は心象の種類の知識だけ', () => {
    const naive = buildGrainScenario({ knows: false });
    const farmer = buildGrainScenario({ knows: true });
    const p0 = naive.world.thing('P1')!;
    const p1 = farmer.world.thing('P1')!;
    expect(p1.attr).toEqual(p0.attr); // 札・仕様・心の種類は同じ
    expect(p0.rel).toEqual({});
    expect(p1.rel[`${KIND}grain`]).toEqual({ becomes: 'gruel', at: 'hearth' }); // 違いは定義が与える種類の知識だけ
    const initial = farmer.world.save();
    naive.world.run(15 * DAY, DT);
    farmer.world.run(30 * DAY, DT);
    const processed = (w: World) => flows(w, 'process').filter((e) => 'effect' in e && e.effect.kind === 'spawn').length;
    expect(state(naive.world.thing('P1'), 'alive')).toBe('no');
    expect(processed(naive.world)).toBe(0);
    expect(naive.world.query((t) => t.kind === 'grain').length).toBeGreaterThan(0); // 穀物は畑にあった
    expect(Object.values(naive.world.thing('P1')!.rel).some((e) => e['kind'] === 'grain')).toBe(true); // 見てはいた
    expect(state(farmer.world.thing('P1'), 'alive')).toBe('yes');
    expect(processed(farmer.world)).toBeGreaterThan(60);
    expect(massTotal(farmer.world)).toBeCloseTo(massTotal(buildGrainScenario({ knows: true }).world), 6);
    // 加工（生む・消す）も記録から同じに再生できる
    const replayed = replayFruit(initial, farmer.world.ledger, 3 * DAY);
    expect(JSON.stringify(replayed.query(() => true))).toBe(JSON.stringify(runGrainDays(3, { knows: true }).scenario.world.query(() => true)));
  });
});

describe('skeleton: 実る時期のある木と、時期を学んで巡回する心（docs/RESEARCH.md「巡回と時期の学習」）', () => {
  const near = (w: World, a: string, b: string) => w.distance(a, b) <= 1.5;
  // 森ごとに一本だけ置く果樹園（森の中心に一本ずつ。以前の一本ずつの果樹園と同じ配置と生産量）。学習の検査はこれで速く走らせる。
  const single = { treesPerForest: 1, ripenPerHour: 0.25 };

  it('木は種類ごとの時期にだけ実る。時期の外では育ちも実も増えず、年ごとのずれは木・種・年で決まる', () => {
    const { world } = buildSeasonScenario({ ...single, persons: [] });
    world.run(8 * DAY - DT, DT);
    expect(edibleOn(world, 'B1').length).toBe(0); // B は 8 日目から
    const aSpawnsAfter6 = flows(world, 'ripen').filter((e) => 'effect' in e && e.effect.kind === 'spawn' && e.a === 'nature' && e.b.startsWith('A') && e.at >= 6 * DAY);
    expect(aSpawnsAfter6.length).toBe(0); // A の時期（0〜6 日）が過ぎたら実らない
    world.run(9 * DAY, DT);
    expect(edibleOn(world, 'B1').length).toBeGreaterThan(0);
    const tree = (seed: number) => ({ id: 'T', kind: 'treeA', attr: { seasonPeriod: SEASON_YEAR, seasonStart: 2 * DAY, seasonLength: DAY, seasonJitter: DAY, seasonSeed: seed }, state: {}, rel: {}, res: {} });
    const starts = (seed: number) => [0, 1, 2].map((y) => {
      for (let t = y * SEASON_YEAR; t < (y + 1) * SEASON_YEAR; t += DT) if (inSeason(tree(seed), t)) return t - y * SEASON_YEAR;
      return -1;
    });
    expect(starts(0)).toEqual(starts(0));
    expect(Math.max(...starts(0)) - Math.min(...starts(0))).toBeGreaterThan(DAY / 2); // 年ごとにずれる（ずれ幅 ±1 日の半分以上）
    // 決定的な値は、末尾の数が 1 違うだけでも散らばる（混ぜが無いと隣どうしがほぼ同じ値になり、年ごとのずれが毎年同じになる）。
    const draws = Array.from({ length: 200 }, (_, n) => unitHash('X', n));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const lag1 = draws.slice(1).reduce((a, b, i) => a + (b - mean) * (draws[i]! - mean), 0) / draws.reduce((a, b) => a + (b - mean) ** 2, 0);
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(lag1)).toBeLessThan(0.2);
    expect(starts(1)).not.toEqual(starts(0)); // 種を変えれば別の年回り
    for (const s of starts(0)) expect(Math.abs(s - 2 * DAY)).toBeLessThanOrEqual(DAY);
  });

  it('記憶の規則: 着いた刻みに一度だけ、種類の見込みと、その木のずれを、同じ予測誤差でそれぞれの速さ倍だけ直す。近くにいる間は最後に見た数を書き続ける。記録には残らない', () => {
    const firstArrival = (attr: Record<string, number>) => {
      const { world } = buildSeasonScenario({ ...single, persons: [{ id: 'P1', def: 'patroller', attr }] });
      for (let i = 0; i < 2 * DAY / DT; i++) {
        world.tick(DT);
        if (typeof world.thing('P1')!.rel['A1']?.['visits'] === 'number') return world;
      }
      throw new Error('P1 did not reach A1');
    };
    // 初めの見込み prior 1、一年 12 区間の最初の区間。誤差 = 見た数 − 1。
    const world = firstArrival({ kindRate: 0.25, learnRate: 0.25 });
    const p = world.thing('P1')!;
    const e = p.rel['A1']!;
    const error = (e['lastCount'] as number) - 1;
    expect(error).toBeGreaterThan(0);
    expect(e['visits']).toBe(1);
    expect(p.rel['kind:treeA']!['fc0']).toBeCloseTo(1 + 0.25 * error, 9);
    expect(e['dv0']).toBeCloseTo(0.25 * error, 9);
    // 訪れていない同じ種類の木 A2 は、種類の見込みで当てる（ずれ 0）。別の種類の木は初めの見込みのまま。
    const t = world.now;
    expect(predict(p, { kind: 'treeA', bears: 'fruit' }, t)).toBeCloseTo(1 + 0.25 * error, 9);
    expect(predict(p, { kind: 'treeB', bears: 'fruit' }, t)).toBe(1);
    world.tick(DT);
    if (near(world, 'P1', 'A1')) expect(world.thing('P1')!.rel['A1']!['visits']).toBe(1); // 居続けても数えない
    expect(world.ledger.some((x) => 'law' in x && x.law === 'forecast')).toBe(false);
    // 種類の速さ 0 は一本ずつの学習: 種類の見込みは書かれず、prior + ずれ が一段の見込みを learnRate で直した値になる。
    const solo = firstArrival({ kindRate: 0, learnRate: 0.5 }).thing('P1')!;
    expect(solo.rel['kind:treeA']).toBeUndefined();
    expect(1 + (solo.rel['A1']!['dv0'] as number)).toBeCloseTo(1 + 0.5 * ((solo.rel['A1']!['lastCount'] as number) - 1), 9);
    expect(predict(solo, { kind: 'treeA', bears: 'fruit' }, t)).toBe(1);
  });

  it('巡回者の心は記憶を持たない: 同じ写しからは同じ意図。見込みは心象の値だけから計算する', () => {
    const { world } = buildSeasonScenario({ ...single, persons: [{ id: 'P1', def: 'patroller' }] });
    world.run(3 * DAY, DT);
    const mind = new PatrolMind();
    const snap = world.thing('P1')!;
    expect(mind.decide(snap, world.now)).toEqual(mind.decide(snap, world.now));
    expect(predict(snap, snap.rel['A1']!, world.now)).toBe(predict(snap, snap.rel['A1']!, world.now));
  });

  it('季節の場面も（木が枯れ、種から生える森でも）、組の順に依らず同じ結果になり、初期状態と記録から再生すると心象の見込みまで同じになる', () => {
    const dump = (w: World) => JSON.stringify(w.query(() => true));
    const run = (order: 'sorted' | 'reverse' | 'shuffle') => {
      const s = buildSeasonScenario({ pairOrder: order, jitterDays: 2, treesPerForest: 2, lifespanDays: 2, sowPerDay: 4 });
      s.world.run(3 * DAY, DT);
      return s.world;
    };
    const base = run('sorted');
    expect(dump(run('reverse'))).toBe(dump(base));
    expect(dump(run('shuffle'))).toBe(dump(base));
    const s = buildSeasonScenario({ jitterDays: 2, treesPerForest: 2, lifespanDays: 2, sowPerDay: 4 });
    const initial = s.world.save();
    s.world.run(5 * DAY, DT);
    expect(s.world.ledger.some((e) => 'law' in e && e.law === 'sow')).toBe(true); // 種から生え、
    expect(s.world.ledger.some((e) => 'law' in e && e.law === 'wither')).toBe(true); // 枯れた
    expect(dump(replaySeason(initial, s.world.ledger, s.world.now))).toBe(dump(s.world));
  }, 30_000); // 3 日を 3 回と 5 日を 1 回、再生を 1 回

  it('時期の学習は効くが、どの覚え方が最善かは条件で入れ替わる: 一人で 72 日、生産量しだいで、一本ずつ覚える心と二段で覚える心の生死が入れ替わる', () => {
    // 数値は 2026-10-27 の実測（docs/DESIGN.md「種類と一本の二段の見込み」）。学ばない心（両方の速さ 0）は、どちらの生産量でも先に死ぬ。
    const diedDay = (ripenPerHour: number, attr: Record<string, number>) => {
      const { world } = buildSeasonScenario({ treesPerForest: 1, persons: [{ id: 'X', def: 'patroller', attr: { appetite: 4, ...attr } }], ripenPerHour });
      world.run(72 * DAY, DT);
      const died = world.ledger.find((e) => 'law' in e && e.law === 'starve');
      return died ? died.at / DAY : Infinity;
    };
    const none = { kindRate: 0, learnRate: 0 };
    const tree = { kindRate: 0, learnRate: 0.5 };
    const both = { kindRate: 0.25, learnRate: 0.25 };
    expect(diedDay(0.25, both)).toBeGreaterThan(diedDay(0.25, tree)); // 71.9 日と 32.0 日
    expect(diedDay(0.25, tree)).toBeGreaterThan(diedDay(0.25, none)); // 学ばない心は 16.7 日
    expect(diedDay(0.15, tree)).toBe(Infinity); // 一本ずつは生き残り
    expect(diedDay(0.15, both)).toBeLessThan(72); // 二段は 40.5 日に死ぬ
  }, 60_000); // 72 日を 5 回走らせる

  it('森と木を置くだけで、木は森の中の空いた所に種から生え、寿命で枯れる。森の外の木は増えない。木の数を決めるものは無く、森の広さで頭打ちになる', () => {
    const w = seasonWorld();
    place(w, [
      { id: 'wood', def: 'forest', x: 0, y: 0 },
      { id: 'T', def: 'treeB', x: 0, y: 0, attr: { sowPerDay: 2, lifespan: 12 * DAY, ripenPerHour: 0.1 } },
      { id: 'lone', def: 'treeC', x: 200, y: 0, attr: { sowPerDay: 2 } },
    ]);
    const m0 = massTotal(w);
    const trees = () => w.query((t) => typeof t.attr['bears'] === 'string');
    w.run(6 * DAY, DT);
    const young = trees().filter((t) => t.id !== 'T' && t.id !== 'lone');
    expect(young.length).toBeGreaterThan(3);
    for (const t of young) {
      expect(t.kind).toBe('treeB'); // 親と同じ種類
      expect(t.attr['ripenPerHour']).toBe(0.1); // 親の属性を受け継ぐ
      expect(Math.hypot(t.state['x'] as number, t.state['y'] as number)).toBeLessThanOrEqual(15); // 森の中
    }
    w.run(36 * DAY, DT);
    expect(w.thing('T')).toBeUndefined(); // 寿命（12 日の 0.5〜1.5 倍）で枯れた
    const inWood = trees().filter((t) => t.id !== 'lone');
    expect(inWood.length).toBeGreaterThan(3); // 森は種から続いている
    expect(inWood.length).toBeLessThanOrEqual(9); // 広さ 15m・縄張り 10m の森に入るのはおよそ 7 本
    expect(trees().filter((t) => Math.hypot(t.state['x'] as number, t.state['y'] as number) > 15).map((t) => t.id)).toEqual(['lone']); // 森の外の木は増えない
    expect(massTotal(w)).toBeCloseTo(m0, 6);
  });
});

describe('skeleton: 設定のファイルから世界を作り、記録して再現する（scenarios/、packages/skeleton/scenario.ts）', () => {
  const builders: Record<string, () => World> = {
    'fruit-one': () => buildFruitScenario().world,
    'fruit-two': () => buildFruitScenario({ persons: 2 }).world,
    'placed-village': () => buildPlacedScenario().world,
    'grain-naive': () => buildGrainScenario().world,
    'grain-knows': () => buildGrainScenario({ knows: true }).world,
    'season-orchard': () => buildSeasonScenario({ treesPerForest: 1, ripenPerHour: 0.25 }).world,
    'season-forest': () => buildSeasonScenario({ persons: [{ id: 'P1', def: 'patroller' }, { id: 'P2', def: 'patroller', attr: { kindRate: 0, learnRate: 0.5 } }], spreadDays: 3, lifespanDays: 24, sowPerDay: 2 }).world,
  };
  const noSeed = (w: World) => JSON.stringify(w.ledger.filter((e) => !('law' in e && e.law === 'seed')));
  const things = (w: World) => JSON.stringify(w.query(() => true).sort((a, b) => (a.id < b.id ? -1 : 1)));

  it('置いてある設定のファイルは、構築関数の場面と同じ世界になる（初期の実の seed の記録を除き、記録も状態も同じ）', () => {
    for (const [name, make] of Object.entries(builders)) {
      const config = JSON.parse(readFileSync(`scenarios/${name}.json`, 'utf8')) as ScenarioConfig;
      const a = make();
      const b = buildFromConfig(config);
      a.run(2 * DAY, DT);
      b.run(2 * DAY, DT);
      expect(noSeed(b), name).toBe(noSeed(a));
      expect(things(b), name).toBe(things(a));
    }
  }, 60_000);

  it('記録のファイルから再生すると最後の状態と記録が同じになり、部品の版が違えば分かる', () => {
    const config = JSON.parse(readFileSync('scenarios/season-forest.json', 'utf8')) as ScenarioConfig;
    const rec = record(config, 2);
    expect(rec.registry.laws.map((l) => l.id)).toContain('sow');
    expect(registryMismatch(rec)).toEqual([]);
    expect(finalOf(replayRecording(rec))).toEqual(rec.final);
    const rerun = buildFromConfig(config);
    rerun.run(rec.until, rec.dt);
    expect(finalOf(rerun)).toEqual(rec.final);
    const changed = { ...rec, registry: { ...rec.registry, laws: rec.registry.laws.map((l) => (l.id === 'sow' ? { ...l, version: 'old' } : l)) } };
    expect(registryMismatch(changed)).toEqual(['recorded sow@old', `current sow@${rec.registry.laws.find((l) => l.id === 'sow')!.version}`]);
  }, 30_000);

  it('途中の写しから再生を続けても、初めから再生したのと同じ世界になる（記録の画面の写しの取り方）', () => {
    const config = JSON.parse(readFileSync('scenarios/season-forest.json', 'utf8')) as ScenarioConfig;
    const rec = record(config, 2);
    let w = replayRecording(rec, 0);
    for (let t = 360; t <= rec.until; t += 360) w = replayRecording(rec, t, w.save());
    expect(finalOf(w).thingsHash).toBe(rec.final.thingsHash);
    expect(JSON.stringify(replayRecording(rec, 1000, replayRecording(rec, 700).save()).query(() => true))).toBe(JSON.stringify(replayRecording(rec, 1000).query(() => true)));
  }, 30_000);

  it('設定の誤りは組み立てで止まる。番号付きの id を置けば、後で生まれる物はその番号を避ける', () => {
    expect(() => buildFromConfig({ format: 'skeleton-scenario/1', modules: ['nothing'], things: [] })).toThrow(/unknown module/);
    expect(() => buildFromConfig({ format: 'skeleton-scenario/1', modules: ['fruit'], defs: [{ name: 'orphan', parent: 'missing' }], things: [] })).toThrow(/unknown parent/);
    const w = buildFromConfig({ format: 'skeleton-scenario/1', modules: ['fruit'], things: [{ id: 'nature', def: 'nature' }, { id: 'tree/fruit#4', def: 'fruit' }] });
    expect(w.nextSpawnId('tree/fruit')).toBe('tree/fruit#5');
  });
});
