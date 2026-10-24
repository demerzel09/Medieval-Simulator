// 最小の骨格: 世界の進行。Δt ごとに、法則の順に影響範囲を列挙し、速度 × Δt の変化を順に適用する。
// 属性を変える経路はこのファイルの apply だけである。足りなければその効果だけ縮める。

import type { AttrValue, Binding, Effect, Knowledge, Law, LedgerEntry, Mind, ThingId, ThingSnapshot, WorldView } from './types.js';

interface ThingRecord {
  id: ThingId;
  kind: string;
  attrs: Record<string, AttrValue>;
}

export class World implements WorldView {
  now = 0;
  private readonly things = new Map<ThingId, ThingRecord>();
  private readonly laws: Law[] = [];
  private readonly minds = new Map<ThingId, Mind>();
  private spawnSeq = 0;
  readonly ledger: LedgerEntry[] = [];

  // ---- 事物 ----

  addThing(id: ThingId, kind: string, attrs: Record<string, AttrValue>): void {
    if (this.things.has(id)) throw new Error(`duplicate thing ${id}`);
    this.things.set(id, { id, kind, attrs: { ...attrs } });
  }

  thing(id: ThingId): ThingSnapshot | undefined {
    const t = this.things.get(id);
    return t ? { id: t.id, kind: t.kind, attrs: t.attrs } : undefined;
  }

  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[] {
    const out: ThingSnapshot[] = [];
    for (const id of [...this.things.keys()].sort()) {
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
   * 影響範囲の種類。
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

  // ---- 法則と心 ----

  addLaw(law: Law): void {
    if (this.laws.some((l) => l.id === law.id)) throw new Error(`duplicate law ${law.id}`);
    this.laws.push(law);
  }

  addMind(person: ThingId, mind: Mind): void {
    if (!this.things.has(person)) throw new Error(`unknown person ${person}`);
    this.minds.set(person, mind);
  }

  // ---- 進行 ----

  /** 一刻み。法則の順に影響範囲を列挙し、変化を適用する。その後、心が意図を定める。最後に死亡を確定する。 */
  tick(dt: number): void {
    for (const law of this.laws) {
      for (const binding of law.scope(this)) {
        for (const effect of law.flow(binding, dt, this)) {
          const applied = this.apply(effect);
          if (applied !== 0) this.ledger.push({ at: this.now, law: law.id, binding, effect, applied });
        }
      }
    }
    for (const [person, mind] of [...this.minds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const self = this.thing(person);
      if (!self || self.attrs['alive'] !== 'yes') continue;
      const intent = mind.decide(self, this.now);
      if (intent) {
        this.apply({ kind: 'intend', person, ...intent });
        this.ledger.push({ at: this.now, kind: 'intend', person, intent: intent.intent, target: intent.target });
      }
    }
    for (const t of this.things.values()) {
      if (t.kind === 'person' && t.attrs['alive'] === 'yes' && typeof t.attrs['nutrition'] === 'number' && t.attrs['nutrition'] <= 1e-9) {
        t.attrs['alive'] = 'no';
        t.attrs['intent'] = 'none';
        this.ledger.push({ at: this.now, kind: 'death', person: t.id });
      }
    }
    this.now += dt;
  }

  run(until: number, dt: number): void {
    while (this.now + 1e-9 < until) this.tick(Math.min(dt, until - this.now));
  }

  /** 初期状態を作る。場面の構築時だけに使い、記録に残す。 */
  seed(effect: Effect): number {
    const applied = this.apply(effect);
    if (applied !== 0) this.ledger.push({ at: this.now, law: 'seed', binding: {}, effect, applied });
    return applied;
  }

  // ---- 属性を変える唯一の経路。戻り値は実際に適用した量（0 なら何も変えていない） ----

  private apply(e: Effect): number {
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
        t.attrs[e.attr] = e.to;
        return 1;
      }
      case 'spawn': {
        if (this.things.has(e.id)) return 0;
        const have = this.num(e.from, e.fromAttr);
        if (have < e.amount) return 0;
        this.set(e.from, e.fromAttr, have - e.amount);
        this.things.set(e.id, { id: e.id, kind: e.thingKind, attrs: { ...e.attrs, quantity: e.amount } });
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
        return amount || 1;
      }
      case 'move': {
        const t = this.things.get(e.thing);
        if (!t || typeof t.attrs['x'] !== 'number' || typeof t.attrs['y'] !== 'number') return 0;
        const have = this.num(e.costFrom, e.costAttr);
        const cost = Math.min(e.cost, have);
        const ratio = e.cost > 0 ? cost / e.cost : 1;
        if (ratio <= 0) return 0;
        t.attrs['x'] = (t.attrs['x'] as number) + e.dx * ratio;
        t.attrs['y'] = (t.attrs['y'] as number) + e.dy * ratio;
        if (cost > 0) {
          this.set(e.costFrom, e.costAttr, have - cost);
          this.set(e.costTo, e.costAttr, this.num(e.costTo, e.costAttr) + cost);
        }
        return Math.hypot(e.dx * ratio, e.dy * ratio);
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
        observer.attrs['knowledge'] = knowledge;
        return 1;
      }
      case 'forget': {
        const observer = this.things.get(e.observer);
        if (!observer) return 0;
        const knowledge = { ...((observer.attrs['knowledge'] as Knowledge | undefined) ?? {}) };
        if (!(e.about in knowledge)) return 0;
        delete knowledge[e.about];
        observer.attrs['knowledge'] = knowledge;
        return 1;
      }
      case 'intend': {
        const t = this.things.get(e.person);
        if (!t) return 0;
        t.attrs['intent'] = e.intent;
        t.attrs['target'] = e.target ?? '';
        t.attrs['targetX'] = e.targetX ?? 0;
        t.attrs['targetY'] = e.targetY ?? 0;
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

  /** 忘れた事物を心象から消すことはしない。心象は古くなるだけである。 */
}
