import { z } from "zod";
import {
  json,
  type Codec,
  type Evidence,
  type Estimate,
  type Forecast,
  type Json,
  type Offer,
  type Plan,
  type Projected,
  type Ref,
} from "./contracts";
import type { CompositionInput, StepProposal } from "./composer";
import type { Diagnosis } from "./registry";
const n = z.number().finite(),
  nonnegative = n.nonnegative();
export const jsonValue = z.custom<Json>((value) => {
  try {
    json(value);
    return true;
  } catch {
    return false;
  }
}, "finite plain JSON required");
const support = z
  .object({
    basis: z.enum(["prior", "experience", "extrapolation"]),
    samples: z.number().int().nonnegative(),
    conditionKey: z.string(),
  })
  .strict();
export const numericEstimateSchema: z.ZodType<Estimate<number>> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("point"), value: n, support }).strict(),
    z
      .object({ kind: z.literal("interval"), low: n, high: n, support })
      .strict()
      .refine((v) => v.low <= v.high, "inverted interval"),
    z.object({ kind: z.literal("unknown"), reason: z.string() }).strict(),
    z
      .object({
        kind: z.literal("branches"),
        branches: z.array(
          z
            .object({
              id: z.string(),
              probability: numericEstimateSchema,
              value: n,
            })
            .strict(),
        ),
      })
      .strict(),
  ]),
);
export const bodyEstimateSchema: z.ZodType<Estimate<number | boolean>> = z.lazy(
  () =>
    z.union([
      z
        .object({
          kind: z.literal("point"),
          value: z.union([n, z.boolean()]),
          support,
        })
        .strict(),
      z
        .object({ kind: z.literal("interval"), low: n, high: n, support })
        .strict()
        .refine((v) => v.low <= v.high, "inverted interval"),
      z.object({ kind: z.literal("unknown"), reason: z.string() }).strict(),
      z
        .object({
          kind: z.literal("branches"),
          branches: z.array(
            z
              .object({
                id: z.string(),
                probability: numericEstimateSchema,
                value: z.union([n, z.boolean()]),
              })
              .strict(),
          ),
        })
        .strict(),
    ]),
);
export const bodySchema = z.record(bodyEstimateSchema);
export const attemptSchema = z
  .object({ kind: z.string(), args: z.record(jsonValue) })
  .strict();
export const proposalSchema: z.ZodType<StepProposal> = z
  .object({
    attempt: attemptSchema.nullable(),
    duration: numericEstimateSchema,
    site: z.string().nullable(),
    interrupts: z.boolean(),
  })
  .strict();
export const planSchema: z.ZodType<Plan> = z
  .object({
    id: z.string(),
    goalId: z.string(),
    revision: z.number().int().positive(),
    revisionCause: z
      .object({
        kind: z.string(),
        minute: nonnegative,
        evidence: z.array(z.string()),
      })
      .strict()
      .optional(),
    entry: z.string(),
    nodes: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["delegate", "attempt", "observe"]),
          model: z.string().nullable(),
          request: jsonValue,
          attempt: attemptSchema.nullable(),
          duration: nonnegative,
          claims: z.array(
            z
              .object({
                kind: z.enum(["lot", "cash", "body", "capacity"]),
                id: z.string(),
                mode: z.enum(["consume", "hold", "produce"]),
                quantity: nonnegative,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    edges: z.array(
      z.object({ from: z.string(), to: z.string(), on: z.string() }).strict(),
    ),
    loops: z.array(
      z
        .object({
          steps: z.array(z.string()),
          maxIterations: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export const projectedSchema: z.ZodType<Projected> = z
  .object({
    minute: numericEstimateSchema,
    site: z.string(),
    cash: n,
    lots: z.record(n),
    capacity: nonnegative,
    occupied: z.string().nullable(),
    body: bodySchema,
  })
  .strict();
export const refSchema: z.ZodType<Ref> = z
  .object({
    model: z.string(),
    revision: z.number().int().nonnegative(),
    input: jsonValue,
    output: jsonValue,
  })
  .strict();
export const forecastSchema: z.ZodType<Forecast> = z
  .object({
    segments: z.array(
      z
        .object({
          step: z.string(),
          path: z.array(z.string()),
          before: projectedSchema,
          after: projectedSchema,
          refs: z.array(refSchema),
        })
        .strict(),
    ),
    violations: z.array(z.string()),
    unevaluated: z.array(
      z.object({ step: z.string(), reason: z.string() }).strict(),
    ),
  })
  .strict();
export const offerSchema: z.ZodType<Offer> = z
  .object({
    id: z.string(),
    parent: z.string(),
    purpose: z.string(),
    target: z.string(),
    deadline: nonnegative,
    basis: z.literal("temporary-goal-v1"),
    priority: n,
    plan: planSchema,
    completion: z.enum(["arrival", "absorption"]),
  })
  .strict();
export const evidenceSchema: z.ZodType<Evidence> = z
  .object({
    id: z.string(),
    intentId: z.string(),
    eventId: z.string(),
    processId: z.string().nullable(),
    action: z.string(),
    occurred: nonnegative,
    received: nonnegative,
    started: nonnegative,
    elapsed: nonnegative,
    phase: z.enum([
      "started",
      "completed",
      "failed",
      "rejected",
      "interrupted",
      "superseded",
    ]),
    before: jsonValue,
    after: jsonValue,
  })
  .strict();
export const diagnosisSchema: z.ZodType<Diagnosis> = z
  .object({
    actualInput: jsonValue,
    observed: jsonValue,
    diagnostic: jsonValue,
    update: jsonValue.nullable(),
  })
  .strict();
export function codec<T>(schema: z.ZodType<T>): Codec<T> {
  return {
    parse(value) {
      json(value);
      return schema.parse(value);
    },
  };
}
