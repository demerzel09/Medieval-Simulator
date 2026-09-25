import type { Job, Person, World } from "../contracts";
import content from "../content/scenario.json";
import { validateContent } from "../content/validate";
import { check, hash, random, zero } from "./core";
export function generate(seed = 240924, populations = [600, 400]): World {
  if (
    !Number.isSafeInteger(seed) ||
    populations.length !== 2 ||
    populations.some((n) => !Number.isSafeInteger(n) || n < 10)
  )
    throw Error("invalid scenario");
  validateContent();
  const w: World = {
    schemaVersion: 1,
    engineVersion: "0.1.0",
    contentHash: hash(content),
    seed,
    rng: {},
    minute: 0,
    nextId: 1,
    population: populations[0] + populations[1],
    people: {},
    households: {},
    settlements: {},
    factions: {},
    accounts: {},
    baseline: zero(),
    produced: zero(),
    consumed: zero(),
    queue: [],
    commands: [],
    applied: [],
    events: [],
    messages: [],
    promises: [],
    units: {},
    shipments: [],
    battles: [],
    offers: [],
    treaties: [],
    busyUntil: {},
    victoryEvents: [],
  };
  const places = [
    ["capital", "白鷺の都", "a", 140, 190, "plain"],
    ["farm", "麦穂の村", "a", 280, 370, "plain"],
    ["trade", "川辺の市", "a", 390, 160, "forest"],
    ["pass", "鷹爪の峠", "b", 630, 270, "highland"],
    ["enemy", "ベルの城", "b", 790, 130, "plain"],
  ] as const;
  for (const [id, name, factionId, x, y, terrain] of places)
    w.settlements[id] = { id, name, factionId, x, y, terrain };
  for (let f = 0; f < 2; f++) {
    const factionId = f ? "b" : "a",
      n = populations[f];
    w.factions[factionId] = {
      id: factionId,
      rulerId: `${factionId}_0000`,
      capitalId: f ? "enemy" : "capital",
      cap: f ? 80 : 120,
      tax: 0.1,
      purpose: "defense",
    };
    w.accounts[factionId] = {
      money: n * 30,
      food: n * 5,
      wood: n * 2,
      equipment: (f ? 30 : 40) + 20,
    };
    w.accounts[`loot_${factionId}`] = zero();
    w.accounts[`work_${factionId}`] = {
      money: n * 30,
      food: n * 5,
      wood: 0,
      equipment: 0,
    };
    for (let i = 0; i < n; i++) {
      const id = `${factionId}_${String(i).padStart(4, "0")}`,
        householdId = `h_${factionId}_${Math.floor(i / 4)}`,
        homeId = f
          ? i < n * 0.75
            ? "enemy"
            : "pass"
          : i < n * 0.4
            ? "capital"
            : i < n * 0.7667
              ? "farm"
              : "trade";
      if (!w.households[householdId]) {
        w.households[householdId] = {
          id: householdId,
          factionId,
          homeId,
          memberIds: [],
        };
        w.accounts[householdId] = zero();
      }
      w.households[householdId].memberIds.push(id);
      w.accounts[householdId].money += 40;
      w.accounts[householdId].food += 2;
      w.accounts[id] = zero();
      const job: Job =
        i % 100 < 45
          ? "farmer"
          : i % 100 < 55
            ? "woodworker"
            : i % 100 < 65
              ? "artisan"
              : i % 100 < 75
                ? "trader"
                : "administrator";
      const p: Person = {
        id,
        name: `${f ? "ベル" : "アウル"}・${i + 1}`,
        age: 20 + Math.floor(random(w) * 35),
        alive: true,
        factionId,
        householdId,
        homeId,
        location: homeId,
        job,
        roles: i === 0 ? ["ruler"] : [],
        culture: (["hearth", "honor", "contract"] as const)[i % 3],
        values: {
          family: 0.3 + random(w) * 0.7,
          honor: random(w),
          wealth: random(w),
          safety: random(w),
        },
        trust: { [`${factionId}_0000`]: 0.55 + random(w) * 0.3 },
        health: 1,
        hunger: 0,
        fatigue: 0,
        fear: 0,
        morale: 0.65,
        skill: 20 + Math.floor(random(w) * 60),
        taxCarry: 0,
        knownTax: 0.1,
        memories: [],
        beliefs: [],
        reactions: {},
      };
      w.people[id] = p;
    }
  }
  const names = [
    "君主レオン",
    "古参将軍アルノー",
    "隊長ミラ",
    "商人セラ",
    "地主オスヴァン",
  ];
  names.forEach((name, i) => {
    const p = w.people[`a_${String(i).padStart(4, "0")}`];
    p.name = name;
  });
  w.people.b_0000.name = "ベル領主ラド";
  w.people.a_0001.roles = ["general"];
  w.people.a_0001.culture = "honor";
  w.people.a_0001.skill = 35;
  w.people.a_0001.trust.a_0000 = 0.9;
  w.people.a_0002.roles = ["captain"];
  w.people.a_0002.culture = "hearth";
  w.people.a_0002.skill = 85;
  w.people.a_0002.homeId = "farm";
  w.people.a_0002.values.family = 0.95;
  w.people.a_0003.culture = "contract";
  for (const a of Object.values(w.accounts))
    for (const g of Object.keys(a) as (keyof typeof a)[]) w.baseline[g] += a[g];
  check(w);
  return w;
}
