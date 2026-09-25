import { z } from "zod";
import content from "./scenario.json";
const natural = z.number().int().nonnegative();
export const scenarioSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: z.literal("pass_and_harvest"),
  population: z.tuple([natural.min(10), natural.min(10)]),
  military: z.tuple([natural, natural]),
  caps: z.tuple([natural, natural]),
  prices: z.object({
    food: natural.min(1),
    wood: natural.min(1),
    equipment: natural.min(1),
  }),
  wages: z.object({ civilian: natural, military: natural }),
  combat: z.object({
    casualtyRate: z.number().min(0).max(1),
    fatality: z.number().min(0).max(1),
    lossMorale: z.number().min(0).max(1),
    fatigueMorale: z.number().min(0).max(1),
  }),
  roads: z.array(
    z.tuple([
      z.enum(["capital", "farm", "trade", "pass", "enemy"]),
      z.enum(["capital", "farm", "trade", "pass", "enemy"]),
      natural.min(1),
    ]),
  ),
});
export function validateContent(input: unknown = content) {
  const c = scenarioSchema.parse(input);
  c.population.forEach((n, i) => {
    if (c.military[i] > c.caps[i] || c.caps[i] > n)
      throw Error("軍籍配分が人口または上限を超える");
  });
  return c;
}
