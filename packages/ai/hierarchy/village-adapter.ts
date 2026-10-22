import { z } from "zod";
import { actionObservation } from "../action-learning";
import type { VillageContext, VillageModel } from "../autonomous-world";
import { point, type Evidence, type Json } from "./contracts";
import {
  contextCodec,
  createPrototypeRegistry,
  prototypeComposition,
  type PrototypeContext,
} from "./models";
import { HierarchyRuntime, type RuntimeInput } from "./runtime";
import {
  checkHierarchyState,
  newHierarchyState,
  type HierarchyState,
} from "./state";
export const prototypeRegistry = createPrototypeRegistry();
export const prototypeRuntime = new HierarchyRuntime(
  prototypeRegistry,
  prototypeComposition,
  (attempt) => {
    attemptCodec.parse({ kind: attempt.kind, args: attempt.args });
  },
);
export const newVillageHierarchy = (
  actor: string,
  seed: number,
  version: string,
) => {
  if (version !== prototypeComposition.version)
    throw Error("model-mismatch: fixture composition");
  return newHierarchyState(actor, seed, prototypeRegistry, version);
};
export const checkVillageHierarchy = (state: HierarchyState, version: string) =>
  checkHierarchyState(state, prototypeRegistry, version);
export function projectVillage(c: VillageContext): PrototypeContext {
  if (!c.effortBody || !c.needs?.sleep)
    throw Error("insufficient-observation: body");
  const destinations: PrototypeContext["destinations"] = [
    { id: c.needs.home.siteId, cell: c.needs.home.cell, kind: "recovery" },
  ];
  for (const p of c.visiblePlants)
    if (
      p.cell &&
      p.siteId &&
      ["herb", "wild_berry", "fruit_tree"].includes(p.species)
    )
      if (!destinations.some((d) => d.id === p.siteId))
        destinations.push({ id: p.siteId, cell: p.cell, kind: "food" });
  return contextCodec.parse({
    site: c.siteId,
    cell: c.cell,
    home: { id: c.needs.home.siteId, cell: c.needs.home.cell },
    sheltered: c.needs.sheltered,
    body: {
      fatigue01: c.effortBody.fatigue,
      energy: c.energy,
      nutritionNeed01: c.effortBody.nutritionNeed,
      sleepiness01: c.needs.sleep.sleepiness,
      cold: c.cold,
      digesting: c.effortBody.digesting,
    },
    mass: c.carriedMass,
    maxEnergy: c.bulkTransport!.maxEnergy,
    hunger: c.hunger,
    meals: c.edibleMeals ?? 0,
    cash: c.ownCash,
    active: c.activeAction ?? null,
    destinations,
  });
}
const attemptCodec = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("travel"),
      args: z.object({ siteId: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["eat", "rest", "interrupt_action"]),
      args: z.object({}).strict(),
    })
    .strict(),
]);
export const hierarchyVillageModel: VillageModel = {
  decide(input) {
    const state = input.subjectiveState.hierarchy;
    if (!state || input.subjectiveState.anticipation)
      throw Error("model-mismatch: hierarchy personality");
    const c = projectVillage(input.knownContext),
      observation = actionObservation(input.knownContext) as unknown as Json;
    const evidence: Evidence[] = input.stimuli.flatMap((s) => {
      const e = s.experience;
      if (s.kind !== "result" || !e?.predictionId || !s.action) return [];
      return [
        {
          id: s.id,
          intentId: e.predictionId,
          eventId: e.attemptEventId,
          processId: e.processId ?? null,
          action: s.action,
          occurred: s.occurredAt * 60,
          received: s.receivedAt * 60,
          started: e.startedAt * 60,
          elapsed: e.elapsedHours * 60,
          phase: e.phase,
          before: e.before as unknown as Json,
          after: e.after as unknown as Json,
        },
      ];
    });
    const data: RuntimeInput = {
      actor: input.actorId,
      minute: input.at * 60,
      context: c,
      observation,
      evidence,
      digesting: c.body.digesting,
      projected: {
        minute: point(input.at * 60),
        site: c.site,
        cash: c.cash,
        lots: Object.fromEntries(
          (input.knownContext.ownFoodLots ?? []).map((l) => [l.id, l.quantity]),
        ),
        capacity: input.knownContext.bulkTransport!.bagFreeMass,
        occupied: c.active,
        body: Object.fromEntries(
          Object.entries(c.body).map(([k, v]) => [k, point(v)]),
        ),
      },
    };
    const result = prototypeRuntime.decide(data, state);
    const attempts = [];
    if (result.attempt) {
      const a = attemptCodec.parse({
        kind: result.attempt.kind,
        args: result.attempt.args,
      });
      const ids = result.attempt.intentId
        ? { experienceId: result.attempt.intentId }
        : {};
      attempts.push(
        a.kind === "travel"
          ? {
              kind: a.kind,
              siteId: a.args.siteId,
              ...ids,
              ...(result.attempt.intentId
                ? { predictionId: result.attempt.intentId }
                : {}),
            }
          : { kind: a.kind, ...ids },
      );
    }
    return {
      attempts,
      subjectiveUpdate: { ...input.subjectiveState, hierarchy: result.state },
      wait: { at: Math.max(input.at + 1, Math.ceil(result.wakeMinute / 60)) },
    };
  },
};
