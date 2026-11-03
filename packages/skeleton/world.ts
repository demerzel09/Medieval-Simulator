// 世界の進行。一刻みは六つの段が順に進む（docs/DESIGN.md の図1・図7・図8）。
//   物理層: 要求 → 解決 → 適用。法則が刻みの始めの状態だけを読んで流れを求め、解決（resolve.ts）が資源の場所ごとに縮め、一斉に書く。
//           組をどの順に数えても、並列に計算しても同じ結果になる。同じ刻みの中の連鎖は次の刻みへ送られる。
//   情報層: 知覚 → 記憶 → 心。感覚が心象を世界から写し直し、記憶の規則（認識の一歩）が心象を書き直し、心が心象だけから意図を選ぶ。
//           意図は状態として次の刻みの法則に読まれ、世界が変わり、また知覚される。
// 値を書く経路は apply だけで、属性には書く経路が無い。法則・感覚・記憶・心は答えを返すだけで、何も書かない。
// 世界の進行は事物の種類の名も資源の名も知らない。死亡も法則（自分自身との組）が返す効果である。
// このファイルの並び: 組み立て → 進行（run・tick）→ 物理層の三段 → 情報層の三段 → 書く経路 → 読む窓 → 録画と再生 → 検査。

import type { Attrs, Effect, InfoEffect, Law, LedgerEntry, Memory, Mind, Relation, Relations, Resources, Scalar, Sense, State, ThingDef, ThingId, ThingSnapshot, WorldState, WorldView } from './types.js';
import { resolve, scaleEffect, type Bundle, type Holdings } from './resolve.js';

interface ThingRecord {
  id: ThingId;
  kind: string;
  attr: Attrs;
  state: State;
  rel: Relations;
  res: Resources;
}

const snapshot = (t: ThingRecord): ThingSnapshot => ({ id: t.id, kind: t.kind, attr: t.attr, state: t.state, rel: t.rel, res: t.res });

export interface ThingParts {
  attr?: Record<string, Scalar>;
  state?: State;
  rel?: Relations;
  res?: Resources;
}

export interface WorldOptions {
  /**
   * 範囲の属性。組 (a, b) は、a === b か、どちらかが位置を持たないか、距離がこれらの属性の最大値以下なら影響範囲にある。
   * 影響範囲にない組は法則を当てずに飛ばす。法則は範囲の内側でしか流れを返さないので、結果は変わらない（計算が減るだけ）。
   */
  rangeAttrs?: string[];
  /** true なら影響範囲で飛ばさず、すべての組に法則を当てる（比較用）。 */
  allPairs?: boolean;
  /** 組を数える順（比較用）。結果は変わらないことを検査するために使う。 */
  pairOrder?: 'sorted' | 'reverse' | 'shuffle';
}

export class World implements WorldView {
  now = 0;
  private dt = 0;
  private readonly rangeAttrs: string[];
  private readonly allPairs: boolean;
  private readonly pairOrder: 'sorted' | 'reverse' | 'shuffle';
  private readonly things = new Map<ThingId, ThingRecord>();
  private readonly defs = new Map<string, ThingDef>();
  private readonly laws: Law[] = [];
  private readonly senses: Sense[] = [];
  private readonly memories: Memory[] = [];
  /** 心の種類（札 mind の値 → 作る関数）。法則や感覚と同じく世界に一度登録する。 */
  private readonly mindKinds = new Map<string, () => Mind>();
  private readonly minds = new Map<ThingId, Mind>();
  /** 一つの効果を適用する間に書いた事物（効果が組の外に触れていないかの検査に使う）。 */
  private touched = new Set<ThingId>();
  private readonly spawnSeq = new Map<string, number>();
  /** 解決が読む資源の窓。 */
  private readonly holdings: Holdings = {
    has: (id) => this.things.has(id),
    amount: (id, res) => this.resOf(id, res),
    quantity: (id) => this.things.get(id)?.res['quantity'],
  };
  readonly ledger: LedgerEntry[] = [];
  /** 計測: 調べた組の数（n²）、影響範囲にあった組の数、法則を当てた回数、要求の束の数、縮めた束の数、観測を試みた組の数。 */
  readonly stats = { pairChecks: 0, activePairs: 0, pairEvaluations: 0, bundles: 0, limited: 0, observations: 0, ticks: 0 };

  constructor(options: WorldOptions = {}) {
    this.rangeAttrs = options.rangeAttrs ?? ['sight', 'reach', 'smell'];
    this.allPairs = options.allPairs ?? false;
    this.pairOrder = options.pairOrder ?? 'sorted';
  }

  // ==== 組み立て: 定義・事物・法則・感覚・記憶・心を登録し、初期状態を作る ====

  /** 種類の定義を登録する。親は先に登録されていること。 */
  addDef(def: ThingDef): void {
    if (this.defs.has(def.name)) throw new Error(`duplicate def ${def.name}`);
    if (def.parent !== undefined && !this.defs.has(def.parent)) throw new Error(`def ${def.name}: unknown parent ${def.parent}`);
    this.defs.set(def.name, def);
  }

  /** 定義を解決する。親の既定値の上に自分の値を重ねる（属性・状態・資源それぞれ名ごとに上書き）。 */
  def(name: string): { attr: Record<string, Scalar>; state: State; res: Resources; rel: Relations } {
    const d = this.defs.get(name);
    if (!d) throw new Error(`unknown def ${name}`);
    const base = d.parent !== undefined ? this.def(d.parent) : { attr: {}, state: {}, res: {}, rel: {} };
    return { attr: { ...base.attr, ...(d.attr ?? {}) }, state: { ...base.state, ...(d.state ?? {}) }, res: { ...base.res, ...(d.res ?? {}) }, rel: { ...base.rel, ...(d.rel ?? {}) } };
  }

  /**
   * 事物を置く。attr は属性（仕様）で凍結され、以後どの効果も書けない。state・rel・res は更新が書く。札 mind があれば心が付く。
   * id が「頭#番号」の形なら、その番号までを採番済みにする（設定から置いた物と、後で生まれる物の id が重ならない）。
   */
  addThing(id: ThingId, kind: string, parts: ThingParts): void {
    if (this.things.has(id)) throw new Error(`duplicate thing ${id}`);
    const numbered = /^(.*)#(\d+)$/.exec(id);
    if (numbered) this.spawnSeq.set(numbered[1]!, Math.max(this.spawnSeq.get(numbered[1]!) ?? 0, Number(numbered[2])));
    this.things.set(id, {
      id,
      kind,
      attr: Object.freeze({ ...(parts.attr ?? {}) }),
      state: { ...(parts.state ?? {}) },
      rel: { ...(parts.rel ?? {}) },
      res: { ...(parts.res ?? {}) },
    });
    this.attachMind(id);
  }

  /** 定義から事物を作る（初期配置）。overrides は生成時だけの上書きで、属性もここでなら決められる（以後は凍結）。 */
  addFromDef(id: ThingId, name: string, overrides: ThingParts = {}): void {
    const d = this.def(name);
    this.addThing(id, name, {
      attr: { ...d.attr, ...(overrides.attr ?? {}) },
      state: { ...d.state, ...(overrides.state ?? {}) },
      rel: { ...d.rel, ...(overrides.rel ?? {}) },
      res: { ...d.res, ...(overrides.res ?? {}) },
    });
  }

  /** 生成する事物の id を、生む側ごとに決定的に採番する。組を数える順に依らない。 */
  nextSpawnId(prefix: string): ThingId {
    const n = (this.spawnSeq.get(prefix) ?? 0) + 1;
    this.spawnSeq.set(prefix, n);
    return `${prefix}#${n}`;
  }

  /** 初期状態を作る。場面の構築時だけに使い、記録に残す。 */
  seed(effect: Effect | InfoEffect): number {
    const applied = this.apply(effect);
    if (applied !== 0 && !('observer' in effect) && !('person' in effect) && effect.kind !== 'use') {
      this.ledger.push({ at: this.now, law: 'seed', a: '', b: '', effect, applied });
    }
    return applied;
  }

  addLaw(law: Law): void {
    if (this.laws.some((l) => l.id === law.id)) throw new Error(`duplicate law ${law.id}`);
    this.laws.push(law);
  }

  addSense(sense: Sense): void {
    if (this.senses.some((s) => s.id === sense.id)) throw new Error(`duplicate sense ${sense.id}`);
    this.senses.push(sense);
  }

  /** 記憶の規則を登録する。知覚のあと、観測者ごとに当てる。 */
  addMemory(memory: Memory): void {
    if (this.memories.some((m) => m.id === memory.id)) throw new Error(`duplicate memory ${memory.id}`);
    this.memories.push(memory);
  }

  /** 心の種類を登録する。札 mind にこの名を持つ事物が置かれる・生まれるたびに make() で作って付ける。既にある事物にも付ける。 */
  addMind(name: string, make: () => Mind): void {
    if (this.mindKinds.has(name)) throw new Error(`duplicate mind ${name}`);
    this.mindKinds.set(name, make);
    for (const id of this.things.keys()) if (!this.minds.has(id)) this.attachMind(id);
  }

  /** 札 mind の名の心を作って付ける。登録されていない種類なら付かない（再生の世界は心を登録しない）。 */
  private attachMind(id: ThingId): void {
    const name = this.things.get(id)!.attr['mind'];
    const make = typeof name === 'string' ? this.mindKinds.get(name) : undefined;
    if (make) this.minds.set(id, make());
  }

  // ==== 進行 ====

  run(until: number, dt: number): void {
    while (this.now + 1e-9 < until) this.tick(Math.min(dt, until - this.now));
  }

  /** 一刻み。物理層の三段と情報層の三段を順に進め、時刻を Δt 進める。 */
  tick(dt: number): void {
    this.beginTick(dt);
    // 物理層: 刻みの始めの状態だけを読んで要求を集め、資源の場所ごとに縮め、一斉に書く。
    const bundles = this.request(dt);
    const factors = resolve(bundles, this.holdings);
    this.applyBundles(bundles, factors);
    // 情報層: 心象を世界から写し直し、記憶が書き直し、心が意図を選ぶ。
    this.perceive();
    this.remember();
    this.decide();
    this.now += dt;
  }

  private beginTick(dt: number): void {
    this.dt = dt;
    this.stats.ticks += 1;
  }

  // ==== 物理層 1: 要求。影響範囲にある組に法則を当て、流れの要求を集める。法則は読むだけで、何も書かない ====

  private request(dt: number): Bundle[] {
    const pairs = this.activePairs();
    const bundles: Bundle[] = [];
    this.laws.forEach((law, lawIndex) => {
      for (const [aId, bId] of pairs) {
        this.stats.pairEvaluations += 1;
        const effects = law.pair(snapshot(this.things.get(aId)!), snapshot(this.things.get(bId)!), dt, this);
        if (effects.length > 0) bundles.push({ lawIndex, law, a: aId, b: bId, effects });
      }
    });
    this.stats.bundles += bundles.length;
    return bundles;
  }

  /** 刻みの始めにある事物の全組（n²。自分自身との組を含む）のうち、影響範囲にある組。 */
  private activePairs(): [ThingId, ThingId][] {
    const ids = this.orderedIds();
    const pairs: [ThingId, ThingId][] = [];
    for (const aId of ids) {
      for (const bId of ids) {
        this.stats.pairChecks += 1;
        if (this.allPairs || this.active(this.things.get(aId)!, this.things.get(bId)!)) pairs.push([aId, bId]);
      }
    }
    this.stats.activePairs += pairs.length;
    return pairs;
  }

  /** 組を数える順。結果は変わらない（検査用に逆順・乱順を選べる）。 */
  private orderedIds(): ThingId[] {
    const ids = this.sortedIds();
    if (this.pairOrder === 'reverse') return ids.reverse();
    if (this.pairOrder === 'shuffle') {
      let seed = 2463534242 + this.stats.ticks;
      for (let i = ids.length - 1; i > 0; i--) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const j = seed % (i + 1);
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      }
    }
    return ids;
  }

  /**
   * 影響範囲にあるか。自分自身との組、位置を持たない事物（自然）との組は常にある。
   * 位置を持つ二つの事物は、距離が両者の範囲の属性の最大値以下なら影響範囲にある。
   * 物理エンジンの broad phase にあたり、結果を変えずに法則を当てる組を減らす。
   */
  private active(a: ThingRecord, b: ThingRecord): boolean {
    if (a === b) return true;
    const pa = this.positionOf(a.id);
    const pb = this.positionOf(b.id);
    if (!pa || !pb) return true;
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    let r = 0;
    for (const t of [a, b]) for (const attr of this.rangeAttrs) r = Math.max(r, this.attrNum(t, attr));
    return d <= r + 1e-9;
  }

  // ==== 物理層 2: 解決は resolve.ts（資源の場所ごとに、要求をどれだけ通すかを決める）====

  // ==== 物理層 3: 適用。束を正規の順（法則、a、b）に並べて一斉に書く。量は解決で決まっているので、順序は結果を変えない ====

  private applyBundles(bundles: Bundle[], factors: Map<Bundle, number>): void {
    bundles.sort((p, q) => p.lawIndex - q.lawIndex || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0) || (p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
    for (const bundle of bundles) {
      const f = factors.get(bundle) ?? 1;
      if (f <= 0) continue;
      if (f < 1 - 1e-9) this.stats.limited += 1;
      for (const effect of bundle.effects) {
        const scaled = scaleEffect(effect, f);
        if (scaled) this.applyFlow(bundle, scaled);
      }
    }
  }

  /** 一つの流れを書き、組の外に触れていないかを確かめ、記録する。 */
  private applyFlow(bundle: Bundle, effect: Effect): void {
    this.touched = new Set();
    const applied = this.apply(effect);
    this.assertWithinPair(bundle.law, bundle.a, bundle.b, effect);
    if (applied !== 0 && effect.kind !== 'use') this.ledger.push({ at: this.now, law: bundle.law.id, a: bundle.a, b: bundle.b, effect, applied });
  }

  /** 法則の効果が触れた事物は、組の二つと、その組から生まれた事物だけでなければならない。 */
  private assertWithinPair(law: Law, a: ThingId, b: ThingId, effect: Effect): void {
    const allowed = new Set([a, b]);
    if (effect.kind === 'spawn') allowed.add(effect.id);
    for (const id of this.touched) {
      if (!allowed.has(id)) throw new Error(`law ${law.id} touched ${id} outside pair (${a}, ${b}): ${JSON.stringify(effect)}`);
    }
  }

  // ==== 情報層 1: 知覚。生きている事物ごとに、他のすべての事物を感覚で観測する（これも全組）====

  private perceive(): void {
    const ids = this.sortedIds();
    for (const id of ids) {
      const p = this.things.get(id)!;
      if (p.state['alive'] !== 'yes') continue;
      const observer = snapshot(p);
      const before: Relations = { ...p.rel };
      const seen = this.observeOthers(observer, before, ids);
      this.forgetUnseen(observer, before, seen);
    }
  }

  /** 観測できた事物を心象に写す（初めてなら「現れた」の事象）。観測できた事物の id を返す。 */
  private observeOthers(observer: ThingSnapshot, before: Relations, ids: ThingId[]): Set<ThingId> {
    const seen = new Set<ThingId>();
    for (const sense of this.senses) {
      for (const oId of ids) {
        if (oId === observer.id) continue;
        const o = this.things.get(oId);
        if (!o) continue;
        this.stats.observations += 1;
        const fields = sense.observe(observer, snapshot(o), this);
        if (!fields) continue;
        seen.add(oId);
        if (!(oId in before)) this.ledger.push({ at: this.now, event: 'appear', person: observer.id, about: oId, kind: o.kind });
        this.apply({ kind: 'inform', observer: observer.id, about: oId, fields });
      }
    }
    return seen;
  }

  /** 覚えているのに、覚えている位置と値からして見えるはずなのに観測できなかった事物を心象から消す（「消えた」の事象）。 */
  private forgetUnseen(observer: ThingSnapshot, before: Relations, seen: Set<ThingId>): void {
    for (const [oId, remembered] of Object.entries(before)) {
      if (seen.has(oId)) continue;
      if (!this.senses.some((s) => s.expected(observer, remembered, this))) continue;
      this.apply({ kind: 'forget', observer: observer.id, about: oId });
      this.ledger.push({ at: this.now, event: 'vanish', person: observer.id, about: oId });
    }
  }

  // ==== 情報層 2: 記憶。生きている観測者ごとに、知覚のあとの写しから心象の書き直しを計算し、まとめて重ねる ====

  /**
   * 認識の一歩（recognize）は観測者ごとに一度、項目ごとの口（learn）は項目ごとに。どの記憶も同じ写し（知覚のあと、記憶の前）から
   * 計算するので、記憶と項目の順に依らない。同じ項目の同じ値を二つの書き直しが書けば、後の方（記憶の登録順、項目の並びで後の相手）が残る。
   * 記憶が読むのは自分の写しと、時刻・位置だけなので、知覚をすべて終えてから記憶を当てても、観測者ごとに交互に当てても同じ結果になる。
   */
  private remember(): void {
    if (!this.memories.length) return;
    for (const id of this.sortedIds()) {
      const p = this.things.get(id)!;
      if (p.state['alive'] !== 'yes') continue;
      for (const [key, fields] of this.recall(snapshot(p))) this.apply({ kind: 'remember', observer: id, key, fields });
    }
  }

  /** 観測者の写しに、登録した記憶を当てた答え（項目の名と、重ねる値）の列。 */
  private recall(perceived: ThingSnapshot): [string, Relation][] {
    const updates: [string, Relation][] = [];
    for (const memory of this.memories) {
      if (memory.recognize) {
        const out = memory.recognize(perceived, this, this.dt);
        if (out) updates.push(...Object.entries(out));
      }
      if (!memory.learn) continue;
      for (const [about, entry] of Object.entries(perceived.rel)) {
        const out = memory.learn(perceived, about, entry, this, this.dt);
        if (out) updates.push(...Object.entries(out));
      }
    }
    return updates;
  }

  // ==== 情報層 3: 心。心を持つ生きている事物ごとに（id の順）、自分の写しだけから意図を選ぶ ====

  private decide(): void {
    for (const [person, mind] of [...this.minds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const self = this.thing(person);
      if (!self || self.state['alive'] !== 'yes') continue;
      const intent = mind.decide(self, this.now);
      if (intent && changesIntent(self, intent)) this.applyIntent(person, intent);
    }
  }

  /** 意図を状態に書き、記録する（意図が変わったときだけ呼ぶ）。 */
  private applyIntent(person: ThingId, intent: NonNullable<ReturnType<Mind['decide']>>): void {
    this.apply({ kind: 'intend', person, ...intent });
    this.ledger.push({ at: this.now, event: 'intend', person, intent: intent.intent, target: intent.target, targetX: intent.targetX, targetY: intent.targetY });
  }

  // ==== 書く経路: 値を変える唯一の経路。戻り値は実際に適用した量（0 なら何も変えていない）。属性を書く経路は無い ====

  private apply(e: Effect | InfoEffect): number {
    switch (e.kind) {
      // -- 物理層の効果（法則が返す）--
      case 'transfer': {
        const have = this.resOf(e.from, e.res);
        const amount = Math.min(e.amount, have);
        if (amount <= 0) return 0;
        this.setRes(e.from, e.res, have - amount);
        this.setRes(e.to, e.res, this.resOf(e.to, e.res) + amount);
        return amount;
      }
      case 'convert': {
        const have = this.resOf(e.from, e.fromRes);
        const amount = Math.min(e.amount, have);
        if (amount <= 0 || e.amount <= 0) return 0;
        const ratio = amount / e.amount;
        const produced = e.produced * ratio;
        const loss = amount - produced;
        if (loss < -1e-9) throw new Error(`convert produces more than consumed: ${JSON.stringify(e)}`);
        this.setRes(e.from, e.fromRes, have - amount);
        this.setRes(e.to, e.toRes, this.resOf(e.to, e.toRes) + produced);
        if (loss > 0) this.setRes(e.lossTo, e.lossRes, this.resOf(e.lossTo, e.lossRes) + loss);
        return amount;
      }
      case 'reassign': {
        const t = this.things.get(e.thing);
        if (!t || t.state['attachedTo'] !== e.from || !this.things.has(e.to)) return 0; // 既に別の相手へ移っていれば何も起きない
        this.setState(e.thing, 'attachedTo', e.to);
        return 1;
      }
      case 'spawn': {
        if (this.things.has(e.id)) return 0;
        const have = this.resOf(e.from, e.fromRes);
        if (have < e.amount) return 0;
        const d = this.def(e.def);
        this.setRes(e.from, e.fromRes, have - e.amount);
        // 属性は定義の値に、効果が渡す値（親から受け継ぐ値など）を重ねる。生まれた後は凍結。
        this.things.set(e.id, { id: e.id, kind: e.def, attr: Object.freeze({ ...d.attr, ...(e.attr ?? {}) }), state: { ...d.state, ...(e.state ?? {}) }, rel: { ...d.rel }, res: { ...d.res, quantity: e.amount } });
        this.touched.add(e.id);
        this.attachMind(e.id);
        return e.amount;
      }
      case 'despawn': {
        const t = this.things.get(e.thing);
        if (!t) return 0;
        const amount = t.res['quantity'] ?? 0;
        const loss = amount - e.produced;
        if (loss < -1e-9) throw new Error(`despawn produces more than the thing holds: ${JSON.stringify(e)}`);
        this.setRes(e.to, e.toRes, this.resOf(e.to, e.toRes) + e.produced);
        if (loss > 0) this.setRes(e.lossTo, e.lossRes, this.resOf(e.lossTo, e.lossRes) + loss);
        this.things.delete(e.thing);
        this.minds.delete(e.thing);
        this.touched.add(e.thing);
        return amount || 1;
      }
      case 'move': {
        const t = this.things.get(e.thing);
        if (!t || typeof t.state['x'] !== 'number' || typeof t.state['y'] !== 'number') return 0;
        const have = this.resOf(e.costFrom, e.costRes);
        const cost = Math.min(e.cost, have);
        const ratio = e.cost > 0 ? cost / e.cost : 1;
        if (ratio <= 0) return 0;
        this.setState(e.thing, 'x', (t.state['x'] as number) + e.dx * ratio);
        this.setState(e.thing, 'y', (t.state['y'] as number) + e.dy * ratio);
        if (cost > 0) {
          this.setRes(e.costFrom, e.costRes, have - cost);
          this.setRes(e.costTo, e.costRes, this.resOf(e.costTo, e.costRes) + cost);
        }
        return Math.hypot(e.dx * ratio, e.dy * ratio);
      }
      case 'use':
        return e.amount; // 容量は解決の段で配り終えている。帳簿には残さない。
      case 'relate': {
        const t = this.things.get(e.thing);
        if (!t || !this.things.has(e.about)) return 0;
        this.setRel(e.thing, { ...t.rel, [e.about]: { ...t.rel[e.about], ...e.fields } });
        return 1;
      }
      case 'die': {
        const t = this.things.get(e.thing);
        if (!t || t.state['alive'] !== 'yes') return 0;
        this.setState(e.thing, 'alive', 'no');
        this.setState(e.thing, 'intent', 'none');
        return 1;
      }
      // -- 情報層の効果（知覚・記憶・心）--
      case 'inform': {
        const observer = this.things.get(e.observer);
        const about = this.things.get(e.about);
        if (!observer || !about) return 0;
        const pos = this.positionOf(e.about);
        if (!pos) return 0;
        // 写す値は上書きし、知覚が写さない値（自分の家の印など、相互作用で得た関係）は残す。
        const entry: Relation = { ...observer.rel[e.about], at: this.now, x: pos.x, y: pos.y };
        for (const f of e.fields) {
          // kind は種類の名（定義の名）。見分けることも知覚に含める。法則は読まない。
          const v = f === 'kind' ? about.kind : (about.attr[f] ?? about.state[f] ?? about.res[f]);
          if (v !== undefined) entry[f] = v;
        }
        this.setRel(e.observer, { ...observer.rel, [e.about]: entry });
        return 1;
      }
      case 'forget': {
        const observer = this.things.get(e.observer);
        if (!observer || !(e.about in observer.rel)) return 0;
        const rel = { ...observer.rel };
        delete rel[e.about];
        this.setRel(e.observer, rel);
        return 1;
      }
      case 'remember': {
        const observer = this.things.get(e.observer);
        if (!observer) return 0;
        this.setRel(e.observer, { ...observer.rel, [e.key]: { ...observer.rel[e.key], ...e.fields } });
        return 1;
      }
      case 'intend': {
        if (!this.things.has(e.person)) return 0;
        this.setState(e.person, 'intent', e.intent);
        this.setState(e.person, 'target', e.target ?? '');
        this.setState(e.person, 'targetX', e.targetX ?? 0);
        this.setState(e.person, 'targetY', e.targetY ?? 0);
        return 1;
      }
    }
  }

  private resOf(id: ThingId, res: string): number {
    const t = this.things.get(id);
    const v = t?.res[res];
    if (typeof v !== 'number') throw new Error(`${id}.${res} is not a resource${t && res in t.attr ? ' (it is a spec attribute; the update must not write it)' : ''}`);
    return v;
  }

  private setRes(id: ThingId, res: string, value: number): void {
    this.things.get(id)!.res[res] = value;
    this.touched.add(id);
  }

  private setState(id: ThingId, key: string, value: Scalar): void {
    this.things.get(id)!.state[key] = value;
    this.touched.add(id);
  }

  private setRel(id: ThingId, rel: Relations): void {
    this.things.get(id)!.rel = rel;
    this.touched.add(id);
  }

  // ==== 読む窓（WorldView）: 法則・感覚・記憶と、場面や画面が読む。書かない ====

  thing(id: ThingId): ThingSnapshot | undefined {
    const t = this.things.get(id);
    return t ? snapshot(t) : undefined;
  }

  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[] {
    const out: ThingSnapshot[] = [];
    for (const id of this.sortedIds()) {
      const s = snapshot(this.things.get(id)!);
      if (pred(s)) out.push(s);
    }
    return out;
  }

  positionOf(id: ThingId): { x: number; y: number } | undefined {
    let cur = this.things.get(id);
    for (let hops = 0; cur && hops < 8; hops++) {
      const at = cur.state['attachedTo'];
      if (typeof at === 'string' && at !== '' && this.things.has(at)) {
        cur = this.things.get(at);
        continue;
      }
      const x = cur.state['x'];
      const y = cur.state['y'];
      return typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
    }
    return undefined;
  }

  distance(a: ThingId, b: ThingId): number {
    const p = this.positionOf(a);
    const q = this.positionOf(b);
    if (!p || !q) return Number.POSITIVE_INFINITY;
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  /**
   * 範囲の種類。すべて属性で決まる。
   * sight: 観測者の視界（sight）と対象の見える範囲（visibility）の小さい方の内側。
   * reach: 観測者の手の届く範囲（reach）の内側。
   * smell: 観測者の嗅覚（smell）と対象の匂う範囲（odor）の小さい方の内側。
   */
  inRange(kind: 'sight' | 'reach' | 'smell', subject: ThingId, object: ThingId): boolean {
    const s = this.things.get(subject);
    const o = this.things.get(object);
    if (!s || !o) return false;
    const d = this.distance(subject, object);
    switch (kind) {
      case 'sight':
        return d <= Math.min(this.attrNum(s, 'sight'), this.attrNum(o, 'visibility'));
      case 'reach':
        return d <= this.attrNum(s, 'reach');
      case 'smell':
        return d <= Math.min(this.attrNum(s, 'smell'), this.attrNum(o, 'odor'));
    }
  }

  private sortedIds(): ThingId[] {
    return [...this.things.keys()].sort();
  }

  private attrNum(t: ThingRecord, a: string): number {
    const v = t.attr[a];
    return typeof v === 'number' ? v : 0;
  }

  // ==== 録画と再生 ====

  /** 世界の写し（録画の初期状態）。定義と事物の値の深い複製。場面を組み立てた直後に取る。 */
  save(): WorldState {
    return JSON.parse(JSON.stringify({ now: this.now, defs: [...this.defs.values()], things: [...this.things.values()], spawnSeq: Object.fromEntries(this.spawnSeq) }));
  }

  /** 写しから世界を作る。法則・感覚・心の種類は入らない（コードなので、要るものを登録し直す）。 */
  static load(s: WorldState, options: WorldOptions = {}): World {
    const w = new World(options);
    w.now = s.now;
    for (const d of s.defs) w.addDef(d);
    for (const t of s.things) w.things.set(t.id, { id: t.id, kind: t.kind, attr: Object.freeze({ ...t.attr }), state: { ...t.state }, rel: { ...t.rel }, res: { ...t.res } });
    for (const [k, n] of Object.entries(s.spawnSeq)) w.spawnSeq.set(k, n);
    return w;
  }

  /**
   * 再生。初期状態から load した世界に、記録を刻みごとに適用し直して時刻 until の状態を再現する。段の並びは tick と同じ。
   * 法則と心は要らない。流れ（物理層。死亡も含む）と意図（心の選択）は記録にあるので、そのまま適用する。
   * 感覚と記憶は要る。心象の刻みごとの写し直し（いつ見たか、位置、鮮度）と書き直しは事象ではなく記録に無いので、世界の真実から計算し直す。
   * 現れた・消えたは、その結果として同じに出る。初期状態より前の記録と seed（初期状態に含まれる）は飛ばす。
   */
  replay(ledger: LedgerEntry[], dt: number, until: number): void {
    let next = 0;
    while (next < ledger.length && ledger[next]!.at < this.now - 1e-9) next++;
    while (this.now + 1e-9 < until) {
      const step = Math.min(dt, until - this.now);
      this.beginTick(step);
      let end = next;
      while (end < ledger.length && ledger[end]!.at <= this.now + 1e-9) end++;
      const entries = ledger.slice(next, end);
      next = end;
      // 物理層: 要求と解決は記録に済んでいるので、記録の流れを記録の順に書く（正規の順で記録されているので、同じ結果になる）。
      this.applyRecordedFlows(entries);
      // 情報層: 知覚と記憶は計算し直し、心の代わりに記録の意図を書く。
      this.perceive();
      this.remember();
      this.applyRecordedIntents(entries);
      this.now += step;
    }
  }

  private applyRecordedFlows(entries: LedgerEntry[]): void {
    for (const e of entries) {
      if (!('law' in e) || e.law === 'seed') continue;
      const applied = this.apply(e.effect);
      if (applied !== 0) this.ledger.push({ at: this.now, law: e.law, a: e.a, b: e.b, effect: e.effect, applied });
    }
  }

  private applyRecordedIntents(entries: LedgerEntry[]): void {
    for (const e of entries) {
      if (!('event' in e) || e.event !== 'intend') continue;
      this.apply({ kind: 'intend', person: e.person, intent: e.intent, target: e.target, targetX: e.targetX, targetY: e.targetY });
      this.ledger.push({ ...e, at: this.now });
    }
  }

  // ==== 検査 ====

  /** 資源の総量。 */
  total(res: string, pred: (t: ThingSnapshot) => boolean = () => true): number {
    let sum = 0;
    for (const t of this.query(pred)) {
      const v = t.res[res];
      if (typeof v === 'number') sum += v;
    }
    return sum;
  }

  get thingCount(): number {
    return this.things.size;
  }
}

/** 心の選んだ意図が、いまの意図（意図・相手・行き先）と違うか。 */
function changesIntent(self: ThingSnapshot, intent: NonNullable<ReturnType<Mind['decide']>>): boolean {
  return (
    self.state['intent'] !== intent.intent ||
    self.state['target'] !== (intent.target ?? '') ||
    self.state['targetX'] !== (intent.targetX ?? 0) ||
    self.state['targetY'] !== (intent.targetY ?? 0)
  );
}
