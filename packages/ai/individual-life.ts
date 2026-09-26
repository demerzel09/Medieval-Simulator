import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type LifeContext = {
  siteId: string; journeyTo?: string; hunger: number; energy: number; carriedFood: number;
  visibleResources: { id: string; available: number }[];
  knownResourceSites: string[]; restGain: number;
};
export type LifeMemory = { lastFailedSite?: string; failedAtDay?: number };
export type LifeStimulus = { kind: "arrival" | "growth" | "hunger" | "action_result"; causeEventIds: string[] };
export type LifeAttempt = { kind: "forage"; resourceId: string; quantity: number } | { kind: "eat" } |
  { kind: "rest" } | { kind: "travel"; siteId: string };
export type LifeResponse = ActorResponse<LifeAttempt, LifeMemory, { at: number }>;
export type LifeModel = PersonalityModel<ActorInput<LifeContext, LifeMemory, LifeStimulus>, LifeResponse>;

/** Uses only bodily needs, carried food, and the currently visible patch. */
export const ordinaryLifeModel: LifeModel = {
  decide(input) {
    const c = input.knownContext;
    const wait = { at: input.at + 1 };
    if (c.journeyTo) return { attempts: [], wait };
    if (c.hunger > 0 && c.carriedFood > 0) return { attempts: [{ kind: "eat" }], wait };
    if (c.energy < 3) return { attempts: [{ kind: "rest" }], wait };
    const available = c.visibleResources.find((resource) => resource.available > 0);
    if (c.carriedFood < 1 && available) return { attempts: [{ kind: "forage", resourceId: available.id, quantity: 1 }], wait };
    if (c.carriedFood < 1) {
      const day = Math.floor((input.at - 1) / 24);
      const failedToday = input.subjectiveState.failedAtDay === day ? input.subjectiveState.lastFailedSite : undefined;
      const next = c.knownResourceSites.find((id) => id !== c.siteId && id !== failedToday);
      if (next) return { attempts: [{ kind: "travel", siteId: next }],
        subjectiveUpdate: c.visibleResources.length ? { lastFailedSite: c.siteId, failedAtDay: day } : input.subjectiveState, wait };
    }
    if (c.carriedFood < 1 && c.visibleResources.length)
      return { attempts: [], wait: { at: Math.floor((input.at - 1) / 24 + 1) * 24 + 1 } };
    if (c.energy < 10) return { attempts: [{ kind: "rest" }], wait };
    return { attempts: [], wait: { at: input.at + (c.carriedFood ? 8 : 1) } };
  },
};
