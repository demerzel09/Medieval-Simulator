import { useEffect, useMemo, useState } from "react";
import { economyE1V2 } from "../../packages/content/economy-e1-v2";
import { capacityReport, contentsQuantity, siteOf, totalMass } from "../../packages/sim/physical";
import { advanceLocalV2, localV2Summary, newLocalWorldA2, newLocalWorldV2, submitLocalV2, type LocalWorldV2 } from "../../packages/sim/local-economy-v2";

type Scenario = "baseline" | "carrier-absent" | "buyer-no-money" | "farmer-absent";
type Rect = { x: number; y: number; width: number; height: number };
const map = economyE1V2.map;
const labels: Record<Scenario, string> = { baseline: "基準", "carrier-absent": "Cが2日目欠勤", "buyer-no-money": "H0の資金不足", "farmer-absent": "F6が2日目欠勤" };
const point = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
function siteRect(id: string): Rect {
  if (id === "farm") return map.farm;
  if (id.startsWith("house:")) return (map.houses as Record<string, Rect>)[id.slice(6)];
  return map.market;
}
function makeWorld(scenario: Scenario, minute: number, autonomousBuyers: boolean) {
  const w = autonomousBuyers ? newLocalWorldA2() : newLocalWorldV2();
  if (scenario === "carrier-absent") submitLocalV2(w, "C", { kind: "ABSENT", personId: "C", day: 2 });
  if (scenario === "buyer-no-money") submitLocalV2(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 });
  if (scenario === "farmer-absent") submitLocalV2(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 });
  advanceLocalV2(w, minute); return w;
}
function position(w: LocalWorldV2, id: string) {
  const j = w.people[id]?.journey;
  if (j) {
    const a = point(siteRect(j.fromId)), b = point(siteRect(j.toId));
    const n = (w.minute - j.depart) / (j.arrive - j.depart);
    return { x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n };
  }
  const site = siteOf(w.physical, id), r = siteRect(site);
  const peers = Object.keys(w.people).filter((other) => !w.people[other].journey && siteOf(w.physical, other) === site).sort();
  const index = peers.indexOf(id), columns = site === "farm" ? 5 : site === "market" ? 4 : 3;
  return { x: r.x + 20 + index % columns * 43, y: r.y + 40 + Math.floor(index / columns) * 30 };
}
const clock = (minute: number) => `${Math.floor(minute / 1440) + 1}日目 ${String(Math.floor(minute % 1440 / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export default function E1V2Debug({ autonomousBuyers = false }: { autonomousBuyers?: boolean }) {
  const [scenario, setScenario] = useState<Scenario>("baseline");
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState("F0");
  const w = useMemo(() => makeWorld(scenario, minute, autonomousBuyers), [scenario, minute, autonomousBuyers]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinute((n) => Math.min(4320, n + 15)), 350);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (minute >= 4320) setPlaying(false); }, [minute]);
  const summary = localV2Summary(w), objects = w.physical.objects;
  const selected = objects[focus];
  const parent = selected?.parentId ? objects[selected.parentId] : undefined;
  const site = selected && siteOf(w.physical, selected.id);
  const mass = selected && totalMass(w.physical, selected.id);
  const capacity = selected && capacityReport(w.physical, selected.id);
  const reservations = w.physical.reservations.filter((r) => r.objectId === focus);
  const actorEvents = w.events.filter((e) => e.actors.includes(focus)).slice(-16).reverse();
  const chosenSite = selected?.typeId === "site" ? focus : site;
  const nearby = chosenSite ? Object.values(objects).filter((o) => o.id !== "world" && siteOf(w.physical, o.id) === chosenSite) : [];
  const places = [{ id: "farm", name: "農場", rect: map.farm }, { id: "market", name: "市場", rect: map.market },
    ...Object.entries(map.houses).map(([id, rect]) => ({ id: `house:${id}`, name: `${id}の家`, rect }))];
  return <div className="e1-debug">
    <header className="e1-top"><div><p className="eyebrow">{autonomousBuyers ? "LOCAL FOOD A2 · BUYER DECISIONS" : "LOCAL FOOD V2 · PHYSICAL TRUTH"}</p><h1>20人の集落 · {autonomousBuyers ? "買物係の自律デバッグ" : "物体木デバッグ"}</h1></div><div><a href="/?e1=debug">旧E1</a> · <a href="/?e1=v2">物体木版</a> · <a href="/?e1=a2">自律A2</a> · <a href="/">90日ゲーム</a></div></header>
    <div className="e1-controls">
      <label>シナリオ <select value={scenario} onChange={(e) => { setScenario(e.target.value as Scenario); setMinute(0); setPlaying(false); }}>
        {Object.entries(labels).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
      </select></label>
      <button onClick={() => setPlaying(!playing)} disabled={minute >= 4320}>{playing ? "停止" : "再生"}</button>
      <button onClick={() => setMinute(Math.max(0, minute - 15))}>−15分</button>
      <button onClick={() => setMinute(Math.min(4320, minute + 15))}>＋15分</button>
      <button onClick={() => setMinute(Math.min(4320, minute + 1440))}>＋1日</button>
      <strong>{clock(minute)}</strong>
      <label>経過分 <input aria-label="経過分" type="number" min={0} max={4320} step={15} value={minute} onChange={(e) => { setPlaying(false); setMinute(Math.max(0, Math.min(4320, Number(e.target.value) || 0))); }} /></label>
      <input aria-label="集落の時刻" type="range" min={0} max={4320} step={15} value={minute} onChange={(e) => { setPlaying(false); setMinute(Number(e.target.value)); }} />
    </div>
    <div className="e1-stats"><span>生産 <b>{summary.producedFood}</b> 食</span><span>消費 <b>{summary.consumedFood}</b> 食</span>
      <span>農場 <b>{summary.farmFood}</b> 食</span><span>市場 <b>{summary.marketFood}</b> 食</span>
      <span data-testid="cart-load">荷車 <b>{contentsQuantity(w.physical, "cart_1", "food")}/21</b> 食</span><span>荷車の状態 <b>{w.cartCondition}/100</b></span><span>協同事業 <b>{summary.cooperativeMoney}</b> 通貨</span></div>
    <main className="e1-layout"><section className="e1-map-panel"><p>場所・人物・荷車・保管具をクリックすると、物理親と所有者、再帰負荷、容量、予約、行動を確認できます。</p>
      <svg className="e1-map" viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="20人の物体木集落地図">
        <rect width={map.width} height={map.height} fill="#1d3028" />
        <rect {...map.town} fill="#294138" stroke="#9bae83" strokeWidth={3} rx={8} />
        <path d={`M ${point(map.farm).x} ${point(map.farm).y} L ${map.town.x} ${point(map.farm).y} L ${point(map.market).x} ${point(map.market).y}`} stroke="#b6a77b" strokeWidth={14} opacity={0.6} fill="none" />
        {places.map(({ id, name, rect }) => <g key={id} className="e1-site" onClick={() => setFocus(id)}>
          <rect {...rect} fill={id === "farm" ? "#40553a" : id === "market" ? "#584c37" : "#42524d"} stroke={focus === id ? "#ffdb8e" : "#a5ae91"} strokeWidth={focus === id ? 4 : 2} rx={5} />
          <text x={rect.x + 12} y={rect.y + 23}>{name}</text><text x={rect.x + 12} y={rect.y + rect.height - 10} className="e1-goods">食料 {contentsQuantity(w.physical, id, "food")} · 現金 {contentsQuantity(w.physical, id, "currency")}</text>
          <title>{name} · 食料 {contentsQuantity(w.physical, id, "food")} · 現金 {contentsQuantity(w.physical, id, "currency")}</title>
        </g>)}
        {Object.values(w.people).map((p) => { const xy = position(w, p.id); return <g key={p.id} className="e1-person" onClick={() => setFocus(p.id)}>
          <circle cx={xy.x} cy={xy.y} r={focus === p.id ? 11 : 9} fill={p.role === "farmer" ? "#a5d18f" : p.role === "carrier" ? "#7cc5d0" : p.role === "seller" ? "#dfb078" : p.role === "buyer" ? "#ddd2a0" : "#bfadc8"} stroke="#23332b" strokeWidth={2} />
          <text x={xy.x + 11} y={xy.y + 4}>{p.id}</text><title>{p.id} · {p.role} · 体力 {p.energy} · 食料 {contentsQuantity(w.physical, p.id, "food")} · 現金 {contentsQuantity(w.physical, p.id, "currency")}</title>
        </g>; })}
        {(() => { const xy = w.people.C.journey?.mode === "cart" ? position(w, "C") : point(siteRect(siteOf(w.physical, "cart_1"))); return <g role="button" aria-label="荷車 cart_1" className="e1-cart" transform={`translate(${xy.x + 32},${xy.y - 24})`} onClick={() => setFocus("cart_1")}>
          <rect x={-14} y={-14} width={30} height={26} rx={3} fill="#9bb8bc" stroke="#17332f" strokeWidth={2} /><text x={-9} y={5} className="e1-cart-symbol">車</text>
          <title>荷車 cart_1 · {contentsQuantity(w.physical, "cart_1", "food")}/21食 · 状態{w.cartCondition}/100</title>
        </g>; })()}
      </svg>
    </section><aside className="e1-detail">
      <div className="e1-inspector" aria-live="polite"><h2>選択したオブジェクト</h2>{selected ? <p><b>{selected.id}</b> · {selected.typeId}<br />物理親: {parent?.id ?? "なし"}<br />所在地: {site}<br />所有者: {selected.ownerId ?? "所有対象外"}<br />数量: {selected.quantity}<br />再帰重量: {mass}負荷点<br />内容重量: {capacity?.massUsed}{capacity?.massMax === undefined ? "" : `/${capacity.massMax}`}負荷点<br />食料: {contentsQuantity(w.physical, selected.id, "food")} · 現金: {contentsQuantity(w.physical, selected.id, "currency")}<br />{selected.id === "cart_1" ? `車両状態: ${w.cartCondition}/100（移動で摩耗）` : ""}<br />予約: {reservations.map((r) => `${r.id} ${r.quantity}`).join("、") || "なし"}<br />原因Event: {selected.causeEventId}</p> : <p>物体を選んでください。</p>}</div>
      <h2>同じ場所にある物体</h2><div>{nearby?.map((o) => <button className="e1-object-link" key={o.id} onClick={() => setFocus(o.id)}>{o.id} · {o.typeId} · {o.ownerId ?? "—"}</button>)}</div>
      {w.people[focus] && <><h2>{focus}の仕事と行動</h2><p>世帯: {w.people[focus].householdId} · 体力: {w.people[focus].energy} · 空腹: {w.people[focus].hunger}</p>
        {w.buyerActors?.[focus] && <p>次の判断: {clock(w.buyerActors[focus].nextWakeAt)} · 知っている注文: {w.buyerActors[focus].orderId ?? "なし"}</p>}
        {w.tasks.filter((t) => t.personId === focus && t.start <= minute).slice(-8).map((t) => <p key={t.id} className="e1-row">{clock(t.start)} · {t.capability} · {t.status}</p>)}
        {actorEvents.map((e) => <p key={e.id} className="e1-row"><b>{clock(e.minute)} · {e.kind}</b>{e.data.action ? ` · ${e.data.action}` : ""}{e.data.reason ? ` · ${e.data.reason}` : ""}<br /><small>{e.id} ← {e.causes.join(", ") || "起点"}</small></p>)}</>}
    </aside></main>
  </div>;
}
