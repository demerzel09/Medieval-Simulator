// 最小の骨格: 世界の進行。時計と予定の待ち行列、影響範囲の決定、型の照合、両側同時の適用、記録。
// 属性を変える経路はこのファイルの applyEffects だけである。

import type {
  ActionInstance,
  ActionType,
  Attempt,
  AttrValue,
  Binding,
  Effect,
  Knowledge,
  LedgerEntry,
  Mind,
  ThingId,
  ThingSnapshot,
  WorldView,
} from './types.js';

interface ThingRecord {
  id: ThingId;
  kind: string;
  attrs: Record<string, AttrValue>;
}

type Scheduled =
  | { at: number; seq: number; kind: 'complete'; instance: number }
  | { at: number; seq: number; kind: 'wake'; person: ThingId }
  | { at: number; seq: number; kind: 'natural'; type: string; binding: Binding };

export interface RunStats {
  completed: number;
  rejected: number;
  cancelled: number;
}

export class World implements WorldView {
  now = 0;
  private seq = 0;
  private nextInstanceId = 1;
  private readonly things = new Map<ThingId, ThingRecord>();
  private readonly types = new Map<string, ActionType>();
  private readonly instances = new Map<number, ActionInstance>();
  private readonly minds = new Map<ThingId, Mind>();
  private readonly queue: Scheduled[] = [];
  readonly ledger: LedgerEntry[] = [];
  readonly stats: RunStats = { completed: 0, rejected: 0, cancelled: 0 };

  // ---- 事物 ----

  addThing(id: ThingId, kind: string, attrs: Record<string, AttrValue>): void {
    if (this.things.has(id)) throw new Error(`duplicate thing ${id}`);
    this.things.set(id, { id, kind, attrs: { ...attrs } });
  }

  thing(id: ThingId): ThingSnapshot | undefined {
    const t = this.things.get(id);
    return t ? snapshot(t) : undefined;
  }

  query(pred: (t: ThingSnapshot) => boolean): ThingSnapshot[] {
    const out: ThingSnapshot[] = [];
    for (const id of [...this.things.keys()].sort()) {
      const s = snapshot(this.things.get(id)!);
      if (pred(s)) out.push(s);
    }
    return out;
  }

  // ---- 作用の型と心 ----

  addType(type: ActionType): void {
    if (this.types.has(type.id)) throw new Error(`duplicate type ${type.id}`);
    this.types.set(type.id, type);
  }

  addMind(person: ThingId, mind: Mind): void {
    this.minds.set(person, mind);
    const self = this.thing(person);
    if (!self) throw new Error(`unknown person ${person}`);
    this.push({ at: mind.nextWake(self, this.now), seq: this.seq++, kind: 'wake', person });
  }

  // ---- 予定 ----

  scheduleNatural(type: string, binding: Binding, at: number): void {
    this.push({ at, seq: this.seq++, kind: 'natural', type, binding });
  }

  private push(item: Scheduled): void {
    // 同時刻は投入順（seq）で決定的に整列する。
    let i = this.queue.length;
    while (i > 0 && compare(this.queue[i - 1]!, item) > 0) i--;
    this.queue.splice(i, 0, item);
  }

  // ---- 試み ----

  /** 人物の試み。影響範囲を決め、型の条件と照合し、実例を予定する。 */
  attempt(attempt: Attempt): { accepted: boolean; reason?: string; instance?: number } {
    const type = this.types.get(attempt.type);
    if (!type) return this.reject(attempt, `unknown type ${attempt.type}`);
    const binding = this.bind(type, attempt.binding);
    if (typeof binding === 'string') return this.reject(attempt, binding);
    const guard = type.guard?.(binding, this) ?? null;
    if (guard) return this.reject({ type: type.id, binding }, guard);
    const instance = this.createInstance(type, binding);
    this.ledger.push({ at: this.now, seq: this.seq++, kind: 'attempt', type: type.id, binding, accepted: true, instance: instance.id });
    return { accepted: true, instance: instance.id };
  }

  private reject(attempt: Attempt, reason: string) {
    this.stats.rejected++;
    this.ledger.push({ at: this.now, seq: this.seq++, kind: 'attempt', type: attempt.type, binding: attempt.binding, accepted: false, reason });
    return { accepted: false, reason };
  }

  /** 影響範囲の決定: 未束縛の役割に、条件を満たす事物を id 順で一つ選ぶ。 */
  private bind(type: ActionType, partial: Binding): Binding | string {
    const bound: Binding = { ...partial };
    for (const role of type.roles) {
      const given = bound[role.name];
      if (given !== undefined) {
        const t = this.thing(given);
        if (!t) return `role ${role.name}: unknown thing ${given}`;
        if (!role.where(t, bound, this)) return `role ${role.name}: ${given} does not satisfy`;
        continue;
      }
      const candidates = this.query((t) => role.where(t, bound, this));
      if (candidates.length === 0) return `role ${role.name}: no thing in scope`;
      bound[role.name] = candidates[0]!.id;
    }
    return bound;
  }

  private createInstance(type: ActionType, binding: Binding): ActionInstance {
    const effects = type.effects(binding, this);
    const scope = new Set<ThingId>(Object.values(binding));
    for (const e of effects) for (const id of touched(e)) scope.add(id);
    const instance: ActionInstance = {
      id: this.nextInstanceId++,
      type: type.id,
      version: type.version,
      binding,
      scope: [...scope].sort(),
      startedAt: this.now,
      dueAt: this.now + type.duration(binding, this),
      state: 'scheduled',
    };
    this.instances.set(instance.id, instance);
    this.push({ at: instance.dueAt, seq: this.seq++, kind: 'complete', instance: instance.id });
    return instance;
  }

  // ---- 進行 ----

  /** 時計を until まで進める。予定を一つずつ取り出し、完了・起床・自然の作用を処理する。 */
  run(until: number): void {
    while (this.queue.length > 0 && this.queue[0]!.at <= until) {
      const item = this.queue.shift()!;
      this.now = item.at;
      if (item.kind === 'complete') this.complete(item.instance);
      else if (item.kind === 'wake') this.wake(item.person);
      else this.natural(item.type, item.binding);
    }
    this.now = until;
  }

  private complete(instanceId: number): void {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.state !== 'scheduled') return;
    const type = this.types.get(instance.type)!;
    // 完了時に影響範囲と条件を再評価する。開始時に可能でも、完了前に対象が失われ得る。
    const rebound = this.bind(type, instance.binding);
    const reason = typeof rebound === 'string' ? rebound : (type.guard?.(instance.binding, this) ?? null);
    if (reason) {
      instance.state = 'cancelled';
      instance.reason = reason;
      this.stats.cancelled++;
      this.ledger.push({ at: this.now, seq: this.seq++, kind: 'cancel', instance: instance.id, type: type.id, reason });
      return;
    }
    const effects = type.effects(instance.binding, this);
    this.applyEffects(effects);
    instance.state = 'completed';
    this.stats.completed++;
    this.ledger.push({ at: this.now, seq: this.seq++, kind: 'complete', instance: instance.id, type: type.id, binding: instance.binding, effects });
    // 死亡の確定は世界側。影響範囲に入った人物の栄養が尽きていれば、その時点で確定する。
    for (const id of instance.scope) {
      const t = this.things.get(id);
      if (t && t.kind === 'person' && t.attrs['alive'] === 'yes' && typeof t.attrs['nutrition'] === 'number' && t.attrs['nutrition'] <= 1e-9) this.markDead(id);
    }
  }

  private natural(typeId: string, binding: Binding): void {
    const type = this.types.get(typeId);
    if (!type) return;
    const bound = this.bind(type, binding);
    if (typeof bound === 'string') return; // 相手がいなければ起きない
    const guard = type.guard?.(bound, this) ?? null;
    if (guard) return;
    this.createInstance(type, bound);
  }

  private wake(person: ThingId): void {
    const mind = this.minds.get(person);
    const self = this.thing(person);
    if (!mind || !self) return;
    if (self.attrs['alive'] === 'no') return; // 死亡後は判断が続かない
    this.ledger.push({ at: this.now, seq: this.seq++, kind: 'wake', person });
    // 二段: まず知覚の試みを出し、即時に完了する実例を処理してから判断する。心象は知覚でしか変わらない。
    for (const attempt of mind.observe(self, this.now)) this.attempt(attempt);
    this.flushNow();
    for (const attempt of mind.decide(this.thing(person)!, this.now)) this.attempt(attempt);
    const next = mind.nextWake(this.thing(person)!, this.now);
    if (next > this.now) this.push({ at: next, seq: this.seq++, kind: 'wake', person });
  }

  /** 現在時刻に予定された実例の完了だけを処理する。起床や自然の予定はそのまま残す。 */
  private flushNow(): void {
    let i = 0;
    while (i < this.queue.length && this.queue[i]!.at === this.now) {
      const item = this.queue[i]!;
      if (item.kind === 'complete') {
        this.queue.splice(i, 1);
        this.complete(item.instance);
      } else i++;
    }
  }

  // ---- 属性を変える唯一の経路 ----

  private applyEffects(effects: Effect[]): void {
    // 先に全効果を検証し、一つでも不可なら何も変えない（両側を一度に確定する）。
    for (const e of effects) this.validate(e);
    for (const e of effects) this.apply(e);
  }

  private validate(e: Effect): void {
    switch (e.kind) {
      case 'transfer': {
        if (e.amount <= 0) throw new Error(`transfer amount must be positive: ${JSON.stringify(e)}`);
        const from = this.num(e.from, e.attr);
        if (from < e.amount) throw new Error(`insufficient ${e.attr} on ${e.from}: ${from} < ${e.amount}`);
        this.num(e.to, e.attr);
        return;
      }
      case 'convert': {
        if (e.amount <= 0 || e.produced < 0) throw new Error(`convert amounts invalid: ${JSON.stringify(e)}`);
        const loss = e.amount - e.produced;
        if (loss < -1e-9) throw new Error(`convert produces more than consumed: ${JSON.stringify(e)}`);
        const from = this.num(e.from, e.fromAttr);
        if (from < e.amount) throw new Error(`insufficient ${e.fromAttr} on ${e.from}: ${from} < ${e.amount}`);
        this.num(e.to, e.toAttr);
        this.num(e.lossTo, e.lossAttr);
        return;
      }
      case 'reassign': {
        const current = this.str(e.thing, e.attr);
        if (current !== e.from) throw new Error(`${e.thing}.${e.attr} is ${current}, not ${e.from}`);
        if (!this.things.has(e.giver) || !this.things.has(e.receiver)) throw new Error(`reassign participants unknown`);
        return;
      }
      case 'inform': {
        if (!this.things.has(e.observer) || !this.things.has(e.about)) throw new Error(`inform participants unknown`);
        return;
      }
    }
  }

  private apply(e: Effect): void {
    switch (e.kind) {
      case 'transfer': {
        this.set(e.from, e.attr, this.num(e.from, e.attr) - e.amount);
        this.set(e.to, e.attr, this.num(e.to, e.attr) + e.amount);
        return;
      }
      case 'convert': {
        const loss = e.amount - e.produced;
        this.set(e.from, e.fromAttr, this.num(e.from, e.fromAttr) - e.amount);
        this.set(e.to, e.toAttr, this.num(e.to, e.toAttr) + e.produced);
        if (loss > 0) this.set(e.lossTo, e.lossAttr, this.num(e.lossTo, e.lossAttr) + loss);
        return;
      }
      case 'reassign': {
        this.set(e.thing, e.attr, e.to);
        return;
      }
      case 'inform': {
        const observer = this.things.get(e.observer)!;
        const about = this.things.get(e.about)!;
        const knowledge: Knowledge = { ...((observer.attrs['knowledge'] as Knowledge | undefined) ?? {}) };
        const attrs: Record<string, number | string> = {};
        for (const a of e.attrs) {
          const v = about.attrs[a];
          if (typeof v === 'number' || typeof v === 'string') attrs[a] = v;
        }
        knowledge[e.about] = { at: this.now, source: e.source, kind: about.kind, attrs };
        observer.attrs['knowledge'] = knowledge;
        return;
      }
    }
  }

  private num(id: ThingId, attr: string): number {
    const v = this.things.get(id)?.attrs[attr];
    if (typeof v !== 'number') throw new Error(`${id}.${attr} is not a number`);
    return v;
  }

  private str(id: ThingId, attr: string): string {
    const v = this.things.get(id)?.attrs[attr];
    if (typeof v !== 'string') throw new Error(`${id}.${attr} is not a string`);
    return v;
  }

  private set(id: ThingId, attr: string, value: AttrValue): void {
    this.things.get(id)!.attrs[attr] = value;
  }

  /** 死亡の確定は世界側。属性 alive を no にし、記録する。心はこれ以後起きない。 */
  markDead(person: ThingId): void {
    const t = this.things.get(person);
    if (!t || t.attrs['alive'] === 'no') return;
    t.attrs['alive'] = 'no';
    this.ledger.push({ at: this.now, seq: this.seq++, kind: 'death', person });
  }

  // ---- 検査 ----

  /** 数値属性の総和。保存則の検査に使う。 */
  total(attr: string, pred: (t: ThingSnapshot) => boolean = () => true): number {
    let sum = 0;
    for (const t of this.query(pred)) {
      const v = t.attrs[attr];
      if (typeof v === 'number') sum += v;
    }
    return sum;
  }

  instance(id: number): ActionInstance | undefined {
    return this.instances.get(id);
  }
}

function snapshot(t: ThingRecord): ThingSnapshot {
  return { id: t.id, kind: t.kind, attrs: t.attrs };
}

function compare(a: Scheduled, b: Scheduled): number {
  return a.at - b.at || a.seq - b.seq;
}

function touched(e: Effect): ThingId[] {
  switch (e.kind) {
    case 'transfer':
      return [e.from, e.to];
    case 'convert':
      return [e.from, e.to, e.lossTo];
    case 'reassign':
      return [e.thing, e.giver, e.receiver];
    case 'inform':
      return [e.observer, e.about];
  }
}
