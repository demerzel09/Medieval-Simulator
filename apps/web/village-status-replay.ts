import type { VillageFixture } from "../../fixtures/autonomous-village";
import type { VillageId } from "../../packages/ai/autonomous-world";
import type { VillageEvent } from "../../packages/sim/autonomous-world";
import type { InventoryItem, InventoryStatus, PersonStatus } from "../../packages/sim/village-status";

/** Project visible events only; hourly snapshots remain authoritative checkpoints.
 * This is a debug view, separate from the observations available to a person. */
export class VillageStatusReplay {
  readonly statuses: Partial<Record<VillageId, PersonStatus>> = {};
  private offers = new Map<string, string>();
  private origins = new Map<string, string>();
  constructor(private fixture: VillageFixture) {}

  private inventories(status: PersonStatus) {
    return [status.carried, status.home, status.market, ...(status.field ? [status.field] : []), ...(status.ground ? [status.ground] : [])];
  }
  private refresh(inventory: InventoryStatus) {
    inventory.items.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    inventory.mass = inventory.items.reduce((n, item) => n + item.mass, 0) +
      (this.fixture.foodMarket ? 0 : inventory.cash);
  }
  private locate(status: PersonStatus, id: string) {
    for (const inventory of this.inventories(status)) {
      const item = inventory.items.find((item) => item.id === id);
      if (item) return { inventory, item };
    }
  }
  private take(status: PersonStatus, id: string, quantity: number) {
    const source = this.locate(status, id);
    if (!source || quantity > source.item.quantity) return undefined;
    const taken = { ...source.item, quantity, mass: source.item.mass / source.item.quantity * quantity };
    source.item.quantity -= quantity;
    source.item.mass -= taken.mass;
    if (!source.item.quantity) source.inventory.items = source.inventory.items.filter((item) => item.id !== id);
    this.refresh(source.inventory);
    return taken;
  }
  private destination(status: PersonStatus, containerId: string) {
    return containerId.startsWith("ground_") ? status.ground : containerId.startsWith("granary_field_") ? status.field :
      containerId.startsWith("home_chest_") || containerId.startsWith("granary_home_") ? status.home :
      containerId.startsWith("granary_market_") || containerId === "stock_S" ? status.market : status.carried;
  }
  private add(status: PersonStatus, item: InventoryItem) {
    const inventory = this.destination(status, item.containerId);
    if (!inventory) return;
    inventory.items.push(item);
    this.refresh(inventory);
  }
  private move(status: PersonStatus, sourceId: string, id: string, quantity: number, containerId: string) {
    const source = this.locate(status, sourceId);
    if (source?.item.containerId === containerId && sourceId === id) return;
    const taken = this.take(status, sourceId, quantity);
    if (!taken) return;
    if (this.origins.has(sourceId)) this.origins.set(id, this.origins.get(sourceId)!);
    this.add(status, { ...taken, id, containerId, offered: sourceId === id && taken.offered });
  }

  apply(event: VillageEvent) {
    const actor = event.actors[0] as VillageId;
    const data = event.data;
    if (event.kind === "person_status") {
      this.statuses[actor] = JSON.parse(String(data.status)) as PersonStatus;
      return;
    }
    const status = this.statuses[actor];
    if (event.kind === "food_spoiled") {
      const owner = this.statuses[data.ownerId as VillageId];
      if (owner) this.take(owner, String(data.lotId), Number(data.quantity));
      return;
    }
    if (!status) return; // Older recordings do not contain physical inventory checkpoints.
    status.hour = event.hour;
    const quantity = Number(data.quantity);
    if (event.kind === "person_died") {
      if (data.body) status.body = JSON.parse(String(data.body)) as PersonStatus["body"];
      status.body.life = { alive: false, atMinute: Number(data.atMinute), eventId: event.id, cause: "activity_capacity_zero" };
      status.body.energy = 0; status.body.activity = "dead";
    } else if (event.kind === "body_changed") {
      for (const key of ["energy", "hunger", "cold", "sleepDebt", "temperature", "mealHours"] as const)
        if (data[key] !== undefined) status.body[key] = Number(data[key]);
      status.body.sheltered = data.sheltered === 1;
      status.body.activity = String(data.activity);
      if (status.body.sleep && data.sleepiness !== undefined) Object.assign(status.body.sleep, {
        deficitHours: Number(data.sleepDeficit), sleepiness: Number(data.sleepiness),
        actualHours: Number(data.actualSleep24), effectiveHours: Number(data.effectiveSleep24),
        mode: String(data.sleepMode), awakeHours: Number(data.awakeHours),
      });
    } else if (event.kind === "effort_body_changed" && status.body.effort) {
      for (const k of ["reserve", "intake", "absorbed", "consumed", "lost", "unmet", "pendingNutrition", "fatigue", "nutritionNeed", "loadDiscomfort", "pleasure", "relief"] as const)
        if (data[k] !== undefined) status.body.effort[k] = Number(data[k]);
      status.body.effort.digesting = Number(data.pendingNutrition) > 0;
      status.body.energy = Number(data.energy); status.body.hunger = Number(data.hunger);
    } else if (event.kind === "process_started") status.body.activity = String(data.action);
    else if (event.kind === "sleep_attempted") { status.body.activity = "settling"; if (status.body.sleep) status.body.sleep.mode = "settling"; }
    else if (event.kind === "sleep_started") { status.body.activity = "sleep"; if (status.body.sleep) status.body.sleep.mode = "asleep"; }
    else if (["sleep_woke", "sleep_unavailable", "sleep_interrupted"].includes(event.kind) && status.body.sleep) {
      status.body.activity = "wait"; status.body.sleep.mode = "awake";
    }
    else if (["process_completed", "process_failed", "sleep_interrupted", "process_interrupted"].includes(event.kind)) status.body.activity = "wait";
    else if (event.kind === "rested" || event.kind === "slept") {
      status.body.energy = Number(data.energy);
      if (data.sleepDebt !== undefined) status.body.sleepDebt = Number(data.sleepDebt);
    } else if (event.kind === "plant_gathered" || event.kind === "crop_harvested") {
      const kind = String(data.species), id = String(data.lotId);
      this.origins.set(id, String(data.plantId));
      this.add(status, { id, kind, quantity,
        mass: quantity * (kind === "grain" ? this.fixture.bulkTransport?.grainUnitMass ?? 1 : 1),
        ownerId: actor, containerId: String(data.storeId ?? `bag_${actor}`), offered: false,
        ...(kind === "grain" && this.fixture.grainNonperishable ? {} :
          { expiresDay: event.day + this.fixture.foodShelfLifeDays }) });
      // Before v16 a harvest also produced a separate seed object, with the next recorded serial.
      if (event.kind === "crop_harvested" && !this.fixture.bulkTransport) {
        const serial = Number(id.split("_").at(-1)) + 1;
        this.add(status, { id: `seed_${String(serial).padStart(6, "0")}`, kind: "seed", quantity: 1,
          mass: 1, ownerId: actor, containerId: `bag_${actor}`, offered: false });
      }
    } else if (event.kind === "plot_sown") {
      const kind = this.fixture.bulkTransport ? "grain" : "seed";
      const seed = status.carried.items.find((item) => data.grainLotId ? item.id === data.grainLotId : item.kind === kind);
      if (seed) this.take(status, seed.id, Number(data.seedQuantity));
    } else if (event.kind === "grain_loaded") {
      this.move(status, String(data.sourceId), String(data.lotId), quantity, `bag_${actor}`);
    } else if (event.kind === "grain_stored") {
      this.move(status, String(data.lotId), String(data.lotId), quantity, String(data.storeId));
    } else if (event.kind === "home_item_stored" || event.kind === "home_item_taken") {
      this.move(status, String(data.sourceId), String(data.objectId), quantity,
        event.kind === "home_item_stored" ? String(data.storeId) : `bag_${actor}`);
    } else if (event.kind === "item_set_down" || event.kind === "ground_item_taken") {
      if (status.ground) status.ground.capacity = Number(data.groundCapacity);
      this.move(status, String(data.sourceId), String(data.objectId), quantity, event.kind === "item_set_down" ? String(data.storeId) : `bag_${actor}`);
    } else if (event.kind === "home_cash_stored" || event.kind === "home_cash_taken") {
      const amount = event.kind === "home_cash_stored" ? quantity : -quantity;
      status.carried.cash -= amount; status.home.cash += amount;
      this.refresh(status.carried); this.refresh(status.home);
    } else if (event.kind === "bread_baked") {
      this.take(status, String(data.grainLotId), quantity);
      this.origins.set(String(data.lotId), String(data.originPlantId));
      this.add(status, { id: String(data.lotId), kind: "bread", quantity, mass: quantity,
        ownerId: actor, containerId: `bag_${actor}`, offered: false,
        expiresDay: event.day + this.fixture.breadEconomy!.shelfLifeDays });
    } else if (event.kind === "ate") {
      const kind = String(data.product ?? data.species);
      const items = [...(actor === "S" ? status.market.items : []), ...status.carried.items];
      const item = items.find((item) => item.kind === kind && item.quantity >= quantity &&
        (!data.originPlantId || this.origins.get(item.id) === data.originPlantId));
      if (item) this.take(status, item.id, quantity);
      status.body.hunger = Math.max(0, status.body.hunger - 1);
      if (this.fixture.experienceLearning) status.body.mealHours = 0;
    } else if (event.kind === "surplus_offered") {
      this.offers.set(String(data.offerId), String(data.lotId));
      const source = this.locate(status, String(data.lotId));
      if (source) source.item.offered = true;
    } else if (event.kind === "surplus_offer_cancelled") {
      const source = this.locate(status, String(data.lotId)); if (source) source.item.offered = false;
      this.offers.delete(String(data.offerId));
    } else if (event.kind === "surplus_sold") {
      const buyerId = event.actors[1] as VillageId, buyer = this.statuses[buyerId];
      const sourceId = this.offers.get(String(data.offerId));
      const source = sourceId && this.take(status, sourceId, quantity);
      if (!source || !buyer) return;
      const id = String(data.lotId);
      if (this.origins.has(sourceId!)) this.origins.set(id, this.origins.get(sourceId!)!);
      this.add(buyer, { ...source, id, ownerId: buyerId, offered: false,
        containerId: source.kind === "grain" && this.fixture.foodMarket!.initialBakingSkills[buyerId] > 0 ?
          `granary_market_${buyerId}` : `bag_${buyerId}` });
      // A remaining portion of the seller's lot is no longer an active offer.
      const remaining = this.locate(status, sourceId!);
      if (remaining) remaining.item.offered = false;
      status.carried.cash += Number(data.price); buyer.carried.cash -= Number(data.price);
      this.refresh(status.carried); this.refresh(buyer.carried);
      buyer.hour = event.hour;
    }
    if (status.body.life?.alive === false) status.body.activity = "dead";
  }
}
