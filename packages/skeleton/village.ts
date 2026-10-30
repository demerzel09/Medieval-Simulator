// 村の実験（study/new-things。docs/RESEARCH.md 10.10「他人から学び、他人と比べる」）。
// 新しい事物の世界（novel.ts）と同じ定義・法則に、人を何人も置く。法則も心も足さない（足すのは、他人の振る舞いを写す知覚だけ）。
// 果実の木は、初めの fruitDays 日だけ実る（実る時期の札を使う。安定した時期のあとの、大きな環境の変化）。
// 果実の採り方と食べ方は、皆が初めから知っている（今までの文化。果実の世界で一人が学んだ型を、皆に持たせる）。
// 畑の穀物は炉で粥になるが、誰もそれを知らない。人の個性は分布から引く（一人ずつの差は、id から決まる量で付ける）:
//   外れ値: 好奇心が強く（affCuriosity 0.6 前後）、満ち足りていても休まない（試作のこれまでの人と同じ）。
//   保守的な人: 好奇心が弱く（0.05 前後）、空腹でなく良い選択肢も無ければ、家で休む（affRest）。
// 比べる条件は、見て学ぶか（affSocial）、比べるか（affCompare）、空腹が試しを生むか（affNeed）、歩く費用の倍率。

import type { Relation, Relations, ThingId } from './types.js';
import type { World } from './world.js';
import { DAY, DT, place, unitHash, type Placement } from './fruit.js';
import { novelWorld, portableKnowledge, runNovel, seedOn } from './novel.js';
import { behaviour } from './affordance.js';

export interface VillageOptions {
  /** 人数。 */
  n: number;
  /** 外れ値の人数（P1 から順に）。 */
  outliers: number;
  /** 見た数えの重み（affSocial）。0 なら見ても学ばない。 */
  social?: number;
  /** 比べる強さ（affCompare）。 */
  compare?: number;
  /** 空腹が試しを生む重み（affNeed）。 */
  need?: number;
  /** 歩く費用の倍率（人の札 walkCostPerMeter 0.0005 に掛ける）。 */
  walk?: number;
  /** 果実の木が実る日数。 */
  fruitDays?: number;
  /** 保守的な人の好奇心と、休む閾値。 */
  shyCuriosity?: number;
  rest?: number;
  /** 炉の位置（既定は家の脇 (0,1)）。家から離すと、穀物を炉まで運ぶ段が要り、試して見つけにくくなる。 */
  hearth?: [number, number];
  /** 皆が初めから持つ知識（型）。既定は果実の世界で一人が 10 日で学んだ型。 */
  culture?: Relations;
  /** 行き先の点数から歩く費用を差し引く重み（affNet）。既定 0 は差し引かない。 */
  net?: number;
  /** 休む所とすることが無いときの行き先を、自分より上手くいっている人のそばにする重み（affFollow）。既定 0 はしない。 */
  follow?: number;
  /** 個性の引き方の種（繰り返しのため。既定は空で、引き方は id だけから決まる）。 */
  seed?: string;
}

let fruitCulture: Relations | undefined;
/** 今までの文化: 果実の世界で、試作の心が一人で 10 日に学んだ型（果実を採る、食べる、と試して効かなかったこと）。 */
export function defaultCulture(): Relations {
  fruitCulture ??= portableKnowledge(runNovel('fruit', 10).world, 'P1');
  return fruitCulture;
}

/** 村の世界を組み立てる。家 (0,0) と炉（既定は (0,1)）、東 40 m に果実の木、西 40 m に畑。人は皆、家の脇から始める。 */
export function buildVillage(o: VillageOptions): { world: World; people: ThingId[] } {
  const w = novelWorld();
  w.addSense(behaviour);
  const fruitDays = o.fruitDays ?? 10;
  const items: Placement[] = [
    { id: 'home', def: 'home', x: 0, y: 0 },
    { id: 'hearth', def: 'hearth', x: o.hearth?.[0] ?? 0, y: o.hearth?.[1] ?? 1 },
  ];
  // 木と畑は一か所ずつ（実りと上限を人数に比例させる）。行き先が多いと、試作の心は行き来で歩き疲れる（記録に残る失敗の一つ）。
  // 果実の時期は豊か（一人に一日 6 個。一人に要るのは歩く費用 5 倍でも 4 個ほど）で、現状のままで足りる。
  const scale = o.n;
  const trees = [{ id: 'tree', def: 'tree', x: 40, y: 0, attr: { ripenPerHour: 0.25 * scale, cap: 12 * scale, seasonPeriod: 10000 * DAY, seasonStart: 0, seasonLength: fruitDays * DAY } }];
  const fields = [{ id: 'field', def: 'field', x: -40, y: 0, attr: { ripenPerHour: 0.25 * o.n, cap: 12 * o.n } }];
  place(w, [...items, ...trees, ...fields]);
  const people: ThingId[] = [];
  const culture = o.culture ?? defaultCulture();
  for (let i = 0; i < o.n; i++) {
    const id = `P${i + 1}`;
    const outlier = i < o.outliers;
    // 個性の一人ずつの差: 0.5〜1.5 倍（同じ個性の二人が、同じ所で同じことをし続けるのを避ける）。
    const spread = (what: string) => 0.5 + unitHash(`${o.seed ?? ''}${id}:${what}`, 0);
    w.addFromDef(id, 'learner', {
      attr: {
        affSocial: o.social ?? 0,
        affCompare: o.compare ?? 0,
        affNeed: o.need ?? 0,
        walkCostPerMeter: 0.0005 * (o.walk ?? 1),
        affOptions: 16,
        affNet: o.net ?? 0,
        affFollow: o.follow ?? 0,
        ...(outlier
          ? { affCuriosity: 0.6 * spread('curiosity') }
          : { affCuriosity: (o.shyCuriosity ?? 0.05) * spread('curiosity'), affRest: (o.rest ?? 0.02) * spread('rest') }),
      },
      rel: culture,
    });
    people.push(id);
  }
  seedOn(w, 'tree', 'fruit', 6 * scale);
  seedOn(w, 'field', 'grain', 6 * o.n);
  return { world: w, people };
}

/** 人ごとの結果: 生死、死んだ日、初めて粥を作った日、作った粥の数、実りの無い自分の試し（初めから持たせた文化の分を除く）、終わりの栄養。 */
export function villageOutcome(w: World, people: ThingId[], culture: Relations = defaultCulture()) {
  return people.map((id) => {
    const t = w.thing(id)!;
    const died = w.ledger.find((e) => 'law' in e && e.law === 'starve' && e.a === id);
    const made = w.ledger.filter((e) => 'law' in e && e.law === 'process' && e.a === id && e.effect.kind === 'spawn');
    let futile = 0;
    for (const [k, e] of Object.entries(t.rel)) if (k.startsWith('aff:s:') && e['s'] === 0) futile += (typeof e['n'] === 'number' ? e['n'] : 0) - ((culture[k]?.['n'] as number | undefined) ?? 0);
    return {
      id,
      alive: t.state['alive'] === 'yes',
      diedDay: died ? Number((died.at / DAY).toFixed(1)) : undefined,
      firstGruelDay: made.length ? Number((made[0]!.at / DAY).toFixed(1)) : undefined,
      gruel: made.length,
      futile,
      nutrition: Number((t.res['nutrition'] ?? 0).toFixed(2)),
    };
  });
}

export function runVillage(o: VillageOptions, days: number) {
  const v = buildVillage(o);
  v.world.run(days * DAY, DT);
  return { ...v, outcome: villageOutcome(v.world, v.people, o.culture ?? defaultCulture()) };
}

export interface TurnoverOptions {
  /** 入れ替えを始める日（果実が尽きて、皆が粥を作るようになった後）。 */
  start: number;
  /** 一人の居る日数。入れ替えの間隔は life ÷ 人数（人数によらず、life 日で一回りする）。 */
  life: number;
  /** 終わりの日。 */
  days: number;
  /**
   * 教える（言葉の代わり）: 新しく来た人に、いちばん栄養の良い人の型を、見た数えとして fidelity 倍で渡す。
   * 見る（affSocial）と同じ重みで見込みに入る。0 なら教えない。手順の全体（どこで採り、どこで加工し、何が食べられるか）を一度に渡せる。
   */
  teach?: number;
  /**
   * 場所も教える: 教える人の覚えている、物に付いた物（畑の穀物など。他の人の手の物は除く）と、付いている先の見込みも渡す。
   * 種類の知識（何がどう効くか）だけでは、源が見えない所にあると取りに行けない。言葉は「どこにあるか」も渡せる。
   */
  teachPlaces?: boolean;
}

/**
 * 人の入れ替わる村: start 日から、いちばん古くからいる人が去り（死ぬ）、保守的な新しい人が家の脇に来る。新しい人は果実の文化だけを持ち、
 * 穀物のことは知らない。人数ごとに、見る・教える条件で、新しい人が粥を作れるようになるか（技が残るか）を測る（Henrich 2004 の問いの小さな形）。
 */
export function runVillageTurnover(o: VillageOptions, t: TurnoverOptions) {
  const v = buildVillage(o);
  const w = v.world;
  const culture = o.culture ?? defaultCulture();
  const order = [...v.people];
  const newcomers: ThingId[] = [];
  const arrived = new Map<ThingId, number>();
  const interval = t.life / o.n;
  let next = t.start;
  let count = 0;
  while (next < t.days - 1e-9) {
    w.run(next * DAY, DT);
    const old = order.shift();
    if (old && w.thing(old)?.state['alive'] === 'yes') w.seed({ kind: 'die', thing: old });
    const id = `N${++count}`;
    const told: Relations = {};
    if (t.teach) {
      const living = order.map((p) => w.thing(p)!).filter((p) => p.state['alive'] === 'yes');
      const teacher = living.sort((a, b) => (b.res['nutrition'] ?? 0) - (a.res['nutrition'] ?? 0) || (a.id < b.id ? -1 : 1))[0];
      for (const [key, e] of Object.entries(teacher?.rel ?? {})) {
        if (!key.startsWith('aff:s:') || key in culture) continue;
        const f: Relation = {};
        for (const [field, value] of Object.entries(e)) {
          if (typeof value !== 'number') continue;
          // 教わった数え: 教える人の自分の数え（n・s・u・y.・c.・cs.）を、見た数え（on・os・ou・oy.・oc.・ocs.）として渡す。
          if (field === 'n' || field === 's' || field === 'u') f[`o${field}`] = value * t.teach;
          else if (/^(y|c|cs)\./.test(field)) f[`o${field}`] = value * t.teach;
        }
        told[key] = f;
      }
      if (t.teachPlaces && teacher) {
        const agent = (id: string) => typeof teacher.rel[id]?.['intent'] === 'string';
        for (const [key, e] of Object.entries(teacher.rel)) {
          const at = typeof e['attachedTo'] === 'string' ? e['attachedTo'] : '';
          if (!key.startsWith('aff:') && at && at !== teacher.id && !agent(at) && !agent(key)) told[key] = { ...e };
          else if (key.startsWith('aff:h:') && !agent(key.slice(6))) told[key] = { ...e };
        }
      }
    }
    const spread = (what: string) => 0.5 + unitHash(`${o.seed ?? ''}${id}:${what}`, 0);
    w.addFromDef(id, 'learner', {
      attr: {
        affSocial: o.social ?? 0,
        affCompare: o.compare ?? 0,
        affNeed: o.need ?? 0,
        walkCostPerMeter: 0.0005 * (o.walk ?? 1),
        affOptions: 16,
        affNet: o.net ?? 0,
        affFollow: o.follow ?? 0,
        affCuriosity: (o.shyCuriosity ?? 0.05) * spread('curiosity'),
        affRest: (o.rest ?? 0.02) * spread('rest'),
      },
      rel: { ...culture, ...told },
    });
    order.push(id);
    newcomers.push(id);
    arrived.set(id, w.now);
    next += interval;
  }
  w.run(t.days * DAY, DT);
  const people = [...v.people, ...newcomers];
  const outcome = villageOutcome(w, people, culture).map((p) => ({ ...p, arrivedDay: arrived.has(p.id) ? Number((arrived.get(p.id)! / DAY).toFixed(1)) : 0 }));
  return { world: w, people, newcomers, outcome };
}
