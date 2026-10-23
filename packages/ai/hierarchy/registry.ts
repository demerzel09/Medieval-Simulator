import {
  frozen,
  json,
  key,
  type Calls,
  type Codec,
  type Composition,
  type ControlModel,
  type Definition,
  type ForwardModel,
  type Learner,
  type Evidence,
  type Json,
} from "./contracts";

export type Diagnosis = {
  actualInput: Json;
  observed: Json;
  diagnostic: Json;
  update: Json | null;
};
type Entry = {
  diagnose?: (
    input: unknown,
    output: unknown,
    evidence: Evidence,
    state: unknown,
  ) => Diagnosis;
  definition: Definition;
  project(input: unknown): unknown;
  invoke(input: unknown, state: unknown, calls: Calls): unknown;
  check(state: unknown): void;
};
/** No person state or global service locator. Registration closes over typed implementations. */
export class ModelRegistry {
  private entries = new Map<string, Entry>();
  private sealed = false;
  constructor(
    readonly version: string,
    private projections: readonly string[],
  ) {}
  add<I, O, S>(
    definition: Definition,
    input: Codec<I>,
    output: Codec<O>,
    state: Codec<S>,
    run: (i: Readonly<I>, s: Readonly<S>, c: Calls) => O,
  ) {
    if (this.sealed || this.entries.has(definition.id))
      throw Error("model-mismatch: immutable definition");
    if (
      !/@[1-9][0-9]*$/.test(definition.id) ||
      !this.projections.includes(definition.projection)
    )
      throw Error("missing-projection");
    if (!Number.isSafeInteger(definition.cost) || definition.cost < 1)
      throw Error("contract-violation: model cost");
    json(definition.initial);
    state.parse(definition.initial);
    const project = (value: unknown) => frozen(input.parse(value));
    this.entries.set(definition.id, {
      project,
      definition: frozen(definition) as Definition,
      check: (v) => {
        json(v);
        state.parse(v);
      },
      invoke: (i, s, c) => {
        const value = output.parse(run(project(i), frozen(state.parse(s)), c));
        json(value);
        return value;
      },
    });
    return this;
  }
  forward<I, O, S>(
    d: Definition,
    i: Codec<I>,
    o: Codec<O>,
    s: Codec<S>,
    model: ForwardModel<I, O, S>,
    diagnose?: (input: I, output: O, evidence: Evidence, state: S) => Diagnosis,
  ) {
    if (d.role !== "forward") throw Error("model-mismatch: forward role");
    this.add(d, i, o, s, (input, state, c) => model.predict(input, state, c));
    if (diagnose)
      this.get(d.id).diagnose = (input, output, evidence, state) =>
        diagnose(i.parse(input), o.parse(output), evidence, s.parse(state));
    return this;
  }
  control<I, O, S>(
    d: Definition,
    i: Codec<I>,
    o: Codec<O>,
    s: Codec<S>,
    model: ControlModel<I, O, S>,
  ) {
    if (d.role !== "control" && d.role !== "fallback")
      throw Error("model-mismatch: control role");
    return this.add(d, i, o, s, (input, state, c) =>
      model.propose(input, state, c),
    );
  }
  learner<I, S>(d: Definition, i: Codec<I>, s: Codec<S>, model: Learner<I, S>) {
    if (d.role !== "learner") throw Error("model-mismatch: learner role");
    return this.add(d, i, s, s, (input, state) => model.update(input, state));
  }
  get(id: string) {
    const e = this.entries.get(id);
    if (!e) throw Error(`model-mismatch:${id}`);
    return e;
  }
  definitions() {
    return [...this.entries.values()].map((e) => e.definition);
  }
  compile(composition: Composition) {
    if (composition.registryVersion !== this.version)
      throw Error("model-mismatch: registry version");
    for (const binding of Object.values(composition.aliases))
      if (this.get(binding.model).definition.contract !== binding.contract)
        throw Error("model-mismatch: alias contract");
    for (const id of composition.root)
      if (this.get(id).definition.role !== "control")
        throw Error("model-mismatch: root");
    for (const role of [
      "composer",
      "evaluator",
      "selector",
      "analyzer",
      "fallback",
    ] as const)
      if (this.get(composition[role]).definition.role !== role)
        throw Error(`model-mismatch:${role}`);
    for (const d of this.definitions())
      if (d.learner && this.get(d.learner).definition.role !== "learner")
        throw Error("model-mismatch: learner");
    for (const definition of this.definitions()) {
      for (const permission of definition.calls ?? []) {
        const target = this.get(
          composition.aliases[permission.target]?.model ?? permission.target,
        ).definition;
        if (
          target.role !== permission.role ||
          target.contract !== permission.contract
        )
          throw Error("model-mismatch: call contract");
        if (definition.role === "fallback")
          throw Error("contract-violation: fallback dependencies");
      }
    }
    const graph = new Map<string, string[]>();
    for (const edge of composition.edges) {
      const from = this.get(edge.from).definition,
        to = this.get(edge.to).definition;
      const a = from.outputs.find((p) => p.name === edge.output),
        b = to.inputs.find((p) => p.name === edge.input);
      if (!a || !b) throw Error("unknown-port");
      if (a.quantity !== b.quantity || a.unit !== b.unit)
        throw Error("unit-mismatch");
      if (a.timing !== b.timing) throw Error("timing-mismatch");
      if (a.body && from.role !== "composer" && to.role !== "composer")
        throw Error("body-port-outside-composer");
      const targetPhase = edge.nextPhase ?? edge.phase;
      if (targetPhase < edge.phase) throw Error("cycle-without-loop");
      const source = `${edge.phase}:${edge.from}`,
        target = `${targetPhase}:${edge.to}`;
      graph.set(source, [...(graph.get(source) ?? []), target]);
    }
    const done = new Set<string>(),
      active = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) throw Error("cycle-without-loop");
      if (done.has(id)) return;
      active.add(id);
      for (const next of graph.get(id) ?? []) visit(next);
      active.delete(id);
      done.add(id);
    };
    for (const id of graph.keys()) visit(id);
    for (const entry of this.entries.values()) Object.freeze(entry);
    this.sealed = true;
    return frozen(composition) as Composition;
  }
  fingerprint(id: string) {
    return key(this.get(id).definition);
  }
}
