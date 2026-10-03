/** Read-only physiology/effort contrast. Counts actual events and checks the nutrition ledger. */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeVillageDocument } from "../sim/shared-village-json";
import type { VillageRecording } from "../sim/village-recording";
import type { PersonStatus } from "../sim/village-status";
const paths = process.argv.slice(2), out = paths.indexOf("--output");
const output = out < 0 ? undefined : paths.splice(out, 2)[1];
if (!paths.length) throw Error("provide one or more village recordings");
const reports = paths.map((path) => {
  const bytes = readFileSync(path), r = decodeVillageDocument<VillageRecording>(JSON.parse(
    (path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()), true);
  const finalStatuses = Object.fromEntries(["S", "F", "C", "B1", "B2"].map((id) => [id,
    JSON.parse(String(r.events.filter((e) => e.kind === "person_status" && e.actors[0] === id).at(-1)!.data.status)) as PersonStatus]));
  const people = Object.fromEntries(Object.entries(finalStatuses).map(([id, status]) => {
    const decisions = r.decisions.filter((d) => d.actorId === id), effort = decisions.at(-1)?.response.subjectiveUpdate?.anticipation?.effort;
    const meals = r.events.filter((e) => e.kind === "ate" && e.actors[0] === id), nutrition = status.body.effort;
    const gaps = [0, ...meals.map((e) => e.hour), r.untilHour];
    const ledgerError = nutrition ? r.fixture.effortBody!.initialReserve / 1000 + nutrition.absorbed -
      nutrition.reserve - nutrition.consumed - nutrition.lost : undefined;
    if (ledgerError !== undefined && Math.abs(ledgerError) > 1e-8) throw Error(`${path}: ${id} nutrition balance`);
    const quarterStates = r.events.filter((e) => e.kind === "effort_body_changed" && e.actors[0] === id && Number(e.data.atMinute) % 60 === 0);
    const depleted = new Set(quarterStates.filter((e) => Number(e.data.reserve) === 0).map((e) => Number(e.data.atMinute)));
    return [id, { meals: meals.length, breadMeals: meals.filter((e) => e.data.product === "bread").length,
      daysWithMeals: new Set(meals.map((e) => e.day)).size,
      maximumFoodGapHours: Math.max(...gaps.slice(1).map((h, i) => h - gaps[i])),
      ...(nutrition ? { nutrition, ledgerError, hoursWithEmptyReserve: depleted.size,
        learning: { matched: effort?.matched, excluded: effort?.excluded, absoluteError: effort?.errors,
          meanAbsoluteError: effort?.matched ? effort.errors / effort.matched : null, models: Object.keys(effort?.models ?? {}).length },
        trade: effort?.trade } : {}) }];
  }));
  return { source: path, rulesetId: r.rulesetId, untilHour: r.untilHour,
    stateHash: r.finalStateHash, eventHash: r.finalEventHash, events: r.events.length,
    money: Object.values(finalStatuses).reduce((n, s) => n + s.carried.cash + s.home.cash + s.market.cash + (s.ground?.cash ?? 0), 0),
    sales: r.events.filter((e) => e.kind === "surplus_sold").length,
    grainSales: r.events.filter((e) => e.kind === "surplus_sold" && e.data.product === "grain").length,
    breadSales: r.events.filter((e) => e.kind === "surplus_sold" && e.data.product === "bread").length,
    directGrainMeals: r.events.filter((e) => e.kind === "ate" && e.data.species === "grain" && e.data.product !== "bread").length,
    loadGoalQuantityMismatches: r.decisions.filter((d) => d.chosen?.kind === "load_grain" &&
      d.response.subjectiveUpdate?.anticipation?.effort?.goal?.kind === "sale" &&
      d.chosen.quantity !== d.response.subjectiveUpdate.anticipation.effort.goal.quantity).length,
    interruptions: r.events.filter((e) => e.kind === "process_interrupted").length,
    setDowns: r.events.filter((e) => e.kind === "item_set_down").length,
    cancelledOffers: r.events.filter((e) => e.kind === "surplus_offer_cancelled").length,
    rejected: r.events.filter((e) => e.kind === "attempt_rejected").length,
    failed: r.events.filter((e) => e.kind === "process_failed").length, people };
});
const text = JSON.stringify({ definition: "Actual saved events. Food gaps include start/end; empty-reserve hours count distinct hourly observations. Learning-off disables new effort/trade model updates only. No counterfactual is inferred from a saved run.", reports }, null, 2) + "\n";
if (output) writeFileSync(output, text); else process.stdout.write(text);
