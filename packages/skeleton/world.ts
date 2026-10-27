// 最小の骨格: 世界の進行。
// 物理層は同期更新「要求 → 解決 → 適用」。刻みの始めの状態から、影響範囲にあるすべての組 (a, b) について法則が流れの要求を出し
// （a が切っ掛けを出す側、b が受ける側）、要求を持ち主ごとに局所で解決し（出せる分だけに縮める。不可分な物は持ち主に閉じた
// 決定的な優先で一人に）、一斉に適用する。組をどの順に数えても、並列に計算しても、同じ結果になる。同じ刻みの中の連鎖は次の刻みへ送られる。
// 情報層: 観測を集め、関係（心象）との差を事象（現れた・消えた）にし、心が意図を定め、死亡を確定する。
// 値を変える経路はこのファイルの apply だけである。属性には書く経路が無い。

import type { Attrs, Effect, InfoEffect, Law, LedgerEntry, Memory, Mind, Relation, Relations, Resources, Scalar, Sense, State, ThingDef, ThingId, ThingSnapshot, WorldState, WorldView } from './types.js';

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

/** 一つの法則が一つの組に出した要求の束。不可分な効果を含めば全か無か。 */
interface Bundle {
  lawIndex: number;
  law: Law;
  a: ThingId;
  b: ThingId;
  effects: Effect[];
}

/**
 * 要求が持ち主の資源に掛ける負荷。force は要求者が提供した力で、不可分な物の取り合いの順になる。
 * 解決は資源のある場所に閉じる（局所性）が、何で決めるかは持ち主の意思ではなく、要求に載った物理量である。
 */
interface Claim {
  bundle: Bundle;
  owner: ThingId;
  key: string;
  amount: number;
  indivisible: boolean;
  force: number;
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
  private touched = new Set<ThingId>();
  private readonly spawnSeq = new Map<string, number>();
  readonly ledger: LedgerEntry[] = [];
  /** 計測: 調べた組の数（n²）、影響範囲にあった組の数、法則を当てた回数、要求の束の数、縮めた束の数、観測を試みた組の数。 */
  readonly stats = { pairChecks: 0, activePairs: 0, pairEvaluations: 0, bundles: 0, limited: 0, observations: 0, ticks: 0 };

  constructor(options: WorldOptions = {}) {
    this.rangeAttrs = options.rangeAttrs ?? ['sight', 'reach', 'smell'];
    this.allPairs = options.allPairs ?? false;
    this.pairOrder = options.pairOrder ?? 'sorted';
  }

  // ---- 事物 ----

  /** 事物を置く。attr は属性（仕様）で凍結され、以後どの効果も書けない。state・rel・res は更新が書く。札 mind があれば心が付く。 */
  addThing(id: ThingId, kind: string, parts: ThingParts): void {
    if (this.things.has(id)) throw new Error(`duplicate thing ${id}`);
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

  /** 札 mind の名の心を作って付ける。登録されていない種類なら付かない（再生の世界は心を登録しない）。 */
  private attachMind(id: ThingId): void {
    const name = this.things.get(id)!.attr['mind'];
    const make = typeof name === 'string' ? this.mindKinds.get(name) : undefined;
    if (make) this.minds.set(id, make());
  }

  // ---- 種類の定義と生成 ----

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

  thing(id: ThingId): ThingSnapshot | undefined {
    const t = this.things.get(id);
    return t ? snapshot(t) : undefined;
  }

  private sortedIds(): ThingId[] {
    return [...this.things.keys()].sort();
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

  private attrNum(t: ThingRecord, a: string): number {
    const v = t.attr[a];
    return typeof v === 'number' ? v : 0;
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

  // ---- 法則・感覚・心 ----

  addLaw(law: Law): void {
    if (this.laws.some((l) => l.id === law.id)) throw new Error(`duplicate law ${law.id}`);
    this.laws.push(law);
  }

  addSense(sense: Sense): void {
    if (this.senses.some((s) => s.id === sense.id)) throw new Error(`duplicate sense ${sense.id}`);
    this.senses.push(sense);
  }

  /** 記憶の規則を登録する。知覚のあと、観測者の心象の各項目に当てる。 */
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

  // ---- 進行 ----

  /**
   * 一刻み。
   * 1. 物理層: 要求（全組に法則。刻みの始めの状態だけを読む）→ 解決（持ち主ごとに局所で縮める）→ 適用（一斉に書く）。
   * 2. 情報層: 観測を集め、関係（心象）との差を事象にする。記憶の規則が心象の見込みを書き直す。心が意図を定める。
   * 3. 時刻を Δt 進める。
   * 世界の進行は事物の種類の名も資源の名も知らない。死亡も法則（自分自身との組）が返す効果である。
   */
  tick(dt: number): void {
    this.dt = dt;
    this.stats.ticks += 1;

    // 1a. 要求。刻みの始めにある事物の全組（n²）を調べ、影響範囲にある組へ法則を当てる。法則は読むだけで、何も書かない。
    const ids = this.orderedIds();
    const pairs: [ThingId, ThingId][] = [];
    for (const aId of ids) {
      for (const bId of ids) {
        this.stats.pairChecks += 1;
        if (this.allPairs || this.active(this.things.get(aId)!, this.things.get(bId)!)) pairs.push([aId, bId]);
      }
    }
    this.stats.activePairs += pairs.length;
    const bundles: Bundle[] = [];
    this.laws.forEach((law, lawIndex) => {
      for (const [aId, bId] of pairs) {
        const a = this.things.get(aId)!;
        const b = this.things.get(bId)!;
        this.stats.pairEvaluations += 1;
        const effects = law.pair(snapshot(a), snapshot(b), dt, this);
        if (effects.length > 0) bundles.push({ lawIndex, law, a: aId, b: bId, effects });
      }
    });
    this.stats.bundles += bundles.length;

    // 1b. 解決。要求を持ち主の資源ごとに集め、持ち主が局所で縮める。
    const factor = this.resolve(bundles);

    // 1c. 適用。束を正規の順（法則、a、b）に並べて一斉に書く。順序は結果を変えない（量は解決で決まっている）。
    bundles.sort((p, q) => p.lawIndex - q.lawIndex || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0) || (p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
    for (const bundle of bundles) {
      const f = factor.get(bundle) ?? 1;
      if (f <= 0) continue;
      if (f < 1 - 1e-9) this.stats.limited += 1;
      for (const effect of bundle.effects) {
        const scaled = scaleEffect(effect, f);
        if (!scaled) continue;
        this.touched = new Set();
        const applied = this.apply(scaled);
        this.assertWithinPair(bundle.law, bundle.a, bundle.b, scaled);
        if (applied !== 0 && scaled.kind !== 'use') this.ledger.push({ at: this.now, law: bundle.law.id, a: bundle.a, b: bundle.b, effect: scaled, applied });
      }
    }

    // 2. 情報層。
    this.perceive();
    for (const [person, mind] of [...this.minds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const self = this.thing(person);
      if (!self || self.state['alive'] !== 'yes') continue;
      const intent = mind.decide(self, this.now);
      if (!intent) continue;
      const changed =
        self.state['intent'] !== intent.intent ||
        self.state['target'] !== (intent.target ?? '') ||
        self.state['targetX'] !== (intent.targetX ?? 0) ||
        self.state['targetY'] !== (intent.targetY ?? 0);
      if (!changed) continue;
      this.apply({ kind: 'intend', person, ...intent });
      this.ledger.push({ at: this.now, event: 'intend', person, intent: intent.intent, target: intent.target, targetX: intent.targetX, targetY: intent.targetY });
    }

    // 3. 時刻。
    this.now += dt;
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
   * 解決。各要求が持ち主の資源に掛ける負荷を集め、資源のある場所に閉じて決める（局所性。順序に依らず並列にできる）。
   * 何で決めるかは物理量である。可分な負荷（移す、変える、費用）は要求がもともと能力 × Δt なので、足りなければ比例で縮める（強く引く者が多く取る）。
   * 不可分な負荷（付け替え、生む、消す、容量の使用）は要求に載った力の大きい順に全か無か、同点は要求者の id、法則、相手の順。
   * 持ち主の意思（好み、渡す）は解決の規則ではなく、持ち主自身の行為（法則）である。束の係数は、その束の負荷の係数の最小。
   */
  private resolve(bundles: Bundle[]): Map<Bundle, number> {
    const factor = new Map<Bundle, number>();
    const byKey = new Map<string, Claim[]>();
    for (const bundle of bundles) {
      factor.set(bundle, 1);
      for (const e of bundle.effects) {
        const c = this.claimOf(bundle, e);
        if (!c) continue;
        const list = byKey.get(c.key) ?? [];
        list.push(c);
        byKey.set(c.key, list);
      }
    }
    for (const [key, claims] of [...byKey.entries()].sort(([k1], [k2]) => (k1 < k2 ? -1 : 1))) {
      const owner = this.things.get(claims[0]!.owner);
      if (!owner) continue;
      const res = key.slice(key.indexOf('|') + 1);
      let remaining = res.startsWith('cap:') ? capacityOf(claims) : res === 'attachedTo' ? 1 : this.resOf(owner.id, res);
      const rank = (c: Claim): [number, ThingId, number, ThingId] => [-c.force, c.bundle.a, c.bundle.lawIndex, c.bundle.b];
      const ordered = [...claims].sort((p, q) => {
        const [p0, p1, p2, p3] = rank(p);
        const [q0, q1, q2, q3] = rank(q);
        return p0 - q0 || (p1 < q1 ? -1 : p1 > q1 ? 1 : 0) || p2 - q2 || (p3 < q3 ? -1 : p3 > q3 ? 1 : 0);
      });
      // 不可分: 優先順に全か無か。
      for (const c of ordered) {
        if (!c.indivisible) continue;
        if (c.amount <= remaining + 1e-9) remaining -= c.amount;
        else factor.set(c.bundle, 0);
      }
      // 可分: 残りを比例で分ける。
      const divisible = ordered.filter((c) => !c.indivisible && (factor.get(c.bundle) ?? 1) > 0);
      const demand = divisible.reduce((s, c) => s + c.amount, 0);
      if (demand > remaining + 1e-9 && demand > 0) {
        const f = Math.max(0, remaining) / demand;
        for (const c of divisible) factor.set(c.bundle, Math.min(factor.get(c.bundle) ?? 1, f));
      }
    }
    // 消える事物（消す要求が通ったもの）に触れる他の束は落とす。消す側が勝ち、順序に依らない。
    const gone = new Set<ThingId>();
    for (const b of bundles) if ((factor.get(b) ?? 0) >= 1 - 1e-9) for (const e of b.effects) if (e.kind === 'despawn') gone.add(e.thing);
    if (gone.size > 0) {
      for (const b of bundles) {
        if (b.effects.some((e) => e.kind === 'despawn' && gone.has(e.thing))) continue;
        if (b.effects.some((e) => participants(e).some((id) => gone.has(id)))) factor.set(b, 0);
      }
    }
    return factor;
  }

  /** 効果が持ち主の資源に掛ける負荷。負荷の無い効果（情報層）は無し。 */
  private claimOf(bundle: Bundle, e: Effect): Claim | undefined {
    switch (e.kind) {
      case 'transfer':
        return { bundle, owner: e.from, key: `${e.from}|${e.res}`, amount: e.amount, indivisible: false, force: 0 };
      case 'convert':
        return { bundle, owner: e.from, key: `${e.from}|${e.fromRes}`, amount: e.amount, indivisible: false, force: 0 };
      case 'move':
        return e.cost > 0 ? { bundle, owner: e.costFrom, key: `${e.costFrom}|${e.costRes}`, amount: e.cost, indivisible: false, force: 0 } : undefined;
      case 'use':
        return { bundle, owner: e.thing, key: `${e.thing}|cap:${e.capacity}`, amount: e.amount, indivisible: true, force: 0 };
      case 'reassign':
        return { bundle, owner: e.thing, key: `${e.thing}|attachedTo`, amount: 1, indivisible: true, force: e.force ?? 0 };
      case 'spawn':
        return { bundle, owner: e.from, key: `${e.from}|${e.fromRes}`, amount: e.amount, indivisible: true, force: 0 };
      case 'despawn': {
        const q = this.things.get(e.thing)?.res['quantity'] ?? 1;
        return { bundle, owner: e.thing, key: `${e.thing}|quantity`, amount: q, indivisible: true, force: 0 };
      }
    }
  }

  /**
   * 観測と事象。生きている事物ごとに、他のすべての事物を感覚で観測する（これも全組）。
   * 観測できた事物は関係（心象）に写す（初めてなら「現れた」事象）。覚えているのに、見えるはずの位置で観測できなければ「消えた」事象。
   */
  private perceive(): void {
    const ids = this.sortedIds();
    for (const pId of ids) {
      const p = this.things.get(pId)!;
      if (p.state['alive'] !== 'yes') continue;
      const observer = snapshot(p);
      const before: Relations = { ...p.rel };
      const seen = new Set<ThingId>();
      for (const sense of this.senses) {
        for (const oId of ids) {
          if (oId === pId) continue;
          const o = this.things.get(oId);
          if (!o) continue;
          this.stats.observations += 1;
          const fields = sense.observe(observer, snapshot(o), this);
          if (!fields) continue;
          seen.add(oId);
          if (!(oId in before)) this.ledger.push({ at: this.now, event: 'appear', person: pId, about: oId, kind: o.kind });
          this.apply({ kind: 'inform', observer: pId, about: oId, fields });
        }
      }
      for (const [oId, remembered] of Object.entries(before)) {
        if (seen.has(oId)) continue;
        const expected = this.senses.some((s) => s.expected(observer, remembered, this));
        if (!expected) continue;
        this.apply({ kind: 'forget', observer: pId, about: oId });
        this.ledger.push({ at: this.now, event: 'vanish', person: pId, about: oId });
      }
      // 記憶: 知覚のあとの写しから、心象の各項目の書き直しを計算し、まとめて重ねる。
      if (!this.memories.length) continue;
      const perceived = snapshot(p);
      // 同じ項目の同じ値を二つの書き直しが書けば、後の方（項目の並びで後の相手）が残る。
      const updates: [string, Relation][] = [];
      for (const memory of this.memories) {
        for (const [about, entry] of Object.entries(perceived.rel)) {
          const out = memory.learn(perceived, about, entry, this, this.dt);
          if (out) updates.push(...Object.entries(out));
        }
      }
      for (const [key, fields] of updates) this.setRel(pId, { ...p.rel, [key]: { ...p.rel[key], ...fields } });
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

  // ---- 録画と再生 ----

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
   * 再生。初期状態から load した世界に、記録を刻みごとに適用し直して時刻 until の状態を再現する。
   * 法則と心は要らない。流れ（物理層。死亡も含む）と意図（心の選択）は記録にあるので、そのまま適用する。
   * 感覚は要る。心象の刻みごとの写し直し（いつ見たか、位置、鮮度）は事象ではなく記録に無いので、知覚は世界の真実から計算し直す。
   * 現れた・消えたは、その結果として同じに出る。初期状態より前の記録と seed（初期状態に含まれる）は飛ばす。
   */
  replay(ledger: LedgerEntry[], dt: number, until: number): void {
    let i = 0;
    while (i < ledger.length && ledger[i]!.at < this.now - 1e-9) i++;
    while (this.now + 1e-9 < until) {
      this.stats.ticks += 1;
      let j = i;
      while (j < ledger.length && ledger[j]!.at <= this.now + 1e-9) j++;
      const entries = ledger.slice(i, j);
      i = j;
      // 1. 物理層: 記録の流れを記録の順に適用する（正規の順で記録されているので、同じ結果になる）。
      for (const e of entries) {
        if (!('law' in e) || e.law === 'seed') continue;
        const applied = this.apply(e.effect);
        if (applied !== 0) this.ledger.push({ at: this.now, law: e.law, a: e.a, b: e.b, effect: e.effect, applied });
      }
      // 2. 情報層: 知覚と記憶を計算し直し、記録の意図を適用する。
      this.dt = Math.min(dt, until - this.now);
      this.perceive();
      for (const e of entries) {
        if (!('event' in e) || e.event !== 'intend') continue;
        this.apply({ kind: 'intend', person: e.person, intent: e.intent, target: e.target, targetX: e.targetX, targetY: e.targetY });
        this.ledger.push({ ...e, at: this.now });
      }
      // 3. 時刻。
      this.now += Math.min(dt, until - this.now);
    }
  }

  /** 初期状態を作る。場面の構築時だけに使い、記録に残す。 */
  seed(effect: Effect | InfoEffect): number {
    const applied = this.apply(effect);
    if (applied !== 0 && !('observer' in effect) && !('person' in effect) && effect.kind !== 'use') {
      this.ledger.push({ at: this.now, law: 'seed', a: '', b: '', effect, applied });
    }
    return applied;
  }

  // ---- 値を変える唯一の経路。戻り値は実際に適用した量（0 なら何も変えていない）。属性を書く経路は無い ----

  private apply(e: Effect | InfoEffect): number {
    switch (e.kind) {
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

  /** 生成する事物の id を、生む側ごとに決定的に採番する。組を数える順に依らない。 */
  nextSpawnId(prefix: string): ThingId {
    const n = (this.spawnSeq.get(prefix) ?? 0) + 1;
    this.spawnSeq.set(prefix, n);
    return `${prefix}#${n}`;
  }

  // ---- 検査 ----

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

/** 効果が触れる事物の id。 */
function participants(e: Effect): ThingId[] {
  switch (e.kind) {
    case 'transfer':
      return [e.from, e.to];
    case 'convert':
      return [e.from, e.to, e.lossTo];
    case 'reassign':
      return [e.thing, e.to];
    case 'spawn':
      return [e.from];
    case 'despawn':
      return [e.thing, e.to, e.lossTo];
    case 'move':
      return [e.thing, e.costFrom, e.costTo];
    case 'use':
    case 'die':
      return [e.thing];
    case 'relate':
      return [e.thing, e.about];
  }
}

/** 容量の要求から、その刻みの容量を読む（同じ持ち主・同じ能力の要求は同じ値を持つ）。 */
function capacityOf(claims: Claim[]): number {
  for (const c of claims) for (const e of c.bundle.effects) if (e.kind === 'use' && `${e.thing}|cap:${e.capacity}` === c.key) return e.available;
  return 0;
}

/** 効果を束の係数で縮める。不可分な効果は係数 1 のときだけ残る。 */
function scaleEffect(e: Effect, f: number): Effect | undefined {
  if (f >= 1 - 1e-9) return e;
  switch (e.kind) {
    case 'transfer':
      return { ...e, amount: e.amount * f };
    case 'convert':
      return { ...e, amount: e.amount * f, produced: e.produced * f };
    case 'move':
      return { ...e, dx: e.dx * f, dy: e.dy * f, cost: e.cost * f };
    case 'use':
    case 'reassign':
    case 'spawn':
    case 'despawn':
    case 'relate':
    case 'die':
      return undefined;
  }
}
