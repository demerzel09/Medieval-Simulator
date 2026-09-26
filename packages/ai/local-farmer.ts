import type { ActorInput, ActorResponse, PersonalityModel } from "./personality";

export type FarmerContext = {
  day: number; location: string; homeId: string; journeyTo?: string;
  available: boolean; energy: number; onRoster: boolean;
  shift?: { id: string; status: "accepted" | "completed" | "refused" };
  harvestedToday: boolean;
  workStartAt: number; harvestAt: number; finishAt: number; nextDayWorkAt: number;
};
export type FarmerSubjectiveState = { shiftTaskId?: string; harvestedToday: boolean };
export type FarmerStimulus = { kind: "arrival" | "shift_result"; receivedAt: number; causeEventIds: string[] };
export type FarmerInput = ActorInput<FarmerContext, FarmerSubjectiveState, FarmerStimulus>;
export type FarmerAttempt =
  | { kind: "start_shift" }
  | { kind: "harvest" }
  | { kind: "return_home" }
  | { kind: "finish_shift" };
export type FarmerResponse = ActorResponse<FarmerAttempt, FarmerSubjectiveState, { at: number }>;
export type FarmerModel = PersonalityModel<FarmerInput, FarmerResponse>;

/** The roster is known locally; accepting it and doing the work remain the farmer's decisions. */
export const ordinaryFarmerModel: FarmerModel = {
  decide(input) {
    const c = input.knownContext, now = input.at;
    const nextDay = { attempts: [], wait: { at: c.nextDayWorkAt } } satisfies FarmerResponse;
    if (!c.available || !c.onRoster) return nextDay;
    if (c.journeyTo) return { attempts: [], wait: { at: now + 1 } };
    if (!c.shift && c.location === c.homeId && now === c.workStartAt)
      return { attempts: [{ kind: "start_shift" }], wait: { at: c.harvestAt } };
    if (c.shift?.status !== "accepted") return nextDay;
    if (!c.harvestedToday && c.location === "farm" && now >= c.harvestAt && now < c.finishAt)
      return { attempts: [{ kind: "harvest" }, { kind: "return_home" }], wait: { at: c.finishAt } };
    if (c.harvestedToday && c.location === c.homeId && now >= c.finishAt)
      return { attempts: [{ kind: "finish_shift" }], wait: { at: c.nextDayWorkAt } };
    if (c.location === "farm" && now >= c.finishAt)
      return { attempts: [{ kind: "return_home" }], wait: { at: c.nextDayWorkAt } };
    return { attempts: [], wait: { at: c.harvestedToday ? c.finishAt : c.harvestAt } };
  },
};
