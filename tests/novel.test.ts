// 新しい事物に自分で対処する心の試作の検査（study/new-things。docs/RESEARCH.md 10.10）。
import { describe, expect, it } from 'vitest';
import { DAY, DT, World, textDigest } from '../packages/skeleton/index.js';
import { buildNovel, portableKnowledge, runNovel } from '../packages/skeleton/novel.js';
import { affordanceMemory, appearance } from '../packages/skeleton/affordance.js';

const futileIn = (r: ReturnType<typeof runNovel>, knowledge: Record<string, Record<string, unknown>> = {}) => {
  let n = 0;
  for (const [k, e] of Object.entries(r.world.thing(r.person)!.rel)) if (k.startsWith('aff:s:') && e['s'] === 0) n += (e['n'] as number) - ((knowledge[k]?.['n'] as number | undefined) ?? 0);
  return n;
};

describe('新しい事物に自分で対処する心の試作', () => {
  it('心は法則の札を読まない: 札を写さない知覚でも、同じ記録になる', () => {
    for (const name of ['fruit', 'grain', 'nut'] as const) {
      const digest = (strict: boolean) => {
        const r = runNovel(name, 3, { strict });
        return textDigest(JSON.stringify(r.world.ledger));
      };
      expect(digest(true)).toBe(digest(false));
    }
  }, 60_000);

  it('穀物が炉で粥になると教えられていなくても、試して覚え、粥を作り続けて 30 日生きる。同じ世界で、知識の無い手書きの採取者は死ぬ', () => {
    const made = (r: ReturnType<typeof runNovel>) => r.world.ledger.filter((e) => 'law' in e && e.law === 'process' && e.effect.kind === 'spawn').length;
    for (const name of ['grain', 'grainApart'] as const) {
      const learner = runNovel(name, 30);
      expect(learner.outcome.alive).toBe(true);
      expect(made(learner)).toBeGreaterThan(30);
      expect(runNovel(name, 30, { person: 'person' }).outcome.alive).toBe(false);
    }
  }, 120_000);

  it('心は種類の名を知らない: 穀物を大麦（名も見た目も違い、法則は同じ）に替えた世界で、何も知らない人は同じ記録になる（種類の名を除いて）', () => {
    const strip = (r: ReturnType<typeof runNovel>) => JSON.stringify(r.world.ledger).replaceAll('barleyField', 'field').replaceAll('barley', 'grain');
    expect(strip(runNovel('barley', 5))).toBe(strip(runNovel('grain', 5)));
  }, 60_000);

  it('上の層（行為ごとに文脈が効くかと結果が出るまでの刻みを、種類をまたいで学ぶ）は、穀物で学んだ人が大麦に移るときの無駄な試しを減らす', () => {
    const train = (meta: number) => portableKnowledge(runNovel('grain', 30, { attr: { affMeta: meta } }).world, 'P1');
    const k0 = train(0);
    const k3 = train(3);
    const m0 = runNovel('barley', 30, { attr: { affMeta: 0 }, knowledge: k0 });
    const m3 = runNovel('barley', 30, { attr: { affMeta: 3 }, knowledge: k3 });
    expect(m3.outcome.alive).toBe(true);
    expect(futileIn(m3, k3)).toBeLessThan(futileIn(m0, k0));
  }, 120_000);

  it('心象の学びはすべて心象にあるので、初期状態と記録から再生すると心象まで同じになる', () => {
    const { world } = buildNovel('grain');
    const initial = world.save();
    world.run(2 * DAY, DT);
    const w = World.load(initial);
    w.addSense(appearance);
    w.addMemory(affordanceMemory);
    w.replay(world.ledger, DT, world.now);
    const dump = (x: World) => JSON.stringify(x.query(() => true));
    expect(dump(w)).toBe(dump(world));
  }, 60_000);
});
