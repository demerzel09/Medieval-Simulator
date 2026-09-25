import type {
  ActorObservation,
  Person,
  Planner,
  Purpose,
  Response,
} from "../contracts";
export function policyResponse(
  p: Pick<Person, "culture" | "values" | "trust" | "hunger">,
  ruler: string,
  purpose: Purpose,
  burden: number,
  reward = 0,
): { response: Response; score: number } {
  const trust = p.trust[ruler] ?? 0.5;
  const norm =
    p.culture === "hearth"
      ? purpose === "defense"
        ? 0.9
        : -0.6
      : p.culture === "honor"
        ? purpose === "expedition"
          ? 0.7
          : 0.2
        : purpose === "trade"
          ? 0.8
          : -0.2;
  const score =
    0.8 * norm +
    0.6 * (trust - 0.5) +
    reward * trust * (0.4 + p.values.wealth) -
    burden * (0.5 + p.values.family) -
    p.hunger * 0.3;
  return {
    score,
    response:
      score > 0.45
        ? "support"
        : score > 0
          ? "comply"
          : score > -0.25
            ? "bargain"
            : score > -0.5
              ? "delay"
              : p.hunger > 2
                ? "flee"
                : "refuse",
  };
}
// All planners consume an observation, never WorldState. A future provider implements this interface.
export class MockPlanner implements Planner {
  plan(_o: ActorObservation) {
    return [];
  }
}
export class OrdinaryPlanner implements Planner {
  plan(o: ActorObservation) {
    if (o.outcome) return [];
    const field = o.units.find((u) => u.factionId === "b");
    if (
      o.actorId === "b_0000" &&
      field &&
      field.location !== "pass" &&
      !field.destination &&
      field.readyAt <= o.minute
    )
      return [
        {
          kind: "ISSUE_ORDER" as const,
          unitId: field.id,
          intent: "defend" as const,
          destination: "pass",
          fallback: "enemy",
          retreatFood: 1,
        },
      ];
    if (
      o.actorId === "b_0000" &&
      o.day % 7 === 0 &&
      o.treasury.equipment > 0 &&
      o.treasury.money > 1000
    )
      return [
        {
          kind: "RECRUIT" as const,
          count: 5,
          purpose: "defense" as const,
          termDays: 90,
          reward: 0,
        },
      ];
    return [];
  }
}
