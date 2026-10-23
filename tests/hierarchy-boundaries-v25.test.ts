import { expect, it } from "vitest";
import { z } from "zod";
import {
  defaultBudget,
  point,
  type Plan,
  type Calls,
  type Definition,
} from "../packages/ai/hierarchy/contracts";
import {
  createPrototypeRegistry,
  prototypeComposition,
} from "../packages/ai/hierarchy/models";
import { DecisionSession } from "../packages/ai/hierarchy/session";
import { newHierarchyState } from "../packages/ai/hierarchy/state";

function register(
  registry: ReturnType<typeof createPrototypeRegistry>,
  id: string,
  run: (calls: Calls) => unknown,
  calls?: Definition["calls"],
) {
  registry.add(
    {
      id,
      role: "evaluator",
      contract: "test",
      projection: "subjective-v1",
      inputs: [],
      outputs: [],
      initial: {},
      learner: null,
      cost: 1,
      ...(calls ? { calls } : {}),
    },
    z.object({}),
    z.unknown(),
    z.object({}),
    (_i, _s, c) => run(c),
  );
}
function session(registry: ReturnType<typeof createPrototypeRegistry>) {
  const composition = registry.compile(prototypeComposition);
  const state = newHierarchyState("F", 1, registry, composition.version);
  return new DecisionSession(registry, state, defaultBudget, composition);
}
const travel = { from: "a", to: "b", distance: 3, mass: 0 };

it("rejects undeclared calls even when the target is cached, before changing provenance or target budget", () => {
  const registry = createPrototypeRegistry();
  register(registry, "unauthorized@1", (calls) =>
    calls.invoke("travel-forward@1", travel),
  );
  const s = session(registry);
  s.invoke("travel-forward@1", travel);
  const refs = structuredClone(s.refs),
    usage = s.usage();
  expect(() => s.invoke("unauthorized@1", {})).toThrow("undeclared model call");
  expect(s.refs).toEqual(refs);
  expect(s.usage()).toEqual(usage);
});

it("allows declared aliases but does not transfer a caller's permissions to its child", () => {
  const registry = createPrototypeRegistry();
  register(registry, "child@1", (calls) =>
    calls.invoke("$travel-prediction", travel),
  );
  register(registry, "parent@1", (calls) => calls.invoke("child@1", {}), [
    { target: "child@1", role: "evaluator", contract: "test" },
    { target: "$travel-prediction", role: "forward", contract: "duration-v1" },
  ]);
  register(
    registry,
    "allowed@1",
    (calls) => calls.invoke("$travel-prediction", travel),
    [
      {
        target: "$travel-prediction",
        role: "forward",
        contract: "duration-v1",
      },
    ],
  );
  const s = session(registry);
  expect(s.invoke("allowed@1", {})).toEqual(
    s.invoke("travel-forward@1", travel),
  );
  expect(() => s.invoke("parent@1", {})).toThrow("undeclared model call");
});

it("rejects incompatible dependencies at compile time and at invocation without compilation", () => {
  const registry = createPrototypeRegistry();
  register(
    registry,
    "wrong-role@1",
    (calls) => calls.invoke("$travel-prediction", travel),
    [
      {
        target: "$travel-prediction",
        role: "control",
        contract: "duration-v1",
      },
    ],
  );
  expect(() => registry.compile(prototypeComposition)).toThrow("call contract");
  const state = newHierarchyState(
    "F",
    1,
    registry,
    prototypeComposition.version,
  );
  const s = new DecisionSession(
    registry,
    state,
    defaultBudget,
    prototypeComposition,
  );
  expect(() => s.invoke("wrong-role@1", {})).toThrow("call contract");
  expect(s.refs).toEqual([]);
});

const context = {
  site: "home",
  cell: { x: 1, y: 2 },
  home: { id: "home", cell: { x: 1, y: 2 } },
  sheltered: true,
  mass: 0,
  maxEnergy: 100,
  hunger: 5,
  meals: 1,
  cash: 99,
  active: null,
  destinations: [],
  body: {
    fatigue01: 0.5,
    cold: 0,
    nutritionNeed01: 0.2,
    energy: 99,
    sleepiness01: 0.3,
    digesting: false,
  },
};
it("projects nested model inputs, removes unrelated information and freezes the result", () => {
  const registry = createPrototypeRegistry([], 2);
  const projected = (id: string, rest = {}) =>
    registry.get(id).project({ context, ...rest }) as {
      context: Record<string, unknown>;
    };
  expect(projected("fallback-local@1").context).toEqual({
    active: null,
    hunger: 5,
    meals: 1,
  });
  const control = projected("travel-control@1", {
    request: { to: "field", cell: { x: 3, y: 2 }, deadline: 60 },
  });
  expect(Object.keys(control.context).sort()).toEqual([
    "active",
    "body",
    "cell",
    "mass",
    "site",
  ]);
  expect(control.context.body).toEqual({ cold: 0, fatigue01: 0.5 });
  expect(() => {
    (control.context.body as { cold: number }).cold = 10;
  }).toThrow();
  expect(projected("recovery-parent@2", { minute: 0 }).context).toEqual({
    site: context.site,
    cell: context.cell,
    active: null,
    destinations: [],
  });
  const parent = projected("food-parent@1", { minute: 0 });
  expect(parent.context).not.toHaveProperty("cash");
  expect(parent.context.body).not.toHaveProperty("energy");
  expect(context.cash).toBe(99);
});

it("rejects an unapproved child named by a plan, even if it is a registered model", () => {
  const registry = createPrototypeRegistry();
  const s = session(registry);
  const plan: Plan = {
    id: "test",
    goalId: "test",
    revision: 1,
    entry: "move",
    nodes: [
      {
        id: "move",
        kind: "delegate",
        model: "food-parent@1",
        request: { to: "field", cell: { x: 3, y: 2 }, deadline: 60 },
        attempt: null,
        duration: 0,
        claims: [],
      },
    ],
    edges: [],
    loops: [],
  };
  const input = {
    plan,
    context,
    start: {
      minute: point(0),
      site: "home",
      cash: 99,
      lots: {},
      capacity: 20,
      occupied: null,
      body: Object.fromEntries(
        Object.entries(context.body).map(([key, value]) => [key, point(value)]),
      ),
    },
  };
  expect(() => s.invoke("compose@1", input)).toThrow("undeclared model call");
  plan.nodes[0].model = "$travel";
  expect(() => s.invoke("compose@1", input)).not.toThrow();
});

it("shares calls on projected inputs without spending budget for unrelated context differences", () => {
  const s = session(createPrototypeRegistry());
  const input = {
    context,
    request: { to: "field", cell: { x: 3, y: 2 }, deadline: 60 },
  };
  const first = s.invoke("$travel", input),
    usage = s.usage();
  expect(
    s.invoke("$travel", {
      ...input,
      context: { ...context, cash: 0, meals: 0 },
    }),
  ).toEqual(first);
  expect(s.usage()).toEqual(usage);
  expect(s.refs).toHaveLength(2);
  expect(s.refs[0]).toEqual(s.refs[1]);
});
