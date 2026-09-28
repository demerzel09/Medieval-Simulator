import { useEffect, useMemo, useRef, useState } from "react";
import type { VillageId } from "../../packages/ai/autonomous-world";
import { findGridPath, type GridMap, type GridPoint } from "../../packages/sim/grid-path";
import type { VillageRecording } from "../../packages/sim/village-recording";

const recordingUrl = new URL("../../fixtures/recordings/autonomous-village-exploring-90.v2.json.gz", import.meta.url).href;
const people: VillageId[] = ["S", "F", "C", "B1", "B2"];
const plantNames: Record<string, string> = {
  grain: "穀物", wild_berry: "野生ベリー", fruit_tree: "果樹", herb: "野草", grass: "草",
};
const stageNames: Record<string, string> = {
  bare: "未耕作", tilled: "耕作済み", seeded: "播種済み", growing: "成長中",
  ripe: "収穫可能", regrowing: "再生中", flowering: "開花中",
};
const actionNames: Record<string, string> = {
  plot_tilled: "耕作", plot_sown: "播種", crop_harvested: "収穫", foraged: "採集",
  food_delivered: "食品納品", food_sold: "食品販売", ate: "食事", wood_burned: "薪使用",
  travel_step: "移動", arrived: "到着", travel_replanned: "経路再探索",
  plant_discovered: "植物発見", plant_gathered: "植物採集",
  animal_born: "動物の出生", animal_died: "動物の死亡", season_changed: "季節変化",
};
const pointKey = (p: GridPoint) => `${p.x},${p.y}`;
const clock = (hour: number) => `${Math.floor((hour - 1) / 24) + 1}日目 ${String((hour - 1) % 24 + 1).padStart(2, "0")}時`;
const totalMinutes = 90 * 24 * 60;
const replayClock = (minutes: number) => {
  const day = Math.min(90, Math.floor(minutes / 1440) + 1);
  const minuteOfDay = minutes - (day - 1) * 1440;
  return `${day}日目 ${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
};

async function readRecording(): Promise<VillageRecording> {
  const response = await fetch(recordingUrl);
  if (!response.ok) throw Error(`記録の取得に失敗しました (${response.status})`);
  const bytes = await response.arrayBuffer();
  // Dev servers may decode Content-Encoding; static hosts may serve the .gz bytes directly.
  const source = new Uint8Array(bytes);
  const text = new TextDecoder().decode(source[0] === 0x1f && source[1] === 0x8b ?
    await new Response(new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() : bytes);
  const recording = JSON.parse(text) as VillageRecording;
  if (recording.rulesetId !== "autonomous-village-exploring-land-v5" || recording.untilHour !== 2160)
    throw Error("土地経済90日の記録ではありません");
  return recording;
}

function atHour(recording: VillageRecording, hour: number, eventFrame: number, minuteOfHour: number) {
  const positions: Record<VillageId, GridPoint> = {
    S: recording.initialGrid.sites.market, F: recording.initialGrid.sites.grove,
    C: recording.initialGrid.sites.market, B1: recording.initialGrid.sites.home_B1,
    B2: recording.initialGrid.sites.home_B2,
  };
  const plants = Object.fromEntries(Object.values(recording.initialLand.plants).map((p) =>
    [p.id, { ...p, cell: { ...p.cell } }]));
  const animals = Object.fromEntries(Object.values(recording.initialLand.animals).map((a) =>
    [a.id, { ...a, cell: { ...a.cell } }]));
  const totals = { grainMeals: 0, wildMeals: 0, gatheredMeals: 0,
    harvestedGrain: 0, meals: 0, wood: 0 };
  let frame = 0;
  let positionsAtHourStart: Record<VillageId, GridPoint> | undefined;
  for (const e of recording.events) {
    if (e.hour > hour) break;
    if (e.hour === hour && !positionsAtHourStart)
      positionsAtHourStart = Object.fromEntries(people.map((id) => [id, { ...positions[id] }])) as
        Record<VillageId, GridPoint>;
    if (e.hour === hour && frame++ >= eventFrame) break;
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
      if (e.data.species === "herb" || e.data.species === "fruit_tree") totals.gatheredMeals++;
    }
    if (e.kind === "wood_burned") totals.wood++;
  }
  if (positionsAtHourStart) for (const id of people) {
    const steps = recording.events.filter((e) => e.hour === hour && e.kind === "travel_step" &&
      e.actors[0] === id);
    const count = Math.floor(steps.length * minuteOfHour / 60);
    if (steps.length) positions[id] = count ?
      { x: Number(steps[count - 1].data.x), y: Number(steps[count - 1].data.y) } :
      positionsAtHourStart[id];
  }
  return { positions, plants, animals, totals };
}

function drawSpatialMap(canvas: HTMLCanvasElement, map: GridMap,
  snapshot: ReturnType<typeof atHour>, selected: VillageId, route?: GridPoint[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cellSize = 32;
  ctx.clearRect(0, 0, 1280, 768);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const px = x * cellSize, py = y * cellSize;
    const blocked = map.blocked.includes(`${x},${y}`);
    const farm = Math.max(Math.abs(x - map.sites.field.x), Math.abs(y - map.sites.field.y)) <= 3;
    const forest = Math.max(Math.abs(x - map.sites.grove.x), Math.abs(y - map.sites.grove.y)) <= 4;
    const meadow = Math.max(Math.abs(x - map.sites.meadow.x), Math.abs(y - map.sites.meadow.y)) <= 4;
    const building = blocked && x >= 6 && x <= 8 && y >= 3 && y <= 5;
    ctx.fillStyle = blocked ? building ? "#685842" : "#6b706e" :
      farm ? "#705b3d" : forest ? "#335a3e" : meadow ? "#5e7846" : "#496347";
    ctx.fillRect(px, py, cellSize, cellSize);
    if (blocked) {
      ctx.fillStyle = building ? "#8b7658" : "#8d938d";
      ctx.fillRect(px + 4, py + 4, 24, 24);
      ctx.fillStyle = "#474e49";
      ctx.fillRect(px + 4, py + 23, 24, 5);
    }
    ctx.strokeStyle = "rgba(16,32,24,.34)";
    ctx.strokeRect(px + .5, py + .5, 31, 31);
  }
  if (route) {
    ctx.strokeStyle = "#ffd36a"; ctx.lineWidth = 3; ctx.beginPath();
    route.forEach((p, index) => {
      if (index === 0) ctx.moveTo(p.x * 32 + 16, p.y * 32 + 16);
      else ctx.lineTo(p.x * 32 + 16, p.y * 32 + 16);
    });
    ctx.stroke(); ctx.lineWidth = 1;
  }
  const names: Record<string, string> = { market: "市場", grove: "森", field: "畑",
    meadow: "草原", home_B1: "B1宅", home_B2: "B2宅",
    rock_west: "岩場", ridge_east: "峠" };
  for (const [id, label] of Object.entries(names)) {
    const p = map.sites[id];
    ctx.fillStyle = id === "field" ? "#aa8c58" : "#3d4b43";
    ctx.fillRect(p.x * 32 + 2, p.y * 32 + 2, 28, 28);
    ctx.fillStyle = "#fff0c5"; ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
    ctx.fillText(label, p.x * 32 + 3, p.y * 32 + 29);
  }
  for (const plant of Object.values(snapshot.plants)) {
    const x = plant.cell.x * 32, y = plant.cell.y * 32;
    if (plant.species === "grain") {
      ctx.fillStyle = "#513f2c"; ctx.fillRect(x + 4, y + 5, 24, 22);
      if (plant.stage === "tilled") {
        ctx.fillStyle = "#96764b";
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 6, y + 9 + i * 6, 20, 2);
      } else if (["seeded", "growing", "ripe"].includes(plant.stage)) {
        ctx.fillStyle = plant.stage === "ripe" ? "#e6c75e" : "#80bd67";
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(x + 8 + i * 7, y + 13 - (plant.stage === "ripe" ? 4 : 0), 3,
            plant.stage === "seeded" ? 5 : 12);
          if (plant.stage === "ripe") ctx.fillRect(x + 6 + i * 7, y + 7, 7, 5);
        }
      }
    } else if (plant.species === "fruit_tree") {
      ctx.fillStyle = "#6b4b30"; ctx.fillRect(x + 14, y + 14, 5, 14);
      ctx.fillStyle = plant.stage === "flowering" ? "#d5a9bb" : "#4a9955";
      ctx.fillRect(x + 7, y + 4, 19, 16);
      if (plant.available) { ctx.fillStyle = "#efa864"; ctx.fillRect(x + 10, y + 8, 4, 4); }
    } else {
      ctx.fillStyle = plant.species === "wild_berry" ? "#648e4f" : "#88aa5a";
      ctx.fillRect(x + 6, y + 11, 20, 15);
      if (plant.available) {
        ctx.fillStyle = plant.species === "wild_berry" ? "#c77bac" : "#c8ce81";
        ctx.fillRect(x + 9, y + 10, 5, 5); ctx.fillRect(x + 20, y + 14, 4, 4);
      }
    }
  }
  for (const animal of Object.values(snapshot.animals)) {
    const x = animal.cell.x * 32, y = animal.cell.y * 32;
    ctx.fillStyle = "#e0d8bb";
    ctx.fillRect(x + 7, y + 14, 19, 11); ctx.fillRect(x + 10, y + 4, 4, 13);
    ctx.fillRect(x + 19, y + 3, 4, 14);
    ctx.fillStyle = "#202823"; ctx.fillRect(x + 19, y + 17, 3, 3);
  }
  const colors: Record<VillageId, string> = { S: "#ffe19a", F: "#e79562", C: "#8bc8dc",
    B1: "#d6b1e4", B2: "#c9da7c" };
  const occupied = new Map<string, number>();
  for (const id of people) {
    const p = snapshot.positions[id], key = pointKey(p), index = occupied.get(key) ?? 0;
    occupied.set(key, index + 1);
    const x = p.x * 32 + 3 + (index % 2) * 12, y = p.y * 32 + 3 + Math.floor(index / 2) * 12;
    ctx.fillStyle = colors[id]; ctx.fillRect(x + 3, y, 8, 5);
    ctx.fillRect(x + 1, y + 5, 12, 10); ctx.fillRect(x + 3, y + 15, 3, 5);
    ctx.fillRect(x + 9, y + 15, 3, 5);
    ctx.fillStyle = "#1d2922"; ctx.font = "bold 10px sans-serif";
    ctx.fillText(id, x + 2, y + 13);
    if (id === selected) {
      ctx.strokeStyle = "#fff6c0"; ctx.lineWidth = 2;
      ctx.strokeRect(p.x * 32 + 1, p.y * 32 + 1, 30, 30); ctx.lineWidth = 1;
    }
  }
}

export default function VillageDebug() {
  const [recording, setRecording] = useState<VillageRecording>();
  const [error, setError] = useState("");
  const [cursorMinutes, setCursorMinutes] = useState(60);
  const [stepMinutes, setStepMinutes] = useState(5);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<VillageId>("F");
  const [routeTo, setRouteTo] = useState("");
  const [sideOpen, setSideOpen] = useState(true);
  const [sideTab, setSideTab] = useState<"history" | "legend">("history");
  const [focusCell, setFocusCell] = useState<GridPoint>({ x: 15, y: 9 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void readRecording().then((value) => { if (active) setRecording(value); })
      .catch((cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!playing || !recording || cursorMinutes >= totalMinutes) return;
    const timer = window.setInterval(() => setCursorMinutes((current) =>
      Math.min(totalMinutes, current + stepMinutes)), speed === 4 ? 100 : 400);
    return () => window.clearInterval(timer);
  }, [playing, recording, stepMinutes, speed, cursorMinutes >= totalMinutes]);
  useEffect(() => { if (cursorMinutes >= totalMinutes) setPlaying(false); }, [cursorMinutes]);
  const day = Math.min(90, Math.floor(cursorMinutes / 1440) + 1);
  const hourOfDay = cursorMinutes === totalMinutes ? 24 :
    Math.floor((cursorMinutes % 1440) / 60) + 1;
  const minuteOfHour = cursorMinutes === totalMinutes ? 60 : cursorMinutes % 60;
  const hour = Math.min(2160, Math.floor(cursorMinutes / 60) + 1);
  const eventsThisHour = useMemo(() => recording?.events.filter((e) => e.hour === hour) ?? [],
    [recording, hour]);
  const visibleFrame = Math.floor(eventsThisHour.length * minuteOfHour / 60);
  const visibleEventIds = useMemo(() => new Set(eventsThisHour.slice(0, visibleFrame)
    .map((e) => e.id)), [eventsThisHour, visibleFrame]);
  const snapshot = useMemo(() => recording && atHour(recording, hour, visibleFrame, minuteOfHour),
    [recording, hour, visibleFrame, minuteOfHour]);
  const gridNow = useMemo(() => {
    if (!recording) return undefined;
    const blocked = new Set(recording.initialGrid.blocked);
    for (const command of recording.terrainCommands) if (command.at <= hour) {
      if (command.blocked) blocked.add(pointKey(command.cell));
      else blocked.delete(pointKey(command.cell));
    }
    return { ...recording.initialGrid, blocked: [...blocked] };
  }, [recording, hour]);
  const route = useMemo(() => gridNow && snapshot && routeTo ?
    findGridPath(gridNow, snapshot.positions[selected], gridNow.sites[routeTo]) : undefined,
  [gridNow, snapshot, selected, routeTo]);
  useEffect(() => {
    if (!gridNow || !snapshot || !canvasRef.current) return;
    const canvas = canvasRef.current;
    drawSpatialMap(canvas, gridNow, snapshot, selected, route);
    let active = true;
    void document.fonts.load('700 10px "Noto Sans JP"', "市場森畑草原岩場峠").then(() => {
      if (active) drawSpatialMap(canvas, gridNow, snapshot, selected, route);
    });
    return () => { active = false; };
  }, [gridNow, snapshot, selected, route]);
  const dayEvents = useMemo(() => recording?.events.filter((e) => e.day === day &&
    (e.hour < hour || e.hour === hour && visibleEventIds.has(e.id)) &&
    (e.actors.includes(selected) ||
      ["crop_harvested", "plant_stage", "animal_born", "animal_died", "season_changed"].includes(e.kind))) ?? [],
  [recording, day, hour, visibleEventIds, selected]);
  const decisions = useMemo(() => recording?.decisions.filter((d) => d.actorId === selected &&
    d.hour > (day - 1) * 24 && (d.hour < hour || d.hour === hour &&
      visibleEventIds.has(d.eventId))) ?? [], [recording, day, hour, visibleEventIds, selected]);
  if (error) return <main className="e1-debug"><h1>土地経済の記録を開けませんでした</h1><p role="alert">{error}</p></main>;
  if (!recording || !snapshot || !gridNow) return <main className="e1-debug"><p>90日記録を読み込んでいます…</p></main>;
  const plantList = Object.values(snapshot.plants);
  const localPlants = plantList.filter((p) => pointKey(p.cell) === pointKey(focusCell));
  const localAnimals = Object.values(snapshot.animals).filter((a) => pointKey(a.cell) === pointKey(focusCell));
  const blocked = gridNow.blocked.includes(pointKey(focusCell));
  const building = blocked && focusCell.x >= 6 && focusCell.x <= 8 &&
    focusCell.y >= 3 && focusCell.y <= 5;
  const terrain = blocked ? building ? "建物" : "岩・山" :
    Math.max(Math.abs(focusCell.x - gridNow.sites.field.x),
      Math.abs(focusCell.y - gridNow.sites.field.y)) <= 3 ? "畑" :
    Math.max(Math.abs(focusCell.x - gridNow.sites.grove.x),
      Math.abs(focusCell.y - gridNow.sites.grove.y)) <= 4 ? "森" :
    Math.max(Math.abs(focusCell.x - gridNow.sites.meadow.x),
      Math.abs(focusCell.y - gridNow.sites.meadow.y)) <= 4 ? "草原" : "平地";
  return <div className="e1-debug village-debug">
    <header className="e1-top"><div><p className="eyebrow">AUTONOMOUS VILLAGE · RECORDED LAND ECONOMY</p>
      <h1>土地経済90日 · 空間デバッグ</h1></div><div><a href="/">90日ゲーム</a></div></header>
    <div className="e1-controls"><label>日 <input aria-label="土地経済の日" type="range" min="1" max="90" value={day}
      onChange={(e) => { setPlaying(false); setCursorMinutes((Number(e.target.value) - 1) * 1440); }} /></label>
      <button onClick={() => { setPlaying(false); setCursorMinutes(Math.max(0, cursorMinutes - 1440)); }}>−1日</button>
      <button onClick={() => { setPlaying(false); setCursorMinutes(Math.min(totalMinutes, cursorMinutes + 1440)); }}>＋1日</button>
      <label>時刻 <input aria-label="土地経済の時刻" type="range" min="1" max="24" value={hourOfDay}
        onChange={(e) => { setPlaying(false); setCursorMinutes((day - 1) * 1440 +
          (Number(e.target.value) - 1) * 60); }} /></label>
      <label>分 <input aria-label="土地経済の分" type="range" min="0" max="60" step={stepMinutes}
        value={minuteOfHour} onChange={(e) => { setPlaying(false); setCursorMinutes(Math.min(totalMinutes,
          (day - 1) * 1440 + (hourOfDay - 1) * 60 + Number(e.target.value))); }} /></label>
      <strong aria-live="polite">{replayClock(cursorMinutes)}</strong>
      <label>移動の刻み <select aria-label="移動の刻み" value={stepMinutes}
        onChange={(e) => { const next = Number(e.target.value); setStepMinutes(next);
          setCursorMinutes((current) => Math.floor(current / next) * next); }}>
        <option value="5">5分</option><option value="15">15分</option>
        <option value="30">30分</option><option value="60">1時間</option>
      </select></label>
      <button onClick={() => { setPlaying(false); setCursorMinutes(Math.min(totalMinutes,
        cursorMinutes + stepMinutes)); }} disabled={cursorMinutes >= totalMinutes}>＋1刻み</button>
      <button onClick={() => { setSpeed(1); setPlaying(true); }} disabled={cursorMinutes >= totalMinutes}>再生</button>
      <button onClick={() => setPlaying(false)} disabled={!playing}>停止</button>
      <button onClick={() => { setSpeed(4); setPlaying(true); }} disabled={cursorMinutes >= totalMinutes}>早送り ×4</button>
      <span role="status">{playing ? speed === 4 ? "早送り中" : "再生中" : "停止中"} · {visibleFrame}/{eventsThisHour.length} Event</span></div>
    <div className="e1-stats"><span>食事 <b>{snapshot.totals.meals}/450</b></span>
      <span>穀物の食事 <b>{snapshot.totals.grainMeals}</b></span>
      <span>野生ベリーの食事 <b>{snapshot.totals.wildMeals}</b></span>
      <span>探索した植物の食事 <b>{snapshot.totals.gatheredMeals}</b></span>
      <span>穀物収穫 <b>{snapshot.totals.harvestedGrain}</b></span>
      <span>薪使用 <b>{snapshot.totals.wood}/450</b></span>
      <span>動物 <b>{Object.keys(snapshot.animals).length}</b></span></div>
    <main className={`e1-layout${sideOpen ? "" : " village-side-collapsed"}`}><section className="e1-map-panel">
      <p>保存済みのEventを順に再生します。分単位の移動位置は、1時間内の通過セルを均等に割り当てた目安です。黄色い線は行先を選んだ場合の計算経路です。</p>
      <div className="village-canvas-scroll"><canvas ref={canvasRef} width={1280} height={768}
        role="img" aria-label="土地経済の1280×768ピクセル地図"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const cell = { x: Math.floor((event.clientX - rect.left) / rect.width * 40),
            y: Math.floor((event.clientY - rect.top) / rect.height * 24) };
          setFocusCell(cell);
          const actor = people.find((id) => pointKey(snapshot.positions[id]) === pointKey(cell));
          if (actor) setSelected(actor);
        }} /></div>
      <p className="e1-legend">32ピクセル×40列×24行。色と記号の説明は右側の「凡例」タブで確認できます。</p>
      <h2>{day}日目の関連Event（{dayEvents.length}件）</h2>
      <div className="e1-action-log">{dayEvents.slice().reverse().slice(0, 120).map((e) =>
        <p key={e.id} className="e1-row"><b>{clock(e.hour)} · {e.actors.join("、") || "世界"} · {actionNames[e.kind] ?? e.kind}</b><br />
          <small>{e.id} ← {e.causes.join(", ") || "起点"} · {JSON.stringify(e.data)}</small></p>)}</div>
    </section><aside className="e1-detail village-side" aria-label="人物の履歴と地図の凡例">
      <button type="button" className="village-side-toggle" aria-expanded={sideOpen}
        onClick={() => setSideOpen((open) => !open)}>
        {sideOpen ? "履歴・凡例を閉じる" : "履歴・凡例を開く"}</button>
      {sideOpen && <><div role="tablist" aria-label="地図の詳細" className="village-tabs"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = sideTab === "history" ? "legend" : "history";
          setSideTab(next);
          document.getElementById(`village-${next}-tab`)?.focus();
        }}>
        <button type="button" role="tab" id="village-history-tab" aria-controls="village-side-panel"
          aria-selected={sideTab === "history"} tabIndex={sideTab === "history" ? 0 : -1}
          onClick={() => setSideTab("history")}>人物の履歴</button>
        <button type="button" role="tab" id="village-legend-tab" aria-controls="village-side-panel"
          aria-selected={sideTab === "legend"} tabIndex={sideTab === "legend" ? 0 : -1}
          onClick={() => setSideTab("legend")}>凡例</button>
      </div><div role="tabpanel" id="village-side-panel"
        aria-labelledby={sideTab === "history" ? "village-history-tab" : "village-legend-tab"}>
        {sideTab === "history" ? <>
          <h2>{selected} の判断履歴</h2>
          <div className="village-side-selectors">
            <label>人物 <select aria-label="土地経済の人物" value={selected}
              onChange={(e) => setSelected(e.target.value as VillageId)}>{people.map((id) =>
                <option key={id} value={id}>{id}</option>)}</select></label>
            <label>経路の行先 <select aria-label="経路の行先" value={routeTo}
              onChange={(e) => setRouteTo(e.target.value)}><option value="">表示しない</option>
              {Object.keys(recording.initialGrid.sites).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
          </div>
          <p>現在のセル: {pointKey(snapshot.positions[selected])} · 経路 {route ? `${route.length - 1}セル` : "表示なし"} · この日ここまでの判断 {decisions.length}件</p>
          <h3>選択セル {pointKey(focusCell)}</h3>
          <p>{terrain} · {blocked ? "通行不可" : "通行可能"} · {localPlants.map((p) =>
            `${plantNames[p.species]} ${stageNames[p.stage] ?? p.stage} ${p.available}`).join(" / ") || "植物なし"} · {localAnimals.map((a) => a.id).join(" / ") || "動物なし"}</p>
          {decisions.slice().reverse().map((d) => <div key={d.eventId} className="e1-row">
            <b>{clock(d.hour)} · {d.chosen?.kind ?? "待機"}</b><br />
            <small>観察地点 {d.knownContext.siteId} · 体力 {d.knownContext.energy} · 空腹 {d.knownContext.hunger}</small><br />
            <small>到達刺激 {d.stimuli.map((s) => s.kind).join("、") || "なし"} · {d.eventId}</small>
          </div>)}
          <p>元記録: {recording.finalStateHash} · 判断 {recording.decisions.length}件 · Event {recording.events.length}件</p>
        </> : <>
          <h2>地図の凡例</h2>
          <p>1セルは32×32ピクセル。地面の色は土地の種類、セル内の形は植物や障害物を表します。</p>
          <h3>地面と障害物</h3>
          <ul className="village-legend-list">
            <li><span className="village-swatch terrain-plain" />平地：濃い緑</li>
            <li><span className="village-swatch terrain-forest" />森：深緑。野草や果樹が育つ</li>
            <li><span className="village-swatch terrain-meadow" />草原：黄緑。草と動物がいる</li>
            <li><span className="village-swatch terrain-field" />畑：茶色。区画ごとに作物が育つ</li>
            <li><span className="village-swatch terrain-building" />建物：茶色い小さな矩形。通行不可</li>
            <li><span className="village-swatch terrain-rock" />岩・山：灰色の小さな矩形。通行不可</li>
          </ul>
          <h3>植物と動物</h3>
          <ul className="village-legend-list">
            <li><span className="village-swatch plant-grain" />穀物：畑の茶色い区画。緑の芽から黄色い穂へ成長</li>
            <li><span className="village-swatch plant-berry" />野生ベリー：緑の株と紫の実</li>
            <li><span className="village-swatch plant-herb" />野草：緑の株と薄黄の葉</li>
            <li><span className="village-swatch plant-tree" />果樹：茶色の幹と緑の冠、橙の実</li>
            <li><span className="village-swatch plant-grass" />草：緑の株。動物の食べ物</li>
            <li><span className="village-swatch animal-rabbit" />ウサギ：白い体と耳</li>
          </ul>
          <h3>移動と人物</h3>
          <ul className="village-legend-list">
            <li><span className="village-swatch route-line" />黄色い線：選択した人物から行先への計算経路</li>
            <li><span className="village-swatch person-farmer" />人物：S 商人、F 農夫、C 運び手、B1・B2 木こり。色と文字で区別</li>
            <li><span className="village-swatch person-selected" />薄黄色の枠：選択中の人物のセル</li>
          </ul>
          <h3>選択セル {pointKey(focusCell)}</h3>
          <p>{terrain} · {blocked ? "通行不可" : "通行可能"} · {localPlants.map((p) =>
            `${plantNames[p.species]} ${stageNames[p.stage] ?? p.stage} ${p.available}`).join(" / ") || "植物なし"} · {localAnimals.map((a) => a.id).join(" / ") || "動物なし"}</p>
        </>}
      </div></>}
    </aside></main>
  </div>;
}
