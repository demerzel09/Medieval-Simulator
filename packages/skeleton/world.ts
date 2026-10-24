// 最小の骨格: 世界の進行。
// 物理層: 刻み Δt ごとに、法則の順に、すべての事物の組（自分自身を含む）へ法則を当て、返った流れを順に適用する。
// 情報層: 観測を集め、心象との差を事象（現れた・消えた）にし、心が意図を定め、死亡を確定する。
// 属性を変える経路はこのファイルの apply だけである。足りなければその効果だけ縮める。

import type { AttrValue, Effect, InfoEffect, Knowledge, Law, LedgerEntry, Mind, Sense, ThingId, ThingSnapshot, WorldView } from './types.js';

interface ThingRecord {
  id: ThingId;
  kind: string;
  attrs: Record<string, AttrValue>;
}

export interface WorldOptions {
  /**
   * 範囲の属性。組 (a, b) は、a === b か、どちらかが位置を持たないか、距離がこれらの属性の最大値以下なら影響範囲にある。
   * 影響範囲にない組は法則を当てずに飛ばす。法則は範囲の内側でしか流れを返さないので、結果は変わらない（計算が減るだけ）。
   */
  rangeAttrs?: string[];
  /** true なら影響範囲で飛ばさず、すべての組に法則を当てる（比較用）。 */
  allPairs?: boolean;
}

export class World implements WorldView {
  now = 0;
  private dt = 0;
  private readonly rangeAttrs: string[];
  private readonly allPairs: boolean;
  private readonly things = new Map<ThingId, ThingRecord>();
  private readonly laws: Law[] = [];
  private readonly senses: Sense[] = [];
  private readonly minds = new Map<ThingId, Mind>();
  private readonly spent = new Map<ThingId, number>();
  private touched = new Set<ThingId>();
  private spawnSeq = 0;
  readonly ledger: LedgerEntry[] = [];
  /** 計測: 調べた組の数（n²）、影響範囲にあった組の数、法則を当てた回数、観測を試みた組の数。 */
  readonly stats = { pairChecks: 0, activePairs: 0, pairEvaluations: 0, observations: 0, ticks: 0 };

  constructor(options: WorldOptions = {}) {
    this.rangeAttrs = options.rangeAttrs ?? ['sight', 'reach', 'smell'];
    this.allPairs = options.allPairs ?? false;
  }

  // ---- 事物 ----

  addThing(id: ThingId, kind: string, attrs: Record<string, AttrValue>): void {
    if (this.things.has(id)) throw new Error(`duplicate thing ${id}`);
    this.things.set(id, { id, kind, attrs: { ...attrs } });
  }

  thing(id: ThingId): ThingSnapshot | undefined {
    const t = this.things.get(id);
    return t ? { id: t.id, kind: t.kind, attrs: t.attrs } : undefined;
  }

  private sortedIds(): ThingId[] {
    return [...this.things.keys()].sort();
  }

  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[] {
    const out: ThingSnapshot[] = [];
    for (const id of this.sortedIds()) {
      const t = this.things.get(id)!;
      const s: ThingSnapshot = { id: t.id, kind: t.kind, attrs: t.attrs };
      if (pred(s)) out.push(s);
    }
    return out;
  }

  positionOf(id: ThingId): { x: number; y: number } | undefined {
    let cur = this.things.get(id);
    for (let hops = 0; cur && hops < 8; hops++) {
      const at = cur.attrs['attachedTo'];
      if (typeof at === 'string' && at !== '' && this.things.has(at)) {
        cur = this.things.get(at);
        continue;
      }
      const x = cur.attrs['x'];
      const y = cur.attrs['y'];
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
   * 範囲の種類。
   * sight: 観測者の視界（sight）と対象の見える範囲（visibility）の小さい方の内側。
   * reach: 観測者の手の届く範囲（reach）の内側。
   * smell: 観測者の嗅覚（smell）と対象の匂う範囲（odor）の小さい方の内側。
   */
  inRange(kind: 'sight' | 'reach' | 'smell', subject: ThingId, object: ThingId): boolean {
    const s = this.things.get(subject);
    const o = this.things.get(object);
    if (!s || !o) return false;
    const d = this.distance(subject, object);
    const num = (t: ThingRecord, a: string) => (typeof t.attrs[a] === 'number' ? (t.attrs[a] as number) : 0);
    switch (kind) {
      case 'sight':
        return d <= Math.min(num(s, 'sight'), num(o, 'visibility'));
      case 'reach':
        return d <= num(s, 'reach');
      case 'smell':
        return d <= Math.min(num(s, 'smell'), num(o, 'odor'));
    }
  }

  timeLeft(id: ThingId): number {
    return Math.max(0, this.dt - (this.spent.get(id) ?? 0));
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
    for (const t of [a, b]) {
      for (const attr of this.rangeAttrs) {
        const v = t.attrs[attr];
        if (typeof v === 'number' && v > r) r = v;
      }
    }
    return d <= r + 1e-9;
  }

  // ---- 法則・感覚・心 ----

  addLaw(law: Law): void {
    if (this.laws.some((l) => l.id === law.id)) throw new Error(`duplicate law ${law.id}`);
    this.laws.push(law);
  }

  addSense(sense: Sense): void {
    if (this.senses.some((s) => s.id === sense.id)) throw new Error(`duplicate sense ${sense.id}`);
    this.senses.push(sense);
  }

  addMind(person: ThingId, mind: Mind): void {
    if (!this.things.has(person)) throw new Error(`unknown person ${person}`);
    this.minds.set(person, mind);
  }

  // ---- 進行 ----

  /**
   * 一刻み。
   * 1. 物理層: すべての事物の組（a, b。a === b を含む）のうち影響範囲にある組へ、法則の順に法則を当て、流れを適用する。
   * 2. 情報層: 観測を集め、心象との差を事象にする。心が意図を定める。死亡を確定する。
   * 3. 時刻を Δt 進める。
   */
  tick(dt: number): void {
    this.dt = dt;
    this.spent.clear();
    this.stats.ticks += 1;

    // 1. 物理層。刻みの始めにある事物の全組（n²）を調べ、影響範囲にある組を求める。途中で生まれた事物は次の刻みから組に入る。
    const ids = this.sortedIds();
    const pairs: [ThingId, ThingId][] = [];
    for (const aId of ids) {
      for (const bId of ids) {
        this.stats.pairChecks += 1;
        if (this.allPairs || this.active(this.things.get(aId)!, this.things.get(bId)!)) pairs.push([aId, bId]);
      }
    }
    this.stats.activePairs += pairs.length;
    // 影響範囲にある組へ、法則の順に法則を当てる。
    for (const law of this.laws) {
      for (const [aId, bId] of pairs) {
        const a = this.things.get(aId);
        const b = this.things.get(bId);
        if (!a || !b) continue; // 途中で消えた事物
        this.stats.pairEvaluations += 1;
        const effects = law.pair({ id: a.id, kind: a.kind, attrs: a.attrs }, { id: b.id, kind: b.kind, attrs: b.attrs }, dt, this);
        for (const effect of effects) {
          this.touched = new Set();
          const applied = this.apply(effect);
          this.assertWithinPair(law, aId, bId, effect);
          if (applied !== 0 && effect.kind !== 'spend') this.ledger.push({ at: this.now, law: law.id, a: aId, b: bId, effect, applied });
        }
      }
    }

    // 2. 情報層。
    this.perceive();
    for (const [person, mind] of [...this.minds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const self = this.thing(person);
      if (!self || self.attrs['alive'] !== 'yes') continue;
      const intent = mind.decide(self, this.now);
      if (!intent) continue;
      const changed =
        self.attrs['intent'] !== intent.intent ||
        self.attrs['target'] !== (intent.target ?? '') ||
        self.attrs['targetX'] !== (intent.targetX ?? 0) ||
        self.attrs['targetY'] !== (intent.targetY ?? 0);
      if (!changed) continue;
      this.apply({ kind: 'intend', person, ...intent });
      this.ledger.push({ at: this.now, event: 'intend', person, intent: intent.intent, target: intent.target });
    }
    for (const t of this.things.values()) {
      if (t.kind === 'person' && t.attrs['alive'] === 'yes' && typeof t.attrs['nutrition'] === 'number' && t.attrs['nutrition'] <= 1e-9) {
        t.attrs['alive'] = 'no';
        t.attrs['intent'] = 'none';
        this.ledger.push({ at: this.now, event: 'death', person: t.id });
      }
    }

    // 3. 時刻。使い残した時間は捨てる。
    this.now += dt;
  }

  /**
   * 観測と事象。生きている人物ごとに、他のすべての事物を感覚で観測する（これも全組）。
   * 観測できた事物は心象に写す（初めてなら「現れた」事象）。覚えているのに、見えるはずの位置で観測できなければ「消えた」事象。
   */
  private perceive(): void {
    const ids = this.sortedIds();
    for (const pId of ids) {
      const p = this.things.get(pId)!;
      if (p.kind !== 'person' || p.attrs['alive'] !== 'yes') continue;
      const observer: ThingSnapshot = { id: p.id, kind: p.kind, attrs: p.attrs };
      const before = { ...((p.attrs['knowledge'] as Knowledge | undefined) ?? {}) };
      const seen = new Set<ThingId>();
      for (const sense of this.senses) {
        for (const oId of ids) {
          if (oId === pId) continue;
          const o = this.things.get(oId);
          if (!o) continue;
          this.stats.observations += 1;
          const attrs = sense.observe(observer, { id: o.id, kind: o.kind, attrs: o.attrs }, this);
          if (!attrs) continue;
          seen.add(oId);
          if (!(oId in before)) this.ledger.push({ at: this.now, event: 'appear', person: pId, about: oId, kind: o.kind });
          this.apply({ kind: 'inform', observer: pId, about: oId, attrs });
        }
      }
      for (const [oId, remembered] of Object.entries(before)) {
        if (seen.has(oId)) continue;
        const expected = this.senses.some((s) => s.expected(observer, remembered, this));
        if (!expected) continue;
        this.apply({ kind: 'forget', observer: pId, about: oId });
        this.ledger.push({ at: this.now, event: 'vanish', person: pId, about: oId });
      }
    }
  }

  /** 法則の効果が触れた事物は、組の二つと、その組から生まれた事物だけでなければならない。 */
  private assertWithinPair(law: Law, a: ThingId, b: ThingId, effect: Effect): void {
    const allowed = new Set([a, b]);
    if (effect.kind === 'spawn') allowed.add(effect.id);
    for (const id of this.touched) {
      if (!allowed.has(id)) throw new Error(`law ${law.id} touched ${id} outside pair (${a}, ${b}): ${JSON.stringify(effect)}`);
    }
  }

  run(until: number, dt: number): void {
    while (this.now + 1e-9 < until) this.tick(Math.min(dt, until - this.now));
  }

  /** 初期状態を作る。場面の構築時だけに使い、記録に残す。 */
  seed(effect: Effect | InfoEffect): number {
    const applied = this.apply(effect);
    if (applied !== 0 && !('observer' in effect) && !('person' in effect) && effect.kind !== 'spend') {
      this.ledger.push({ at: this.now, law: 'seed', a: '', b: '', effect, applied });
    }
    return applied;
  }

  // ---- 属性を変える唯一の経路。戻り値は実際に適用した量（0 なら何も変えていない） ----

  private apply(e: Effect | InfoEffect): number {
    switch (e.kind) {
      case 'transfer': {
        const have = this.num(e.from, e.attr);
        const amount = Math.min(e.amount, have);
        if (amount <= 0) return 0;
        this.set(e.from, e.attr, have - amount);
        this.set(e.to, e.attr, this.num(e.to, e.attr) + amount);
        return amount;
      }
      case 'convert': {
        const have = this.num(e.from, e.fromAttr);
        const amount = Math.min(e.amount, have);
        if (amount <= 0 || e.amount <= 0) return 0;
        const ratio = amount / e.amount;
        const produced = e.produced * ratio;
        const loss = amount - produced;
        if (loss < -1e-9) throw new Error(`convert produces more than consumed: ${JSON.stringify(e)}`);
        this.set(e.from, e.fromAttr, have - amount);
        this.set(e.to, e.toAttr, this.num(e.to, e.toAttr) + produced);
        if (loss > 0) this.set(e.lossTo, e.lossAttr, this.num(e.lossTo, e.lossAttr) + loss);
        return amount;
      }
      case 'reassign': {
        const t = this.things.get(e.thing);
        if (!t || t.attrs[e.attr] !== e.from || !this.things.has(e.to)) return 0; // 既に別の相手へ移っていれば何も起きない
        this.set(e.thing, e.attr, e.to);
        return 1;
      }
      case 'spawn': {
        if (this.things.has(e.id)) return 0;
        const have = this.num(e.from, e.fromAttr);
        if (have < e.amount) return 0;
        this.set(e.from, e.fromAttr, have - e.amount);
        this.things.set(e.id, { id: e.id, kind: e.thingKind, attrs: { ...e.attrs, quantity: e.amount } });
        this.touched.add(e.id);
        return e.amount;
      }
      case 'despawn': {
        const t = this.things.get(e.thing);
        if (!t) return 0;
        const amount = typeof t.attrs['quantity'] === 'number' ? t.attrs['quantity'] : 0;
        const loss = amount - e.produced;
        if (loss < -1e-9) throw new Error(`despawn produces more than the thing holds: ${JSON.stringify(e)}`);
        this.set(e.to, e.toAttr, this.num(e.to, e.toAttr) + e.produced);
        if (loss > 0) this.set(e.lossTo, e.lossAttr, this.num(e.lossTo, e.lossAttr) + loss);
        this.things.delete(e.thing);
        this.touched.add(e.thing);
        return amount || 1;
      }
      case 'move': {
        const t = this.things.get(e.thing);
        if (!t || typeof t.attrs['x'] !== 'number' || typeof t.attrs['y'] !== 'number') return 0;
        const have = this.num(e.costFrom, e.costAttr);
        const cost = Math.min(e.cost, have);
        const ratio = e.cost > 0 ? cost / e.cost : 1;
        if (ratio <= 0) return 0;
        this.set(e.thing, 'x', (t.attrs['x'] as number) + e.dx * ratio);
        this.set(e.thing, 'y', (t.attrs['y'] as number) + e.dy * ratio);
        if (cost > 0) {
          this.set(e.costFrom, e.costAttr, have - cost);
          this.set(e.costTo, e.costAttr, this.num(e.costTo, e.costAttr) + cost);
        }
        return Math.hypot(e.dx * ratio, e.dy * ratio);
      }
      case 'spend': {
        const left = this.timeLeft(e.thing);
        const minutes = Math.min(e.minutes, left);
        if (minutes <= 0) return 0;
        this.spent.set(e.thing, (this.spent.get(e.thing) ?? 0) + minutes);
        return minutes;
      }
      case 'inform': {
        const observer = this.things.get(e.observer);
        const about = this.things.get(e.about);
        if (!observer || !about) return 0;
        const pos = this.positionOf(e.about);
        if (!pos) return 0;
        const knowledge: Knowledge = { ...((observer.attrs['knowledge'] as Knowledge | undefined) ?? {}) };
        const attrs: Record<string, number | string> = {};
        for (const a of e.attrs) {
          const v = about.attrs[a];
          if (typeof v === 'number' || typeof v === 'string') attrs[a] = v;
        }
        knowledge[e.about] = { at: this.now, kind: about.kind, x: pos.x, y: pos.y, attrs };
        this.set(e.observer, 'knowledge', knowledge);
        return 1;
      }
      case 'forget': {
        const observer = this.things.get(e.observer);
        if (!observer) return 0;
        const knowledge = { ...((observer.attrs['knowledge'] as Knowledge | undefined) ?? {}) };
        if (!(e.about in knowledge)) return 0;
        delete knowledge[e.about];
        this.set(e.observer, 'knowledge', knowledge);
        return 1;
      }
      case 'intend': {
        const t = this.things.get(e.person);
        if (!t) return 0;
        this.set(e.person, 'intent', e.intent);
        this.set(e.person, 'target', e.target ?? '');
        this.set(e.person, 'targetX', e.targetX ?? 0);
        this.set(e.person, 'targetY', e.targetY ?? 0);
        return 1;
      }
    }
  }

  private num(id: ThingId, attr: string): number {
    const v = this.things.get(id)?.attrs[attr];
    if (typeof v !== 'number') throw new Error(`${id}.${attr} is not a number`);
    return v;
  }

  private set(id: ThingId, attr: string, value: AttrValue): void {
    this.things.get(id)!.attrs[attr] = value;
    this.touched.add(id);
  }

  /** 生成する事物の id を決定的に採番する。 */
  nextSpawnId(prefix: string): ThingId {
    this.spawnSeq += 1;
    return `${prefix}#${this.spawnSeq}`;
  }

  // ---- 検査 ----

  total(attr: string, pred: (t: ThingSnapshot) => boolean = () => true): number {
    let sum = 0;
    for (const t of this.query(pred)) {
      const v = t.attrs[attr];
      if (typeof v === 'number') sum += v;
    }
    return sum;
  }

  get thingCount(): number {
    return this.things.size;
  }
}
