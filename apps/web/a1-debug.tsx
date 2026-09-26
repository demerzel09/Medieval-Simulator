import { useEffect, useMemo, useState } from "react";
import { advanceA1, newA1World, offerA1 } from "../../packages/sim/autonomy-a1";

function at(minute: number) {
  const world = newA1World(42);
  for (const [taskId, workerId] of [["job_a", "worker_a"], ["job_b", "worker_b"]] as const)
    offerA1(world, { id: taskId, at: 0, issuerId: "manager", workerId, taskId, toolId: "tool", work: 3, deliveryMinutes: 0 });
  advanceA1(world, minute);
  return world;
}

const labels: Record<string, string> = { manager: "依頼者", worker_a: "働き手A", worker_b: "働き手B", tool: "共有道具" };
const places = { manager: { x: 140, y: 175 }, worker_a: { x: 345, y: 135 }, worker_b: { x: 345, y: 265 }, tool: { x: 565, y: 200 } };
const taskStatus = (status?: string) => status === "working" ? "作業中" : status === "completed" ? "完了" : status === "offered" ? "待機中" : "依頼者";

export default function A1Debug() {
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState("worker_a");
  const world = useMemo(() => at(minute), [minute]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinute((current) => Math.min(6, current + 1)), 850);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (minute >= 6) setPlaying(false); }, [minute]);
  const claim = world.physical.reservations.find((item) => item.objectId === "tool");
  const active = Object.values(world.processes)[0];
  const selectedActor = world.actors[focus];
  const selectedEvents = world.events.filter((event) => focus === "tool" ? event.data.toolId === "tool" || event.kind === "tool_released" : event.actors.includes(focus)).slice(-12).reverse();
  return <div className="e1-debug">
    <header className="e1-top"><div><p className="eyebrow">A1 · ACTOR-LED WORK</p><h1>二人と一つの道具 · 自律行動デバッグ</h1></div><div><a href="/?e1=a2">A2の集落を見る</a> · <a href="/">90日ゲームに戻る</a></div></header>
    <div className="e1-controls">
      <button onClick={() => setPlaying(!playing)} disabled={minute >= 6}>{playing ? "停止" : "再生"}</button>
      <button onClick={() => { setPlaying(false); setMinute(Math.max(0, minute - 1)); }}>−1分</button>
      <button onClick={() => { setPlaying(false); setMinute(Math.min(6, minute + 1)); }}>＋1分</button>
      <strong>{minute}分目</strong>
      <label>経過分 <input aria-label="A1経過分" type="number" min={0} max={6} step={1} value={minute} onChange={(event) => { setPlaying(false); setMinute(Math.max(0, Math.min(6, Number(event.target.value) || 0))); }} /></label>
      <input aria-label="A1時刻スライダー" type="range" min={0} max={6} step={1} value={minute} onChange={(event) => { setPlaying(false); setMinute(Number(event.target.value)); }} />
    </div>
    <div className="e1-stats">
      <span>道具の利用者 <b data-testid="a1-claim">{claim?.claimantId ?? "なし"}</b></span>
      <span>進行中の仕事 <b>{active?.taskId ?? "なし"}</b></span>
      <span>残りの仕事量 <b data-testid="a1-remaining">{active?.remaining ?? 0}</b></span>
      <span>完了 <b>{Object.values(world.tasks).filter((task) => task.status === "completed").length}/2</b></span>
    </div>
    <main className="e1-layout"><section className="e1-map-panel">
      <p>人物か道具を選ぶと、本人の状態と因果Eventを確認できます。道具は一人だけが利用できます。</p>
      <svg className="e1-map" viewBox="0 0 720 400" role="img" aria-label="A1作業場の人物と道具">
        <rect width="720" height="400" fill="#1d3028" />
        <rect x="40" y="45" width="640" height="305" rx="12" fill="#314b3b" stroke="#9bae83" strokeWidth="3" />
        <text x="55" y="76">作業場</text>
        {(["manager", "worker_a", "worker_b"] as const).map((id) => {
          const p = places[id], actor = world.actors[id], task = Object.values(world.tasks).find((item) => item.workerId === id);
          const status = taskStatus(task?.status);
          return <g key={id} className="e1-person" role="button" aria-label={`${labels[id]} ${id}`} onClick={() => setFocus(id)}>
            <circle cx={p.x} cy={p.y} r={focus === id ? 27 : 23} fill={task?.status === "working" ? "#e7bf79" : task?.status === "completed" ? "#93c991" : "#9bc2c6"} stroke="#23332b" strokeWidth="3" />
            <text x={p.x + 32} y={p.y - 4}>{labels[id]} · {id}</text>
            <text x={p.x + 32} y={p.y + 17}>{status} · 体力 {actor.energy}</text>
            <title>{labels[id]} · {status} · 体力 {actor.energy}</title>
          </g>;
        })}
        <g role="button" aria-label="共有道具 tool" className="e1-cart" onClick={() => setFocus("tool")}>
          <rect x={places.tool.x - 27} y={places.tool.y - 27} width="54" height="54" rx="8" fill={claim ? "#d0ad71" : "#9fb7ac"} stroke={focus === "tool" ? "#ffdb8e" : "#1e342c"} strokeWidth="4" />
          <text x={places.tool.x - 15} y={places.tool.y + 6}>道具</text>
          <text x={places.tool.x - 56} y={places.tool.y + 52}>利用者: {claim?.claimantId ?? "なし"}</text>
          <title>共有道具 · 利用者 {claim?.claimantId ?? "なし"}</title>
        </g>
      </svg>
      <h2>全員の行動</h2>
      {world.events.slice(-16).reverse().map((event) => <p className="e1-row" key={event.id}>{event.minute}分 · {event.actors.join("、")} · {event.kind} · {event.data.taskId ?? ""}</p>)}
    </section><aside className="e1-detail">
      <div className="e1-inspector"><h2>{labels[focus]}</h2>
        {selectedActor ? <p>ID: {focus}<br />体力: {selectedActor.energy}<br />知っている仕事: {selectedActor.knownTaskIds.join("、") || "なし"}<br />次の判断: {selectedActor.wait.until === undefined ? "通知待ち" : `${selectedActor.wait.until}分目`}<br />状態: {taskStatus(Object.values(world.tasks).find((task) => task.workerId === focus)?.status)}</p> :
          <p>ID: tool<br />所有者: {world.physical.objects.tool.ownerId}<br />利用者: {claim?.claimantId ?? "なし"}<br />予約ID: {claim?.id ?? "なし"}</p>}
      </div>
      <h2>選択対象の因果Event</h2>
      {selectedEvents.map((event) => <p className="e1-row" key={event.id}><b>{event.minute}分 · {event.kind}</b><br /><small>{event.id} ← {event.causes.join("、") || "起点"}</small></p>)}
    </aside></main>
  </div>;
}
