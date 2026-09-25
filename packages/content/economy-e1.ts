import { z } from "zod";
import fixture from "./economy-e1.json";

const nat = z.number().int().nonnegative();
const positive = z.number().int().positive();
export const economyE1Schema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: z.literal("village_food_loop"),
  price: positive,
  foodPerPerson: positive,
  farmOutputPerShift: positive,
  farmersOnShift: z.tuple([positive, positive, positive]),
  cartCapacity: positive,
  roadKm: positive,
  walkKmh: positive,
  cartKmh: positive,
  initialHouseholdMoney: nat,
  times: z.object({
    orders: nat,
    notice: nat,
    assignment: nat,
    farmCommute: nat,
    farmArrive: nat,
    cartDepart: nat,
    cartFarmArrive: nat,
    farmEnd: nat,
    loadEnd: nat,
    cartMarketArrive: nat,
    unloadEnd: nat,
    marketEnd: nat,
    meal: nat,
  }),
  households: z.array(
    z.object({
      id: z.string().min(1),
      farmers: z.array(z.string().min(1)),
      buyer: z.string().min(1),
      other: z.array(z.string().min(1)),
    }),
  ).length(4),
  roles: z.object({
    seller: z.string().min(1),
    carrier: z.string().min(1),
    farmManager: z.string().min(1),
  }),
  routines: z.array(z.object({
    id: z.string().min(1),
    version: positive,
    trigger: z.enum(["daily", "notice", "stock_arrival"]),
    role: z.enum(["farmer", "carrier", "seller", "buyer", "all"]),
    capability: z.enum(["work_shift", "carry_food", "market_sale", "buy_food", "eat_food"]),
  })).length(5),
});
export type EconomyE1Content = z.infer<typeof economyE1Schema>;
export function validateEconomyE1(input: unknown = fixture): EconomyE1Content {
  const c = economyE1Schema.parse(input);
  const ids = c.households.flatMap((h) => [...h.farmers, h.buyer, ...h.other]);
  if (ids.length !== 20 || new Set(ids).size !== 20 ||
      c.households.some((h) => h.farmers.length + h.other.length !== 4))
    throw Error("E1 households must contain 20 unique people in groups of five");
  const farmerIds = c.households.flatMap((h) => h.farmers);
  if (farmerIds.length !== 7 || !farmerIds.includes(c.roles.farmManager) ||
      !ids.includes(c.roles.seller) || !ids.includes(c.roles.carrier) ||
      c.roles.seller === c.roles.carrier ||
      farmerIds.includes(c.roles.seller) || farmerIds.includes(c.roles.carrier) ||
      c.households.some((h) => h.buyer === c.roles.seller || h.buyer === c.roles.carrier))
    throw Error("invalid E1 actor roles");
  const expected = ["work_shift", "carry_food", "market_sale", "buy_food", "eat_food"];
  const roleFor = { work_shift: "farmer", carry_food: "carrier", market_sale: "seller", buy_food: "buyer", eat_food: "all" } as const;
  if (new Set(c.routines.map((r) => r.id)).size !== c.routines.length ||
      expected.some((cap) => c.routines.filter((r) => r.capability === cap).length !== 1) ||
      c.routines.some((r) => r.role !== roleFor[r.capability]))
    throw Error("invalid E1 routine capabilities");
  const t = c.times;
  if (!(t.orders < t.notice && t.notice < t.assignment &&
        t.farmCommute === t.assignment && t.farmArrive === t.cartDepart &&
        t.cartFarmArrive < t.farmEnd && t.farmEnd < t.loadEnd &&
        t.loadEnd < t.cartMarketArrive && t.cartMarketArrive < t.unloadEnd &&
        t.unloadEnd < t.marketEnd && t.marketEnd < t.meal && t.meal < 1440 &&
        t.farmArrive - t.farmCommute >= c.roadKm / c.walkKmh * 60 &&
        t.cartFarmArrive - t.cartDepart >= c.roadKm / c.cartKmh * 60 &&
        t.cartMarketArrive - t.loadEnd >= c.roadKm / c.cartKmh * 60 &&
        t.marketEnd - t.unloadEnd >= c.households.length * 15))
    throw Error("infeasible E1 timetable");
  if (c.farmersOnShift.some((n) => n > farmerIds.length) ||
      c.cartCapacity < c.farmersOnShift[0] * c.farmOutputPerShift ||
      c.farmersOnShift.reduce((a,b) => a+b,0) * c.farmOutputPerShift !==
        ids.length * c.foodPerPerson * 3 ||
      c.initialHouseholdMoney < 3 * 5 * c.foodPerPerson * c.price)
    throw Error("E1 fixture does not balance three days");
  return c;
}
export const economyE1 = validateEconomyE1();
