import { z } from "zod";
const number = z.number().finite();
const cell = z.object({ x: number, y: number }).strict();
export const contextCodec = z
  .object({
    site: z.string(),
    cell,
    home: z.object({ id: z.string(), cell }).strict(),
    sheltered: z.boolean(),
    body: z
      .object({
        fatigue01: number,
        energy: number,
        nutritionNeed01: number,
        sleepiness01: number,
        cold: number,
        digesting: z.boolean(),
      })
      .strict(),
    mass: number,
    maxEnergy: number,
    hunger: number,
    meals: number,
    cash: number,
    active: z.string().nullable(),
    destinations: z.array(
      z
        .object({ id: z.string(), cell, kind: z.enum(["recovery", "food"]) })
        .strict(),
    ),
  })
  .strict();
export type PrototypeContext = z.infer<typeof contextCodec>;
// Projection codecs remove unrelated subjective fields before model execution.
export const travelContext = contextCodec
  .pick({ site: true, cell: true, mass: true, active: true })
  .extend({
    body: contextCodec.shape.body.pick({ cold: true, fatigue01: true }).strip(),
  })
  .strip();
export const parentContext = contextCodec
  .pick({ site: true, active: true, destinations: true })
  .extend({
    body: contextCodec.shape.body
      .pick({ fatigue01: true, cold: true, nutritionNeed01: true })
      .strip(),
  })
  .strip();
export const recoveryContext = contextCodec
  .pick({ site: true, cell: true, active: true, destinations: true })
  .strip();
export const fallbackContext = contextCodec
  .pick({ active: true, hunger: true, meals: true })
  .strip();
export const compositionContext = contextCodec
  .pick({
    site: true,
    cell: true,
    mass: true,
    active: true,
    maxEnergy: true,
    sheltered: true,
  })
  .extend({
    body: contextCodec.shape.body
      .pick({ cold: true, fatigue01: true, nutritionNeed01: true })
      .strip(),
  })
  .strip();
