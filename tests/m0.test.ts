import { describe, it, expect } from "vitest";
import { generate } from "../packages/sim/generate";
import { advance, hash, load, save, submit, check } from "../packages/sim/core";
describe("M0 deterministic core", () => {
  it("100 people, 30 days, same seed and command hash", () => {
    const run = () => {
      const w = generate(42, [60, 40]);
      submit(w, "a_0000", { kind: "WAIT", minutes: 10 }, "fixed");
      advance(w, 30 * 1440);
      check(w);
      return w;
    };
    expect(hash(run())).toBe(hash(run()));
    expect(run().minute).toBe(43200);
  });
  it("save resume retains pending queues and RNG", () => {
    const w = generate(3, [60, 40]);
    advance(w, 15 * 1440);
    submit(w, "a_0000", { kind: "WAIT", minutes: 30 });
    const resumed = load(save(w));
    advance(w, 15 * 1440);
    advance(resumed, 15 * 1440);
    expect(resumed).toEqual(w);
  });
  it("rejects malformed, unauthorized and duplicate commands", () => {
    const w = generate();
    expect(submit(w, "a_0000", { kind: "HACK" }).ok).toBe(false);
    expect(
      submit(w, "a_0005", {
        kind: "SET_TAX",
        rate: 0.1,
        amount: 4,
        purpose: "defense",
      }).ok,
    ).toBe(false);
    submit(w, "a_0000", { kind: "WAIT", minutes: 1 }, "once");
    expect(submit(w, "a_0000", { kind: "WAIT", minutes: 1 }, "once").ok).toBe(
      false,
    );
    expect(() => load('{"schemaVersion":99}')).toThrow();
  });
});
