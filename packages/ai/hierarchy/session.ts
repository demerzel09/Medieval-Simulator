import {
  Meter,
  frozen,
  key,
  type Budget,
  type Composition,
  type Calls,
  type Ref,
  type Work,
} from "./contracts";
import type { ModelRegistry } from "./registry";
import type { HierarchyState } from "./state";
/** One judgment only; a cached call still contributes provenance to its new consumer. */
export class DecisionSession implements Calls {
  readonly refs: Ref[] = [];
  readonly meter: Meter;
  private cache = new Map<string, { output: unknown; refs: Ref[] }>();
  private depth = 0;
  constructor(
    readonly registry: ModelRegistry,
    private readonly state: HierarchyState,
    budget: Budget,
    private composition?: Composition,
  ) {
    this.meter = new Meter(budget);
  }
  peak(work: Work, value: number) {
    this.meter.peak(work, value);
  }
  limit(work: Work) {
    return this.meter.limit[work];
  }
  take(work: Work, amount = 1) {
    this.meter.take(work, amount);
  }
  invoke<I, O>(id: string, input: I): O {
    id = this.composition?.aliases[id]?.model ?? id;
    const entry = this.registry.get(id),
      saved = this.state.models[id];
    if (!saved) throw Error("model-mismatch: state");
    const cacheKey = key([id, saved.revision, input]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.refs.push(...structuredClone(cached.refs));
      return structuredClone(cached.output) as O;
    }
    const work: Partial<Record<typeof entry.definition.role, Work>> = {
      forward: "forecasts",
      control: "proposals",
      analyzer: "analyses",
      learner: "learningUpdates",
    };
    if (work[entry.definition.role])
      this.take(work[entry.definition.role]!, entry.definition.cost);
    this.depth++;
    const start = this.refs.length;
    try {
      this.meter.depth(this.depth);
      const output = entry.invoke(input, saved.value, this);
      if (entry.definition.role === "forward")
        this.refs.push({
          model: id,
          revision: saved.revision,
          input: structuredClone(input) as Ref["input"],
          output: structuredClone(output) as Ref["output"],
        });
      this.cache.set(cacheKey, {
        output: structuredClone(output),
        refs: structuredClone(this.refs.slice(start)),
      });
      return structuredClone(output) as O;
    } finally {
      this.depth--;
    }
  }
  usage() {
    return { ...this.meter.usage };
  }
}
