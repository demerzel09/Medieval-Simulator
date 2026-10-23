import { frozen } from "./contracts";
import { ExecutionState, type Choice, type HierarchyState } from "./state";

/** Owns choice/failure records; callers cannot retain a mutable record reference. */
export class DecisionHistory {
  constructor(private readonly state: HierarchyState) {}
  record(
    choice: Omit<
      Choice,
      "id" | "policyRevision" | "modelRevisions" | "rngDraws"
    >,
  ) {
    const entry: Choice = {
      id: new ExecutionState(this.state).id("choice"),
      minute: choice.minute,
      source: choice.source,
      chosen: choice.chosen,
      candidates: structuredClone(choice.candidates),
      basis: choice.basis,
      policyRevision: this.state.policyRevision,
      modelRevisions: Object.fromEntries(
        Object.entries(this.state.models).map(([id, model]) => [
          id,
          model.revision,
        ]),
      ),
      rngDraws: 0,
      usage: { ...choice.usage },
      exhausted: choice.exhausted,
    };
    this.state.choices.push(entry);
    return frozen(entry);
  }
  fail(failure: HierarchyState["failures"][number]) {
    this.state.failures.push({ ...failure });
  }
  retain(choices: number, failures: number) {
    this.state.choices = this.state.choices.slice(-choices);
    this.state.failures = this.state.failures.slice(-failures);
  }
}
