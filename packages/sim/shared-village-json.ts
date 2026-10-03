/** Lossless JSON storage for repeated decision snapshots. The decoded world/record schema is unchanged. */
type Ref = { ref: number };
type Atom = string | number | boolean | null | Ref;
type Entry = Atom[] | Record<string, Atom>;
type SharedDocument = { encoding: "village-shared-state-v1"; root: Atom; values: Entry[] };
export function encodeVillageDocument(value: unknown): SharedDocument {
  const values: Entry[] = [], indices = new Map<string, number>(), active = new Set<object>();
  const visit = (v: unknown): Atom => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "object") throw Error("unsupported village JSON value");
    if (active.has(v)) throw Error("cyclic village JSON value");
    active.add(v);
    const entry: Entry = Array.isArray(v) ? v.map(visit) : Object.fromEntries(Object.entries(v)
      .filter(([, child]) => child !== undefined).map(([key, child]) => [key, visit(child)]));
    const key = JSON.stringify(entry);
    let ref = indices.get(key);
    if (ref === undefined) { ref = values.length; values.push(entry); indices.set(key, ref); }
    active.delete(v); return { ref };
  };
  const root = visit(value);
  return { encoding: "village-shared-state-v1", root, values };
}
/** Shared references are suitable only for a read-only debug recording. Mutable simulation saves expand them. */
export function decodeVillageDocument<T>(input: unknown, readOnly = false): T {
  if (!input || typeof input !== "object" || !("encoding" in input)) return input as T;
  const d = input as SharedDocument;
  if (d.encoding !== "village-shared-state-v1" || !Array.isArray(d.values)) throw Error("unsupported village JSON encoding");
  const cache = new Map<number, unknown>(), active = new Set<number>();
  const visit = (v: Atom): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (!Number.isSafeInteger(v.ref) || v.ref < 0 || v.ref >= d.values.length || Object.keys(v).length !== 1 || active.has(v.ref))
      throw Error("invalid village JSON reference");
    if (readOnly && cache.has(v.ref)) return cache.get(v.ref);
    active.add(v.ref);
    const entry = d.values[v.ref];
    if (!entry || typeof entry !== "object") throw Error("invalid village JSON entry");
    const out = Array.isArray(entry) ? entry.map(visit) : Object.fromEntries(Object.entries(entry).map(([k, child]) => [k, visit(child)]));
    active.delete(v.ref); if (readOnly) cache.set(v.ref, out);
    return out;
  };
  return visit(d.root) as T;
}
/** Stream top-level arrays so a 90-day world never requires one >512 MiB JS string. Same JSON/FNV hash. */
export function hashVillageDocument(value: object) {
  let h = 2166136261;
  const add = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); };
  add("{"); let first = true;
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (!first) add(","); first = false; add(JSON.stringify(key)); add(":");
    if (Array.isArray(v)) {
      add("["); for (let i = 0; i < v.length; i++) { if (i) add(","); add(JSON.stringify(v[i]) ?? "null"); } add("]");
    } else add(JSON.stringify(v));
  }
  add("}"); return (h >>> 0).toString(16).padStart(8, "0");
}
