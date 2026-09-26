import { advanceLocalV2, localV2Summary, newLocalWorldA3Income, submitLocalV2 } from "../sim/local-economy-v2";

const scenario = process.argv[2] ?? "baseline";
if (!["baseline", "buyer-no-money", "farmer-absent"].includes(scenario)) throw Error("unknown scenario");
const daysCount = process.argv.includes("--days") ? Number(process.argv[process.argv.indexOf("--days") + 1]) : 3;
if (!Number.isSafeInteger(daysCount) || daysCount < 1 || daysCount > 90) throw Error("days must be 1..90");
const w = newLocalWorldA3Income();
if (scenario === "buyer-no-money") submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 });
if (scenario === "farmer-absent") submitLocalV2(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 });
const days = [];
let previousProduced = 0, previousConsumed = 0;
for (let day = 1; day <= daysCount; day++) {
  advanceLocalV2(w, 1440);
  days.push({ ...localV2Summary(w),
    producedToday: w.producedFood - previousProduced, consumedToday: w.consumedFood - previousConsumed,
    cartCondition: w.cartCondition,
    unpaidWages: w.wageClaims!.filter((claim) => !claim.paidEventId).reduce((n, claim) => n + claim.amount, 0),
    unpaidDistributions: w.distributionClaims!.filter((claim) => !claim.paidEventId).reduce((n, claim) => n + claim.amount, 0),
    householdHunger: Object.fromEntries(Object.values(w.households).map((household) => [household.id,
      household.memberIds.reduce((n, id) => n + w.people[id].hunger, 0)])),
    farmerEnergy: Object.fromEntries(Object.values(w.people).filter((person) => person.role === "farmer").map((person) => [person.id, person.energy])),
  });
  previousProduced = w.producedFood; previousConsumed = w.consumedFood;
}
console.log(JSON.stringify({ scenario, mode: w.economicMode, days, wageClaims: w.wageClaims!.length,
  paidClaims: w.wageClaims!.filter((claim) => claim.paidEventId).length,
  distributionClaims: w.distributionClaims!.length, paidDistributions: w.distributionClaims!.filter((claim) => claim.paidEventId).length }, null, 2));
