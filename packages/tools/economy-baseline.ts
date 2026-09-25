import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Good, Job, Stock, World } from "../contracts";
import { check, hash, submit, zero } from "../sim/core";
import { newGame, tick } from "../sim/engine";
import type { Entry } from "../sim/economy";
import content from "../content/scenario.json";

type Path = "idle" | "diplomacy" | "military";
type Case = { seed: number; path: Path };
const cases: Case[] = [
  { seed: 240924, path: "idle" },
  { seed: 42, path: "idle" },
  { seed: 71, path: "idle" },
  { seed: 240924, path: "diplomacy" },
  { seed: 240924, path: "military" },
];
const goods: Good[] = ["money", "food", "wood", "equipment"];
const jobs: Job[] = [
  "farmer",
  "woodworker",
  "artisan",
  "trader",
  "administrator",
];
const add = (a: Stock, b: Stock) => {
  for (const good of goods) a[good] += b[good];
  return a;
};
const delta = (after: Stock, before: Stock): Stock => ({
  money: after.money - before.money,
  food: after.food - before.food,
  wood: after.wood - before.wood,
  equipment: after.equipment - before.equipment,
});
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function accountKind(w: World, id: string) {
  if (id.startsWith("work_")) return "sharedWork";
  if (w.factions[id]) return "treasury";
  if (w.households[id]) return "household";
  if (w.people[id]) return "person";
  if (w.units[id]) return "unit";
  if (id.startsWith("loot_")) return "loot";
  return "other";
}

function snapshot(w: World) {
  const byKind: Record<string, Stock> = {};
  const byFaction: Record<string, { treasury: Stock; sharedWork: Stock }> = {};
  const accountTotal = zero();
  for (const [id, stock] of Object.entries(w.accounts)) {
    add(accountTotal, stock);
    const kind = accountKind(w, id);
    add((byKind[kind] ??= zero()), stock);
  }
  for (const faction of Object.values(w.factions))
    byFaction[faction.id] = {
      treasury: { ...w.accounts[faction.id] },
      sharedWork: { ...w.accounts[`work_${faction.id}`] },
    };
  const households = Object.values(w.households)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => {
      const members = h.memberIds.map((id) => w.people[id]);
      return {
        id: h.id,
        factionId: h.factionId,
        homeId: h.homeId,
        money: w.accounts[h.id].money,
        food: w.accounts[h.id].food,
        aliveMembers: members.filter((p) => p.alive).length,
        civilianMembers: members.filter(
          (p) => p.alive && !p.military && !p.captiveBy,
        ).length,
        hungryAliveMembers: members.filter((p) => p.alive && p.hunger > 0)
          .length,
        hungryCivilianMembers: members.filter(
          (p) => p.alive && !p.military && !p.captiveBy && p.hunger > 0,
        ).length,
      };
    });
  const jobHeadcount = Object.fromEntries(
    jobs.map((job) => [
      job,
      Object.values(w.people).filter((p) => p.alive && p.job === job).length,
    ]),
  ) as Record<Job, number>;
  return {
    minute: w.minute,
    accountTotal,
    byKind,
    byFaction,
    households,
    jobHeadcount,
    alive: Object.values(w.people).filter((p) => p.alive).length,
    military: Object.values(w.people).filter((p) => p.alive && p.military)
      .length,
    hungryAlive: Object.values(w.people).filter(
      (p) => p.alive && p.hunger > 0,
    ).length,
    produced: { ...w.produced },
    consumed: { ...w.consumed },
  };
}

function dailyLedger(ledger: Entry[], w: World) {
  const flows = {
    foodWorkToHouseholds: 0,
    moneyHouseholdsToWork: 0,
    moneyWorkToPeople: 0,
    moneyTreasuryToPeople: 0,
    moneyPeopleToHouseholds: 0,
    moneyPeopleToTreasury: 0,
  };
  for (const [from, to, good, amount] of ledger) {
    if (good === "food" && from.startsWith("work_") && w.households[to])
      flows.foodWorkToHouseholds += amount;
    if (good !== "money") continue;
    if (w.households[from] && to.startsWith("work_"))
      flows.moneyHouseholdsToWork += amount;
    if (from.startsWith("work_") && w.people[to])
      flows.moneyWorkToPeople += amount;
    if (w.factions[from] && w.people[to])
      flows.moneyTreasuryToPeople += amount;
    if (w.people[from] && w.households[to])
      flows.moneyPeopleToHouseholds += amount;
    if (w.people[from] && w.factions[to])
      flows.moneyPeopleToTreasury += amount;
  }
  return flows;
}

function runCase({ seed, path }: Case) {
  const w = newGame(seed);
  if (path === "diplomacy")
    submit(w, "a_0000", {
      kind: "NEGOTIATE",
      amount: 3000,
      nonAggression: true,
      durationDays: 120,
    });
  if (path === "military")
    submit(w, "a_0000", {
      kind: "RECRUIT",
      count: 80,
      purpose: "expedition",
      termDays: 90,
      reward: 20,
    });
  const initial = snapshot(w);
  const days = [];
  let previous = initial;
  let eventCursor = w.events.length;
  let activityCursor = w.activities.length;
  for (let day = 1; day <= 90; day++) {
    tick(w, 1440);
    if (w.minute !== day * 1440)
      throw Error(`case ${seed}/${path} ended before day ${day}`);
    if (path === "military" && day === 1)
      for (const unit of Object.values(w.units).filter(
        (unit) => unit.factionId === "a",
      )) {
        submit(w, "a_0000", {
          kind: "DISPATCH_SUPPLY",
          unitId: unit.id,
          amount: 250,
        });
        submit(w, "a_0000", {
          kind: "ISSUE_ORDER",
          unitId: unit.id,
          intent: "attack",
          destination: "pass",
          fallback: "capital",
          retreatFood: 0,
        });
      }
    const events = w.events.slice(eventCursor);
    const economy = events.filter((e) => e.kind === "economy");
    if (economy.length !== 1)
      throw Error(`expected one economy event on day ${day}`);
    const ledger = economy[0].data.ledger as Entry[];
    const unpaid = economy[0].data.unpaid as Record<string, number>;
    const activityKinds: Record<string, number> = {};
    const hungryByActivityKind: Record<string, number> = {};
    const activityJobs = Object.fromEntries(jobs.map((job) => [job, 0])) as
      Record<Job, number>;
    for (const activity of w.activities.slice(activityCursor)) {
      activityKinds[activity.kind] = (activityKinds[activity.kind] ?? 0) + 1;
      if (w.people[activity.personId].hunger > 0)
        hungryByActivityKind[activity.kind] =
          (hungryByActivityKind[activity.kind] ?? 0) + 1;
      if (activity.kind === "work")
        activityJobs[w.people[activity.personId].job]++;
    }
    const current = snapshot(w);
    days.push({
      day,
      ...current,
      dailyProduced: delta(current.produced, previous.produced),
      dailyConsumed: delta(current.consumed, previous.consumed),
      economyProduction: economy[0].data.production,
      economyLedgerFlows: dailyLedger(ledger, w),
      unpaidPeopleReported: Object.keys(unpaid).length,
      unpaidAmountReported: sum(Object.values(unpaid)),
      activityKinds,
      hungryByActivityKind,
      activityJobs,
    });
    previous = current;
    eventCursor = w.events.length;
    activityCursor = w.activities.length;
  }
  check(w);
  const last = days.at(-1)!;
  const window = days.slice(30);
  return {
    seed,
    path,
    engineVersion: w.engineVersion,
    contentHash: w.contentHash,
    externalCommands: w.commands.filter((c) => c.origin !== "ordinary_ai"),
    initial,
    days,
    summary: {
      seed,
      path,
      finalWorldHash: hash(w),
      outcome: w.outcome,
      day: w.minute / 1440,
      population: w.population,
      alive: last.alive,
      cumulativeProduced: last.produced,
      cumulativeConsumed: last.consumed,
      sharedWorkEnd: Object.fromEntries(
        Object.entries(last.byFaction).map(([id, value]) => [
          id,
          value.sharedWork,
        ]),
      ),
      treasuryEnd: last.byKind.treasury,
      personalAccountsEnd: last.byKind.person,
      householdsEnd: {
        money: sum(last.households.map((h) => h.money)),
        food: sum(last.households.map((h) => h.food)),
        hungryCivilianMembers: sum(
          last.households.map((h) => h.hungryCivilianMembers),
        ),
        withHungryCivilian: last.households.filter(
          (h) => h.hungryCivilianMembers > 0,
        ).length,
      },
      days31to90: {
        foodProduced: sum(window.map((d) => d.dailyProduced.food)),
        foodConsumed: sum(window.map((d) => d.dailyConsumed.food)),
        foodWorkToHouseholds: sum(
          window.map((d) => d.economyLedgerFlows.foodWorkToHouseholds),
        ),
        moneyHouseholdsToWork: sum(
          window.map((d) => d.economyLedgerFlows.moneyHouseholdsToWork),
        ),
        equipmentProduced: sum(window.map((d) => d.dailyProduced.equipment)),
        equipmentConsumed: sum(window.map((d) => d.dailyConsumed.equipment)),
        daysWithHungryAlive: window.filter((d) => d.hungryAlive > 0).length,
        hungryMilitaryActivityPersonDays: sum(
          window.map((d) => d.hungryByActivityKind.military ?? 0),
        ),
        hungryNonMilitaryActivityPersonDays: sum(
          window.map((d) =>
            Object.entries(d.hungryByActivityKind)
              .filter(([kind]) => kind !== "military")
              .reduce((n, [, count]) => n + count, 0),
          ),
        ),
        unpaidPersonDaysReported: sum(
          window.map((d) => d.unpaidPeopleReported),
        ),
      },
    },
  };
}

const runs = cases.map(runCase);
const artifact = {
  formatVersion: 1,
  scenarioId: content.scenarioId,
  engineVersion: runs[0].engineVersion,
  contentHash: runs[0].contentHash,
  periodDays: 90,
  sampling: "end of each simulated day; day 0 after newGame initial recruitment",
  cases,
  limitations: [
    "Job headcount and Activity(work) are labels, not measured work time.",
    "Account stocks have no physical location.",
    "Economy ledger flows cover dailyEconomy only; account snapshots cover all transfers.",
    "Unpaid reports are daily shortfalls, not a persisted debt ledger.",
    "Day 90 demobilization follows the economy event, so end-of-day military status differs from the activity/feeding cohort.",
  ],
  runs,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/economy-e0.json.gz",
  gzipSync(JSON.stringify(artifact)),
);
const summary = {
  formatVersion: artifact.formatVersion,
  scenarioId: artifact.scenarioId,
  engineVersion: artifact.engineVersion,
  contentHash: artifact.contentHash,
  periodDays: artifact.periodDays,
  cases: runs.map((run) => run.summary),
  limitations: artifact.limitations,
};
writeFileSync(
  "artifacts/economy-e0-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
