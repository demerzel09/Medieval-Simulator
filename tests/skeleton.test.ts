// 最小の骨格の不変条件。docs/DESIGN.md「細部へ降りる前に満たす条件」と Laurier・Poels の表1に対応する。
import { describe, expect, it } from 'vitest';
import { World, buildMealScenario, runDays, mealTypes, DAY, HOUR } from '../packages/skeleton/index.js';
import type { Effect, LedgerEntry, ThingSnapshot } from '../packages/skeleton/index.js';

const str = (t: ThingSnapshot | undefined, a: string): string => (typeof t?.attrs[a] === 'string' ? (t!.attrs[a] as string) : '');
const num = (t: ThingSnapshot | undefined, a: string): number => (typeof t?.attrs[a] === 'number' ? (t!.attrs[a] as number) : 0);

/** 作物・穀物・パン・胃・栄養・廃棄の総和。自然を含めれば保存される。 */
function foodTotal(w: World): number {
  return w.total('crop') + w.total('quantity', (t) => t.kind === 'grain' || t.kind === 'bread') + w.total('stomach') + w.total('nutrition') + w.total('waste');
}

describe('skeleton: 条件1・2 属性は作用の実例によってしか変わらず、両側を一度に変える', () => {
  it('完了した実例の効果は、どれも二つの事物の間で釣り合う', () => {
    const { scenario } = runDays(3);
    const completes = scenario.world.ledger.filter((e): e is Extract<LedgerEntry, { kind: 'complete' }> => e.kind === 'complete');
    expect(completes.length).toBeGreaterThan(0);
    for (const c of completes) {
      for (const e of c.effects) {
        if (e.kind === 'transfer') expect(e.from).not.toBe(e.to);
        if (e.kind === 'convert') expect(e.amount - e.produced).toBeGreaterThanOrEqual(-1e-9);
        if (e.kind === 'reassign') expect(e.giver).not.toBe(e.receiver);
      }
    }
  });

  it('食物の総量は、自然の源泉と廃棄を含めれば保存される（Laurier・Poels 第二公理）', () => {
    const { scenario } = runDays(5);
    const fresh = buildMealScenario().world;
    expect(foodTotal(scenario.world)).toBeCloseTo(foodTotal(fresh), 6);
  });

  it('効果の検証に失敗すれば、何も変わらない（片側だけ成功しない）', () => {
    const w = new World();
    w.addThing('x', 'bread', { quantity: 1, custodian: 'p', location: 'h' });
    w.addThing('y', 'bread', { quantity: 0, custodian: 'q', location: 'h' });
    w.addType({
      id: 'bad',
      version: 't',
      agentRole: 'a',
      roles: [{ name: 'a', where: (t) => t.id === 'x' }],
      duration: () => 0,
      effects: () => [
        { kind: 'transfer', attr: 'quantity', from: 'x', to: 'y', amount: 1 },
        { kind: 'transfer', attr: 'quantity', from: 'x', to: 'y', amount: 5 }, // 不足で失敗する
      ],
    });
    w.attempt({ type: 'bad', binding: { a: 'x' } });
    expect(() => w.run(1)).toThrow(/insufficient/);
    expect(num(w.thing('x'), 'quantity')).toBe(1);
    expect(num(w.thing('y'), 'quantity')).toBe(0);
  });
});

describe('skeleton: 条件3・4 保管者と到達', () => {
  it('どの事物も保管者はちょうど一人で、引き渡しは両保管者のロットを同じ実例で変える', () => {
    const { scenario } = runDays(6);
    const w = scenario.world;
    for (const lot of w.query((t) => t.kind === 'bread' || t.kind === 'grain')) {
      expect(['A', 'B']).toContain(str(lot, 'custodian'));
    }
    const handovers = w.ledger.filter((e): e is Extract<LedgerEntry, { kind: 'complete' }> => e.kind === 'complete' && e.type === 'handover');
    for (const h of handovers) {
      const t = h.effects.find((e): e is Extract<Effect, { kind: 'transfer' }> => e.kind === 'transfer' && e.attr === 'quantity');
      expect(t).toBeDefined();
      expect(str(w.thing(t!.from), 'custodian')).toBe(h.binding['giver']);
      expect(str(w.thing(t!.to), 'custodian')).toBe(h.binding['receiver']);
    }
  });

  it('到達していない場所のパンは食べられない（影響範囲に入らない）', () => {
    const { world } = buildMealScenario();
    // A の家にパンを置く。B は homeB にいるので、B の eat の影響範囲には入らない。
    world.addType({
      id: 'seed',
      version: 't',
      agentRole: 'nature',
      roles: [{ name: 'nature', where: (t) => t.kind === 'nature' }],
      duration: () => 0,
      effects: () => [{ kind: 'convert', from: 'nature', fromAttr: 'crop', amount: 1, to: 'bread:A@homeA', toAttr: 'quantity', produced: 1, lossTo: 'nature', lossAttr: 'waste' }],
    });
    world.attempt({ type: 'seed', binding: { nature: 'nature' } });
    world.run(1);
    expect(num(world.thing('bread:A@homeA'), 'quantity')).toBe(1);
    const r = world.attempt({ type: 'eat', binding: { person: 'B' } });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/bread: no thing in scope/);
  });
});

describe('skeleton: 条件5 心象は知覚でしか変わらず、古く、誤り得る', () => {
  it('知覚した事物だけが心象に入り、時刻と出所を持つ', () => {
    const { scenario } = runDays(1);
    const a = scenario.world.thing('A')!;
    const knowledge = a.attrs['knowledge'] as Record<string, { at: number; source: string; attrs: Record<string, unknown> }>;
    const keys = Object.keys(knowledge);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(knowledge[k]!.source).toBe('A');
      expect(knowledge[k]!.at).toBeGreaterThanOrEqual(0);
    }
    // homeB の事物は A の心象に無い（A は homeB に行っていない）。
    expect(keys.some((k) => k.endsWith('@homeB'))).toBe(false);
  });
});

describe('skeleton: 条件7・8 自然の作用は補正されず、同じ初期状態から同じ結果になる', () => {
  it('二回走らせると記録が一致する', () => {
    const a = runDays(4);
    const b = runDays(4);
    expect(JSON.stringify(a.scenario.world.ledger)).toBe(JSON.stringify(b.scenario.world.ledger));
    expect(a.daily).toEqual(b.daily);
  });

  it('栄養は需要に合わせて補正されず、食べなければ減り、減った分は自然へ移る', () => {
    const w = new World();
    w.addThing('nature', 'nature', { nutrition: 0, waste: 0 });
    w.addThing('P', 'person', { alive: 'yes', nutrition: 1, stomach: 0, location: 'h', home: 'h', keep: 0, knowledge: {} });
    for (const t of mealTypes) w.addType(t);
    for (let h = 0; h < 24; h++) w.scheduleNatural('wear', { nature: 'nature', person: 'P' }, h * HOUR);
    w.run(DAY);
    expect(num(w.thing('P'), 'nutrition')).toBeLessThan(1);
    expect(num(w.thing('nature'), 'nutrition')).toBeCloseTo(1 - num(w.thing('P'), 'nutrition'), 6);
  });
});

describe('skeleton: 対照 配分の規則だけを変え、世界側は変えない', () => {
  it('基準では訪問者が10日以内に餓死し、農夫が栄養4未満でだけ食べる対照では二人とも生きる。食物の総量はどちらも保存される', () => {
    const base = runDays(10);
    const contrast = runDays(10, { farmer: { eatBelow: 4 } });
    const last = (r: typeof base) => r.daily[r.daily.length - 1]!;
    expect(last(base)['A.alive']).toBe('yes');
    expect(last(base)['B.alive']).toBe('no');
    expect(last(contrast)['A.alive']).toBe('yes');
    expect(last(contrast)['B.alive']).toBe('yes');
    const fresh = buildMealScenario().world;
    expect(foodTotal(base.scenario.world)).toBeCloseTo(foodTotal(fresh), 6);
    expect(foodTotal(contrast.scenario.world)).toBeCloseTo(foodTotal(fresh), 6);
  });
});

describe('skeleton: 条件9 影響範囲は実例を作る前に決まり、完了時に再評価される', () => {
  it('開始後に対象が失われた実例は取り消され、部分的に成功しない', () => {
    const { world } = buildMealScenario();
    world.addType({
      id: 'blight',
      version: 't',
      agentRole: 'nature',
      roles: [{ name: 'nature', where: (t) => t.kind === 'nature' }],
      duration: () => 0,
      effects: () => [{ kind: 'transfer', attr: 'crop', from: 'field', to: 'nature', amount: 10 }],
    });
    world.addType({
      id: 'teleport',
      version: 't',
      agentRole: 'nature',
      roles: [{ name: 'nature', where: (t) => t.kind === 'nature' }],
      duration: () => 0,
      effects: () => [
        { kind: 'transfer', attr: 'occupants', from: 'homeA', to: 'field', amount: 1 },
        { kind: 'reassign', thing: 'A', attr: 'location', from: 'homeA', to: 'field', giver: 'homeA', receiver: 'field' },
      ],
    });
    world.attempt({ type: 'teleport', binding: { nature: 'nature' } });
    world.run(1);
    const r = world.attempt({ type: 'harvest', binding: { person: 'A' } });
    expect(r.accepted).toBe(true);
    const inst = world.instance(r.instance!)!;
    expect(inst.scope).toEqual(expect.arrayContaining(['A', 'field', 'grain:A@field', 'nature']));
    world.attempt({ type: 'blight', binding: { nature: 'nature' } });
    world.run(inst.dueAt);
    expect(world.instance(r.instance!)!.state).toBe('cancelled');
    expect(num(world.thing('grain:A@field'), 'quantity')).toBe(0);
  });
});
