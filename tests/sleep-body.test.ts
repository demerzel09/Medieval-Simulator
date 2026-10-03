import { describe, expect, it } from "vitest";
import { advanceSleepQuarter, beginSleep, checkSleepBody, checkSleepConfig, circadianSleep, defaultSleepConfig,
  endSleep, newSleepBody, sleepSignal, type SleepBody } from "../packages/sim/sleep-body";
const config = defaultSleepConfig;
function advance(b: SleepBody, hours: number, energy = 30, cold = 0, rest = false) {
  const events = [];
  for (let i = 0; i < hours * 4; i++) {
    const r = advanceSleepQuarter(b, config, energy, 30, cold, rest); energy = r.energy; events.push(...r.transitions);
  }
  return { energy, events };
}
function actualSleep(b: SleepBody) {
  beginSleep(b); b.mode = "asleep";
}
describe("sleep body: quarter-hour physical regulation", () => {
  it("starts rested and keeps sleep deficit and awake drive zero through 18 hours", () => {
    const b = newSleepBody(config);
    for (const hours of [1, 11, 6]) {
      advance(b, hours);
      expect(sleepSignal(b, config, 30, 30)).toMatchObject({ deficitHours: 0, actualHours: 6, awakeDrive: 0 });
    }
    expect(b.pressure).toBeCloseTo(665241, -1);
    advance(b, 2); expect(sleepSignal(b, config, 30, 30).deficitHours).toBe(2);
    advance(b, 4); expect(sleepSignal(b, config, 30, 30).deficitHours).toBe(6);
  });
  it("keeps the controlled 18 awake / 6 actual sleep cycle stable for 90 days", () => {
    const b = newSleepBody(config);
    for (let day = 0; day < 90; day++) {
      advance(b, 18); actualSleep(b); advance(b, 6);
      if (b.mode !== "awake") endSleep(b, "controlled awakening");
      expect(sleepSignal(b, config, 30, 30)).toMatchObject({ deficitHours: 0, effectiveHours: 6 });
      expect(b.pressure).toBeGreaterThanOrEqual(90028); expect(b.pressure).toBeLessThanOrEqual(90034);
      checkSleepBody(b, (day + 1) * 1440);
    }
    expect(b.totalSleepMinutes).toBe(90 * 360);
  });
  it("uses a smooth independent night drive and lets severe fatigue cause daytime sleepiness", () => {
    const b = newSleepBody(config); advance(b, 12);
    const day = sleepSignal(b, config, 30, 30);
    const nightBody = structuredClone(b); nightBody.minute += 11 * 60;
    nightBody.history.forEach((i) => { i.from += 11 * 60; i.to += 11 * 60; });
    const night = sleepSignal(nightBody, config, 30, 30);
    expect(night.sleepiness).toBeGreaterThan(day.sleepiness);
    expect(sleepSignal(b, config, 0, 30).sleepiness).toBeGreaterThanOrEqual(.6);
    expect(circadianSleep(22 * 60)).toBe(0); expect(circadianSleep(22.5 * 60)).toBe(.5);
    expect(circadianSleep(5.5 * 60)).toBe(.5); expect(circadianSleep(6 * 60)).toBe(0);
  });
  it("enters sleep more easily at night for the same pressure, history and temperature", () => {
    const shifted = (hour: number) => {
      const b = newSleepBody(config); advance(b, 12); b.minute = hour * 60;
      b.history.forEach((i) => { i.from += (hour - 12) * 60; i.to += (hour - 12) * 60; }); beginSleep(b); return b;
    };
    const day = shifted(12), night = shifted(23);
    expect(advance(day, .25).events).toEqual([]);
    expect(advance(night, .25).events[0].kind).toBe("sleep_started");
    expect(night.totalSleepMinutes).toBe(0); expect(night.awakeMinutes).toBe(0);
  });
  it("recovers energy during rest but only actual sleep lowers pressure and adds sleep credit", () => {
    const a = newSleepBody(config); advance(a, 24);
    const b = structuredClone(a), pressure = a.pressure; actualSleep(b);
    const rest = advance(a, 2, 10, 0, true), sleep = advance(b, 2, 10);
    expect(rest.energy).toBe(14); expect(sleep.energy).toBe(14);
    expect(a.pressure).toBeGreaterThan(pressure); expect(b.pressure).toBeLessThan(pressure);
    expect(sleepSignal(a, config, 14, 30).effectiveHours).toBe(0);
    expect(sleepSignal(b, config, 14, 30).effectiveHours).toBe(2);
  });
  it("does not reset pressure after a short nap or credit settling as sleep", () => {
    const b = newSleepBody(config); advance(b, 24); beginSleep(b, b.minute + 75);
    const r = advance(b, 1.25, 20);
    expect(r.events.map((e) => e.kind)).toEqual(["sleep_started", "sleep_woke"]);
    expect(r.events.at(-1)).toMatchObject({ sleepMinutes: 60, waitMinutes: 15, reason: "personal wake reservation" });
    expect(b.totalSleepMinutes).toBe(60); expect(b.pressure).toBeGreaterThan(400000);
    expect(b.awakeMinutes).toBe(0);
  });
  it("ends a failed sleep attempt after two hours with zero actual sleep", () => {
    const b = newSleepBody(config); beginSleep(b);
    const r = advance(b, 2, 20);
    expect(r.events).toMatchObject([{ kind: "sleep_unavailable", sleepMinutes: 0, waitMinutes: 120 }]);
    expect(r.energy).toBe(24); expect(b.mode).toBe("awake"); expect(b.totalSleepMinutes).toBe(0);
  });
  it("requires recovered pressure even when previous sleep still fills the 24h window", () => {
    const b = newSleepBody(config); advance(b, 18); actualSleep(b);
    expect(advance(b, .5).events).toEqual([]); expect(b.mode).toBe("asleep");
    const r = advance(b, 5.5);
    expect(r.events.at(-1)).toMatchObject({ kind: "sleep_woke", reason: "natural awakening", sleepMinutes: 360 });
  });
  it("does not use a depleted fixture's initial pressure as its recovered threshold", () => {
    const altered = { ...config, initialPressure: 900000 };
    const b = newSleepBody(altered); actualSleep(b);
    const events = [];
    for (let i = 0; i < 4; i++) events.push(...advanceSleepQuarter(b, altered, 30, 30, 0).transitions);
    expect(events).toEqual([]); expect(b.mode).toBe("asleep");
  });
  it("counts poor-quality sleep separately and stops credit immediately on cold interruption", () => {
    const b = newSleepBody(config); advance(b, 24); actualSleep(b);
    advance(b, 1, 20, 6);
    expect(sleepSignal(b, config, 20, 30)).toMatchObject({ actualHours: 1, effectiveHours: .75 });
    const r = advance(b, .25, 20, 12);
    expect(r.events[0]).toMatchObject({ kind: "sleep_interrupted", sleepMinutes: 60, effectiveMinutes: 45 });
    expect(b.totalSleepMinutes).toBe(60);
  });
  it("retains split sleep across midnight and rejects gaps or corrupted saves", () => {
    const b = newSleepBody(config); advance(b, 24); actualSleep(b); advance(b, 1); endSleep(b, "nap");
    advance(b, 3); actualSleep(b); advance(b, 2); endSleep(b, "nap");
    expect(sleepSignal(b, config, 30, 30).actualHours).toBe(3);
    const copy = JSON.parse(JSON.stringify(b)); checkSleepBody(copy, b.minute);
    expect(copy).toEqual(b);
    copy.history[0].to--; expect(() => checkSleepBody(copy, b.minute)).toThrow("invalid sleep body");
    expect(() => checkSleepConfig({ ...config, initialHistory: [] })).toThrow("invalid sleep regulation config");
  });
});
