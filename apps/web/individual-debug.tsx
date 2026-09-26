import { useMemo, useState } from "react";
import { advanceLifeWorld, newLifeWorld } from "../../packages/sim/individual-life";
import { advanceMarketDay, marketSummary, newMarketWorld } from "../../packages/sim/individual-market";
import { contentsQuantity, siteOf, type PhysicalState } from "../../packages/sim/physical";

type View = "life" | "market";
const positions: Record<string, { x: number; y: number; name: string }> = {
  clearing: { x: 35, y: 55, name: "空き地" }, grove: { x: 375, y: 55, name: "木立と食料資源" },
  market: { x: 35, y: 55, name: "Sの市場" },
};
function snapshot(view: View, day: number) {
  if (view === "life") { const w = newLifeWorld(); advanceLifeWorld(w, day * 24); return w; }
  const w = newMarketWorld(); for (let i = 0; i < day; i++) advanceMarketDay(w); return w;
}
function owned(s: PhysicalState, id: string, kind: string) {
  return Object.values(s.objects).filter((o) => o.typeId === kind && o.ownerId === id).reduce((n, o) => n + o.quantity, 0);
}
export default function IndividualDebug({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView);
  const [day, setDay] = useState(1);
  const [focus, setFocus] = useState(initialView === "life" ? "A" : "S");
  const w = useMemo(() => snapshot(view, day), [view, day]);
  const physical = w.physical;
  const people = view === "life" ? Object.keys((w as ReturnType<typeof newLifeWorld>).people) : ["F", "C", "S", "B1", "B2"];
  const sites = view === "life" ? ["clearing", "grove"] : ["market", "grove"];
  const selected = physical.objects[focus];
  const events = w.events.filter((event) => event.actors.includes(focus) || event.data.resourceId === focus).reverse();
  const market = view === "market" ? marketSummary(w as ReturnType<typeof newMarketWorld>) : undefined;
  return <div className="e1-debug">
    <header className="e1-top"><div><p className="eyebrow">INDIVIDUAL ECONOMY · PHYSICAL TRUTH</p><h1>{view === "life" ? "制度なし採集生活" : "S個人の市場と取引"}</h1></div>
      <div><a href="/?individual=life">採集生活</a> · <a href="/?individual=market">Sの市場</a> · <a href="/?e1=a3-income">旧A3</a> · <a href="/">90日ゲーム</a></div></header>
    <div className="e1-controls"><label>対照 <select aria-label="個人経済の対照" value={view} onChange={(e) => { setView(e.target.value as View); setDay(1); setFocus(e.target.value === "life" ? "A" : "S"); }}>
      <option value="life">制度なし採集</option><option value="market">個人市場</option></select></label>
      <label>日数 <input aria-label="個人経済の日数" type="range" min={1} max={7} value={day} onChange={(e) => setDay(Number(e.target.value))} /></label>
      <button onClick={() => setDay(Math.max(1, day - 1))}>−1日</button><button onClick={() => setDay(Math.min(7, day + 1))}>＋1日</button><strong>{day}日目</strong></div>
    <div className="e1-stats">
      {view === "life" ? <><span>採集 <b>{(w as ReturnType<typeof newLifeWorld>).harvested}</b></span><span>食事 <b>{(w as ReturnType<typeof newLifeWorld>).eaten}</b></span>
        <span>資源残量 <b>{(w as ReturnType<typeof newLifeWorld>).resources.berries.available}</b></span></> :
        <><span>店頭価格 <b>{market!.price}</b></span><span>Sの現金 <b>{market!.sellerCash}</b></span>
          <span>Sの留保額 <b>{market!.sellerReserve}</b></span><span>Sの実現損益 <b>{market!.sellerProfit}</b></span>
          <span>販売数 <b>{market!.sold}</b></span><span>在庫 <b>{market!.stock}</b></span><span>腐敗 <b>{market!.spoiled}</b></span></>}
    </div>
    <main className="e1-layout"><section className="e1-map-panel"><p>場所・人物・資源を選ぶと、物体の所有者、携行量、本人の行動Eventを確認できます。場所は取引を実行しません。</p>
      <svg className="e1-map" viewBox="0 0 720 400" role="img" aria-label="個人経済の場所と人物">
        <rect width="720" height="400" fill="#1d3028" />
        {sites.map((id) => { const p = positions[id]; return <g key={id} role="button" aria-label={`${p.name} ${id}`} onClick={() => setFocus(id)}>
          <rect x={p.x} y={p.y} width="305" height="285" rx="12" fill={id === "grove" ? "#315a3b" : "#4c5141"} stroke={focus === id ? "#ffdb8e" : "#9bae83"} strokeWidth="3" />
          <text x={p.x + 14} y={p.y + 28}>{p.name}</text><text x={p.x + 14} y={p.y + 52}>所有者: {physical.objects[id].ownerId ?? "なし"}</text>
          <text x={p.x + 14} y={p.y + 75}>食料 {contentsQuantity(physical, id, "food")} · 現金 {view === "market" ? contentsQuantity(physical, id, "currency") : 0}</text>
        </g>; })}
        {people.map((id, index) => { const location = siteOf(physical, id); const p = positions[location] ?? positions.grove;
          return <g key={id} role="button" aria-label={`人物 ${id}`} onClick={() => setFocus(id)}>
            <circle cx={p.x + 50 + (index % 3) * 80} cy={p.y + 135 + Math.floor(index / 3) * 75} r={focus === id ? 20 : 17} fill="#e5bf7b" stroke="#20352b" strokeWidth="3" />
            <text x={p.x + 70 + (index % 3) * 80} y={p.y + 140 + Math.floor(index / 3) * 75}>{id}</text>
            <title>{id} · {location} · 自分の食料 {owned(physical, id, "food")} · 自分の現金 {owned(physical, id, "currency")}</title>
          </g>; })}
      </svg>
      <h2>全員の行動（{w.events.filter((e) => e.actors.length).length}件）</h2><div className="e1-action-log">{w.events.filter((e) => e.actors.length).slice().reverse().map((e) =>
        <p key={e.id} className="e1-row">{e.hour}時 · {e.actors.join("、")} · {e.kind}<br /><small>{e.id} ← {e.causes.join(", ") || "起点"}</small></p>)}</div>
    </section><aside className="e1-detail"><div className="e1-inspector"><h2>選択した物体</h2>{selected ? <p><b>{selected.id}</b> · {selected.typeId}<br />所在地: {siteOf(physical, selected.id)}<br />物理親: {selected.parentId ?? "なし"}<br />所有者: {selected.ownerId ?? "なし"}<br />食料: {contentsQuantity(physical, selected.id, "food")} · 現金: {view === "market" ? contentsQuantity(physical, selected.id, "currency") : 0}</p> : <p>選択してください。</p>}</div>
      {people.includes(focus) && <><h2>{focus}の行動と財産</h2><p>本人所有の食料: {owned(physical, focus, "food")} · 通貨: {owned(physical, focus, "currency")}</p>
        {view === "life" && <p>空腹: {(w as ReturnType<typeof newLifeWorld>).people[focus].hunger} · 体力: {(w as ReturnType<typeof newLifeWorld>).people[focus].energy}</p>}</>}
      <h2>関連する因果Event</h2>{events.map((e) => <p key={e.id} className="e1-row"><b>{e.hour}時 · {e.kind}</b><br /><small>{e.id} ← {e.causes.join(", ") || "起点"}</small></p>)}
    </aside></main>
  </div>;
}
