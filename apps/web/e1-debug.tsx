import { useEffect, useMemo, useState } from "react";
import { economyE1 } from "../../packages/content/economy-e1";
import {
  advanceLocal, newLocalWorld, submitLocal,
  type LocalWorld, type Place,
} from "../../packages/sim/local-economy";

type Scenario = "baseline" | "carrier-absent" | "buyer-no-money" | "farmer-absent";
type Rect = { x: number; y: number; width: number; height: number };
const scenarios: Record<Scenario, string> = {
  baseline: "基準",
  "carrier-absent": "運搬人が2日目欠勤",
  "buyer-no-money": "H0の資金不足",
  "farmer-absent": "F6が2日目欠勤",
};
const roleName: Record<string, string> = {
  farmer: "農民", carrier: "運搬人", seller: "売り手", buyer: "買物係", dependent: "家族",
};
const eventName: Record<string, string> = {
  journey_started: "移動開始", journey_arrived: "到着", food_produced: "食料生産",
  journey_blocked: "体力・容量不足で移動不可", cash_moved: "現金を移す",
  shipment_loaded: "荷積み", shipment_delivered: "市場へ配送", shipment_failed: "配送失敗",
  sale_reserved: "売買予約", sale_settled: "売買成立", sale_expired: "注文失効",
  food_brought_home: "食料を持ち帰る", meal_eaten: "食事", meal_missed: "欠食",
  purchase_requested: "購入依頼", replenishment_requested: "入荷依頼",
  task_offered: "仕事の提案", task_accepted: "仕事の引受", task_refused: "仕事の拒否",
};
const map = economyE1.map;
const point = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
function siteRect(place: Place): Rect {
  if (place === "farm") return map.farm;
  if (place.startsWith("house:")) return map.houses[place.slice(6)];
  return map.market;
}
function position(w: LocalWorld, id: string) {
  const p = w.people[id];
  if (p.journey) {
    const a = point(siteRect(p.journey.from)), b = point(siteRect(p.journey.to));
    const progress = (w.minute - p.journey.depart) / (p.journey.arrive - p.journey.depart);
    return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
  }
  const r = siteRect(p.location);
  const peers = Object.values(w.people).filter((other) => !other.journey && other.location === p.location)
    .sort((a, b) => a.id.localeCompare(b.id));
  const index = peers.findIndex((other) => other.id === id);
  const columns = p.location === "farm" ? 5 : p.location === "market" ? 4 : 3;
  return { x: r.x + 20 + (index % columns) * 43, y: r.y + 40 + Math.floor(index / columns) * 30 };
}
function makeWorld(scenario: Scenario, minute: number) {
  const w = newLocalWorld();
  if (scenario === "carrier-absent") submitLocal(w, "C", { kind: "ABSENT", personId: "C", day: 2 });
  if (scenario === "buyer-no-money") submitLocal(w, "B0", { kind: "TRANSFER_MONEY", from: "H0", to: "reserve", amount: 40 });
  if (scenario === "farmer-absent") submitLocal(w, "F6", { kind: "ABSENT", personId: "F6", day: 2 });
  advanceLocal(w, minute);
  return w;
}
const clock = (minute: number) => `${Math.floor(minute / 1440) + 1}日目 ${String(Math.floor(minute % 1440 / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const foodAt = (w: LocalWorld, place: Place) => w.lots.filter((lot) => lot.place === place).reduce((n, lot) => n + lot.quantity, 0);
const capacityAt = (place: Place) => place === "farm" ? economyE1.limits.farmFood :
  place === "market" ? economyE1.limits.marketFood : economyE1.limits.houseFood;
const personFood = (w: LocalWorld, id: string) => foodAt(w, `carried:${id}`);
const personCash = (w: LocalWorld, id: string) => w.cashContainers.filter((c) => c.place === `carried:${id}`).reduce((n, c) => n + c.amount, 0);

export default function E1Debug() {
  const [scenario, setScenario] = useState<Scenario>("baseline");
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [personId, setPersonId] = useState("F0");
  const [site, setSite] = useState<Place>("house:H0");
  const [focus, setFocus] = useState("site:house:H0");
  const w = useMemo(() => makeWorld(scenario, minute), [scenario, minute]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinute((n) => Math.min(4320, n + 15)), 350);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (minute >= 4320) setPlaying(false); }, [minute]);
  const selected = w.people[personId];
  const recent = w.events.filter((e) => e.actors.includes(personId)).slice(-18).reverse();
  const selectedHouse = site.startsWith("house:") ? w.households[site.slice(6)] : undefined;
  const siteMembers = Object.values(w.people).filter((p) => !p.journey && p.location === site);
  const cargo = w.lots.filter((lot) => lot.place.startsWith("cargo:"));
  const carried = w.lots.filter((lot) => lot.place.startsWith("carried:"));
  const cartFood = cargo.reduce((n, lot) => n + lot.quantity, 0);
  const focusedCash = w.cashContainers.find((c) => focus === `cash:${c.id}`);
  const focusedFood = w.lots.find((lot) => focus === `food:${lot.id}`);
  const focusPerson = focus.startsWith("person:") ? w.people[focus.slice(7)] : undefined;
  const places: { id: Place; name: string; rect: Rect }[] = [
    { id: "farm", name: "農場", rect: map.farm },
    { id: "market", name: "市場", rect: map.market },
    ...Object.entries(map.houses).map(([id, rect]) => ({ id: `house:${id}` as Place, name: `${id}の家`, rect })),
  ];
  return (
    <div className="e1-debug">
      <header className="e1-top">
        <div><p className="eyebrow">LOCAL FOOD VILLAGE · DEVELOPMENT VIEW</p><h1>20人の集落 · 空間デバッグ</h1></div>
        <a href="/">90日ゲームに戻る</a>
      </header>
      <div className="e1-controls">
        <label>シナリオ <select value={scenario} onChange={(e) => { setScenario(e.target.value as Scenario); setMinute(0); setPlaying(false); }}>
          {Object.entries(scenarios).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
        </select></label>
        <button onClick={() => setPlaying(!playing)} disabled={minute >= 4320}>{playing ? "停止" : "再生"}</button>
        <button onClick={() => setMinute(Math.max(0, minute - 15))}>−15分</button>
        <button onClick={() => setMinute(Math.min(4320, minute + 15))}>＋15分</button>
        <button onClick={() => setMinute(Math.min(4320, minute + 1440))}>＋1日</button>
        <strong>{clock(minute)}</strong>
        <label>経過分 <input aria-label="経過分" type="number" min={0} max={4320} step={15} value={minute} onChange={(e) => { setPlaying(false); setMinute(Math.max(0, Math.min(4320, Number(e.target.value) || 0))); }} /></label>
        <input aria-label="集落の時刻" type="range" min={0} max={4320} step={15} value={minute} onChange={(e) => { setPlaying(false); setMinute(Number(e.target.value)); }} />
      </div>
      <div className="e1-stats">
        <span>生産 <b>{w.producedFood}</b> 食</span><span>消費 <b>{w.consumedFood}</b> 食</span>
        <span>農場 <b>{foodAt(w, "farm")}</b> 食</span><span>市場 <b>{foodAt(w, "market")}</b> 食</span>
        <span>荷車 <b>{cartFood}/{w.cart.capacity}</b> 食</span>
        <span>持ち歩き <b>{carried.reduce((n, l) => n + l.quantity, 0)}</b> 食</span>
        <span>協同事業 <b>{w.wallets.cooperative}</b> 通貨</span>
      </div>
      <main className="e1-layout">
        <section className="e1-map-panel">
          <p>枠は場所、丸は人物、荷車印は輸送手段、¥は現金の入れ物です。ホバーかクリックで容量・現在量・移動コストを確認できます。</p>
          <svg className="e1-map" viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="20人の集落地図">
            <rect x={0} y={0} width={map.width} height={map.height} fill="#1d3028" />
            <rect {...map.town} fill="#294138" stroke="#9bae83" strokeWidth={3} rx={8} />
            <text x={map.town.x + 15} y={map.town.y + 25} className="e1-town-label">町 · 4世帯</text>
            <path d={`M ${point(map.farm).x} ${point(map.farm).y} L ${map.town.x} ${point(map.farm).y} L ${point(map.market).x} ${point(map.market).y}`} stroke="#b6a77b" strokeWidth={14} opacity={0.6} fill="none"><title>農場と市場: 2km。徒歩は空荷6体力、荷車は空荷10体力・21食積載20体力（片道）</title></path>
            <text x={305} y={235} className="e1-road-label">2 km の道</text>
            {places.map(({ id, name, rect }) => <g key={id} onClick={() => { setSite(id); setFocus(`site:${id}`); }} className="e1-site">
              <rect {...rect} rx={5} fill={id === "farm" ? "#40553a" : id === "market" ? "#584c37" : "#42524d"} stroke={site === id ? "#ffdb8e" : "#a5ae91"} strokeWidth={site === id ? 4 : 2} />
              <text x={rect.x + 12} y={rect.y + 23}>{name}</text>
              <text x={rect.x + 12} y={rect.y + rect.height - 10} className="e1-goods">■ 食料 {foodAt(w, id)}/{capacityAt(id)} · {id.startsWith("house:") ? `現金 ${w.cashContainers.filter((c) => c.place === id).reduce((n,c) => n+c.amount,0)}` : id === "market" ? `現金 ${w.cashContainers.find((c) => c.id === "till_cooperative")?.amount}` : "協同事業所有"}</text>
              <title>{name}: 食料 {foodAt(w, id)}/{capacityAt(id)}食。置かれた現金 {w.cashContainers.filter((c) => c.place === id).reduce((n,c) => n+c.amount,0)}通貨。</title>
            </g>)}
            {Object.values(w.people).map((p) => {
              const xy = position(w, p.id);
              return <g key={p.id} className="e1-person" onClick={() => { setPersonId(p.id); setSite(p.journey?.to ?? p.location); setFocus(`person:${p.id}`); }}>
                <circle cx={xy.x} cy={xy.y} r={personId === p.id ? 11 : 9} fill={p.role === "farmer" ? "#a5d18f" : p.role === "carrier" ? "#7cc5d0" : p.role === "seller" ? "#dfb078" : p.role === "buyer" ? "#ddd2a0" : "#bfadc8"} stroke={personId === p.id ? "#fff" : "#23332b"} strokeWidth={2} />
                <text x={xy.x + 11} y={xy.y + 4}>{p.id}</text>
                <title>{p.id} · {roleName[p.role]} · 食料 {personFood(w, p.id)}/{p.foodCapacity}食 · 現金 {personCash(w, p.id)}/{p.cashCapacity}通貨 · 体力 {p.energy}/{economyE1.limits.personEnergy}{p.journey ? ` · ${p.journey.mode} ${p.journey.distanceKm}km 費用${p.journey.effortCost}体力` : ""}</title>
              </g>;
            })}
            {(() => {
              const xy = w.cart.carrierId ? position(w, w.cart.carrierId) : point(siteRect(w.cart.location));
              return <g className="e1-cart" role="button" aria-label="荷車 cart_1" onClick={() => setFocus("cart")}
                transform={`translate(${xy.x + 32},${xy.y - 24})`}>
                <rect x={-14} y={-14} width={30} height={26} rx={3} fill="#9bb8bc" stroke="#17332f" strokeWidth={2} />
                <text x={-9} y={5} className="e1-cart-symbol">車</text>
                <title>荷車 cart_1 · 協同事業所有 · 食料 {cartFood}/{w.cart.capacity}食 · 農場道2kmの費用: 空荷10体力、21食積載20体力</title>
              </g>;
            })()}
            {w.lots.filter((lot) => lot.quantity > 0 && (lot.place.startsWith("cargo:") || lot.place.startsWith("carried:"))).map((lot, i) => {
              const id = lot.place.startsWith("carried:") ? lot.place.slice(8) : w.shipments.find((s) => `cargo:${s.id}` === lot.place)?.carrierId;
              if (!id) return null;
              const xy = position(w, id);
              return <g key={lot.id} className="e1-item" onClick={() => setFocus(`food:${lot.id}`)}><rect x={xy.x - 9 + i * 4} y={xy.y - 27 - i * 4} width={15} height={15} fill="#e5c278" stroke="#473a24" /><text x={xy.x + 9 + i * 4} y={xy.y - 16 - i * 4} className="e1-cargo-label">{lot.quantity}</text><title>食料ロット {lot.id}: {lot.quantity}食 · 所有者 {lot.ownerId} · 所在地 {lot.place}</title></g>;
            })}
            {w.cashContainers.map((c) => {
              const rect = c.place.startsWith("carried:") ? undefined : siteRect(c.place);
              const xy = rect ? { x: rect.x + rect.width - 22 - (c.kind === "reserve" ? 28 : 0), y: rect.y + 42 } : position(w, c.place.slice(8));
              if (c.kind === "pouch" && c.amount === 0) return null;
              return <g key={c.id} className="e1-cash" onClick={() => setFocus(`cash:${c.id}`)}>
                <circle cx={xy.x} cy={xy.y} r={10} fill="#e0b962" stroke="#2d2b1b" strokeWidth={2} />
                <text x={xy.x - 5} y={xy.y + 4} className="e1-cash-symbol">¥</text>
                <title>{c.id} · {c.kind} · 所有者 {c.ownerId} · 現金 {c.amount}/{c.capacity}通貨 · 所在地 {c.place}</title>
              </g>;
            })}
          </svg>
          <p className="e1-legend">● 人物　▣ 荷車　■ 食料　¥ 金庫・財布。表示はE1の世界状態から描画します。</p>
        </section>
        <aside className="e1-detail">
          <div className="e1-inspector" aria-live="polite">
            <h2>選択したオブジェクト</h2>
            {focus === "cart" && <p><b>荷車 {w.cart.id}</b><br />所有者: {w.cart.ownerId}<br />所在地: {w.cart.carrierId ? `${w.cart.carrierId}が牽引中` : w.cart.location}<br />食料積載: {cartFood}/{w.cart.capacity}食<br />農場道の片道費用: 空荷10体力、満載20体力。牽引者の体力から支払います。</p>}
            {focusPerson && <p><b>{focusPerson.id} · {roleName[focusPerson.role]}</b><br />運べる食料: {personFood(w, focusPerson.id)}/{focusPerson.foodCapacity}食<br />運べる現金: {personCash(w, focusPerson.id)}/{focusPerson.cashCapacity}通貨<br />体力: {focusPerson.energy}/{economyE1.limits.personEnergy}<br />{focusPerson.journey ? `移動中: ${focusPerson.journey.mode === "cart" ? "荷車" : "徒歩"} ${focusPerson.journey.distanceKm}km · 費用${focusPerson.journey.effortCost}体力` : "移動していません。市街の空荷徒歩は1体力、農場道2kmの空荷徒歩は6体力です。"}</p>}
            {focusedCash && <p><b>現金容器 {focusedCash.id}</b><br />種別: {focusedCash.kind}<br />所有者: {focusedCash.ownerId}<br />所在地: {focusedCash.place}<br />現金: {focusedCash.amount}/{focusedCash.capacity}通貨<br />容量を超える移動・清算は拒否されます。</p>}
            {focusedFood && <p><b>食料ロット {focusedFood.id}</b><br />所有者: {focusedFood.ownerId}<br />所在地: {focusedFood.place}<br />量: {focusedFood.quantity}食 · 予約: {focusedFood.reserved}食<br />原因Event: {focusedFood.causeEventId}</p>}
            {focus.startsWith("site:") && <div><p><b>{site.startsWith("house:") ? `${site.slice(6)}の家` : site === "farm" ? "農場" : "市場"}</b><br />食料: {foodAt(w, site)}/{capacityAt(site)}食<br />現金: {w.cashContainers.filter((c) => c.place === site).reduce((n,c) => n+c.amount,0)}通貨</p>
              {w.cashContainers.filter((c) => c.place === site).map((c) => <button className="e1-object-link" key={c.id} onClick={() => setFocus(`cash:${c.id}`)}>¥ {c.id}: {c.amount}/{c.capacity}通貨</button>)}
              {w.lots.filter((lot) => lot.place === site && lot.quantity > 0).map((lot) => <button className="e1-object-link" key={lot.id} onClick={() => setFocus(`food:${lot.id}`)}>■ {lot.id}: {lot.quantity}食 · {lot.ownerId}所有</button>)}
            </div>}
          </div>
          <h2>{site.startsWith("house:") ? `${site.slice(6)}世帯の家` : site === "farm" ? "農場" : "市場"}</h2>
          <p>現在いる人: {siteMembers.map((p) => p.id).join("、") || "なし"}</p>
          {selectedHouse && <p>世帯員: {selectedHouse.memberIds.join("、")}<br />世帯所有通貨: {w.wallets[selectedHouse.id]}通貨（家の金庫と買物係の財布の合計）</p>}
          <p>置かれた食料: {foodAt(w, site)}食</p>
          <h2>{personId} · {roleName[selected.role]}</h2>
          <p>所属: {selected.householdId}世帯<br />現在地: {selected.journey ? `${selected.journey.from} → ${selected.journey.to}（${clock(selected.journey.arrive)}到着）` : selected.location}<br />空腹: {selected.hunger}</p>
          <h3>この人の仕事</h3>
          {w.tasks.filter((task) => task.personId === personId && task.start <= minute && task.end >= minute - 1440).slice(-8).map((task) => <p key={task.id} className="e1-row">{clock(task.start)}–{clock(task.end)} · {task.capability} · {task.status}</p>)}
          <h3>この人の因果Event（新しい順）</h3>
          {recent.map((e) => <p key={e.id} className="e1-row"><b>{clock(e.minute)} · {eventName[e.kind] ?? e.kind}</b><br /><small>{e.id} ← {e.causes.join(", ") || "起点"}</small></p>)}
        </aside>
      </main>
    </div>
  );
}
