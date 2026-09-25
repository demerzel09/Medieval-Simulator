import { validateContent } from "../content/validate";
import { validateEconomyE1 } from "../content/economy-e1";
console.log("Content valid:", validateContent().scenarioId);
console.log("Content valid:", validateEconomyE1().scenarioId);
