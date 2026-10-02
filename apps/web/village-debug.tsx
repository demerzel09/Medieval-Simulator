import { useEffect, useMemo, useRef, useState } from "react";
import { VillageStatusReplay } from "./village-status-replay";
import type { VillageId } from "../../packages/ai/autonomous-world";
import { findGridPathV2, type GridMap, type GridPoint } from "../../packages/sim/grid-path";
import { bodilyDiscomfort, type InventoryStatus, type PersonStatus } from "../../packages/sim/village-status";
import { loadMovement, type LoadTransport } from "../../packages/sim/load-movement";
import type { VillageRecording } from "../../packages/sim/village-recording";
import type { ActionLearningMemory } from "../../packages/ai/action-learning";

const woodQuery = new URLSearchParams(window.location.search).get("wood");
const recordMode = woodQuery === "legacy" || woodQuery === "paused" || woodQuery === "farms" || woodQuery === "wild" || woodQuery === "local" || woodQuery === "bread" || woodQuery === "needs" || woodQuery === "market" || woodQuery === "home" || woodQuery === "load" ? woodQuery : "learn";
const processedFood = recordMode === "bread" || recordMode === "needs" || (recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn");
const legacyWood = recordMode === "legacy";
const recordingUrl = recordMode === "learn" ?
  new URL("../../fixtures/recordings/autonomous-village-experience-learning-90.v2.json.gz", import.meta.url).href : recordMode === "load" ?
  new URL("../../fixtures/recordings/autonomous-village-bulk-transport-90.v2.json.gz", import.meta.url).href : recordMode === "home" ?
  new URL("../../fixtures/recordings/autonomous-village-home-storage-90.v2.json.gz", import.meta.url).href : recordMode === "market" ?
  new URL("../../fixtures/recordings/autonomous-village-food-market-90.v2.json.gz", import.meta.url).href : legacyWood ?
  new URL("../../fixtures/recordings/autonomous-village-ecological-90.v2.json.gz", import.meta.url).href :
  recordMode === "paused" ?
  new URL("../../fixtures/recordings/autonomous-village-wood-paused-90.v2.json.gz", import.meta.url).href :
  recordMode === "farms" ?
  new URL("../../fixtures/recordings/autonomous-village-owned-farms-90.v2.json.gz", import.meta.url).href :
  recordMode === "wild" ?
  new URL("../../fixtures/recordings/autonomous-village-wild-food-90.v2.json.gz", import.meta.url).href :
  recordMode === "local" ?
  new URL("../../fixtures/recordings/autonomous-village-local-work-90.v2.json.gz", import.meta.url).href :
  recordMode === "bread" ?
  new URL("../../fixtures/recordings/autonomous-village-bread-90.v2.json.gz", import.meta.url).href :
  new URL("../../fixtures/recordings/autonomous-village-needs-90.v2.json.gz", import.meta.url).href;
const people: VillageId[] = ["S", "F", "C", "B1", "B2"];
const plantNames: Record<string, string> = {
  grain: "穀物", wild_berry: "野生ベリー", fruit_tree: "果樹", herb: "野草", grass: "草",
};
const stageNames: Record<string, string> = {
  bare: "未耕作", tilled: "耕作済み", seeded: "播種済み", growing: "成長中",
  ripe: "収穫可能", regrowing: "再生中", flowering: "開花中", fallow: "休止中",
};
const actionNames: Record<string, string> = {
  grain_loaded: "穀物庫から積む", home_cash_stored: "家に現金を保管", home_cash_taken: "家の現金を持ち出す", home_item_stored: "家に物品を保管", home_item_taken: "家の物品を持ち出す",
  plot_tilled: "耕作", plot_sown: "播種", crop_harvested: "収穫", foraged: "採集",
  slept: "睡眠", sleep_interrupted: "睡眠中断", body_changed: "身体・環境", grain_stored: "穀物を保存", bread_baked: "製パン", surplus_offered: "余剰食品の提示", surplus_sold: "余剰食品の売買",
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
  if (recording.rulesetId !== (recordMode === "learn" ? "autonomous-village-experience-learning-v17" : recordMode === "load" ? "autonomous-village-bulk-transport-v16" : recordMode === "home" ? "autonomous-village-home-storage-v15" : recordMode === "market" ? "autonomous-village-food-market-v14" : legacyWood ? "autonomous-village-ecological-land-v6" :
    recordMode === "paused" ? "autonomous-village-wood-paused-v7" :
    recordMode === "farms" ? "autonomous-village-owned-farms-v8" : recordMode === "wild" ? "autonomous-village-wild-food-market-v9" : recordMode === "local" ? "autonomous-village-local-work-v10" : recordMode === "bread" ? "autonomous-village-bread-storage-v11" : "autonomous-village-anticipatory-needs-v12") || recording.untilHour !== 2160)
    throw Error("土地経済90日の記録ではありません");
  return recording;
}

const reasonLabels: Record<string, string> = {
  "load sale surplus for affordable predicted market journey": "販売する余剰から、移動体力の見込みに収まる量を積む",
  "continue forage goal": "選んだ植物セルで採集を続ける",
  "finish selected food gathering before reconsidering trade": "到着した採集先で食料を取ってから、次の目的を考える",
  "collect immediately available food before another journey": "現在のセルで収穫可能な食料を確保する",
  "obtain local food while retaining effort to reach shelter": "家へ戻る体力を残し、現在のセルの食料を先に取る",
  "wait briefly for observed baking ingredients": "実際の原料提示を短時間待つ",
  "revisit personally observed food cell; confirm availability on arrival": "以前観察した植物セルへ行き、到着して収穫可能か確かめる",
  "explore beyond locally depleted food cells": "採り尽くした周辺から移動し、他の植物セルを探す",
  "recover before choosing a feasible sale load": "売却分を積む前に、運べる体力を回復する",
  "retrieve one stored grain for observed tilled crop": "耕作済みの作物に播く穀物1を保管庫から用意する",
  "recover energy for predicted loaded journey": "荷重を含む移動見込みに備えて体力を回復する",
  "leave heavy grain at home before seeking edible food": "食料を探す前に、重い穀物を自宅に預ける",
  "sowing requires actual carried grain; retain tilled plot": "携帯する穀物がないため、耕した畑を維持して播種を待つ",
  "take grain reserve for sowing owned crops": "自分の畑へ播種用の穀物を持ち出す",
  "return to owned grain stock for another load": "自宅・畑の保管穀物を次の便で運ぶ",
  "load only grain that fits while retaining planting reserve": "播種用を残し、携帯容量に収まる穀物を積む",
  "carrying capacity full; leave harvested grain safely at field": "携帯容量が一杯のため、穀物は畑に保管する",
  "leave excess cash in own home before carrying on": "使う現金を残し、余りを自宅に保管する",
  "take own stored cash for food purchases": "食料購入のため自宅の現金を持ち出す",
  "take edible reserve from own home": "自宅の食料備蓄を持ち出す",
  "leave surplus food in own home": "携帯する食料を残し、余りを自宅に保管する",
  "buy edible food with earned cash": "得た代金で食べられる食品を買う",
  "carry purchased grain to market bakery": "購入した穀物を市場の加工場所へ運ぶ",
  "market grain storage full; retain purchased grain": "市場の穀物庫が満杯で、購入原料を保持する",
  "store purchased ingredient before baking": "加工前に購入原料を保存する",
  "offer baked bread above personal food reserve": "自食用を残してパンを販売する",
  "buy offered grain for market bread production": "市場で製パンするため穀物を買う",
  "process owned market grain into bread": "市場の本人所有の穀物からパンを作る",
  "wait at market for observed ingredient sellers or bread buyers": "市場で原料の売り手やパンの買い手を待つ",
  "visit market to buy ingredients, bake or sell bread": "市場で原料購入・製パン・販売をする",
  "carry harvested grain to sell for edible food": "食料代を得るため、収穫した穀物を市場へ運ぶ",
  "offer inedible grain to an ingredient buyer": "そのまま食べられない穀物を原料として売る",
  "wait for an actual grain buyer; retain ownership until sale": "穀物の買い手を待つ。売れるまで本人の所有物",
  "visit market to obtain edible food instead of eating raw grain": "食べられる食品を買うため市場へ向かう",
  "wait for an actual edible-food offer": "購入できる食品の提示を待つ",
  "eat personal edible reserve": "自食用の備蓄を食べる",
  "recover at selected shelter": "選んだ避難場所で回復する",
  "prevent predicted sleep deficit": "予測した睡眠不足を避ける",
  "recover enough energy to reach shelter": "避難場所まで移動できる体力を回復する",
  "safe local sleep outweighs distant shelter journey": "遠い家への移動より、安全な現在地での睡眠を選ぶ",
  "recover activity fatigue without erasing sleep debt": "活動の疲労を回復する（睡眠不足は残る）",
  "grain storage full; retain carried grain": "穀物庫に空きがなく、手持ちを保持する",
  "store physically carried raw grain": "運んだ穀物を保存する",
  "prepare edible reserve before next hunger": "次の空腹に備えてパンを作る",
  "buy available food before hunger worsens": "空腹が悪化する前に食品を買う",
  "obtain raw material for impending food need": "近づく食事に必要な原料を収穫する",
  "gather locally observed food for impending hunger": "近づく空腹に備えて見つけた植物を採る",
  "revisit known food area; no visible food": "食用植物が見えず、知っている採集地を再訪する",
  "wait briefly for an actual buyer": "買い手を短時間待つ",
  "offer only food above personal reserve": "自食用の備蓄を超える食品を売る",
  "work owned crop for bounded personal reserve": "必要な備蓄量に応じて自分の畑で働く",
  "observe own crop growth": "自分の作物の生育を確かめる",
  "reserve sufficient or waiting for observed growth; no forced daily task": "備蓄が十分、または生育待ち",
  "revise travel effort after actual exhaustion rejection": "移動の拒否を受け、体力の見積もりを見直して休む",
  "defer exposed trip; predicted cold exceeds reserve benefit": "屋外の寒さを予測し、急がない移動を見送る",
  "continue sleep goal": "選んだ睡眠場所へ向かう",
  "continue store goal": "選んだ穀物庫へ向かう",
  "continue bake goal": "製パンする場所へ向かう",
  "continue sell goal": "余剰を販売する場所へ向かう",
};
const activityLabels: Record<string, string> = { sleep: "睡眠", rest: "休憩", travel: "移動", bake_bread: "製パン",
  gather_plant: "採集", till_plot: "耕作", sow_plot: "播種", harvest_plot: "収穫" };

const itemNames: Record<string, string> = { ...plantNames, bread: "パン", seed: "播種用の穀物", wood: "薪" };
function ExperienceCard({ memory }: { memory?: ActionLearningMemory }) {
  const outcome = memory?.recent.at(-1), p = memory?.pending.at(-1) ?? outcome?.prediction;
  return <section className="village-status-card" aria-label="経験からの見込み"><h3>経験からの見込み</h3>
    {!memory ? <p>まだ行動経験はありません。</p> : <>
      <p>対応した結果 {memory.totals.matched}件 · 条件の記憶 {Object.keys(memory.models).length}件 · 結果待ち {memory.pending.length}件</p>
      {p && <p>{activityLabels[p.action] ?? p.action} · 荷物の重量 {p.before.mass}<br />
        体力の見込み：{p.selected === "experience" ? "本人の経験" : "初期の見込み"} · {(p.selected === "experience" ? p.learnedRate! : p.priorRate).toFixed(2)}/時間<br />
        予定期間 {p.expectedHours.toFixed(1)}時間</p>}
      {outcome && <p>直前の結果：{outcome.status === "completed" ? "完了" : outcome.status === "failed" ? "失敗" : outcome.status === "interrupted" ? "中断" : "学習対象外"}
        {outcome.energyChange !== undefined && <> · 体力の実変化 {outcome.energyChange}</>}
        {outcome.error !== undefined && <> · 観測区間の予測との差 {outcome.error.toFixed(2)}</>}</p>}
      {outcome && <p>実際の増減：食事分 {outcome.mealsChange ?? "不明"} · 原料 {outcome.rawChange ?? "不明"} · 現金 {outcome.cashChange ?? "不明"}</p>}
      <small>自分に届いた結果で更新します。同じ重量の荷物は共通の移動経験を使います。</small>
    </>}
  </section>;
}
function InventoryCard({ title, inventory, day, owner }: { title: string; inventory: InventoryStatus; day: number; owner: string }) {
  return <section className="village-status-card" aria-label={title}>
    <h3>{title}</h3><dl className="village-status-values">
      <div><dt>所持金</dt><dd>{inventory.cash}</dd></div>
      <div><dt>総重量 / 容量</dt><dd>{inventory.mass} / {inventory.capacity}</dd></div>
    </dl><small>所有者 {owner} · 重量はシミュレーション単位</small>
    {inventory.items.length ? <table className="village-inventory-table"><thead><tr><th>物品</th><th>数量</th><th>重量</th><th>状態</th></tr></thead>
      <tbody>{inventory.items.map((item) => <tr key={item.id}><td><details><summary>{itemNames[item.kind] ?? item.kind}</summary>
        <small>{item.id}<br />所有者 {item.ownerId}<br />保管先 {item.containerId}</small></details></td>
        <td>{item.quantity}</td><td>{item.mass}</td><td>{item.expiresDay === undefined ? (item.kind === "grain" ? "腐敗なし・原料" : "期限なし") :
          `あと${Math.max(0, item.expiresDay - day)}日`}{item.offered && <small>販売提示あり</small>}</td></tr>)}</tbody></table> : <p className="village-empty-inventory">物品なし</p>}
  </section>;
}
function StatusCards({ status, person, day, transport, realMealClock }: { status: PersonStatus; person: VillageId; day: number; transport?: LoadTransport; realMealClock?: boolean }) {
  const needs = bodilyDiscomfort(status.body);
  return <div className="village-status-stack">
    <small>状態の記録：{status.hour === 0 ? "開始時" : clock(status.hour)}</small>
    <p className="village-cash-total">現金合計（携帯＋保管） <b>{status.carried.cash + status.home.cash + status.market.cash}</b></p>
    <InventoryCard title="携帯中の所持品" inventory={status.carried} day={day} owner={person} />
    {transport && <p aria-label="運搬負荷">歩行速度：無荷物時の{Math.round(loadMovement(status.carried.mass, transport).speedRatio * 100)}% · 移動中の体力消費：{loadMovement(status.carried.mass, transport).energyPerHour}/時間</p>}
    <section className="village-status-card" aria-label="人物の身体ステータス"><h3>{person} の身体</h3>
      <dl className="village-status-values"><div><dt>体力</dt><dd>{status.body.energy} / {status.body.maxEnergy}</dd></div>
        <div><dt>気温</dt><dd>{status.body.temperature}℃</dd></div><div><dt>空腹</dt><dd>{status.body.hunger}</dd></div>
        <div><dt>睡眠不足</dt><dd>{status.body.sleepDebt}時間</dd></div></dl>
      <p>{status.body.sheltered ? "自宅の屋内" : "屋外"} · {realMealClock ? "食事からの経過" : "食事周期（旧記録）"} {status.body.mealHours}時間</p>
      <div className="village-need-meter"><span>快適さ（身体）</span><b>{needs.comfort}%</b><progress aria-label="身体の快適さ" value={needs.comfort} max={100} /></div>
      {([["不快", needs.discomfort], ["空腹の負担", needs.hunger], ["寒さの負担", needs.cold], ["疲労", needs.fatigue], ["眠気", needs.sleepiness]] as const).map(([label, value]) =>
        <div className="village-need-meter discomfort" key={label}><span>{label}</span><b>{value}%</b><progress aria-label={label} value={value} max={100} /></div>)}
      <small>快・不快は身体の負担の目安。不快は4項目の最大値、快適さは100−不快。</small>
    </section>
    {status.field && <InventoryCard title="畑の保管品" inventory={status.field} day={day} owner={person} />}
    <InventoryCard title={`${person} の家の保管品`} inventory={status.home} day={day} owner={person} />
    {(status.market.items.length > 0 || status.market.cash > 0) && <InventoryCard title="市場の保管品" inventory={status.market} day={day} owner={person} />}
  </div>;
}

function atHour(recording: VillageRecording, hour: number, eventFrame: number, minuteOfHour: number) {
  const statusReplay = new VillageStatusReplay(recording.fixture);
  const statuses = statusReplay.statuses;
  const activeActions: Partial<Record<VillageId, string>> = {};
  const bodies: Partial<Record<VillageId, { temperature: number; cold: number; sleepDebt: number; sheltered: boolean }>> = {};
  const positions: Record<VillageId, GridPoint> = {
    S: recording.initialGrid.sites.market, F: recording.initialGrid.sites.grove,
    C: recording.initialGrid.sites.market, B1: recording.initialGrid.sites.home_B1,
    B2: recording.initialGrid.sites.home_B2,
  };
  const plants = Object.fromEntries(Object.values(recording.initialLand.plants).map((p) =>
    [p.id, { ...p, cell: { ...p.cell } }]));
  const ageAnchors = Object.fromEntries(Object.keys(plants).map((id) => [id, 0]));
  const animals = Object.fromEntries(Object.values(recording.initialLand.animals).map((a) =>
    [a.id, { ...a, cell: { ...a.cell } }]));
  const totals = { grainMeals: 0, wildMeals: 0, gatheredMeals: 0,
    harvestedGrain: 0, meals: 0, wood: 0, surplusSales: 0, grainSales: 0, breadSales: 0, breadMeals: 0, breadBaked: 0 };
  const grainStocks: Record<string, { ownerId: string; siteId: string; quantity: number }> = {};
  if (recording.fixture.breadEconomy) for (const id of people) {
    grainStocks[`granary_home_${id}`] = { ownerId: id, siteId: `home_${id}`, quantity: 0 };
    grainStocks[`granary_market_${id}`] = { ownerId: id, siteId: "market", quantity: 0 };
  }
  if (recording.fixture.bulkTransport) for (const p of Object.values(plants).filter((p) => p.species === "grain"))
    grainStocks[`granary_field_${p.id}`] = { ownerId: p.ownerId!, siteId: p.siteId, quantity: 0 };
  let frame = 0;
  let positionsAtHourStart: Record<VillageId, GridPoint> | undefined;
  for (const e of recording.events) {
    if (e.hour > hour) break;
    if (e.hour === hour && !positionsAtHourStart)
      positionsAtHourStart = Object.fromEntries(people.map((id) => [id, { ...positions[id] }])) as
        Record<VillageId, GridPoint>;
    if (e.hour === hour && frame++ >= eventFrame) break;
    statusReplay.apply(e);
    if (e.kind === "body_changed") bodies[e.actors[0] as VillageId] = {
      temperature: Number(e.data.temperature), cold: Number(e.data.cold), sleepDebt: Number(e.data.sleepDebt),
      sheltered: e.data.sheltered === 1 };
    if (e.kind === "process_started") activeActions[e.actors[0] as VillageId] = String(e.data.action);
    if (e.kind === "process_completed" || e.kind === "process_failed" || e.kind === "sleep_interrupted")
      delete activeActions[e.actors[0] as VillageId];
    if (e.kind === "crop_harvested" && e.data.storeId) grainStocks[String(e.data.storeId)].quantity += Number(e.data.quantity);
    if (e.kind === "grain_loaded" || e.kind === "home_item_taken" && grainStocks[String(e.data.storeId)]) grainStocks[String(e.data.storeId)].quantity -= Number(e.data.quantity);
    if (e.kind === "grain_stored") grainStocks[String(e.data.storeId)].quantity += Number(e.data.quantity);
    if (e.kind === "bread_baked") {
      grainStocks[String(e.data.storeId)].quantity -= Number(e.data.quantity);
      totals.breadBaked += Number(e.data.quantity);
    }
    if (e.kind === "ate" && e.data.product === "bread") totals.breadMeals++;
    if (e.kind === "surplus_sold") {
      totals.surplusSales++;
      if (e.data.product === "grain") totals.grainSales++;
      if (e.data.product === "bread") totals.breadSales++;
    }
    if (e.kind === "travel_step") {
      const actor = e.actors[0] as VillageId;
      positions[actor] = { x: Number(e.data.x), y: Number(e.data.y) };
    } else if (e.kind === "arrived") {
      const actor = e.actors[0] as VillageId;
      positions[actor] = recording.initialGrid.sites[String(e.data.siteId)];
    } else if (e.kind === "plot_tilled" || e.kind === "plot_sown" || e.kind === "plant_stage") {
      const id = String(e.data.plantId), plant = plants[id];
      if (plant) {
        plant.stage = (e.kind === "plot_tilled" ? "tilled" : e.kind === "plot_sown" ?
          "seeded" : e.data.stage) as typeof plant.stage;
        plant.ageHours = 0; ageAnchors[id] = e.hour;
      }
    }
    else if (e.kind === "crop_harvested") {
      const id = String(e.data.plantId), plant = plants[id];
      plant.stage = "fallow"; plant.available = 0; plant.ageHours = 0; ageAnchors[id] = e.hour;
      totals.harvestedGrain += Number(e.data.quantity);
    } else if (e.kind === "foraged" && e.data.resource === "food") {
      const id = String(e.data.plantId ?? "wild_berry"), plant = plants[id];
      if (plant) { plant.available -= Number(e.data.quantity); plant.stage = "regrowing";
        plant.ageHours = 0; ageAnchors[id] = e.hour; }
    } else if (e.kind === "plant_gathered" || e.kind === "animal_ate") {
      const id = String(e.data.plantId), plant = plants[id];
      if (plant) {
        plant.available -= Number(e.data.quantity);
        plant.stage = "regrowing"; plant.ageHours = 0; ageAnchors[id] = e.hour;
      }
    } else if (e.kind === "plant_grew" && plants[String(e.data.plantId)]) {
      const id = String(e.data.plantId), plant = plants[id];
      plant.available = Math.min(plant.capacity, plant.available + Number(e.data.quantity));
      plant.stage = "ripe"; plant.ageHours = 0; ageAnchors[id] = e.hour;
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
  for (const plant of Object.values(plants)) if (["growing", "regrowing", "fallow", "flowering"]
    .includes(plant.stage)) plant.ageHours += Math.max(0, hour - ageAnchors[plant.id]);
  return { positions, plants, animals, grainStocks, activeActions, bodies, statuses, totals };
}

const idHasOwnedFields = (map: GridMap) => !!map.sites.field_B1;

function drawSpatialMap(canvas: HTMLCanvasElement, map: GridMap,
  snapshot: ReturnType<typeof atHour>, selected: VillageId, route?: GridPoint[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cellSize = 32;
  ctx.clearRect(0, 0, 1280, 768);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const px = x * cellSize, py = y * cellSize;
    const blocked = map.blocked.includes(`${x},${y}`);
    const farm = Object.entries(map.sites).filter(([id]) => id === "field" || id.startsWith("field_"))
      .some(([, site]) => Math.max(Math.abs(x - site.x), Math.abs(y - site.y)) <=
        (idHasOwnedFields(map) ? 1 : 3));
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
    rock_west: "岩場", ridge_east: "峠",
    ...(map.sites.home_F ? { home_F: "F宅", home_S: "S宅", home_C: "C宅" } : {}),
    ...(idHasOwnedFields(map) ? { field: "F畑", field_B1: "B1畑", field_B2: "B2畑" } : {}) };
  for (const [id, label] of Object.entries(names)) {
    const p = map.sites[id];
    if (!p) continue;
    ctx.fillStyle = id === "field" ? "#aa8c58" : "#3d4b43";
    ctx.fillRect(p.x * 32 + 2, p.y * 32 + 2, 28, 28);
    ctx.fillStyle = "#fff0c5"; ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
    ctx.fillText(label, p.x * 32 + 3, p.y * 32 + 29);
  }
  for (const plant of Object.values(snapshot.plants)) {
    const x = plant.cell.x * 32, y = plant.cell.y * 32;
    if (plant.species === "grain") {
      ctx.fillStyle = plant.stage === "fallow" ? "#817967" : "#513f2c";
      ctx.fillRect(x + 4, y + 5, 24, 22);
      if (plant.stage === "tilled") {
        ctx.fillStyle = "#96764b";
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 6, y + 9 + i * 6, 20, 2);
      } else if (plant.stage === "fallow") {
        ctx.strokeStyle = "#c2b394"; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 7 + i * 7, y + 8);
          ctx.lineTo(x + 7 + i * 7, y + 23); ctx.stroke(); }
        ctx.lineWidth = 1;
      } else if (["seeded", "growing", "ripe"].includes(plant.stage)) {
        const growth = plant.stage === "growing" ?
          Math.min(1, plant.ageHours / plant.growHours) : 0;
        const height = plant.stage === "seeded" ? 4 : plant.stage === "ripe" ? 16 :
          6 + Math.round(10 * growth);
        ctx.fillStyle = plant.stage === "ripe" ? "#e6c75e" : "#80bd67";
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(x + 8 + i * 7, y + 24 - height, 3, height);
          if (plant.stage === "ripe") ctx.fillRect(x + 6 + i * 7, y + 7, 7, 5);
          else if (plant.stage === "seeded") ctx.fillRect(x + 7 + i * 7, y + 21, 5, 3);
        }
      }
      if (plant.ownerId) {
        ctx.strokeStyle = plant.ownerId === "F" ? "#ffd36a" : plant.ownerId === "B1" ? "#82c8ff" : "#d9a5ff";
        ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, 28, 28); ctx.lineWidth = 1;
      }
    } else if (plant.species === "fruit_tree") {
      ctx.fillStyle = "#6b4b30"; ctx.fillRect(x + 14, y + 14, 5, 14);
      ctx.fillStyle = plant.stage === "flowering" ? "#d5a9bb" :
        plant.stage === "regrowing" ? "#47684a" : "#4a9955";
      ctx.fillRect(x + 7, y + 4, 19, 16);
      if (plant.stage === "ripe" && plant.available) {
        ctx.fillStyle = "#efa864"; ctx.fillRect(x + 10, y + 8, 4, 4);
        ctx.fillRect(x + 19, y + 13, 4, 4);
      }
    } else {
      const regrowing = plant.stage === "regrowing";
      const growth = regrowing ? Math.min(1, plant.ageHours / plant.growHours) : 1;
      const height = regrowing ? 5 + Math.round(9 * growth) : 15;
      ctx.fillStyle = regrowing ? "#537357" :
        plant.species === "wild_berry" ? "#648e4f" : "#88aa5a";
      ctx.fillRect(x + 6, y + 26 - height, 20, height);
      if (plant.species === "grass" && plant.stage === "ripe") {
        ctx.fillStyle = "#c1d78b";
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 10 + i * 6, y + 6 + i % 2 * 3, 2, 12);
      } else if (plant.stage === "ripe" && plant.available) {
        ctx.fillStyle = plant.species === "wild_berry" ? "#c77bac" : "#c8ce81";
        ctx.fillRect(x + 9, y + 10, 5, 5); ctx.fillRect(x + 20, y + 14, 4, 4);
      }
    }
  }
  for (const stock of Object.values(snapshot.grainStocks)) {
    if (!stock.quantity) continue;
    const p = map.sites[stock.siteId];
    ctx.fillStyle = "#ba9250"; ctx.fillRect(p.x * 32 + 18, p.y * 32 + 3, 11, 9);
    ctx.fillStyle = "#fff0c5"; ctx.font = 'bold 10px "Noto Sans JP", sans-serif';
    ctx.fillText(String(stock.quantity), p.x * 32 + 15, p.y * 32 + 20);
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
    if (snapshot.activeActions[id] === "sleep") {
      ctx.fillStyle = "#f5f2cf"; ctx.fillText("Z", x + 15, y + 6);
    }
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
  const [sideWidth, setSideWidth] = useState(() => Math.max(640, Math.min(760, window.innerWidth * .43)));
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth - 32);
  const [resizing, setResizing] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendWidth, setLegendWidth] = useState(360);
  const legendDrag = useRef<{ x: number; width: number; moved: boolean } | undefined>(undefined);
  const layoutRef = useRef<HTMLElement>(null);
  const [focusCell, setFocusCell] = useState<GridPoint>({ x: 15, y: 9 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!layoutRef.current) return;
    const observer = new ResizeObserver(([entry]) => setLayoutWidth(entry.contentRect.width));
    observer.observe(layoutRef.current);
    return () => observer.disconnect();
  }, [recording]);
  const clampSideWidth = (width: number) => Math.max(560, Math.min(layoutWidth - 332, width));
  const displayedSideWidth = clampSideWidth(sideWidth);
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
    findGridPathV2(gridNow, snapshot.positions[selected], gridNow.sites[routeTo]) : undefined,
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
  const dayEvents = useMemo(() => recording?.events.filter((e) => e.kind !== "person_status" && e.day === day &&
    (e.hour < hour || e.hour === hour && visibleEventIds.has(e.id)) &&
    (e.actors.includes(selected) ||
      ["crop_harvested", "plant_stage", "animal_born", "animal_died", "season_changed"].includes(e.kind))) ?? [],
  [recording, day, hour, visibleEventIds, selected]);
  const decisions = useMemo(() => recording?.decisions.filter((d) => d.actorId === selected &&
    d.hour > (day - 1) * 24 && (d.hour < hour || d.hour === hour &&
      visibleEventIds.has(d.eventId))) ?? [], [recording, day, hour, visibleEventIds, selected]);
  const latestObservation = useMemo(() => recording?.decisions.filter((d) => d.actorId === selected &&
    (d.hour < hour || d.hour === hour && visibleEventIds.has(d.eventId))).at(-1),
  [recording, hour, visibleEventIds, selected]);
  if (error) return <main className="e1-debug"><h1>土地経済の記録を開けませんでした</h1><p role="alert">{error}</p></main>;
  if (!recording || !snapshot || !gridNow) return <main className="e1-debug"><p>90日記録を読み込んでいます…</p></main>;
  const selectedFarm = recording.fixture.landEconomy?.farms?.find((farm) => farm.ownerId === selected);
  const plantList = Object.values(snapshot.plants);
  const localPlants = plantList.filter((p) => pointKey(p.cell) === pointKey(focusCell));
  const localStocks = Object.values(snapshot.grainStocks).filter((s) => pointKey(gridNow.sites[s.siteId]) === pointKey(focusCell));
  const localAnimals = Object.values(snapshot.animals).filter((a) => pointKey(a.cell) === pointKey(focusCell));
  const blocked = gridNow.blocked.includes(pointKey(focusCell));
  const building = blocked && focusCell.x >= 6 && focusCell.x <= 8 &&
    focusCell.y >= 3 && focusCell.y <= 5;
  const terrain = blocked ? building ? "建物" : "岩・山" :
    Object.entries(gridNow.sites).filter(([id]) => id === "field" || id.startsWith("field_"))
      .some(([, site]) => Math.max(Math.abs(focusCell.x - site.x), Math.abs(focusCell.y - site.y)) <=
        (idHasOwnedFields(gridNow) ? 1 : 3)) ? "畑" :
    Math.max(Math.abs(focusCell.x - gridNow.sites.grove.x),
      Math.abs(focusCell.y - gridNow.sites.grove.y)) <= 4 ? "森" :
    Math.max(Math.abs(focusCell.x - gridNow.sites.meadow.x),
      Math.abs(focusCell.y - gridNow.sites.meadow.y)) <= 4 ? "草原" : "平地";
  return <div className="e1-debug village-debug">
    <header className="e1-top"><div><p className="eyebrow">AUTONOMOUS VILLAGE · RECORDED LAND ECONOMY</p>
      <h1>土地経済90日 · 生態デバッグ</h1></div><div>
        <label>表示する記録 <select aria-label="表示する記録" value={recordMode}
          onChange={(e) => { const url = new URL(window.location.href);
            if (e.target.value !== "learn") url.searchParams.set("wood", e.target.value);
            else url.searchParams.delete("wood");
            window.location.assign(url.href); }}>
          <option value="learn">経験学習・目的のある運搬・食事時計</option><option value="load">旧記録：収穫20・畑の保管・荷重と運搬</option><option value="home">旧記録：人物ステータス・自宅保管・食品市場</option><option value="market">旧記録：穀物売却・市場製パン・パン購入</option><option value="needs">旧記録：自宅製パン・欲求と経験</option><option value="bread">旧記録：穀物保存・パン加工</option><option value="local">植物セルで採集・農作業</option><option value="wild">旧記録：往復採集・余剰売買</option><option value="farms">所有畑・穀物保存</option><option value="paused">薪停止の対照記録</option><option value="legacy">旧記録：固定薪資源あり</option>
        </select></label> <a href="/">90日ゲーム</a></div></header>
    {recordMode === "paused" && <p className="e1-map-panel" role="note">薪の採集・売買・燃料要求は停止中です。
      B1・B2の薪販売収入もなくなるため、食料代の不足と市場の資金不足が起きる対照記録です。
      90日間の正常稼働を示す記録ではありません。旧記録でCが森に待機するのは食料の引渡し待ちです。</p>}
    {recordMode === "farms" && <p className="e1-map-panel" role="note">穀物は腐敗しません。
      F・B1・B2がそれぞれ自分の畑を耕作・播種・収穫します。薪と雇用は使いません。
      農夫3人は90日食料を確保しますが、S・Cの食料市場の資金循環は未解決です。</p>}
    {recordMode === "wild" && <p className="e1-map-panel" role="note">全員が野草・ベリーを採集して直接食べられます。
      余剰は市場で提示し、買い手が現金で購入します。採集には移動・体力と再生待ちが必要です。
      穀物は腐敗せず、薪・雇用・製パン・技能習得・転職は未導入です。</p>}
    {recordMode === "local" && <p className="e1-map-panel" role="note">採集は植物のセルへ移動してから行い、
      その場で食事・休息できます。森・畑の中心へ自動では戻りません。
      作業対象がなければ生育・再生待ち、余剰の販売中は市場で買い手待ちになります。</p>}
    {processedFood && <p className="e1-map-panel" role="note">穀物は直接食べられません。原料として扱います。
      {(recordMode === "load" || recordMode === "learn") && <>播種1→収穫20、穀物1単位の重量2。袋の容量20、人物全体24。畑に収穫物を保管し、容量に収まる量を分けて運びます。荷物が重いほど歩行が遅く、体力消費が増えます。 </>}
      {(recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn") ? <>農夫は穀物を市場で売り、代金でパンを購入します。初期の製パン技能はSだけが持ち、市場の穀物庫に買った原料を保存して加工します。</> : <>収穫後は本人の家か市場の穀物庫へ運び、腐敗せず保存します。</>}
      穀物1から2時間でパン1を作り、パンは製造日から3日で腐敗します。野草・ベリーは直接食べられます。
      {(recordMode === "needs" || (recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn")) && <> 気温・睡眠不足・場所の回復を扱い、経験から先の冷え方と移動時間を見積もります。短い休憩と睡眠は別です。</>}</p>}
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
      <span>{processedFood ? "パンの食事" : "穀物の食事"} <b>{processedFood ? snapshot.totals.breadMeals : snapshot.totals.grainMeals}</b></span>
      {processedFood && <><span>製パン <b>{snapshot.totals.breadBaked}</b></span><span>穀物保存 <b>{Object.values(snapshot.grainStocks).reduce((n, s) => n + s.quantity, 0)}</b></span></>}
      <span>野生ベリーの食事 <b>{snapshot.totals.wildMeals}</b></span>
      <span>探索した植物の食事 <b>{snapshot.totals.gatheredMeals}</b></span>
      <span>穀物収穫 <b>{snapshot.totals.harvestedGrain}</b></span>
      {(recordMode === "farms" || recordMode === "wild" || recordMode === "local" || processedFood) && <span>穀物保存 <b>腐敗なし</b></span>}
      <span>薪 <b>{legacyWood ? `使用 ${snapshot.totals.wood}/450` : "停止中"}</b></span>
      {(recordMode === "wild" || recordMode === "local" || processedFood) && <span>余剰売買 <b>{snapshot.totals.surplusSales}件</b></span>}
      {(recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn") && <><span>穀物売買 <b>{snapshot.totals.grainSales}件</b></span><span>パン売買 <b>{snapshot.totals.breadSales}件</b></span></>}
      <span>動物 <b>{Object.keys(snapshot.animals).length}</b></span></div>
    <main ref={layoutRef} className={`e1-layout village-resizable-layout${resizing ? " is-resizing" : ""}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) 12px ${displayedSideWidth}px` }}>
      <section className="e1-map-panel">
        <p className="village-map-description">保存済みのEventを順に再生します。分単位の移動は1時間内の通過セルから補間した目安です。黄色い線は計算経路、植物の色と高さは生育段階です。</p>
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
        <p className="e1-legend">32ピクセル×40列×24行。表示は地図の幅に合わせて拡縮します。右端の「凡例」をクリック、または左へ引くと説明を開けます。</p>
      </section>
      <div role="separator" aria-label="地図と人物パネルの幅" aria-orientation="vertical"
        aria-valuemin={560} aria-valuemax={Math.max(560, Math.floor(layoutWidth - 332))}
        aria-valuenow={Math.round(displayedSideWidth)} tabIndex={0} className="village-divider"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !layoutRef.current) return;
          const rect = layoutRef.current.getBoundingClientRect();
          const padding = parseFloat(getComputedStyle(layoutRef.current).paddingRight);
          setSideWidth(clampSideWidth(rect.right - padding - event.clientX - 6));
        }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
        onLostPointerCapture={() => setResizing(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); setSideWidth(clampSideWidth(displayedSideWidth + (event.key === "ArrowLeft" ? 32 : -32)));
          } else if (event.key === "Home") { event.preventDefault(); setSideWidth(640); }
        }} />
      <aside className="e1-detail village-side" aria-label="人物のステータスと行動ログ">
        <div className="village-side-selectors">
          <label>人物 <select aria-label="土地経済の人物" value={selected}
            onChange={(e) => setSelected(e.target.value as VillageId)}>
            {people.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
          <label>経路の行先 <select aria-label="経路の行先" value={routeTo} onChange={(e) => setRouteTo(e.target.value)}>
            <option value="">表示しない</option>{Object.keys(recording.initialGrid.sites).map((id) =>
              <option key={id} value={id}>{id}</option>)}</select></label>
        </div>
        <p className="village-person-location">現在のセル: {pointKey(snapshot.positions[selected])} · 経路 {route ? `${route.length - 1}セル` : "表示なし"} ·
          進行中 {activityLabels[snapshot.activeActions[selected] ?? ""] ?? "待機"}</p>
        <div className="village-inspector-panes">
          <section className="village-inspector-pane" aria-label="人物のステータス">
            <h2>{selected} のステータス</h2>
            {snapshot.statuses[selected] ? <StatusCards status={snapshot.statuses[selected]!} person={selected} day={day}
              transport={recording.fixture.bulkTransport} realMealClock={!!recording.fixture.experienceLearning} /> :
              <p>この旧記録には物品・身体のステータス記録がありません。行動ログの本人観察を参照できます。</p>}
            {recording.fixture.experienceLearning && <ExperienceCard memory={latestObservation?.response.subjectiveUpdate?.anticipation?.learning} />}
          </section>
          <section className="village-inspector-pane" aria-label="人物の行動ログ">
          <h2>{selected} の判断履歴</h2>
          {selectedFarm && <p>所有する畑: {selectedFarm.id} · {selectedFarm.plotIds.length}区画 · 穀物は腐敗なし</p>}
          {(recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn") && <p>製パン技能：{recording.fixture.foodMarket!.initialBakingSkills[selected]} · 市場で加工</p>}
          {snapshot.statuses[selected] && <p>所持金 {snapshot.statuses[selected]!.carried.cash} · 携帯重量 {snapshot.statuses[selected]!.carried.mass}/{snapshot.statuses[selected]!.carried.capacity} · 快適さ {bodilyDiscomfort(snapshot.statuses[selected]!.body).comfort}%</p>}
          {!snapshot.statuses[selected] && latestObservation && <p>最新の本人観察（{clock(latestObservation.hour)}）:
            所持金 {latestObservation.knownContext.ownCash} · 空腹 {latestObservation.knownContext.hunger} ·
            体力 {latestObservation.knownContext.energy} ·
            判断 {latestObservation.chosen?.kind ?? "待機"} ·
            進行中 {activityLabels[snapshot.activeActions[selected] ?? ""] ?? snapshot.activeActions[selected] ?? "なし"}</p>}
          {!snapshot.statuses[selected] && snapshot.bodies[selected] && <p>表示時点の身体：気温 {snapshot.bodies[selected]!.temperature}℃ ·
            寒さ {snapshot.bodies[selected]!.cold} · 睡眠不足 {snapshot.bodies[selected]!.sleepDebt} ·
            {snapshot.bodies[selected]!.sheltered ? "自宅の屋内" : "屋外"}</p>}
          {latestObservation?.response.subjectiveUpdate?.anticipation?.reasoning && <p>
            判断理由：{reasonLabels[latestObservation.response.subjectiveUpdate.anticipation.reasoning.reason] ?? latestObservation.response.subjectiveUpdate.anticipation.reasoning.reason}<br />
            対処の見込み {latestObservation.response.subjectiveUpdate.anticipation.reasoning.leadHours.toFixed(1)}時間 ·
            先の寒さ {latestObservation.response.subjectiveUpdate.anticipation.reasoning.forecastCold.toFixed(1)} ·
            記憶 {latestObservation.response.subjectiveUpdate.anticipation.experiences.length}件</p>}
          <h3>選択セル {pointKey(focusCell)}</h3>
          <p>{terrain} · {blocked ? "通行不可" : "通行可能"} · {localPlants.map((p) =>
            `${plantNames[p.species]} ${stageNames[p.stage] ?? p.stage} ${p.available}${p.ownerId ? ` · 所有者 ${p.ownerId} · ${p.farmId}` : ""}`).join(" / ") || "植物なし"} · {localAnimals.map((a) => a.id).join(" / ") || "動物なし"}</p>
          {localStocks.map((stock) => <p key={stock.ownerId}>穀物庫 {stock.ownerId}: {stock.quantity}単位 · 所有者 {stock.ownerId}</p>)}
          {(recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn") && <section aria-label="人物の最近の売買"><h3>最近の売買</h3>
            {recording.events.filter((e) => e.kind === "surplus_sold" && e.actors.includes(selected) &&
              (e.hour < hour || visibleEventIds.has(e.id))).slice(-6).reverse().map((e) => <p key={e.id}>
              {clock(e.hour)} · {e.data.product === "bread" ? "パン" : e.data.product === "grain" ? "穀物" : plantNames[String(e.data.species)]} {e.data.quantity}単位 ·
              {e.actors[0]} → {e.actors[1]} · 代金 {e.data.price}</p>)}
          </section>}
          {decisions.slice().reverse().map((d) => <div key={d.eventId} className="e1-row">
            <b>{clock(d.hour)} · {d.chosen?.kind ?? "待機"}</b><br />
            <small>観察地点 {d.knownContext.siteId} · 体力 {d.knownContext.energy} · 空腹 {d.knownContext.hunger} · 所持金 {d.knownContext.ownCash}</small><br />
            {d.stimuli.some((s) => s.reason) && <><small>結果: {d.stimuli.filter((s) => s.reason)
              .map((s) => s.reason).join("、")}</small><br /></>}
            <small>到達刺激 {d.stimuli.map((s) => s.kind).join("、") || "なし"} · {d.eventId}</small>
          </div>)}
          <p>元記録: {recording.finalStateHash} · 判断 {recording.decisions.length}件 · Event {recording.events.length}件</p>
            <h3>{day}日目の関連Event（{dayEvents.length}件）</h3>
            {dayEvents.slice().reverse().slice(0, 120).map((e) =>
              <p key={e.id} className="e1-row"><b>{clock(e.hour)} · {e.actors.join("、") || "世界"} · {actionNames[e.kind] ?? e.kind}</b><br />
                <small>{e.id} ← {e.causes.join(", ") || "起点"} · {JSON.stringify(e.data)}</small></p>)}
          </section>
        </div>
      </aside>
    </main>
    <aside className={`village-legend-drawer${legendOpen ? " is-open" : ""}`} style={{ width: legendWidth }}
      aria-label="独立した地図の凡例" onKeyDown={(event) => {
        if (event.key === "Escape") { setLegendOpen(false); document.getElementById("village-legend-pull")?.focus(); }
      }}>
      <button type="button" id="village-legend-pull" className="village-legend-pull" aria-expanded={legendOpen}
        aria-controls="village-legend-content" aria-label="凡例を引き出す" title="クリックで開閉・左へドラッグで引き出す"
        onClick={(event) => {
          if (event.detail === 0 || !legendDrag.current?.moved) setLegendOpen((open) => !open);
          legendDrag.current = undefined;
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          legendDrag.current = { x: event.clientX, width: legendOpen ? legendWidth : 0, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = legendDrag.current;
          if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const delta = drag.x - event.clientX;
          if (Math.abs(delta) < 4 && !drag.moved) return;
          drag.moved = true;
          const extent = drag.width + delta;
          setLegendOpen(extent > 100);
          setLegendWidth(Math.max(280, Math.min(window.innerWidth - 40, 600, extent)));
        }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { legendDrag.current = undefined; }}>
        凡例
      </button>
      <div id="village-legend-content" className="village-legend-content" inert={!legendOpen} aria-hidden={!legendOpen}>
        <button type="button" className="village-legend-dismiss" onClick={() => setLegendOpen(false)}>凡例をしまう</button>
          <h2>地図の凡例</h2>
          {(recordMode === "needs" || (recordMode === "market" || recordMode === "home" || recordMode === "load" || recordMode === "learn")) && <p>家：本人の家では保温と睡眠回復が有利です。帰宅時刻は固定せず、予測と身体の必要から選びます。屋外睡眠も可能です。人物の横の「Z」は睡眠中です。</p>}
          {processedFood && <p>黄茶色の箱と数字：家・市場・畑の穀物庫と保存量。穀物は原料で直接食べられません。パンは製造日から3日で腐敗します。</p>}
          <p>1セルは32×32ピクセル。地面の色は土地の種類、セル内の形は植物や障害物を表します。</p>
          {(recordMode === "farms" || recordMode === "wild" || recordMode === "local" || processedFood) && <p>畑の枠色：Fは黄、B1は青、B2は紫。各4区画で、所有者だけが作業できます。穀物は腐敗しません。</p>}
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
            <li><span className="village-swatch plant-grain" />穀物：耕作の筋→小さな芽→伸びる緑の茎→黄色い穂。収穫後は灰茶色の休止区画</li>
            <li><span className="village-swatch plant-fallow" />休止中の畑：縦の薄い筋。3日間は耕作・播種できない</li>
            <li><span className="village-swatch plant-berry" />野生ベリー：紫の実が収穫可能。採集後は実が消え、低い株から7日で再生</li>
            <li><span className="village-swatch plant-herb" />野草：薄黄の葉。採集後は葉が消え、低い株から4日で再生。2単位で1食</li>
            <li><span className="village-swatch plant-tree" />果樹：橙の実→暗い冠の再生中→桃色の花→実</li>
            <li><span className="village-swatch plant-grass" />草：緑の株と細い葉。動物に食べられた後、1日で再生</li>
            <li><span className="village-swatch animal-rabbit" />ウサギ：白い体と耳</li>
          </ul>
          <h3>移動と人物</h3>
          <ul className="village-legend-list">
            <li><span className="village-swatch route-line" />黄色い線：選択した人物から行先への計算経路</li>
            <li><span className="village-swatch person-farmer" />人物：S 商人、F 農夫、C 運び手、B1・B2 {legacyWood ? "木こり" : "農夫"}。色と文字で区別</li>
            <li><span className="village-swatch person-selected" />薄黄色の枠：選択中の人物のセル</li>
          </ul>
      </div>
    </aside>
  </div>;
}
