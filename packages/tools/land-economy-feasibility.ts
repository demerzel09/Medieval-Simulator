import { landEconomy90V1 } from "../../fixtures/land-economy-90";
import { assessLandEconomy90 } from "./land-economy-feasibility-model";

const result = assessLandEconomy90(landEconomy90V1);
console.log(JSON.stringify({ ...result, days: process.argv.includes("--daily") ? result.days : undefined,
  firstDay: result.days[0], fourthDay: result.days[3], lastDay: result.days.at(-1) }, null, 2));
