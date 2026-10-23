import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { hierarchyRecoveryV25, hierarchyV25 } from "../fixtures/hierarchy-v25";
import {
  hierarchyVillageModel,
  recoveryRegistry,
} from "../packages/ai/hierarchy/village-adapter";
import { recoveryComposition } from "../packages/ai/hierarchy/models";
import { DecisionSession } from "../packages/ai/hierarchy/session";
import { defaultBudget, point } from "../packages/ai/hierarchy/contracts";
import { newHierarchyState } from "../packages/ai/hierarchy/state";
import {
  advanceVillageWorld,
  loadVillageWorld,
  newVillageWorld,
  saveVillageWorld,
  villageHash,
} from "../packages/sim/autonomous-world";
import {
  captureVillageRecording,
  replayVillageRecording,
  type VillageRecording,
} from "../packages/sim/village-recording";
import { decodeVillageDocument } from "../packages/sim/shared-village-json";
import { VillageStatusReplay } from "../apps/web/village-status-replay";
import { villagePersonStatus } from "../packages/sim/village-status";

function firstDecision() {
  const w = newVillageWorld(240924, hierarchyRecoveryV25);
  advanceVillageWorld(w, 1, hierarchyVillageModel);
  return w.decisions.find((d) => d.actorId === "F")!;
}

describe("v25 recovery behavior, separate from connection reproducibility", () => {
  it("reproduces the original fatigue death and every original response without migrating the record", () => {
    const record = decodeVillageDocument<VillageRecording>(
      JSON.parse(
        gunzipSync(
          readFileSync(
            "fixtures/recordings/autonomous-village-hierarchy-24h.v2.json.gz",
          ),
        ).toString(),
      ),
      true,
    );
    const death = record.events.find(
      (e) => e.kind === "person_died" && e.actors.includes("F"),
    )!;
    expect(death.data.atMinute).toBe(825);
    expect(death.data.fatigue).toBe(1);
    expect(Number(death.data.reserve)).toBeGreaterThan(0);
    for (const d of record.decisions)
      expect(
        hierarchyVillageModel.decide({
          actorId: d.actorId,
          at: d.hour,
          knownContext: d.knownContext,
          stimuli: d.stimuli,
          subjectiveState: d.subjectiveBefore,
        }),
      ).toEqual(d.response);
    expect(villageHash(replayVillageRecording(record))).toBe("0559b3e5");
    expect(hierarchyV25.hierarchyModel?.compositionVersion).toBe(
      "travel-body-prototype@1",
    );
  });

  it("offers actual rest at home and outside, rejecting predicted exhaustion before starting travel", () => {
    const initial = firstDecision();
    for (const atHome of [false, true])
      for (const mass of [0, 8, 16]) {
        const context = structuredClone(initial.knownContext);
        context.effortBody!.fatigue = 0.9856;
        context.energy = 26 * (1 - 0.9856);
        context.carriedMass = mass;
        if (atHome) {
          context.siteId = context.needs!.home.siteId;
          context.cell = context.needs!.home.cell;
          context.needs!.sheltered = true;
        }
        const response = hierarchyVillageModel.decide({
          actorId: "F",
          at: 1,
          knownContext: context,
          subjectiveState: structuredClone(initial.subjectiveBefore),
          stimuli: [],
        });
        expect(response.attempts.map((a) => a.kind)).toEqual(["rest"]);
        const choice = response.subjectiveUpdate!.hierarchy!.choices.at(-1)!;
        expect(choice.basis).toBe("temporary-recovery-v2");
        expect(
          choice.candidates.some((c) =>
            c.violations.includes("predicted-capacity-exhaustion"),
          ),
        ).toBe(true);
      }
  });

  it("does not model loaded waiting as rest or erase sensations at a zero-duration observation", () => {
    const state = newHierarchyState(
      "F",
      240924,
      recoveryRegistry,
      recoveryComposition.version,
    );
    const session = new DecisionSession(
      recoveryRegistry,
      state,
      defaultBudget,
      recoveryComposition,
    );
    const input = {
      before: { fatigue01: point(0.5), energy: point(13), cold: point(4) },
      minutes: point(120),
      activity: "wait",
      context: { mass: 8, maxEnergy: 26, sheltered: false, nutritionNeed01: 0 },
    };
    const wait = session.invoke<any, any>("$body", input);
    const rest = session.invoke<any, any>("$body", {
      ...input,
      activity: "rest",
    });
    expect(wait.fatigue01.value).toBeGreaterThan(0.5);
    expect(rest.fatigue01.value).toBeLessThan(0.5);
    expect(session.invoke("$body", { ...input, minutes: point(0) })).toEqual(
      input.before,
    );
  });

  it("reduces real fatigue through rest, keeps all five alive for 24h, and repeats after save/resume", () => {
    const w = newVillageWorld(240924, hierarchyRecoveryV25);
    advanceVillageWorld(w, 12, hierarchyVillageModel);
    const resumed = loadVillageWorld(saveVillageWorld(w));
    advanceVillageWorld(w, 12, hierarchyVillageModel);
    advanceVillageWorld(resumed, 12, hierarchyVillageModel);
    expect(villageHash(w)).toBe(villageHash(resumed));
    for (const person of Object.values(w.people))
      expect(person.death).toBeUndefined();
    expect(
      w.events.some((e) => e.kind === "rested" && e.actors.includes("F")),
    ).toBe(true);
    const f = w.decisions.filter((d) => d.actorId === "F");
    expect(
      Math.max(...f.map((d) => d.knownContext.effortBody!.fatigue)),
    ).toBeLessThan(0.8);
    expect(
      f.some((d) =>
        d.stimuli.some(
          (s) =>
            s.action === "rest" &&
            s.experience?.phase === "completed" &&
            s.experience.after.fatigue! < s.experience.before.fatigue!,
        ),
      ),
    ).toBe(true);
    expect(
      w.people.F.memory.hierarchy!.models["body-forward@2"].revision,
    ).toBeGreaterThan(0);
    const replay = new VillageStatusReplay(w.fixture);
    for (const event of w.events) replay.apply(event);
    for (const id of Object.keys(w.people))
      expect(replay.statuses[id as keyof typeof w.people]?.body).toEqual(
        villagePersonStatus(w, id as keyof typeof w.people).body,
      );
    for (const d of w.decisions)
      expect(
        hierarchyVillageModel.decide({
          actorId: d.actorId,
          at: d.hour,
          knownContext: d.knownContext,
          stimuli: d.stimuli,
          subjectiveState: d.subjectiveBefore,
        }),
      ).toEqual(d.response);
    expect(
      villageHash(replayVillageRecording(captureVillageRecording(w))),
    ).toBe(villageHash(w));
  }, 30000);

  it("reports the remaining nutrition deaths over ten days and freezes deceased actors instead of counting replay as survival", () => {
    const w = newVillageWorld(240924, hierarchyRecoveryV25);
    advanceVillageWorld(w, 72, hierarchyVillageModel);
    const deaths = w.events.filter((e) => e.kind === "person_died");
    expect(deaths).toHaveLength(5);
    for (const death of deaths) {
      expect(Number(death.data.atMinute)).toBeGreaterThan(24 * 60);
      expect(death.data.reserve).toBe(0);
      expect(Number(death.data.fatigue)).toBeLessThan(1);
    }
    const frozen = structuredClone(w.people),
      decisions = w.decisions.length;
    advanceVillageWorld(w, 168, hierarchyVillageModel);
    expect(w.hour).toBe(240);
    expect(w.decisions).toHaveLength(decisions);
    for (const id of Object.keys(w.people)) {
      const key = id as keyof typeof w.people;
      expect(w.people[key].memory).toEqual(frozen[key].memory);
      expect(w.people[key].effort).toEqual(frozen[key].effort);
    }
  }, 30000);
});
