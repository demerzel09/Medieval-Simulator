/// <reference types="vite/client" />
// 骨格の記録の画面。v24・v25 の画面（village-debug）と同じ配置と見た目で、骨格の記録（設定・初期状態・記録）を再生して見せる。
// 世界の進行には触らない。画面は記録から任意の時刻の世界を作り直すだけで、物の描き分けは札（area・bears・stores・mind・attachedTo）で決める。
import { useEffect, useMemo, useRef, useState } from "react";
import { DAY, World, inSeason, predict, replayRecording } from "../../packages/skeleton/index";
import type { LedgerEntry, Recording, Relation, ScenarioConfig, ThingSnapshot, WorldState } from "../../packages/skeleton/index";
import type { SkeletonWorkerResponse } from "./skeleton-worker";

const scenarioFiles = import.meta.glob("../../scenarios/*.json", { eager: true, import: "default" }) as Record<string, ScenarioConfig>;
const scenarios = Object.fromEntries(Object.entries(scenarioFiles).map(([path, c]) => [c.name ?? path.replace(/^.*\//, "").replace(/\.json$/, ""), c]));
const query = new URLSearchParams(window.location.search);
const firstScenario = query.get("skeleton") && scenarios[query.get("skeleton")!] ? query.get("skeleton")! : Object.keys(scenarios).includes("season-forest") ? "season-forest" : Object.keys(scenarios)[0] ?? "";

const lawNames: Record<string, string> = {
  walk: "歩く", pick: "採る", stow: "しまう", give: "渡す", eat: "食べる", digest: "消化", wear: "消耗", starve: "飢え死に",
  ripen: "実る", rot: "腐る", settle: "住む", process: "加工", wither: "枯れる", sow: "種から生える", seed: "初期配置",
};
const eventNames: Record<string, string> = { appear: "現れた", vanish: "消えた", intend: "意図" };
const intentNames: Record<string, string> = { move: "移動", pick: "採る", eat: "食べる", idle: "待つ", settle: "住む", stow: "しまう", give: "渡す", process: "加工", none: "なし" };
const kindColors: Record<string, string> = { treeA: "#e0b24f", treeB: "#d07aa0", treeC: "#79b4e3", tree: "#8fc27a", field: "#b89b5e" };
const mindColors: Record<string, string> = { patroller: "#f4ead2", forager: "#e8cc91" };
const W = 1280;
const H = 768;

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const clock = (minutes: number) => {
  const day = Math.floor(minutes / 1440) + 1;
  const m = Math.round(minutes - (day - 1) * 1440);
  return `${day}日目 ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) >= 100 ? 0 : 2)) : String(v));
const has = (t: ThingSnapshot, a: string) => a in t.attr;
const involves = (e: LedgerEntry, id: string) =>
  "law" in e ? e.a === id || e.b === id || ("thing" in e.effect && e.effect.thing === id) : e.person === id || ("about" in e && e.about === id);

/** 心を持つ物の通った道。初期位置に、記録の「歩く」の流れ（実際に動いた割合を掛けた移動）を足していく。 */
function trailsOf(rec: Recording): Map<string, { t: number; x: number; y: number }[]> {
  const out = new Map<string, { t: number; x: number; y: number }[]>();
  for (const t of rec.initial.things) if (typeof t.attr["mind"] === "string" && typeof t.state["x"] === "number") out.set(t.id, [{ t: rec.initial.now, x: t.state["x"] as number, y: num(t.state["y"]) }]);
  for (const e of rec.ledger) {
    if (!("law" in e) || e.effect.kind !== "move") continue;
    const path = out.get(e.effect.thing);
    if (!path) continue;
    const full = Math.hypot(e.effect.dx, e.effect.dy);
    const ratio = full > 0 ? e.applied / full : 0;
    const last = path[path.length - 1]!;
    path.push({ t: e.at + rec.dt, x: last.x + e.effect.dx * ratio, y: last.y + e.effect.dy * ratio });
  }
  return out;
}

/** 地図の範囲: 初めの物の位置と、通った道のすべて。 */
function boundsOf(rec: Recording, trails: ReturnType<typeof trailsOf>) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of rec.initial.things) if (typeof t.state["x"] === "number") { xs.push(t.state["x"] as number); ys.push(num(t.state["y"])); }
  for (const p of trails.values()) for (const q of p) { xs.push(q.x); ys.push(q.y); }
  if (!xs.length) return { minX: -50, maxX: 50, minY: -50, maxY: 50 };
  const pad = 25;
  return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
}

type View = { things: ThingSnapshot[]; now: number };
type Bounds = ReturnType<typeof boundsOf>;

function projector(b: Bounds) {
  const scale = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY));
  const ox = (W - (b.maxX - b.minX) * scale) / 2;
  const oy = (H - (b.maxY - b.minY) * scale) / 2;
  return { scale, x: (x: number) => ox + (x - b.minX) * scale, y: (y: number) => oy + (b.maxY - y) * scale, inv: (px: number, py: number) => ({ x: (px - ox) / scale + b.minX, y: b.maxY - (py - oy) / scale }) };
}

function drawMap(canvas: HTMLCanvasElement, view: View, bounds: Bounds, trails: ReturnType<typeof trailsOf>, selected: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const p = projector(bounds);
  ctx.fillStyle = "#496347";
  ctx.fillRect(0, 0, W, H);
  const step = p.scale * 10 >= 24 ? 10 : 50;
  ctx.strokeStyle = "rgba(16,32,24,.34)";
  ctx.lineWidth = 1;
  for (let gx = Math.ceil(bounds.minX / step) * step; gx <= bounds.maxX; gx += step) { ctx.beginPath(); ctx.moveTo(p.x(gx) + .5, 0); ctx.lineTo(p.x(gx) + .5, H); ctx.stroke(); }
  for (let gy = Math.ceil(bounds.minY / step) * step; gy <= bounds.maxY; gy += step) { ctx.beginPath(); ctx.moveTo(0, p.y(gy) + .5); ctx.lineTo(W, p.y(gy) + .5); ctx.stroke(); }
  ctx.fillStyle = "rgba(232,240,226,.7)";
  ctx.font = "11px sans-serif";
  ctx.fillText(`格子 ${step}m`, 8, H - 8);
  const pos = (t: ThingSnapshot) => (typeof t.state["x"] === "number" ? { x: p.x(t.state["x"] as number), y: p.y(num(t.state["y"])) } : undefined);
  const byId = new Map(view.things.map((t) => [t.id, t]));
  const attachedCount = new Map<string, number>();
  for (const t of view.things) {
    const at = t.state["attachedTo"];
    if (typeof at === "string" && at) attachedCount.set(at, (attachedCount.get(at) ?? 0) + 1);
  }
  // 森（広がり）
  for (const t of view.things.filter((t) => has(t, "area"))) {
    const q = pos(t);
    if (!q) continue;
    ctx.fillStyle = "rgba(37,74,48,.85)";
    ctx.beginPath(); ctx.arc(q.x, q.y, num(t.attr["area"]) * p.scale, 0, Math.PI * 2); ctx.fill();
  }
  // 木・畑（実を付ける物）。時期の内は塗り、外は輪だけ。付いている実の数を点で。
  for (const t of view.things.filter((t) => typeof t.attr["bears"] === "string")) {
    const q = pos(t);
    if (!q) continue;
    const color = kindColors[t.kind] ?? "#8fc27a";
    const r = Math.max(4, Math.min(9, num(t.attr["canopy"], 6) * p.scale * .35));
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    if (inSeason(t, view.now)) ctx.fill(); else ctx.stroke();
    const n = attachedCount.get(t.id) ?? 0;
    ctx.fillStyle = "#f6e27a";
    for (let i = 0; i < Math.min(n, 12); i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(q.x + Math.cos(a) * (r + 4), q.y + Math.sin(a) * (r + 4), 1.8, 0, Math.PI * 2); ctx.fill();
    }
    if (t.id === selected) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, num(t.attr["canopy"], 0) * p.scale, 0, Math.PI * 2); ctx.stroke(); }
  }
  // 家・炉（置ける物、加工の場）
  for (const t of view.things.filter((t) => has(t, "stores") || has(t, "hearth"))) {
    const q = pos(t);
    if (!q) continue;
    ctx.fillStyle = has(t, "hearth") ? "#b5653b" : "#8b7658";
    ctx.fillRect(q.x - 7, q.y - 7, 14, 14);
    const n = attachedCount.get(t.id) ?? 0;
    if (n) { ctx.fillStyle = "#f6e27a"; ctx.fillText(String(n), q.x + 9, q.y + 4); }
  }
  // 選んだ人の通った道（直近 1 日）・視界・行き先
  const sel = byId.get(selected);
  const trail = trails.get(selected);
  if (trail) {
    ctx.strokeStyle = "rgba(255,244,214,.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const q of trail) {
      if (q.t > view.now || q.t < view.now - DAY) continue;
      if (!started) { ctx.moveTo(p.x(q.x), p.y(q.y)); started = true; } else ctx.lineTo(p.x(q.x), p.y(q.y));
    }
    if (sel && pos(sel)) ctx.lineTo(pos(sel)!.x, pos(sel)!.y);
    ctx.stroke();
  }
  if (sel && pos(sel) && typeof sel.attr["mind"] === "string") {
    const q = pos(sel)!;
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(q.x, q.y, num(sel.attr["sight"]) * p.scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (sel.state["intent"] === "move") {
      const target = byId.get(String(sel.state["target"] ?? ""));
      const to = target && pos(target) ? pos(target)! : { x: p.x(num(sel.state["targetX"])), y: p.y(num(sel.state["targetY"])) };
      ctx.strokeStyle = "rgba(240,212,153,.8)";
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
  }
  // 人（心を持つ物）
  for (const t of view.things.filter((t) => typeof t.attr["mind"] === "string")) {
    const q = pos(t);
    if (!q) continue;
    const alive = t.state["alive"] !== "no";
    ctx.fillStyle = alive ? mindColors[String(t.attr["mind"])] ?? "#e8cc91" : "#6b706e";
    ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.id === selected ? "#ff6b4a" : "#1d2a22";
    ctx.lineWidth = t.id === selected ? 3 : 1.5;
    ctx.stroke();
    ctx.fillStyle = "#f2f2ea";
    ctx.fillText(`${t.id}${alive ? "" : " ×"}`, q.x + 8, q.y - 6);
    const n = attachedCount.get(t.id) ?? 0;
    if (n) { ctx.fillStyle = "#f6e27a"; ctx.fillText(`実${n}`, q.x + 8, q.y + 8); }
  }
}

/** 巡回者の見込みの表: 種類の見込み（fc）と、木ごとのずれ（dv。種類ごとに畳む）、いまの見込み。 */
function ForecastTable({ self, now }: { self: ThingSnapshot; now: number }) {
  const bins = Math.max(1, Math.round(num(self.attr["bins"], 1)));
  const cal = num(self.attr["calendar"], 1) || 1;
  const current = Math.min(bins - 1, Math.floor(((now % cal) / cal) * bins));
  const kinds = Object.entries(self.rel).filter(([k]) => k.startsWith("kind:")).sort(([a], [b]) => (a < b ? -1 : 1));
  const trees = Object.entries(self.rel).filter(([, e]) => "bears" in e).sort(([a], [b]) => (a < b ? -1 : 1));
  const treeKinds = [...new Set(trees.map(([, e]) => String(e["kind"])))].sort();
  const cell = { padding: "1px 3px", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const, whiteSpace: "nowrap" as const };
  const cells = (e: Relation | undefined, key: string) => Array.from({ length: bins }, (_, b) => {
    const v = e?.[`${key}${b}`];
    return <td key={b} style={{ ...cell, ...(b === current ? { background: "#3b5a40" } : {}) }}>{typeof v === "number" ? v.toFixed(1) : "·"}</td>;
  });
  const head = <thead><tr><th style={cell}>相手</th>{Array.from({ length: bins }, (_, b) => <th key={b} style={cell}>{b + 1}</th>)}<th style={cell}>いま</th></tr></thead>;
  return <section className="village-status-card" aria-label="見込みの表" style={{ marginTop: 6 }}>
    <h3>見込みの表（一年 {bins} 区間、いまは {current + 1} 番目）</h3>
    <small>種類の行は種類の見込み fc。木の行はその木のずれ dv で、いまの見込みは 種類 + ずれ + 直近の観察のずれ。</small>
    <table className="village-log-table" style={{ fontSize: 11 }}>{head}<tbody>
      {kinds.map(([k, e]) => <tr key={k}><td style={cell}><b>{k.slice(5)}</b></td>{cells(e, "fc")}<td style={cell}></td></tr>)}
    </tbody></table>
    {treeKinds.map((kind) => {
      const rows = trees.filter(([, e]) => String(e["kind"]) === kind);
      return <details key={kind}><summary>{kind} の木 {rows.length} 本（ずれ dv と、いまの見込み）</summary>
        <table className="village-log-table" style={{ fontSize: 11 }}>{head}<tbody>
          {rows.map(([id, e]) => <tr key={id}><td style={cell}>{id}{typeof e["visits"] === "number" ? ` (${e["visits"]}回)` : ""}</td>{cells(e, "dv")}<td style={cell}>{predict(self, e, now).toFixed(2)}</td></tr>)}
        </tbody></table></details>;
    })}
  </section>;
}

function ValueCard({ title, values }: { title: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (!entries.length) return null;
  return <section className="village-status-card"><h3>{title}</h3>
    <dl className="village-status-values">{entries.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{fmt(v)}</dd></div>)}</dl></section>;
}

export default function SkeletonViewer() {
  const [scenarioName, setScenarioName] = useState(firstScenario);
  const [days, setDays] = useState(() => scenarios[firstScenario]?.world?.days ?? 30);
  const [rec, setRec] = useState<Recording>();
  const [checkpoints, setCheckpoints] = useState<{ t: number; state: WorldState }[]>([]);
  const [verified, setVerified] = useState<{ replay: boolean; registry: string[] }>();
  const [elapsed, setElapsed] = useState<{ run: number; replay: number }>();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [stepMinutes, setStepMinutes] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const liveRef = useRef<World | undefined>(undefined);

  const start = (message: { type: "run"; config: ScenarioConfig; days: number } | { type: "open"; recording: Recording }) => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./skeleton-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setError(""); setPlaying(false); setRec(undefined); liveRef.current = undefined;
    const totalDays = message.type === "run" ? message.days : message.recording.until / DAY;
    const every = Math.max(60, Math.ceil((totalDays * 1440) / 150 / 60) * 60); // 写しは 150 枚ほど
    worker.onmessage = ({ data }: MessageEvent<SkeletonWorkerResponse>) => {
      if (data.type === "progress") setProgress(`${data.phase === "run" ? "走らせています" : "再生して写しを取っています"} ${clock(data.done)} / ${(data.total / DAY).toFixed(0)}日`);
      else if (data.type === "error") { setError(data.message); setProgress(""); }
      else {
        setRec(data.recording); setCheckpoints(data.checkpoints); setVerified(data.verified); setElapsed(data.elapsed); setProgress("");
        setCursor(0);
        const first = data.recording.initial.things.find((t) => typeof t.attr["mind"] === "string");
        setSelected((s) => (data.recording.initial.things.some((t) => t.id === s) ? s : first?.id ?? ""));
        worker.terminate();
      }
    };
    worker.postMessage({ ...message, every });
  };
  useEffect(() => { if (scenarios[firstScenario]) start({ type: "run", config: scenarios[firstScenario]!, days }); return () => workerRef.current?.terminate(); }, []);

  const until = rec?.until ?? 0;
  useEffect(() => {
    if (!playing || !rec || cursor >= until) return;
    const timer = window.setInterval(() => setCursor((c) => Math.min(until, c + stepMinutes)), speed === 4 ? 100 : 400);
    return () => window.clearInterval(timer);
  }, [playing, rec, stepMinutes, speed, cursor >= until]);
  useEffect(() => { if (cursor >= until) setPlaying(false); }, [cursor, until]);

  const trails = useMemo(() => (rec ? trailsOf(rec) : new Map()), [rec]);
  const bounds = useMemo(() => (rec ? boundsOf(rec, trails) : { minX: -50, maxX: 50, minY: -50, maxY: 50 }), [rec, trails]);

  /** 時刻 cursor の世界。進むときは表示中の世界を記録で進め、戻るか大きく飛ぶときは直前の写しから再生する。 */
  const view = useMemo<View | undefined>(() => {
    if (!rec || !checkpoints.length) return undefined;
    const cp = [...checkpoints].reverse().find((c) => c.t <= cursor) ?? checkpoints[0]!;
    let w = liveRef.current;
    if (!w || w.now > cursor + 1e-9 || cp.t > w.now + 1e-9) w = replayRecording(rec, cursor, cp.state);
    else w.replay(rec.ledger, rec.dt, cursor);
    liveRef.current = w;
    return { things: w.query(() => true), now: w.now };
  }, [rec, checkpoints, cursor]);

  useEffect(() => { if (canvasRef.current && view) drawMap(canvasRef.current, view, bounds, trails, selected); }, [view, bounds, trails, selected]);

  const upTo = useMemo(() => (rec ? rec.ledger.filter((e) => e.at < cursor) : []), [rec, cursor]);
  const stats = useMemo(() => {
    const count = (law: string, kind?: string) => upTo.filter((e) => "law" in e && e.law === law && (!kind || e.effect.kind === kind)).length;
    return { eaten: count("eat"), died: count("starve"), born: count("sow"), withered: count("wither"), ripened: count("ripen", "spawn") };
  }, [upTo]);

  if (error) return <div className="e1-debug village-debug"><p role="alert">エラー: {error}</p></div>;
  const things = view?.things ?? [];
  const byId = new Map(things.map((t) => [t.id, t]));
  const minded = things.filter((t) => typeof t.attr["mind"] === "string");
  const trees = things.filter((t) => typeof t.attr["bears"] === "string");
  const self = byId.get(selected);
  const day = Math.floor(cursor / 1440) + 1;
  const dayStart = (day - 1) * 1440;
  const dayEvents = selected ? upTo.filter((e) => e.at >= dayStart && involves(e, selected)) : [];
  const held = self ? things.filter((t) => t.state["attachedTo"] === self.id) : [];
  const heldByKind = held.reduce<Record<string, number>>((m, t) => ({ ...m, [t.kind]: (m[t.kind] ?? 0) + 1 }), {});
  const { x: _x, y: _y, ...otherState } = self?.state ?? {};
  void _x; void _y;

  const openFile = async (file: File) => {
    const stream = file.name.endsWith(".gz") ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream();
    const recording = JSON.parse(await new Response(stream).text()) as Recording;
    if (recording.format !== "skeleton-recording/1") { setError(`記録の形式が違います: ${String(recording.format)}`); return; }
    start({ type: "open", recording });
  };
  const saveFile = async () => {
    if (!rec) return;
    const blob = await new Response(new Blob([JSON.stringify(rec)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${rec.scenario.name ?? "skeleton"}-${rec.until / DAY}d.recording.json.gz`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return <div className="e1-debug village-debug">
    <header className="e1-top"><div><h1>骨格 · {rec?.scenario.name ?? scenarioName}</h1></div><div>
      <label>設定 <select aria-label="設定のファイル" value={scenarioName} onChange={(e) => { setScenarioName(e.target.value); setDays(scenarios[e.target.value]?.world?.days ?? 30); }}>
        {Object.keys(scenarios).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>{" "}
      <label>日数 <input aria-label="走らせる日数" type="number" min={1} max={365} value={days} style={{ width: 56 }} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} /></label>{" "}
      <button onClick={() => scenarios[scenarioName] && start({ type: "run", config: scenarios[scenarioName]!, days })} disabled={!!progress}>走らせる</button>{" "}
      <label>記録のファイルを開く <input type="file" accept=".json,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); }} /></label>{" "}
      <button onClick={() => void saveFile()} disabled={!rec}>記録を保存</button>{" "}
      <a href="/?village=land-economy&wood=acquisition">v24 の画面</a></div></header>
    {progress && <p role="status">{progress}</p>}
    {rec && <details className="village-specification" role="note">
      <summary>記録の条件・仕様 <span>{rec.scenario.description ?? ""}</span></summary>
      <p className="e1-map-panel">部品の組 {rec.registry.modules.join("・")} · 一刻み {rec.dt}分 · {rec.until / DAY}日 · 初めの物 {rec.initial.things.length} · 記録 {rec.ledger.length.toLocaleString()}件
        {elapsed && (elapsed.run > 0 ? ` · 走らせる ${(elapsed.run / 1000).toFixed(1)}秒・再生 ${(elapsed.replay / 1000).toFixed(1)}秒` : ` · 記録のファイルから開いた · 再生 ${(elapsed.replay / 1000).toFixed(1)}秒`)}</p>
      <p className="e1-map-panel">再生の検証: {verified?.replay ? "記録から再生した最後の状態は、記録の最後の状態と同じ" : "記録の最後の状態と違う"} · 部品の版: {verified && verified.registry.length === 0 ? "いまのコードと同じ" : verified?.registry.join(", ")}</p>
      <p className="e1-map-panel">法則 {rec.registry.laws.map((l) => `${lawNames[l.id] ?? l.id}（${l.id}@${l.version}）`).join("、")} · 感覚 {rec.registry.senses.map((s) => `${s.id}@${s.version}`).join("、")} · 記憶の規則 {rec.registry.memories.map((s) => `${s.id}@${s.version}`).join("、") || "なし"} · 心 {rec.registry.minds.join("、")}</p>
    </details>}
    <div className="e1-controls"><label>日 <input aria-label="日" type="range" min="1" max={Math.max(1, until / 1440)} value={day}
      onChange={(e) => { setPlaying(false); setCursor(Math.min(until, (Number(e.target.value) - 1) * 1440 + (cursor % 1440))); }} /></label>
      <button onClick={() => { setPlaying(false); setCursor(Math.max(0, cursor - 1440)); }}>−1日</button>
      <button onClick={() => { setPlaying(false); setCursor(Math.min(until, cursor + 1440)); }}>＋1日</button>
      <label>時刻 <input aria-label="時刻" type="range" min="0" max="1430" step="10" value={cursor % 1440}
        onChange={(e) => { setPlaying(false); setCursor(Math.min(until, dayStart + Number(e.target.value))); }} /></label>
      <strong aria-live="polite">{clock(cursor)}</strong>
      <label>刻み <select aria-label="刻み" value={stepMinutes} onChange={(e) => setStepMinutes(Number(e.target.value))}>
        <option value="10">10分</option><option value="60">1時間</option><option value="360">6時間</option><option value="1440">1日</option></select></label>
      <button onClick={() => { setPlaying(false); setCursor(Math.min(until, cursor + stepMinutes)); }} disabled={cursor >= until}>＋1刻み</button>
      <button onClick={() => { setSpeed(1); setPlaying(true); }} disabled={cursor >= until}>再生</button>
      <button onClick={() => setPlaying(false)} disabled={!playing}>停止</button>
      <button onClick={() => { setSpeed(4); setPlaying(true); }} disabled={cursor >= until}>早送り ×4</button>
      <span role="status">{playing ? (speed === 4 ? "早送り中" : "再生中") : "停止中"}</span></div>
    <div className="e1-stats">
      <span>生きている人 <b>{minded.filter((t) => t.state["alive"] !== "no").length}/{minded.length}</b></span>
      <span>木 <b>{trees.length}</b>{" "}{["treeA", "treeB", "treeC"].map((k) => { const n = trees.filter((t) => t.kind === k).length; return n ? <span key={k}> {k.slice(4)}:{n}</span> : null; })}</span>
      <span>実っている木 <b>{trees.filter((t) => view && inSeason(t, view.now)).length}</b></span>
      <span>実 <b>{things.filter((t) => has(t, "edible")).length}</b></span>
      <span>実った <b>{stats.ripened}</b></span><span>食べた <b>{stats.eaten}</b></span>
      <span>種から生えた木 <b>{stats.born}</b></span><span>枯れた木 <b>{stats.withered}</b></span><span>死 <b>{stats.died}</b></span></div>
    <main className="e1-layout village-resizable-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 12px 640px" }}>
      <section className="e1-map-panel">
        <div className="village-canvas-scroll"><canvas ref={canvasRef} width={W} height={H} role="img" aria-label="骨格の世界の地図"
          onClick={(event) => {
            if (!view) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const px = (event.clientX - rect.left) / rect.width * W;
            const py = (event.clientY - rect.top) / rect.height * H;
            const pr = projector(bounds);
            const near = view.things.filter((t) => typeof t.state["x"] === "number")
              .map((t) => ({ t, d: Math.hypot(pr.x(t.state["x"] as number) - px, pr.y(num(t.state["y"])) - py) - (typeof t.attr["mind"] === "string" ? 6 : 0) - (has(t, "area") ? -10 : 0) }))
              .sort((a, b) => a.d - b.d)[0];
            if (near && near.d < 16) setSelected(near.t.id);
          }} /></div>
        <p className="e1-legend">北が上 · 森は濃い緑の円 · 木は種類で色分け（A 黄・B 桃・C 青。塗りは実る時期、輪は時期の外）· 黄の点は付いている実 · 四角は家 · 丸は人（選んだ人は赤い縁、点線は視界、線は行き先、薄い線は直近 1 日の道）· 物をクリックで詳細</p>
      </section>
      <div className="village-divider" aria-hidden="true" />
      <aside className="e1-detail village-side" aria-label="物の値と記録">
        <div className="village-side-selectors">
          <label>物 <select aria-label="物" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {[...minded, ...(self && !minded.includes(self) ? [self] : [])].map((t) => <option key={t.id} value={t.id}>{t.id}（{t.kind}）{t.state["alive"] === "no" ? "（死亡）" : ""}</option>)}</select></label>
        </div>
        {self ? <>
          <p className="village-person-location">{self.id} · 定義 {self.kind}{typeof self.state["x"] === "number" ? ` · 位置 ${num(self.state["x"]).toFixed(0)}, ${num(self.state["y"]).toFixed(0)}` : ""}
            {typeof self.attr["mind"] === "string" && ` · 心 ${self.attr["mind"]} · ${self.state["alive"] === "no" ? "死亡" : `意図 ${intentNames[String(self.state["intent"])] ?? String(self.state["intent"])}${self.state["target"] ? ` → ${String(self.state["target"])}` : self.state["intent"] === "move" ? " → 探索の行き先" : ""}`}`}
            {typeof self.attr["bears"] === "string" && view && ` · ${inSeason(self, view.now) ? "実る時期" : "時期の外"} · 付いている実 ${held.length}${typeof self.state["bornAt"] === "number" ? ` · 生まれて ${((view.now - num(self.state["bornAt"])) / DAY).toFixed(1)}日` : ""}`}</p>
          <div className="village-inspector-panes">
            <section className="village-inspector-pane" aria-label="物の値">
              <h2>{self.id} の値</h2>
              <div className="village-status-stack">
                <ValueCard title="資源" values={self.res} />
                <ValueCard title="状態" values={otherState} />
                {held.length > 0 && <ValueCard title="付いている物" values={heldByKind} />}
                <details><summary>属性（{Object.keys(self.attr).length}）</summary><ValueCard title="属性" values={self.attr} /></details>
              </div>
            </section>
            <section className="village-inspector-pane" aria-label="心象と記録">
              {Object.keys(self.rel).length > 0 && <details><summary>心象（{Object.keys(self.rel).length} 項目）</summary>
                <table className="village-log-table"><thead><tr><th>相手</th><th>種類</th><th>最後に見た</th><th>そのほか</th></tr></thead>
                  <tbody>{Object.entries(self.rel).filter(([, e]) => !("edible" in e)).map(([id, e]) => <tr key={id}><td>{id}</td><td>{String(e["kind"] ?? "")}</td><td>{typeof e["at"] === "number" ? clock(e["at"] as number) : ""}</td>
                    <td>{Object.entries(e).filter(([k]) => !["kind", "at", "x", "y", "visibility"].includes(k) && !/^(fc|dv)\d+$/.test(k)).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")}</td></tr>)}</tbody></table>
                <small>実の項目（{Object.values(self.rel).filter((e) => "edible" in e).length}）は省略</small></details>}
              <h3>{day}日目の記録（{dayEvents.length}件）</h3>
              {dayEvents.slice().reverse().slice(0, 150).map((e, i) => <div key={i} className="e1-row"><b>{clock(e.at)} · {"law" in e ? `${lawNames[e.law] ?? e.law} · ${e.a}${e.b && e.b !== e.a ? ` × ${e.b}` : ""}` : `${eventNames[e.event] ?? e.event} · ${"about" in e ? e.about : "intent" in e ? `${intentNames[e.intent] ?? e.intent}${e.target ? ` → ${e.target}` : ""}` : ""}`}</b>
                {"law" in e && <details className="village-event-details"><summary>{e.effect.kind} · {fmt(e.applied)}</summary><code>{JSON.stringify(e.effect)}</code></details>}</div>)}
              {rec && <p className="village-record-source">記録 {rec.final.ledger.toLocaleString()}件 · 最後の状態の要約 {rec.final.thingsHash} · 記録の要約 {rec.final.ledgerHash}</p>}
            </section>
          </div>
          {has(self, "forecasts") && view && <ForecastTable self={self} now={view.now} />}
        </> : <p>物を選んでください。</p>}
      </aside>
    </main>
  </div>;
}
