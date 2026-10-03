import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeVillageDocument } from "../sim/shared-village-json";
import type { VillageRecording } from "../sim/village-recording";
import { hash } from "../sim/core";
import type { VillageId } from "../ai/autonomous-world";

const args = process.argv.slice(2), path = args[0];
if (!path) throw Error("provide a village recording and optional --output path");
const r = decodeVillageDocument<VillageRecording>(JSON.parse(gunzipSync(readFileSync(path)).toString()), true);
if (hash(r.events) !== r.finalEventHash) throw Error("recorded events do not match their hash");
const ids: VillageId[] = ["S", "F", "C", "B1", "B2"];
const report = { ruleset: r.rulesetId, seed: r.seed, untilHour: r.untilHour, stateHash: r.finalStateHash,
  eventHash: r.finalEventHash, events: r.events.length,
  trades: r.events.filter((e) => e.kind === "surplus_sold").map((e) => ({ hour: e.hour, actors: e.actors, ...e.data })),
  grainMeals: r.events.filter((e) => e.kind === "ate" && e.data.species === "grain" && e.data.product !== "bread").length,
  people: Object.fromEntries(ids.map((id) => {
    const decisions = r.decisions.filter((d) => d.actorId === id), personal = r.events.filter((e) => e.actors[0] === id);
    const meals = personal.filter((e) => e.kind === "ate").map((e) => ({ hour: e.hour, species: e.data.species, product: e.data.product, quantity: e.data.quantity }));
    const death = personal.find((e) => e.kind === "person_died");
    const outcomes = new Map(decisions.flatMap((d) => (d.response.subjectiveUpdate?.anticipation?.effort?.acquisition?.outcomes ?? []).map((o) => [o.id, o] as const)));
    const selections = decisions.filter((d) => d.response.subjectiveUpdate?.anticipation?.effort?.acquisition?.plan?.startedAt === d.hour)
      .map((d) => { const a = d.response.subjectiveUpdate!.anticipation!.effort!.acquisition!;
        return { hour: d.hour, action: d.response.attempts[0], plan: a.plan, selected: a.selected,
          candidates: a.candidates.map(({ attempt, ...p }) => p) }; });
    const intervals = meals.slice(1).map((meal, i) => meal.hour - meals[i].hour);
    const endHour = death ? Number(death.data.atMinute) / 60 : r.untilHour;
    const nutrition = personal.filter((e) => e.kind === "effort_body_changed" && (e.hour % 6 === 0 || Number(e.data.reserve) < 12))
      .map((e) => ({ atMinute: e.data.atMinute, reserve: e.data.reserve, pending: e.data.pendingNutrition, fatigue: e.data.fatigue }));
    const last = personal.filter((e) => e.kind === "person_status").at(-1);
    return [id, { death: death?.data ?? null, meals, maxMealIntervalHours: intervals.length ? Math.max(...intervals) : null,
      hoursFromLastMealToEnd: endHour - (meals.at(-1)?.hour ?? 0), nutrition, selections, outcomes: [...outcomes.values()],
      finalStatus: last ? JSON.parse(String(last.data.status)) : null }];
  })) };
const output = args.indexOf("--output");
if (output >= 0) { if (!args[output + 1]) throw Error("--output requires a path"); writeFileSync(args[output + 1], JSON.stringify(report, null, 2) + "\n"); }
else console.log(JSON.stringify(report, null, 2));
