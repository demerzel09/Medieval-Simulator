import { useEffect, useMemo, useState } from "react";
import type { VillageId } from "../../packages/ai/autonomous-world";
import type { GridPoint } from "../../packages/sim/grid-path";
import type { VillageRecording } from "../../packages/sim/village-recording";

const recordingUrl = new URL("../../fixtures/recordings/autonomous-village-land-90.v2.json.gz", import.meta.url).href;
const people: VillageId[] = ["S", "F", "C", "B1", "B2"];
const plantNames: Record<string, string> = {
  grain: "穀物", wild_berry: "野生ベリー", fruit_tree: "果樹", herb: "野草", grass: "草",
};
const actionNames: Record<string, string> = {
  plot_tilled: "耕作", plot_sown: "播種", crop_harvested: "収穫", foraged: "採集",
  food_delivered: "食品納品", food_sold: "食品販売", ate: "食事", wood_burned: "薪使用",
  travel_step: "移動", arrived: "到着", travel_replanned: "経路再探索",
  animal_born: "動物の出生", animal_died: "動物の死亡", season_changed: "季節変化",
};
const pointKey = (p: GridPoint) => `${p.x},${p.y}`;
const clock = (hour: number) => `${Math.floor((hour - 1) / 24) + 1}日目 ${String((hour - 1) % 24 + 1).padStart(2, "0")}時`;

async function readRecording(): Promise<VillageRecording> {
  const response = await fetch(recordingUrl);
  if (!response.ok) throw Error(`記録の取得に失敗しました (${response.status})`);
  // Vite serves the archived .gz asset with Content-Encoding: gzip; fetch decodes it.
  const text = await response.text();
  const recording = JSON.parse(text) as VillageRecording;
  if (recording.rulesetId !== "autonomous-village-land-economy-v2" || recording.untilHour !== 2160)
    throw Error("土地経済90日の記録ではありません");
  return recording;
}

function atHour(recording: VillageRecording, hour: number) {
  const positions: Record<VillageId, GridPoint> = {
    S: recording.initialGrid.sites.market, F: recording.initialGrid.sites.grove,
    C: recording.initialGrid.sites.market, B1: recording.initialGrid.sites.home_B1,
    B2: recording.initialGrid.sites.home_B2,
  };
  const plants = Object.fromEntries(Object.values(recording.initialLand.plants).map((p) =>
    [p.id, { ...p, cell: { ...p.cell } }]));
  const animals = Object.fromEntries(Object.values(recording.initialLand.animals).map((a) =>
    [a.id, { ...a, cell: { ...a.cell } }]));
  const totals = { grainMeals: 0, wildMeals: 0, harvestedGrain: 0, meals: 0, wood: 0 };
  for (const e of recording.events) {
    if (e.hour > hour) break;
    if (e.kind === "travel_step") {
      const actor = e.actors[0] as VillageId;
      positions[actor] = { x: Number(e.data.x), y: Number(e.data.y) };
    } else if (e.kind === "arrived") {
      const actor = e.actors[0] as VillageId;
      positions[actor] = recording.initialGrid.sites[String(e.data.siteId)];
    } else if (e.kind === "plot_tilled") plants[String(e.data.plantId)].stage = "tilled";
    else if (e.kind === "plot_sown") plants[String(e.data.plantId)].stage = "seeded";
    else if (e.kind === "plant_stage" && plants[String(e.data.plantId)])
      plants[String(e.data.plantId)].stage = e.data.stage as typeof plants[string]["stage"];
    else if (e.kind === "crop_harvested") {
      const plant = plants[String(e.data.plantId)];
      plant.stage = "bare"; plant.available = 0;
      totals.harvestedGrain += Number(e.data.quantity);
    } else if (e.kind === "foraged" && e.data.resource === "food") {
      plants.wild_berry.available -= Number(e.data.quantity);
      if (plants.wild_berry.available === 0) plants.wild_berry.stage = "regrowing";
    } else if (e.kind === "plant_gathered" || e.kind === "animal_ate") {
      const plant = plants[String(e.data.plantId)];
      if (plant) {
        plant.available -= Number(e.data.quantity);
        if (plant.available === 0) plant.stage = "regrowing";
      }
    } else if (e.kind === "plant_grew" && plants[String(e.data.plantId)]) {
      const plant = plants[String(e.data.plantId)];
      plant.available = Math.min(plant.capacity, plant.available + Number(e.data.quantity));
      plant.stage = "ripe";
    } else if (e.kind === "animal_moved" && animals[String(e.data.animalId)])
      animals[String(e.data.animalId)].cell = { x: Number(e.data.x), y: Number(e.data.y) };
    else if (e.kind === "animal_born") {
      const id = String(e.data.animalId);
      animals[id] = { ...recording.initialLand.animals.rabbit_1, id,
        cell: { x: Number(e.data.x), y: Number(e.data.y) } };
    } else if (e.kind === "animal_died") delete animals[String(e.data.animalId)];
    if (e.kind === "ate") {
      totals.meals++;
      if (e.data.species === "grain") totals.grainMeals++;
      if (e.data.species === "wild_berry") totals.wildMeals++;
    }
    if (e.kind === "wood_burned") totals.wood++;
  }
  return { positions, plants, animals, totals };
}

export default function VillageDebug() {
  const [recording, setRecording] = useState<VillageRecording>();
  const [error, setError] = useState("");
  const [day, setDay] = useState(4);
  const [hourOfDay, setHourOfDay] = useState(12);
  const [selected, setSelected] = useState<VillageId>("F");
  useEffect(() => {
    let active = true;
    void readRecording().then((value) => { if (active) setRecording(value); })
      .catch((cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  const hour = (day - 1) * 24 + hourOfDay;
  const snapshot = useMemo(() => recording && atHour(recording, hour), [recording, hour]);
  const dayEvents = useMemo(() => recording?.events.filter((e) => e.day === day &&
    e.hour <= hour && (e.actors.includes(selected) ||
      ["crop_harvested", "plant_stage", "animal_born", "animal_died", "season_changed"].includes(e.kind))) ?? [],
  [recording, day, hour, selected]);
  const decisions = useMemo(() => recording?.decisions.filter((d) => d.actorId === selected &&
    d.hour > (day - 1) * 24 && d.hour <= hour) ?? [], [recording, day, hour, selected]);
  if (error) return <main className="e1-debug"><h1>土地経済の記録を開けませんでした</h1><p role="alert">{error}</p></main>;
  if (!recording || !snapshot) return <main className="e1-debug"><p>90日記録を読み込んでいます…</p></main>;
  const sites = Object.entries(recording.initialGrid.sites);
  const plantList = Object.values(snapshot.plants);
  return <div className="e1-debug village-debug">
    <header className="e1-top"><div><p className="eyebrow">AUTONOMOUS VILLAGE · RECORDED LAND ECONOMY</p>
      <h1>土地経済90日 · 記録デバッグ</h1></div><div><a href="/">90日ゲーム</a></div></header>
    <div className="e1-controls"><label>日 <input aria-label="土地経済の日" type="range" min="1" max="90" value={day}
      onChange={(e) => setDay(Number(e.target.value))} /></label>
      <button onClick={() => setDay(Math.max(1, day - 1))}>−1日</button>
      <button onClick={() => setDay(Math.min(90, day + 1))}>＋1日</button>
      <label>時刻 <input aria-label="土地経済の時刻" type="range" min="1" max="24" value={hourOfDay}
        onChange={(e) => setHourOfDay(Number(e.target.value))} /></label>
      <strong>{clock(hour)}</strong>
      <label>人物 <select aria-label="土地経済の人物" value={selected}
        onChange={(e) => setSelected(e.target.value as VillageId)}>{people.map((id) =>
          <option key={id} value={id}>{id}</option>)}</select></label></div>
    <div className="e1-stats"><span>食事 <b>{snapshot.totals.meals}/450</b></span>
      <span>穀物の食事 <b>{snapshot.totals.grainMeals}</b></span>
      <span>野生ベリーの食事 <b>{snapshot.totals.wildMeals}</b></span>
      <span>穀物収穫 <b>{snapshot.totals.harvestedGrain}</b></span>
      <span>薪使用 <b>{snapshot.totals.wood}/450</b></span>
      <span>動物 <b>{Object.keys(snapshot.animals).length}</b></span></div>
    <main className="e1-layout"><section className="e1-map-panel">
      <p>保存済みの判断とEventを時刻順に表示します。セルの人物、作物、動物は記録された位置と変化です。</p>
      <div className="village-grid" style={{ gridTemplateColumns: `repeat(${recording.initialGrid.width}, minmax(70px, 1fr))` }}
        role="img" aria-label="土地経済の矩形地図">
        {Array.from({ length: recording.initialGrid.width * recording.initialGrid.height }, (_, i) => {
          const point = { x: i % recording.initialGrid.width, y: Math.floor(i / recording.initialGrid.width) };
          const site = sites.find(([, p]) => pointKey(p) === pointKey(point))?.[0];
          const localPeople = people.filter((id) => pointKey(snapshot.positions[id]) === pointKey(point));
          const localPlants = plantList.filter((p) => pointKey(p.cell) === pointKey(point));
          const localAnimals = Object.values(snapshot.animals).filter((a) => pointKey(a.cell) === pointKey(point));
          return <div key={i} className={`village-cell ${site ? "site" : ""} ${site === "field" ? "field" : ""}`}>
            <small>{point.x},{point.y}</small><strong>{site ?? "道"}</strong>
            {localPeople.map((id) => <button key={id} className={id === selected ? "selected" : ""}
              onClick={() => setSelected(id)}>{id}</button>)}
            {localPlants.map((p) => <span key={p.id} title={`${p.id} · ${p.stage} · ${p.available}`}>
              {plantNames[p.species]}:{p.stage}</span>)}
            {localAnimals.map((a) => <span key={a.id}>🐇 {a.id}</span>)}
          </div>;
        })}</div>
      <h2>{day}日目の関連Event（{dayEvents.length}件）</h2>
      <div className="e1-action-log">{dayEvents.slice().reverse().slice(0, 120).map((e) =>
        <p key={e.id} className="e1-row"><b>{clock(e.hour)} · {e.actors.join("、") || "世界"} · {actionNames[e.kind] ?? e.kind}</b><br />
          <small>{e.id} ← {e.causes.join(", ") || "起点"} · {JSON.stringify(e.data)}</small></p>)}</div>
    </section><aside className="e1-detail"><h2>{selected} の判断履歴</h2>
      <p>現在のセル: {pointKey(snapshot.positions[selected])} · この日ここまでの判断 {decisions.length}件</p>
      {decisions.slice().reverse().map((d) => <div key={d.eventId} className="e1-row">
        <b>{clock(d.hour)} · {d.chosen?.kind ?? "待機"}</b><br />
        <small>観察地点 {d.knownContext.siteId} · 体力 {d.knownContext.energy} · 空腹 {d.knownContext.hunger}</small><br />
        <small>到達刺激 {d.stimuli.map((s) => s.kind).join("、") || "なし"} · {d.eventId}</small>
      </div>)}
      <p>元記録: {recording.finalStateHash} · 判断 {recording.decisions.length}件 · Event {recording.events.length}件</p>
    </aside></main>
  </div>;
}
