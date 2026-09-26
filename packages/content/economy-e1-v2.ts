import { z } from "zod";
import fixture from "./economy-e1-v2.json";
import { validateEconomyE1 } from "./economy-e1";
import type { PhysicalType } from "../sim/physical";

const nat = z.number().int().nonnegative();
const physicalType = z.object({
  id: z.string().min(1), tags: z.array(z.string().min(1)).min(1), unitMass: nat,
  stackable: z.boolean(), ownable: z.boolean(),
  container: z.object({ acceptsTags: z.array(z.string().min(1)), maxContentsMass: nat.optional(),
    maxDirectChildren: nat.optional(), maxQuantityByTag: z.record(nat).optional() }).optional(),
});
const required = ["world", "site", "person", "bag", "foodStoreFarm", "foodStoreMarket", "foodStoreHouse", "chest", "pouch", "till", "cart", "food", "currency"];
export function validateEconomyE1V2(input: unknown = fixture) {
  const record = z.object({ schemaVersion: z.literal(2), physicalTypes: z.record(physicalType) }).passthrough().parse(input);
  const base = validateEconomyE1({ ...record, schemaVersion: 1 });
  const types = record.physicalTypes as Record<string, PhysicalType>;
  const tags = new Set(Object.values(types).flatMap((type) => type.tags));
  if (required.some((id) => !types[id]) || Object.entries(types).some(([id, type]) => id !== type.id ||
    new Set(type.tags).size !== type.tags.length || type.container?.acceptsTags.some((tag) => !tags.has(tag)) ||
    Object.keys(type.container?.maxQuantityByTag ?? {}).some((tag) => !tags.has(tag)))) throw Error("invalid E1 v2 physical types");
  if (types.food.unitMass !== 1 || types.currency.unitMass !== 1 || types.cart.container?.maxContentsMass !== base.cartCapacity ||
    types.person.container?.maxContentsMass !== base.limits.personFood + base.limits.personCash ||
    types.foodStoreFarm.container?.maxContentsMass !== base.limits.farmFood ||
    types.foodStoreMarket.container?.maxContentsMass !== base.limits.marketFood ||
    types.foodStoreHouse.container?.maxContentsMass !== base.limits.houseFood ||
    types.pouch.container?.maxContentsMass !== base.limits.personCash ||
    types.chest.container?.maxContentsMass !== base.limits.houseChestCash ||
    types.till.container?.maxContentsMass !== base.limits.marketTillCash) throw Error("E1 v2 physical limits mismatch");
  return input as typeof fixture;
}
export const economyE1V2 = validateEconomyE1V2();
