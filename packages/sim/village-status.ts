import type { VillageId } from "../ai/autonomous-world";
import type { VillageWorld } from "./autonomous-world";
import { needsTemperature } from "./needs-body";
import { sleepSignal, type SleepSignal } from "./sleep-body";
import { capacityReport, totalMass } from "./physical";

export type InventoryItem = { id: string; kind: string; quantity: number; mass: number; ownerId: string;
  containerId: string; expiresDay?: number; offered: boolean };
export type InventoryStatus = { cash: number; mass: number; capacity: number; items: InventoryItem[] };
export type PersonStatus = { hour: number; carried: InventoryStatus; home: InventoryStatus; market: InventoryStatus;
  field?: InventoryStatus;
  body: { energy: number; maxEnergy: number; hunger: number; cold: number; sleepDebt: number; mealHours: number;
    temperature: number; sheltered: boolean; activity: string; sleep?: SleepSignal } };

/** A debug snapshot of actual physical objects. It does not grant an actor access to others' inventories. */
export function villagePersonStatus(w: VillageWorld, id: VillageId): PersonStatus {
  const inventory = (containers: string[]): InventoryStatus => {
    const objects = Object.values(w.physical.objects).filter((o) => o.ownerId === id && containers.includes(o.parentId ?? ""));
    return {
      cash: objects.filter((o) => o.typeId === "currency").reduce((n, o) => n + o.quantity, 0),
      mass: containers.filter((c) => w.physical.objects[c]).reduce((n, c) => n + capacityReport(w.physical, c).massUsed, 0),
      capacity: containers.filter((c) => w.physical.objects[c]).reduce((n, c) => n + (capacityReport(w.physical, c).massMax ?? 0), 0),
      items: objects.filter((o) => o.typeId !== "currency").map((o) => {
        const meta = w.foodLots[o.id];
        const expiresDay = meta && !(meta.species === "grain" && meta.product !== "bread") ?
          (meta.product === "bread" ? meta.producedDay! + w.fixture.breadEconomy!.shelfLifeDays : meta.harvestedDay + w.fixture.foodShelfLifeDays) : undefined;
        return { id: o.id, kind: meta?.product === "bread" ? "bread" : meta?.species ?? o.typeId,
          quantity: o.quantity, mass: totalMass(w.physical, o.id), ownerId: o.ownerId!, containerId: o.parentId!,
          ...(expiresDay === undefined ? {} : { expiresDay }),
          offered: Object.values(w.foodOffers ?? {}).some((offer) => offer.lotId === o.id && !offer.purchasedEventId) };
      }).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    };
  };
  const person = w.people[id];
  const sheltered = w.physical.objects[id].parentId === `home_${id}`;
  const temperature = w.fixture.needs ? needsTemperature(Math.max(1, w.hour), w.fixture.needs, sheltered) : 0;
  const carried = inventory([`bag_${id}`, `wallet_${id}`]);
  carried.capacity = w.physical.types.person.container!.maxContentsMass!;
  return { hour: w.hour, carried, home: inventory([`home_chest_${id}`, `granary_home_${id}`]),
    market: inventory([`granary_market_${id}`, ...(id === "S" ? ["stock_S"] : [])]),
    ...(w.fixture.bulkTransport ? { field: inventory(Object.values(w.physical.objects).filter((o) => o.id.startsWith("granary_field_") && o.ownerId === id).map((o) => o.id)) } : {}),
    body: { energy: person.energy, maxEnergy: w.fixture.body.maxEnergy, hunger: person.hunger, cold: person.cold,
      sleepDebt: person.needs?.sleepDebt ?? 0, mealHours: person.needs?.mealHours ?? 0, temperature, sheltered,
      ...(person.sleep ? { sleep: sleepSignal(person.sleep, w.fixture.sleepRegulation!, person.energy, w.fixture.body.maxEnergy) } : {}),
      activity: person.sleep?.mode === "settling" ? "settling" : person.activeProcessId ? w.processes[person.activeProcessId]?.kind ?? "wait" : "wait" } };
}

/** Display indices of physical needs, not a new emotion or a learned subjective value. */
export function bodilyDiscomfort(body: PersonStatus["body"]) {
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
  const hunger = clamp(body.hunger / 3), cold = clamp(body.cold / 12);
  const fatigue = clamp(1 - body.energy / body.maxEnergy), sleepiness = clamp(body.sleep?.sleepiness ?? body.sleepDebt / 24);
  const discomfort = Math.max(hunger, cold, fatigue, sleepiness);
  return { hunger, cold, fatigue, sleepiness, discomfort, comfort: 100 - discomfort };
}
