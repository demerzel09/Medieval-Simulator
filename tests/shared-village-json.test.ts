import { expect, it } from "vitest";
import { hash } from "../packages/sim/core";
import { decodeVillageDocument, encodeVillageDocument, hashVillageDocument } from "../packages/sim/shared-village-json";
it("keeps JSON content and the existing hash while sharing repeated snapshot values", () => {
  const memory = { text: "眠気🌙", history: [{ at: 15, sleep: false }, { at: 30, sleep: true }], absent: undefined };
  const input = { people: { memory }, decisions: Array.from({ length: 100 }, () => ({ before: structuredClone(memory), after: structuredClone(memory) })), array: [undefined, null, NaN], empty: {} };
  const packed = encodeVillageDocument(input), output = decodeVillageDocument(JSON.parse(JSON.stringify(packed)));
  expect(output).toEqual(JSON.parse(JSON.stringify(input)));
  expect(hashVillageDocument(input)).toBe(hash(input));
  expect(hashVillageDocument(output as object)).toBe(hash(input));
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(input).length / 4);
});
it("expands mutable saves independently and allows read-only recording references", () => {
  const packed = encodeVillageDocument({ first: { n: 1 }, second: { n: 1 } });
  const live = decodeVillageDocument<{ first: { n: number }; second: { n: number } }>(packed);
  live.first.n = 2; expect(live.second.n).toBe(1);
  const readOnly = decodeVillageDocument<typeof live>(packed, true); expect(readOnly.first).toBe(readOnly.second);
  expect(decodeVillageDocument({ legacy: 2 })).toEqual({ legacy: 2 });
});
it("rejects invalid references and unsupported encodings", () => {
  expect(() => decodeVillageDocument({ encoding: "village-shared-state-v1", root: { ref: 2 }, values: [] })).toThrow("invalid village JSON reference");
  expect(() => decodeVillageDocument({ encoding: "village-shared-state-v1", root: { ref: 0 }, values: [{ loop: { ref: 0 } }] })).toThrow("invalid village JSON reference");
  expect(() => decodeVillageDocument({ encoding: "future" })).toThrow("unsupported village JSON encoding");
});
