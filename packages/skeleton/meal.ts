// 最小の骨格: 食事までの鎖を、作用の型として書く。
// 事物: 自然、畑（場所でもある）、家A、家B、穀物・パンのロット、人物A・B（身体と心象）。
// 作用の型: 再生、収穫、製パン、腐敗、移動、引き渡し、摂取、消化、消耗、知覚。
// 数値はすべて仮の比較条件であり、校正値ではない。

import type { ActionType, Attempt, Binding, Effect, Knowledge, Mind, ThingId, ThingSnapshot, WorldView } from './types.js';
import { World } from './world.js';

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 24 * HOUR;

const BASE_LOCATIONS = ['field', 'homeA', 'homeB'];
const BASE_PERSONS = ['A', 'B'];
const WOOD_LOCATIONS = [...BASE_LOCATIONS, 'forest', 'homeC'];
const WOOD_PERSONS = [...BASE_PERSONS, 'C'];

// ---- 補助 ----

const num = (t: ThingSnapshot | undefined, a: string): number => {
  const v = t?.attrs[a];
  return typeof v === 'number' ? v : 0;
};
const str = (t: ThingSnapshot | undefined, a: string): string => {
  const v = t?.attrs[a];
  return typeof v === 'string' ? v : '';
};
const alive = (t: ThingSnapshot | undefined): boolean => str(t, 'alive') === 'yes';
const isPlace = (t: ThingSnapshot): boolean => t.kind === 'place' || t.kind === 'field' || t.kind === 'forest';
const locationOf = (w: WorldView, id: ThingId | undefined): string => str(w.thing(id ?? ''), 'location');
/** 保管者と場所の組ごとに一つあるロット（入れ物）。無ければ undefined。 */
const lotAt = (w: WorldView, kind: string, custodian: string, location: string): ThingSnapshot | undefined =>
  w.query((t) => t.kind === kind && str(t, 'custodian') === custodian && str(t, 'location') === location)[0];

// ---- 作用の型 ----

/** 自然 → 畑: 作物が再生する。自然の作物の蓄えを源泉として明示する（Laurier・Poels の境界）。 */
export const regen: ActionType = {
  id: 'regen',
  version: 'skeleton-1',
  agentRole: 'nature',
  roles: [
    { name: 'nature', where: (t) => t.kind === 'nature' },
    { name: 'field', where: (t) => t.kind === 'field' && num(t, 'crop') < 20 },
  ],
  duration: () => 0,
  effects: (b) => [{ kind: 'transfer', attr: 'crop', from: b['nature']!, to: b['field']!, amount: 1 }],
};

/** 人物 ↔ 畑: 収穫。畑の作物 1 を、人物が保管する穀物ロット 1 に変える（損失なし）。 */
export const harvest: ActionType = {
  id: 'harvest',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) },
    { name: 'field', where: (t, b, w) => t.kind === 'field' && locationOf(w, b['person']) === t.id && num(t, 'crop') >= 1 },
    { name: 'grain', where: (t, b) => t.kind === 'grain' && str(t, 'custodian') === b['person'] && str(t, 'location') === b['field'] },
  ],
  duration: () => 30 * MINUTE,
  effects: (b) => [
    { kind: 'convert', from: b['field']!, fromAttr: 'crop', amount: 1, to: b['grain']!, toAttr: 'quantity', produced: 1, lossTo: 'nature', lossAttr: 'waste' },
  ],
};

/** 人物 ↔ 自分のロット: 製パン。穀物 1 → パン 1。家でのみ。鮮度は自然の蓄えから補う。 */
export const bake: ActionType = {
  id: 'bake',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) && str(t, 'location') === str(t, 'home') },
    { name: 'grain', where: (t, b, w) => t.kind === 'grain' && str(t, 'custodian') === b['person'] && str(t, 'location') === locationOf(w, b['person']) && num(t, 'quantity') >= 1 },
    { name: 'bread', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['person'] && str(t, 'location') === locationOf(w, b['person']) },
  ],
  duration: () => 60 * MINUTE,
  effects: (b, w) => {
    const bread = w.thing(b['bread']!);
    const effects: Effect[] = [
      { kind: 'convert', from: b['grain']!, fromAttr: 'quantity', amount: 1, to: b['bread']!, toAttr: 'quantity', produced: 1, lossTo: 'nature', lossAttr: 'waste' },
    ];
    const refresh = 3 - num(bread, 'freshness');
    if (refresh > 0) effects.push({ kind: 'transfer', attr: 'freshness', from: 'nature', to: b['bread']!, amount: refresh });
    return effects;
  },
};

/** 自然 ↔ パンのロット: 腐敗。鮮度が 1 下がり、0 になると量が廃棄へ移る。 */
export const decay: ActionType = {
  id: 'decay',
  version: 'skeleton-1',
  agentRole: 'nature',
  roles: [
    { name: 'nature', where: (t) => t.kind === 'nature' },
    { name: 'bread', where: (t) => t.kind === 'bread' && num(t, 'quantity') > 0 && num(t, 'freshness') >= 1 },
  ],
  duration: () => 0,
  effects: (b, w) => {
    const bread = w.thing(b['bread']!)!;
    const effects: Effect[] = [{ kind: 'transfer', attr: 'freshness', from: b['bread']!, to: b['nature']!, amount: 1 }];
    if (num(bread, 'freshness') <= 1) effects.push({ kind: 'transfer', attr: 'quantity', from: b['bread']!, to: b['nature']!, amount: num(bread, 'quantity') });
    return effects;
  },
};

/**
 * 人物 ↔ 場所: 移動と運搬。出る場所と入る場所の居場所数を移し、所在を付け替える。
 * 手持ちの量は、出る場所のロットから入る場所のロットへ移す（ロットは保管者と場所の組ごとの入れ物で、動かない）。
 */
export const move: ActionType = {
  id: 'move',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) },
    { name: 'from', where: (t, b, w) => isPlace(t) && t.id === locationOf(w, b['person']) },
    { name: 'to', where: (t, b) => isPlace(t) && t.id !== b['from'] },
  ],
  duration: () => 20 * MINUTE,
  effects: (b, w) => {
    const person = b['person']!;
    const effects: Effect[] = [
      { kind: 'transfer', attr: 'occupants', from: b['from']!, to: b['to']!, amount: 1 },
      { kind: 'reassign', thing: person, attr: 'location', from: b['from']!, to: b['to']!, giver: b['from']!, receiver: b['to']! },
    ];
    for (const kind of ['grain', 'bread', 'wood']) {
      const src = lotAt(w, kind, person, b['from']!);
      const dst = lotAt(w, kind, person, b['to']!);
      if (!src || !dst || num(src, 'quantity') <= 0) continue;
      effects.push({ kind: 'transfer', attr: 'quantity', from: src.id, to: dst.id, amount: num(src, 'quantity') });
      const refresh = num(src, 'freshness') - num(dst, 'freshness');
      if (kind === 'bread' && refresh > 0) effects.push({ kind: 'transfer', attr: 'freshness', from: 'nature', to: dst.id, amount: refresh });
    }
    return effects;
  },
};

/** 人物A ↔ 人物B: 引き渡し。同じ場所で、手放す側のパンのロットから受け取る側のロットへ量を移す。両側を一度に確定する。 */
export const handover: ActionType = {
  id: 'handover',
  version: 'skeleton-1',
  agentRole: 'giver',
  roles: [
    { name: 'receiver', where: (t) => t.kind === 'person' && alive(t) },
    { name: 'giver', where: (t, b, w) => t.kind === 'person' && alive(t) && t.id !== b['receiver'] && str(t, 'location') === locationOf(w, b['receiver']) },
    { name: 'givenLot', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['giver'] && str(t, 'location') === locationOf(w, b['giver']) && num(t, 'quantity') >= 1 },
    { name: 'receivedLot', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['receiver'] && str(t, 'location') === locationOf(w, b['receiver']) },
  ],
  // 手放す側の方針（属性 keep）: 手元に keep 個は残す。所有権ではなく本人の意図。
  guard: (b, w) => (num(w.thing(b['givenLot']!), 'quantity') - 1 >= num(w.thing(b['giver']!), 'keep') ? null : 'giver keeps its bread'),
  duration: () => 5 * MINUTE,
  effects: (b, w) => {
    const effects: Effect[] = [{ kind: 'transfer', attr: 'quantity', from: b['givenLot']!, to: b['receivedLot']!, amount: 1 }];
    const refresh = num(w.thing(b['givenLot']!), 'freshness') - num(w.thing(b['receivedLot']!), 'freshness');
    if (refresh > 0) effects.push({ kind: 'transfer', attr: 'freshness', from: 'nature', to: b['receivedLot']!, amount: refresh });
    return effects;
  },
};

/** 人物 ↔ 自分のパン: 摂取。パン 1 が胃の内容 1 になる。 */
export const eat: ActionType = {
  id: 'eat',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) && num(t, 'stomach') < 2 },
    { name: 'bread', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['person'] && str(t, 'location') === locationOf(w, b['person']) && num(t, 'quantity') >= 1 },
  ],
  duration: () => 15 * MINUTE,
  effects: (b) => [
    { kind: 'convert', from: b['bread']!, fromAttr: 'quantity', amount: 1, to: b['person']!, toAttr: 'stomach', produced: 1, lossTo: 'nature', lossAttr: 'waste' },
  ],
};

/** 自然 ↔ 身体: 消化。胃の内容 1 が栄養 0.8 になり、0.2 は排出へ。 */
export const digest: ActionType = {
  id: 'digest',
  version: 'skeleton-1',
  agentRole: 'nature',
  roles: [
    { name: 'nature', where: (t) => t.kind === 'nature' },
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) && num(t, 'stomach') >= 1 },
  ],
  duration: () => 0,
  effects: (b) => [
    { kind: 'convert', from: b['person']!, fromAttr: 'stomach', amount: 1, to: b['person']!, toAttr: 'nutrition', produced: 0.8, lossTo: b['nature']!, lossAttr: 'waste' },
  ],
};

/** 自然 ↔ 身体: 消耗。栄養が 0.1 ずつ熱として自然へ移る。 */
export const wear: ActionType = {
  id: 'wear',
  version: 'skeleton-1',
  agentRole: 'nature',
  roles: [
    { name: 'nature', where: (t) => t.kind === 'nature' },
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) && num(t, 'nutrition') > 0 },
  ],
  duration: () => 0,
  effects: (b, w) => [{ kind: 'transfer', attr: 'nutrition', from: b['person']!, to: b['nature']!, amount: Math.min(0.1, num(w.thing(b['person']!), 'nutrition')) }],
};

// 知覚で写す属性。新しい属性を足すときはここにも足す（属性ごとに可視かどうかを決める）。
const VISIBLE = ['quantity', 'freshness', 'crop', 'wood', 'custodian', 'location'];

/** 人物 ↔ 同じ場所の事物: 知覚。周囲の可視属性の写しを心象に書く。対象側の変化はゼロ。他の人物の所在も見える。 */
export const perceive: ActionType = {
  id: 'perceive',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [{ name: 'person', where: (t) => t.kind === 'person' && alive(t) }],
  duration: () => 0,
  effects: (b, w) => {
    const here = locationOf(w, b['person']);
    const effects = w
      .query((t) => t.id !== b['person'] && (str(t, 'location') === here || (t.kind === 'field' && here === 'field')))
      .map<Effect>((t) => ({ kind: 'inform', observer: b['person']!, about: t.id, attrs: VISIBLE, source: b['person']! }));
    // 同じ場所にいない人物については「ここにいない」ことだけを知る（所在は見えないので記録しない）。
    return effects;
  },
};

export const mealTypes: ActionType[] = [regen, harvest, bake, decay, move, handover, eat, digest, wear, perceive];

// ---- 第二の資源: 薪。属性と作用の型の追加だけで足せるかを確かめるための拡張 ----

/** 自然 → 森: 薪が再生する。 */
export const regrow: ActionType = {
  id: 'regrow',
  version: 'skeleton-1',
  agentRole: 'nature',
  roles: [
    { name: 'nature', where: (t) => t.kind === 'nature' },
    { name: 'forest', where: (t) => t.kind === 'forest' && num(t, 'wood') < 20 },
  ],
  duration: () => 0,
  effects: (b) => [{ kind: 'transfer', attr: 'wood', from: b['nature']!, to: b['forest']!, amount: 1 }],
};

/** 人物 ↔ 森: 採集。森の薪 1 を、人物が保管する薪ロット 1 に変える。 */
export const gather: ActionType = {
  id: 'gather',
  version: 'skeleton-1',
  agentRole: 'person',
  roles: [
    { name: 'person', where: (t) => t.kind === 'person' && alive(t) },
    { name: 'forest', where: (t, b, w) => t.kind === 'forest' && locationOf(w, b['person']) === t.id && num(t, 'wood') >= 1 },
    { name: 'wood', where: (t, b) => t.kind === 'wood' && str(t, 'custodian') === b['person'] && str(t, 'location') === b['forest'] },
  ],
  duration: () => 30 * MINUTE,
  effects: (b) => [{ kind: 'convert', from: b['forest']!, fromAttr: 'wood', amount: 1, to: b['wood']!, toAttr: 'quantity', produced: 1, lossTo: 'nature', lossAttr: 'waste' }],
};

/** 薪を使う製パン。穀物 1 と薪 1 → パン 1。薪は燃えて廃棄へ。 */
export const bakeWithWood: ActionType = {
  id: 'bake',
  version: 'skeleton-1-wood',
  agentRole: 'person',
  roles: [
    ...bake.roles,
    { name: 'wood', where: (t, b, w) => t.kind === 'wood' && str(t, 'custodian') === b['person'] && str(t, 'location') === locationOf(w, b['person']) && num(t, 'quantity') >= 1 },
  ],
  duration: bake.duration,
  effects: (b, w) => [
    ...bake.effects(b, w),
    { kind: 'convert', from: b['wood']!, fromAttr: 'quantity', amount: 1, to: 'nature', toAttr: 'waste', produced: 0, lossTo: 'nature', lossAttr: 'waste' },
  ],
};

/**
 * 人物 ↔ 人物: 交換。同じ場所で、売り手の薪 1 と買い手のパン 1 を一つの実例で互いに移す。
 * REA の交換の双対（give と take）を一つの作用として確定する。
 */
export const exchange: ActionType = {
  id: 'exchange',
  version: 'skeleton-1',
  agentRole: 'seller',
  roles: [
    { name: 'seller', where: (t) => t.kind === 'person' && alive(t) },
    { name: 'buyer', where: (t, b, w) => t.kind === 'person' && alive(t) && t.id !== b['seller'] && str(t, 'location') === locationOf(w, b['seller']) },
    { name: 'sellerWood', where: (t, b, w) => t.kind === 'wood' && str(t, 'custodian') === b['seller'] && str(t, 'location') === locationOf(w, b['seller']) && num(t, 'quantity') >= 1 },
    { name: 'buyerBread', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['buyer'] && str(t, 'location') === locationOf(w, b['buyer']) && num(t, 'quantity') >= 1 },
    { name: 'buyerWood', where: (t, b, w) => t.kind === 'wood' && str(t, 'custodian') === b['buyer'] && str(t, 'location') === locationOf(w, b['buyer']) },
    { name: 'sellerBread', where: (t, b, w) => t.kind === 'bread' && str(t, 'custodian') === b['seller'] && str(t, 'location') === locationOf(w, b['seller']) },
  ],
  guard: (b, w) => (num(w.thing(b['buyerBread']!), 'quantity') - 1 >= num(w.thing(b['buyer']!), 'keep') ? null : 'buyer keeps its bread'),
  duration: () => 5 * MINUTE,
  effects: (b, w) => {
    const effects: Effect[] = [
      { kind: 'transfer', attr: 'quantity', from: b['sellerWood']!, to: b['buyerWood']!, amount: 1 },
      { kind: 'transfer', attr: 'quantity', from: b['buyerBread']!, to: b['sellerBread']!, amount: 1 },
    ];
    const refresh = num(w.thing(b['buyerBread']!), 'freshness') - num(w.thing(b['sellerBread']!), 'freshness');
    if (refresh > 0) effects.push({ kind: 'transfer', attr: 'freshness', from: 'nature', to: b['sellerBread']!, amount: refresh });
    return effects;
  },
};

export const woodTypes: ActionType[] = [regrow, gather, exchange];

// ---- 心象・予測・配分（最小の規則） ----

function known(self: ThingSnapshot): Knowledge {
  return (self.attrs['knowledge'] as Knowledge | undefined) ?? {};
}
function knownLotQuantity(self: ThingSnapshot, kind: string, custodian: string, location: string): number {
  let sum = 0;
  for (const k of Object.values(known(self))) {
    if (k.kind === kind && k.attrs['custodian'] === custodian && k.attrs['location'] === location) sum += Number(k.attrs['quantity'] ?? 0);
  }
  return sum;
}
function knownCrop(self: ThingSnapshot): number {
  return Number(known(self)['field']?.attrs['crop'] ?? 0);
}
function knownOthersBread(self: ThingSnapshot, location: string): { lot: ThingId; custodian: string } | undefined {
  for (const [id, k] of Object.entries(known(self))) {
    if (k.kind === 'bread' && k.attrs['custodian'] !== self.id && k.attrs['location'] === location && Number(k.attrs['quantity'] ?? 0) >= 1) {
      return { lot: id, custodian: String(k.attrs['custodian']) };
    }
  }
  return undefined;
}

/**
 * 農夫: 発注点型の規則。家のパンの見込みが発注点を下回れば、穀物があれば焼き、無ければ畑へ行って
 * 目標量まで収穫し、家へ戻る。収穫の止め時は自分の手段（運べる量、焼く時間）から決める。
 */
export interface FarmerOptions {
  /** 家のパンがこれを下回れば補充に動く。 */
  reorderPoint?: number;
  /** 一度の畑行きで持ち帰る穀物の目標。 */
  grainTarget?: number;
  /** 栄養の見込み（ここでは自分の栄養属性を感覚として読む）がこれ以上なら食べない。Infinity なら空腹感だけで食べる。 */
  eatBelow?: number;
  /** 製パンに薪が要る場面か。要るなら薪の見込みが無いときは焼かずに待つ。 */
  needsWood?: boolean;
}

export class FarmerMind implements Mind {
  private readonly reorderPoint: number;
  private readonly grainTarget: number;
  private readonly eatBelow: number;
  private readonly needsWood: boolean;
  constructor(options: FarmerOptions = {}) {
    this.reorderPoint = options.reorderPoint ?? 2;
    this.grainTarget = options.grainTarget ?? 6;
    this.eatBelow = options.eatBelow ?? Number.POSITIVE_INFINITY;
    this.needsWood = options.needsWood ?? false;
  }
  nextWake(_self: ThingSnapshot, now: number): number {
    return now + 2 * HOUR;
  }
  observe(self: ThingSnapshot, _now: number): Attempt[] {
    return [{ type: 'perceive', binding: { person: self.id } }];
  }
  decide(self: ThingSnapshot, _now: number): Attempt[] {
    const me = self.id;
    const here = str(self, 'location');
    const home = str(self, 'home');
    const attempts: Attempt[] = [];
    const hungry = num(self, 'stomach') < 1 && num(self, 'nutrition') < this.eatBelow;
    if (hungry && knownLotQuantity(self, 'bread', me, here) >= 1) attempts.push({ type: 'eat', binding: { person: me } });
    const breadHere = knownLotQuantity(self, 'bread', me, here);
    const grainHere = knownLotQuantity(self, 'grain', me, here);
    const woodHere = knownLotQuantity(self, 'wood', me, here);
    if (here === home) {
      if (breadHere < this.reorderPoint) {
        if (grainHere >= 1) {
          const bakes = this.needsWood ? Math.min(grainHere, woodHere, 3) : Math.min(grainHere, 3);
          for (let i = 0; i < bakes; i++) attempts.push({ type: 'bake', binding: { person: me } });
          // 薪が無ければ焼けないので待つ。薪は交換で届く。
        } else attempts.push({ type: 'move', binding: { person: me, to: 'field' } });
      }
    } else if (here === 'field') {
      const crop = knownCrop(self);
      if (grainHere >= this.grainTarget || crop < 1) attempts.push({ type: 'move', binding: { person: me, to: home } });
      else for (let i = 0; i < Math.min(crop, this.grainTarget - grainHere, 4); i++) attempts.push({ type: 'harvest', binding: { person: me } });
    } else {
      attempts.push({ type: 'move', binding: { person: me, to: home } });
    }
    return attempts;
  }
}

/** 畑を持たない人物: 手持ちが無ければ農夫の家へ行き、見えたパンの引き渡しを求める。農夫が留守なら一度帰る。 */
export class VisitorMind implements Mind {
  constructor(private readonly farmerHome: string) {}
  nextWake(_self: ThingSnapshot, now: number): number {
    return now + 2 * HOUR;
  }
  observe(self: ThingSnapshot, _now: number): Attempt[] {
    return [{ type: 'perceive', binding: { person: self.id } }];
  }
  decide(self: ThingSnapshot, _now: number): Attempt[] {
    const me = self.id;
    const here = str(self, 'location');
    const home = str(self, 'home');
    const attempts: Attempt[] = [];
    if (num(self, 'stomach') < 1 && knownLotQuantity(self, 'bread', me, here) >= 1) attempts.push({ type: 'eat', binding: { person: me } });
    if (knownLotQuantity(self, 'bread', me, here) < 1) {
      if (here !== this.farmerHome) attempts.push({ type: 'move', binding: { person: me, to: this.farmerHome } });
      else {
        const other = knownOthersBread(self, here);
        const giverHere = other ? known(self)[other.custodian]?.attrs['location'] === here : false;
        if (other && giverHere) attempts.push({ type: 'handover', binding: { receiver: me, giver: other.custodian, givenLot: other.lot } });
        else attempts.push({ type: 'move', binding: { person: me, to: home } });
      }
    } else if (here !== home) {
      attempts.push({ type: 'move', binding: { person: me, to: home } });
    }
    return attempts;
  }
}

/** 木こり: 森で薪を目標量まで採り、農夫の家で薪とパンを交換し、食べて帰る。 */
export class WoodcutterMind implements Mind {
  constructor(
    private readonly farmerHome: string,
    private readonly woodTarget = 4,
  ) {}
  nextWake(_self: ThingSnapshot, now: number): number {
    return now + 2 * HOUR;
  }
  observe(self: ThingSnapshot, _now: number): Attempt[] {
    return [{ type: 'perceive', binding: { person: self.id } }];
  }
  decide(self: ThingSnapshot, _now: number): Attempt[] {
    const me = self.id;
    const here = str(self, 'location');
    const home = str(self, 'home');
    const attempts: Attempt[] = [];
    const breadHere = knownLotQuantity(self, 'bread', me, here);
    const woodHere = knownLotQuantity(self, 'wood', me, here);
    if (num(self, 'stomach') < 1 && breadHere >= 1) attempts.push({ type: 'eat', binding: { person: me } });
    if (breadHere >= 1) {
      if (here !== home) attempts.push({ type: 'move', binding: { person: me, to: home } });
      return attempts;
    }
    if (here === 'forest') {
      const wood = Number(known(self)['forest']?.attrs['wood'] ?? 0);
      if (woodHere >= this.woodTarget || wood < 1) attempts.push({ type: 'move', binding: { person: me, to: this.farmerHome } });
      else for (let i = 0; i < Math.min(wood, this.woodTarget - woodHere, 4); i++) attempts.push({ type: 'gather', binding: { person: me } });
    } else if (here === this.farmerHome) {
      const farmer = Object.entries(known(self)).find(([, k]) => k.kind === 'person' && k.attrs['location'] === here);
      const farmerBread = farmer ? knownLotQuantity(self, 'bread', farmer[0], here) : 0;
      if (woodHere >= 1 && farmer && farmerBread >= 1) attempts.push({ type: 'exchange', binding: { seller: me, buyer: farmer[0] } });
      else if (woodHere < 1) attempts.push({ type: 'move', binding: { person: me, to: 'forest' } });
      else attempts.push({ type: 'move', binding: { person: me, to: home } }); // 農夫が留守かパンが無い。一度帰る
    } else {
      attempts.push({ type: 'move', binding: { person: me, to: woodHere >= 1 ? this.farmerHome : 'forest' } });
    }
    return attempts;
  }
}

// ---- 場面 ----

export interface Scenario {
  world: World;
  persons: ThingId[];
  locations: string[];
}

export interface ScenarioOptions {
  farmer?: FarmerOptions;
  /** 農夫が手元に残すパンの数（引き渡しの方針）。 */
  farmerKeep?: number;
  /** 薪と木こりCを加える。製パンに薪が要る。 */
  wood?: boolean;
}

/** 最小の場面: 畑一つ、家二軒、農夫Aと訪問者B。wood なら森と家Cと木こりCが加わる。 */
export function buildMealScenario(options: ScenarioOptions = {}): Scenario {
  const w = new World();
  const persons = options.wood ? WOOD_PERSONS : BASE_PERSONS;
  const locations = options.wood ? WOOD_LOCATIONS : BASE_LOCATIONS;
  w.addThing('nature', 'nature', { crop: 1000, wood: 1000, waste: 0, freshness: 1000, nutrition: 0, quantity: 0 });
  w.addThing('field', 'field', { location: 'field', crop: 10, occupants: 0 });
  w.addThing('homeA', 'place', { occupants: 1 });
  w.addThing('homeB', 'place', { occupants: 1 });
  // 初期栄養 6 は仮の比較条件（消耗 0.1/時なので、食べなければ 60 時間で尽きる）。
  w.addThing('A', 'person', { alive: 'yes', location: 'homeA', home: 'homeA', nutrition: 6, stomach: 0, keep: options.farmerKeep ?? 1, knowledge: {} });
  w.addThing('B', 'person', { alive: 'yes', location: 'homeB', home: 'homeB', nutrition: 6, stomach: 0, keep: 0, knowledge: {} });
  if (options.wood) {
    w.addThing('forest', 'forest', { location: 'forest', wood: 10, occupants: 0 });
    w.addThing('homeC', 'place', { occupants: 1 });
    w.addThing('C', 'person', { alive: 'yes', location: 'homeC', home: 'homeC', nutrition: 6, stomach: 0, keep: 0, knowledge: {} });
  }
  // ロットは保管者と場所の組ごとに一つ用意する入れ物（量 0 でも存在し、動かない）。
  const kinds = options.wood ? ['grain', 'bread', 'wood'] : ['grain', 'bread'];
  for (const person of persons) {
    for (const loc of locations) {
      for (const kind of kinds) {
        const attrs: Record<string, number | string> = { custodian: person, location: loc, quantity: 0 };
        if (kind === 'bread') attrs['freshness'] = 0;
        // 初期の賦存: 農夫は薪 3 を持って始める。パンには薪が要り、薪はパンとしか交換されないので、
        // どちらかに初期の持ち分が無いと交換が始まらない（動かして分かったこと 11）。
        if (kind === 'wood' && person === 'A' && loc === 'homeA') attrs['quantity'] = 3;
        w.addThing(`${kind}:${person}@${loc}`, kind, attrs);
      }
    }
  }
  for (const t of mealTypes) if (!(options.wood && t.id === 'bake')) w.addType(t);
  if (options.wood) {
    w.addType(bakeWithWood);
    for (const t of woodTypes) w.addType(t);
  }
  w.addMind('A', new FarmerMind({ ...options.farmer, needsWood: options.wood ?? false }));
  w.addMind('B', new VisitorMind('homeA'));
  if (options.wood) w.addMind('C', new WoodcutterMind('homeA'));
  return { world: w, persons: [...persons], locations: [...locations] };
}

/**
 * 自然の予定を置く。再生は 4 時間ごと（6/日。二人の需要 2.4×2÷0.8＝6 と同程度の仮の比較条件）、
 * 腐敗は 8 時間ごと、消化は 2 時間ごと、消耗は 1 時間ごと。森があれば薪の再生も 4 時間ごと。
 */
export function scheduleNature(w: World, fromDay: number, toDay: number, scenario?: Pick<Scenario, 'persons' | 'locations'>): void {
  const persons = scenario?.persons ?? BASE_PERSONS;
  const locations = scenario?.locations ?? BASE_LOCATIONS;
  const hasForest = w.thing('forest') !== undefined;
  for (let day = fromDay; day < toDay; day++) {
    const base = day * DAY;
    for (let h = 0; h < 24; h++) {
      const at = base + h * HOUR;
      for (const person of persons) w.scheduleNatural('wear', { nature: 'nature', person }, at);
      if (h % 2 === 0) for (const person of persons) w.scheduleNatural('digest', { nature: 'nature', person }, at);
      if (h % 4 === 0) w.scheduleNatural('regen', { nature: 'nature', field: 'field' }, at);
      if (h % 4 === 0 && hasForest) w.scheduleNatural('regrow', { nature: 'nature', forest: 'forest' }, at);
      if (h % 8 === 0) for (const person of persons) for (const loc of locations) w.scheduleNatural('decay', { nature: 'nature', bread: `bread:${person}@${loc}` }, at);
    }
  }
}

/** 死亡の判定を世界側で行う。栄養が 0 以下の人物を死亡にする。 */
export function judgeDeath(w: World, persons: ThingId[]): void {
  for (const p of persons) {
    const t = w.thing(p);
    if (t && alive(t) && num(t, 'nutrition') <= 0) w.markDead(p);
  }
}

/** 日次の要約。 */
export function summarize(w: World, persons: ThingId[]): Record<string, number | string> {
  const out: Record<string, number | string> = { day: Math.round(w.now / DAY) };
  for (const p of persons) {
    const t = w.thing(p)!;
    out[`${p}.alive`] = str(t, 'alive');
    out[`${p}.location`] = str(t, 'location');
    out[`${p}.nutrition`] = Number(num(t, 'nutrition').toFixed(2));
    out[`${p}.stomach`] = num(t, 'stomach');
    out[`${p}.bread`] = w.total('quantity', (x) => x.kind === 'bread' && str(x, 'custodian') === p);
    out[`${p}.grain`] = w.total('quantity', (x) => x.kind === 'grain' && str(x, 'custodian') === p);
    if (w.thing('forest')) out[`${p}.wood`] = w.total('quantity', (x) => x.kind === 'wood' && str(x, 'custodian') === p);
  }
  out['field.crop'] = num(w.thing('field'), 'crop');
  if (w.thing('forest')) out['forest.wood'] = num(w.thing('forest'), 'wood');
  out['nature.waste'] = Number(num(w.thing('nature'), 'waste').toFixed(2));
  out['completed'] = w.stats.completed;
  out['rejected'] = w.stats.rejected;
  out['cancelled'] = w.stats.cancelled;
  return out;
}

export function runDays(days: number, options: ScenarioOptions = {}): { scenario: Scenario; daily: Record<string, number | string>[] } {
  const scenario = buildMealScenario(options);
  const { world, persons } = scenario;
  scheduleNature(world, 0, days, scenario);
  const daily: Record<string, number | string>[] = [];
  for (let day = 0; day < days; day++) {
    world.run((day + 1) * DAY);
    judgeDeath(world, persons);
    daily.push(summarize(world, persons));
  }
  return { scenario, daily };
}

export type { Binding };
