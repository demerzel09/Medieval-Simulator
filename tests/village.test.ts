// 村の実験の検査（study/new-things。docs/RESEARCH.md 10.10「他人から学び、他人と比べる」）。
import { describe, expect, it } from 'vitest';
import { DAY, DT, World, textDigest } from '../packages/skeleton/index.js';
import { buildNovel } from '../packages/skeleton/novel.js';
import { buildVillage } from '../packages/skeleton/village.js';
import { affordanceMemory, appearance, behaviour } from '../packages/skeleton/affordance.js';

describe('他人から学び、他人と比べる（村の試作）', () => {
  it('他人がいなければ、振る舞いの知覚と、見る・比べる値を足しても、一人の世界の記録は変わらない', () => {
    const digest = (social: boolean) => {
      const { world } = buildNovel('grain', social ? { attr: { affSocial: 0.5, affCompare: 1, affOptions: 8 } } : {});
      if (social) world.addSense(behaviour);
      world.run(3 * DAY, DT);
      return textDigest(JSON.stringify(world.ledger));
    };
    expect(digest(true)).toBe(digest(false));
  }, 60_000);

  it('見て学ぶ人は、他人が炉で穀物を粥にするのを見た数えを、炉のある文脈つきで持つ。見ない人は持たない', () => {
    const seen = (social: number) => {
      const { world } = buildVillage({ n: 2, outliers: 1, need: 1, social });
      world.run(2 * DAY, DT);
      return world.thing('P2')!.rel['aff:s:process:grain'];
    };
    const watcher = seen(0.5);
    expect(watcher?.['os']).toBeGreaterThan(0);
    expect(watcher?.['ocs.hearth']).toBeGreaterThan(0);
    expect(seen(0)?.['os']).toBeUndefined();
  }, 120_000);

  it('見た数えと比べる基準も心象にあるので、初期状態と記録から再生すると心象まで同じになる', () => {
    const { world } = buildVillage({ n: 3, outliers: 1, need: 1, social: 0.5, compare: 1 });
    const initial = world.save();
    world.run(1 * DAY, DT);
    const w = World.load(initial);
    w.addSense(appearance);
    w.addSense(behaviour);
    w.addMemory(affordanceMemory);
    w.replay(world.ledger, DT, world.now);
    const dump = (x: World) => JSON.stringify(x.query(() => true));
    expect(dump(w)).toBe(dump(world));
  }, 120_000);
});
