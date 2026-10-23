import {
  travelContext,
  parentContext,
  recoveryContext,
  fallbackContext,
  compositionContext,
  type PrototypeContext,
} from "./input-projections";
export { contextCodec, type PrototypeContext } from "./input-projections";
import { z } from "zod";
import {
  codec,
  numericEstimateSchema,
  bodySchema,
  proposalSchema,
  offerSchema,
  planSchema,
  projectedSchema,
  forecastSchema,
  refSchema,
  evidenceSchema,
  jsonValue,
  diagnosisSchema,
  attemptSchema,
} from "./schemas";
import {
  actionStep,
  compose,
  type CompositionInput,
  type StepProposal,
} from "./composer";
import {
  json,
  point,
  unknown,
  type Codec,
  type Composition,
  type Definition,
  type Estimate,
  type Evidence,
  type Forecast,
  type Json,
  type Offer,
  type Plan,
  type Port,
  type Ref,
} from "./contracts";
import { ModelRegistry, type Diagnosis } from "./registry";

const number = z.number().finite();
const sample = z
  .object({ count: z.number().int().nonnegative(), mean: number })
  .strict();
const stateCodec = z.object({ samples: z.record(sample) }).strict();
type Samples = z.infer<typeof stateCodec>;
const empty = z.object({}).strict();
const numericEstimate = codec(numericEstimateSchema);
const bodyCodec = bodySchema;
const cell = z.object({ x: number, y: number }).strict();
const travelInput = z
  .object({
    from: z.string(),
    to: z.string(),
    distance: number.nonnegative(),
    mass: number.nonnegative(),
  })
  .strict();
const bodyInput = z
  .object({
    before: bodyCodec,
    minutes: z.custom<Estimate<number>>((v) => {
      try {
        numericEstimate.parse(v);
        return true;
      } catch {
        return false;
      }
    }),
    activity: z.string(),
    context: z
      .object({
        mass: number,
        maxEnergy: number,
        sheltered: z.boolean(),
        nutritionNeed01: number,
      })
      .strict(),
  })
  .strict();
const request = z.object({ to: z.string(), cell, deadline: number }).strict();
const controlInput = z.object({ context: travelContext, request }).strict();
const compositionCalls: NonNullable<Definition["calls"]> = [
  { target: "$travel", role: "control", contract: "travel-control-v1" },
  { target: "$body", role: "forward", contract: "body-v1" },
];

const travelKey = (i: z.infer<typeof travelInput>) =>
  `${i.from}>${i.to}:mass${Math.floor(i.mass / 4)}`;
const bodyKey = (i: z.infer<typeof bodyInput>) =>
  `${i.activity}:mass${Math.floor(i.context.mass / 4)}:${i.context.sheltered ? "in" : "out"}:need${i.context.nutritionNeed01 >= 0.75}`;
const mean = (s: Samples, k: string, prior: number) =>
  s.samples[k]?.mean ?? prior;
const scaled = (
  start: Estimate<number | boolean>,
  duration: Estimate<number>,
  rate: number,
  low: number,
  high: number,
): Estimate<number | boolean> => {
  if (
    start.kind !== "point" ||
    typeof start.value !== "number" ||
    duration.kind === "unknown" ||
    duration.kind === "branches"
  )
    return unknown("missing-input");
  const clamp = (n: number) => Math.max(low, Math.min(high, n));
  if (duration.kind === "point")
    return point(clamp(start.value + (duration.value / 60) * rate));
  const values = [
    clamp(start.value + (duration.low / 60) * rate),
    clamp(start.value + (duration.high / 60) * rate),
  ];
  return {
    kind: "interval",
    low: Math.min(...values),
    high: Math.max(...values),
    support: {
      basis: "extrapolation",
      samples: 0,
      conditionKey: "duration-range",
    },
  };
};
function bodyPrediction(
  i: z.infer<typeof bodyInput>,
  s: Samples,
  revision = 1,
) {
  if (revision === 2 && i.minutes.kind === "point" && i.minutes.value === 0)
    return structuredClone(i.before);
  const condition = bodyKey(i),
    rest = (
      revision === 1 ? ["rest", "sleep", "wait"] : ["rest", "sleep"]
    ).includes(i.activity);
  const result: Record<string, Estimate<number | boolean>> = {};
  for (const field of [
    "fatigue01",
    "energy",
    "nutritionNeed01",
    "sleepiness01",
    "cold",
  ]) {
    const fallback =
      field === "fatigue01"
        ? rest
          ? -0.07
          : revision === 2 && i.activity === "wait"
            ? (0.02 * i.context.mass) / 8
            : 0.04 * (1 + i.context.mass / 8)
        : field === "energy"
          ? rest
            ? 2
            : -(1 + i.context.mass / 8)
          : null;
    const learned = s.samples[`${condition}:${field}`];
    result[field] =
      fallback === null && !learned
        ? unknown("no-experience")
        : scaled(
            i.before[field] ?? unknown("missing-input"),
            i.minutes,
            learned?.mean ?? fallback!,
            0,
            field === "energy"
              ? i.context.maxEnergy
              : field === "cold"
                ? 100
                : 1,
          );
    if (result[field].kind === "point")
      result[field].support = {
        basis: learned ? "experience" : "prior",
        samples: learned?.count ?? 0,
        conditionKey: `${condition}:${field}`,
      };
  }
  result.digesting = unknown("absorption-unidentified");
  return result;
}
function observation(
  e: Evidence,
  field: string,
  side: "before" | "after",
): number | null {
  const value = e[side] as Record<string, Json>;
  const k =
    field === "fatigue01"
      ? "fatigue"
      : field === "nutritionNeed01"
        ? "nutritionNeed"
        : field === "sleepiness01"
          ? "sleepiness"
          : field;
  return typeof value[k] === "number" ? (value[k] as number) : null;
}
function bodyDiagnosis(
  i: z.infer<typeof bodyInput>,
  predicted: Record<string, Estimate<number | boolean>>,
  e: Evidence,
  s: Samples,
  revision = 1,
): Diagnosis {
  const actualInput = { ...i, minutes: point(e.elapsed) },
    conditional = bodyPrediction(actualInput, s, revision);
  const diagnostic: Record<string, Json> = {},
    observed: Record<string, Json> = {},
    values: { key: string; value: number }[] = [];
  for (const field of [
    "fatigue01",
    "energy",
    "nutritionNeed01",
    "sleepiness01",
    "cold",
  ]) {
    const actual = observation(e, field, "after"),
      before = observation(e, field, "before"),
      p = predicted[field],
      c = conditional[field];
    observed[field] = actual;
    diagnostic[field] =
      actual !== null &&
      p?.kind === "point" &&
      c?.kind === "point" &&
      typeof p.value === "number" &&
      typeof c.value === "number"
        ? {
            total: actual - p.value,
            local: actual - c.value,
            upstream: c.value - p.value,
          }
        : { reason: "missing-observation-or-prediction" };
    // Saturation and changed recovery nutrition invalidate a linear rate sample.
    const maximum =
      field === "energy" ? i.context.maxEnergy : field === "cold" ? 100 : 1;
    const recoveryChanged =
      ["rest", "sleep"].includes(i.activity) &&
      (observation(e, "nutritionNeed01", "before") ?? 0) >= 0.75 !==
        (observation(e, "nutritionNeed01", "after") ?? 0) >= 0.75;
    if (
      actual !== null &&
      before !== null &&
      actual > 0 &&
      actual < maximum &&
      e.elapsed > 0 &&
      !recoveryChanged
    )
      values.push({
        key: `${bodyKey(i)}:${field}`,
        value: ((actual - before) * 60) / e.elapsed,
      });
  }
  return {
    actualInput: actualInput as unknown as Json,
    observed,
    diagnostic,
    update: values.length ? { values } : null,
  };
}
const durationPort: Port = {
  name: "duration",
  quantity: "duration",
  unit: "minute",
  timing: "predicted",
};
const bodyPorts: Port[] = [
  "fatigue01",
  "energy",
  "nutritionNeed01",
  "sleepiness01",
  "cold",
  "digesting",
].map((name) => ({
  name,
  quantity: name,
  unit: name === "digesting" ? "boolean" : name,
  timing: "predicted",
  body: true,
}));
const def = (
  id: string,
  role: Definition["role"],
  initial: Json = {},
  learner: string | null = null,
  inputs: Port[] = [],
  outputs: Port[] = [],
): Definition => ({
  id,
  role,
  initial,
  learner,
  inputs,
  outputs,
  projection: "subjective-v1",
  contract: role,
  cost: 1,
});
export function parentDefinition(id: string, kind: "recovery" | "food") {
  return { definition: def(id, "control"), kind };
}
function makePlan(
  parent: string,
  target: PrototypeContext["destinations"][number],
  minute: number,
): Plan {
  return {
    id: `${parent}:${target.id}`,
    goalId: "proposal",
    revision: 1,
    entry: "travel",
    nodes: [
      {
        id: "travel",
        kind: "delegate",
        model: "$travel",
        request: { to: target.id, cell: target.cell, deadline: minute + 720 },
        attempt: null,
        duration: 0,
        claims: [{ kind: "body", id: "self", mode: "hold", quantity: 1 }],
      },
      {
        id: "observe",
        kind: "observe",
        model: null,
        request: null,
        attempt: null,
        duration: 0,
        claims: [],
      },
    ],
    edges: [{ from: "travel", to: "observe", on: "completed" }],
    loops: [],
  };
}
export function registerParent(
  registry: ModelRegistry,
  id: string,
  kind: "recovery" | "food",
) {
  return registry.control(
    def(id, "control"),
    z.object({ context: parentContext, minute: number }).strict(),
    codec(z.array(offerSchema)),
    empty,
    {
      propose({ context: c, minute }) {
        if (c.active) return [];
        const places = c.destinations.filter(
          (d) => d.kind === kind && d.id !== c.site,
        );
        return places.map((target) => ({
          id: `${id}:${target.id}`,
          parent: id,
          purpose: kind,
          target: target.id,
          deadline: minute + 720,
          basis: "temporary-goal-v1" as const,
          completion: "arrival" as const,
          priority:
            kind === "recovery"
              ? c.body.fatigue01 * 10 + c.body.cold
              : c.body.nutritionNeed01 * 10 + 1,
          plan: makePlan(id, target, minute),
        }));
      },
    },
  );
}
export function createPrototypeRegistry(
  extraParents: { id: string; kind: "recovery" | "food" }[] = [],
  revision: 1 | 2 = 1,
) {
  const registry = new ModelRegistry(`hierarchy-registry@${revision}`, [
    "subjective-v1",
  ]);
  registry.learner(
    def("sample-mean@1", "learner", { samples: {} }),
    z
      .object({
        values: z.array(z.object({ key: z.string(), value: number }).strict()),
      })
      .strict(),
    stateCodec,
    {
      update(input, state) {
        const next = structuredClone(state);
        for (const value of input.values) {
          const old = next.samples[value.key];
          const count = (old?.count ?? 0) + 1;
          next.samples[value.key] = {
            count,
            mean: (old?.mean ?? 0) + (value.value - (old?.mean ?? 0)) / count,
          };
        }
        return next;
      },
    },
  );
  registry.forward(
    {
      ...def(
        "travel-forward@1",
        "forward",
        { samples: {} },
        "sample-mean@1",
        [],
        [durationPort],
      ),
      contract: "duration-v1",
    },
    travelInput,
    numericEstimate,
    stateCodec,
    {
      predict(input, state) {
        const k = travelKey(input),
          sample = state.samples[k];
        return point(
          sample?.mean ??
            Math.max(
              60,
              Math.ceil((input.distance * (1 + input.mass / 8)) / 16) * 60,
            ),
          k,
          sample?.count ?? 0,
        );
      },
    },
    (input, predicted, e): Diagnosis => {
      const p = predicted.kind === "point" ? predicted.value : null;
      return {
        actualInput: input,
        observed: e.elapsed,
        diagnostic:
          p === null
            ? { reason: "unknown" }
            : { total: e.elapsed - p, local: e.elapsed - p, upstream: 0 },
        update:
          e.phase === "completed" && e.elapsed > 0
            ? { values: [{ key: travelKey(input), value: e.elapsed }] }
            : null,
      };
    },
  );
  registry.forward(
    {
      ...def(
        "body-forward@1",
        "forward",
        { samples: {} },
        "sample-mean@1",
        [],
        bodyPorts,
      ),
      contract: "body-v1",
    },
    bodyInput,
    bodyCodec,
    stateCodec,
    { predict: (input, state) => bodyPrediction(input, state) },
    bodyDiagnosis,
  );
  registry.control(
    {
      ...def("travel-control@1", "control", {}, null, [durationPort], []),
      contract: "travel-control-v1",
      calls: [
        {
          target: "$travel-prediction",
          role: "forward",
          contract: "duration-v1",
        },
      ],
    },
    controlInput,
    codec(proposalSchema),
    empty,
    {
      propose({ context: c, request: r }, _state, calls): StepProposal {
        const duration = calls.invoke<unknown, Estimate<number>>(
          "$travel-prediction",
          {
            from: c.site,
            to: r.to,
            distance: Math.max(
              Math.abs(c.cell.x - r.cell.x),
              Math.abs(c.cell.y - r.cell.y),
            ),
            mass: c.mass,
          },
        );
        const interrupts =
          c.active === "travel" &&
          (c.body.cold >= 8 || c.body.fatigue01 >= 0.86);
        return {
          attempt: interrupts
            ? { kind: "interrupt_action", args: {} }
            : c.active
              ? null
              : c.site === r.to
                ? null
                : { kind: "travel", args: { siteId: r.to } },
          duration: interrupts ? point(0) : duration,
          site: interrupts ? null : r.to,
          interrupts,
        };
      },
    },
  );
  registry.add(
    {
      ...def(
        "compose@1",
        "composer",
        {},
        null,
        [durationPort, ...bodyPorts],
        [],
      ),
      calls: compositionCalls,
    },
    codec(
      z
        .object({
          plan: planSchema,
          start: projectedSchema,
          context: compositionContext,
        })
        .strict(),
    ),
    codec(forecastSchema),
    empty,
    (input, _s, calls) =>
      compose(input, calls, "$body", calls.limit("branchesPerPlan"), {
        mass: input.context.mass,
        maxEnergy: input.context.maxEnergy,
        sheltered: input.context.sheltered,
        nutritionNeed01: input.context.body.nutritionNeed01,
      }),
  );
  registry.add(
    def("temporary-evaluation@1", "evaluator"),
    codec(z.object({ offer: offerSchema, forecast: forecastSchema }).strict()),
    z.union([number, z.null()]),
    empty,
    ({ offer, forecast }) => {
      const last = forecast.segments.at(-1);
      if (
        !last ||
        last.after.minute.kind !== "point" ||
        last.before.minute.kind !== "point"
      )
        return null;
      const first = forecast.segments[0];
      if (first.before.minute.kind !== "point") return null;
      const before = first.before.body.fatigue01,
        after = last.after.body.fatigue01;
      if (
        before?.kind !== "point" ||
        after?.kind !== "point" ||
        typeof before.value !== "number" ||
        typeof after.value !== "number"
      )
        return null;
      return (
        offer.priority -
        (last.after.minute.value - first.before.minute.value) / 60 -
        3 * (after.value - before.value)
      );
    },
  );
  registry.add(
    def("temporary-selection@1", "selector"),
    z
      .object({
        candidates: z
          .array(z.object({ id: z.string(), score: number }).strict())
          .min(1),
      })
      .strict(),
    z.string(),
    empty,
    ({ candidates }) =>
      [...candidates].sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      )[0].id,
  );
  registry.add(
    def("local-residual@1", "analyzer"),
    codec(
      z
        .object({ ref: refSchema, evidence: evidenceSchema, saved: jsonValue })
        .strict(),
    ),
    codec(diagnosisSchema),
    empty,
    ({ ref, evidence, saved }) => {
      const diagnose = registry.get(ref.model).diagnose;
      if (!diagnose)
        return {
          actualInput: null,
          observed: null,
          diagnostic: { reason: "not-registered" },
          update: null,
        };
      return diagnose(ref.input, ref.output, evidence, saved);
    },
  );
  registry.control(
    def("fallback-local@1", "fallback"),
    z.object({ context: fallbackContext }).strict(),
    codec(attemptSchema.nullable()),
    empty,
    {
      propose({ context: c }) {
        return !c.active && c.hunger > 0 && c.meals > 0
          ? { kind: "eat", args: {} }
          : null;
      },
    },
  );
  registerParent(registry, "recovery-parent@1", "recovery");
  registerParent(registry, "food-parent@1", "food");
  for (const parent of extraParents)
    registerParent(registry, parent.id, parent.kind);
  if (revision === 2) registerRecoveryRevision(registry);
  return registry;
}
export const prototypeComposition: Composition = {
  version: "travel-body-prototype@1",
  registryVersion: "hierarchy-registry@1",
  root: ["recovery-parent@1", "food-parent@1"],
  composer: "compose@1",
  evaluator: "temporary-evaluation@1",
  selector: "temporary-selection@1",
  analyzer: "local-residual@1",
  fallback: "fallback-local@1",
  aliases: {
    $travel: { model: "travel-control@1", contract: "travel-control-v1" },
    "$travel-prediction": {
      model: "travel-forward@1",
      contract: "duration-v1",
    },
    $body: { model: "body-forward@1", contract: "body-v1" },
  },
  edges: [
    {
      from: "travel-forward@1",
      output: "duration",
      to: "travel-control@1",
      input: "duration",
      phase: 0,
    },
    {
      from: "travel-forward@1",
      output: "duration",
      to: "compose@1",
      input: "duration",
      phase: 0,
    },
    ...bodyPorts.map((port) => ({
      from: "body-forward@1",
      output: port.name,
      to: "compose@1",
      input: port.name,
      phase: 1,
    })),
  ],
};

/** Revision 2 fixes the missing recovery action; these weights remain provisional. */
function registerRecoveryRevision(registry: ModelRegistry) {
  registry.forward(
    {
      ...def(
        "body-forward@2",
        "forward",
        { samples: {} },
        "sample-mean@1",
        [],
        bodyPorts,
      ),
      contract: "body-v1",
    },
    bodyInput,
    bodyCodec,
    stateCodec,
    { predict: (input, state) => bodyPrediction(input, state, 2) },
    (input, predicted, evidence, state) =>
      bodyDiagnosis(input, predicted, evidence, state, 2),
  );
  registry.control(
    def("recovery-parent@2", "control"),
    z.object({ context: recoveryContext, minute: number }).strict(),
    codec(z.array(offerSchema)),
    empty,
    {
      propose({ context: c, minute }) {
        if (c.active) return [];
        const targets = [
          { id: c.site, cell: c.cell, kind: "recovery" as const },
          ...c.destinations.filter(
            (d) => d.kind === "recovery" && d.id !== c.site,
          ),
        ];
        return targets.map((target) => {
          const plan = makePlan("recovery-parent@2", target, minute);
          const rest = actionStep("recover", "rest", 120);
          rest.claims = [
            { kind: "body", id: "self", mode: "hold", quantity: 1 },
          ];
          if (target.id === c.site) {
            plan.entry = "recover";
            plan.nodes = [rest, plan.nodes[1]];
            plan.edges = [{ from: "recover", to: "observe", on: "completed" }];
          } else {
            plan.nodes.splice(1, 0, rest);
            plan.edges = [
              { from: "travel", to: "recover", on: "completed" },
              { from: "recover", to: "observe", on: "completed" },
            ];
          }
          return {
            id: plan.id,
            parent: "recovery-parent@2",
            purpose: "recovery",
            target: target.id,
            deadline: minute + 720,
            plan,
            basis: "temporary-recovery-v2" as const,
            priority: 0,
            completion: "arrival" as const,
          };
        });
      },
    },
  );
  registry.add(
    {
      ...def(
        "compose@2",
        "composer",
        {},
        null,
        [durationPort, ...bodyPorts],
        [],
      ),
      calls: compositionCalls,
    },
    codec(
      z
        .object({
          plan: planSchema,
          start: projectedSchema,
          context: compositionContext,
        })
        .strict(),
    ),
    codec(forecastSchema),
    empty,
    (input, _state, calls) => {
      const forecast = compose(
        input,
        calls,
        "$body",
        calls.limit("branchesPerPlan"),
        {
          mass: input.context.mass,
          maxEnergy: input.context.maxEnergy,
          sheltered: input.context.sheltered,
          nutritionNeed01: input.context.body.nutritionNeed01,
        },
      );
      // Local prediction domain, not the formal survival probability comparison.
      for (const segment of forecast.segments) {
        const fatigue = segment.after.body.fatigue01,
          energy = segment.after.body.energy;
        if (
          (fatigue?.kind === "point" &&
            typeof fatigue.value === "number" &&
            fatigue.value >= 1) ||
          (energy?.kind === "point" &&
            typeof energy.value === "number" &&
            energy.value <= 0)
        ) {
          if (!forecast.violations.includes("predicted-capacity-exhaustion"))
            forecast.violations.push("predicted-capacity-exhaustion");
        }
      }
      return forecast;
    },
  );
  registry.add(
    def("temporary-evaluation@2", "evaluator"),
    codec(z.object({ offer: offerSchema, forecast: forecastSchema }).strict()),
    z.union([number, z.null()]),
    empty,
    ({ offer, forecast }) => {
      const first = forecast.segments[0],
        last = forecast.segments.at(-1);
      if (
        !first ||
        !last ||
        first.before.minute.kind !== "point" ||
        last.after.minute.kind !== "point"
      )
        return null;
      const before = first.before.body.fatigue01,
        after = last.after.body.fatigue01;
      if (
        before?.kind !== "point" ||
        after?.kind !== "point" ||
        typeof before.value !== "number" ||
        typeof after.value !== "number"
      )
        return null;
      return (
        offer.priority -
        (last.after.minute.value - first.before.minute.value) / 60 +
        40 * (before.value ** 2 - after.value ** 2)
      );
    },
  );
}

export const recoveryComposition: Composition = {
  ...structuredClone(prototypeComposition),
  version: "travel-body-recovery@2",
  registryVersion: "hierarchy-registry@2",
  root: ["recovery-parent@2", "food-parent@1"],
  composer: "compose@2",
  evaluator: "temporary-evaluation@2",
  evaluationBasis: "temporary-recovery-v2",
  aliases: {
    ...structuredClone(prototypeComposition.aliases),
    $body: { model: "body-forward@2", contract: "body-v1" },
  },
  edges: prototypeComposition.edges.map((edge) => ({
    ...edge,
    from: edge.from === "body-forward@1" ? "body-forward@2" : edge.from,
    to: edge.to === "compose@1" ? "compose@2" : edge.to,
  })),
};
