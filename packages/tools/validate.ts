import { validateContent } from "../content/validate";
import { validateEconomyE1 } from "../content/economy-e1";
import { validateEconomyE1V2 } from "../content/economy-e1-v2";
console.log("Content valid:", validateContent().scenarioId);
console.log("Content valid:", validateEconomyE1().scenarioId);
console.log("Content valid:", validateEconomyE1V2().scenarioId, "v2");
