import { decodeVillageDocument } from "../../packages/sim/shared-village-json";
import { useEffect, useMemo, useRef, useState } from "react";
import { VillageStatusReplay } from "./village-status-replay";
import type { VillageId } from "../../packages/ai/autonomous-world";
import { findGridPathV2, type GridMap, type GridPoint } from "../../packages/sim/grid-path";
import { bodilyDiscomfort, type InventoryItem, type InventoryStatus, type PersonStatus } from "../../packages/sim/village-status";
import { loadMovement, type LoadTransport } from "../../packages/sim/load-movement";
import type { VillageRecording } from "../../packages/sim/village-recording";
import type { ActionLearningMemory } from "../../packages/ai/action-learning";

const woodQuery = new URLSearchParams(window.location.search).get("wood");
const recordMode = woodQuery === "energy" || woodQuery === "integrity" || woodQuery === "sleep" || woodQuery === "legacy" || woodQuery === "paused" || woodQuery === "farms" || woodQuery === "wild" || woodQuery === "local" || woodQuery === "bread" || woodQuery === "needs" || woodQuery === "market" || woodQuery === "home" || woodQuery === "load" || woodQuery === "learn" || woodQuery === "journey" || woodQuery === "plan" ? woodQuery : "energy";
const foodMarketRecord = ["market", "home", "load", "learn", "journey", "plan", "sleep", "integrity", "energy"].includes(recordMode);
const loadRecord = ["load", "learn", "journey", "plan", "sleep", "integrity", "energy"].includes(recordMode);
const processedFood = recordMode === "bread" || recordMode === "needs" || foodMarketRecord;
const legacyWood = recordMode === "legacy";
const recordingUrl = recordMode === "energy" ?
  new URL("../../fixtures/recordings/autonomous-village-energy-effort-90.v2.json.gz", import.meta.url).href : recordMode === "integrity" ?
  new URL("../../fixtures/recordings/autonomous-village-offer-integrity-90.v2.json.gz", import.meta.url).href : recordMode === "sleep" ?
  new URL("../../fixtures/recordings/autonomous-village-sleep-regulation-90.v2.json.gz", import.meta.url).href : recordMode === "plan" ?
  new URL("../../fixtures/recordings/autonomous-village-food-planning-90.v2.json.gz", import.meta.url).href : recordMode === "journey" ?
  new URL("../../fixtures/recordings/autonomous-village-food-journeys-90.v2.json.gz", import.meta.url).href : recordMode === "learn" ?
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
  item_set_down: "荷物を地面へ置く", ground_item_taken: "置いた荷物を拾う", process_interrupted: "作業中断", surplus_offer_cancelled: "販売提示の取消", effort_body_changed: "栄養・疲労・負担", grain_loaded: "穀物庫から積む", home_cash_stored: "家に現金を保管", home_cash_taken: "家の現金を持ち出す", home_item_stored: "家に物品を保管", home_item_taken: "家の物品を持ち出す",
  plot_tilled: "耕作", plot_sown: "播種", crop_harvested: "収穫", foraged: "採集",
  sleep_attempted: "入眠を試みる", sleep_started: "入眠", sleep_woke: "起床", sleep_unavailable: "入眠できず終了", slept: "睡眠実績", sleep_interrupted: "睡眠中断", body_changed: "身体・環境", grain_stored: "穀物を保存", bread_baked: "製パン", surplus_offered: "余剰食品の提示", surplus_sold: "余剰食品の売買",
  food_delivered: "食品納品", food_sold: "食品販売", ate: "食事", wood_burned: "薪使用",
  travel_step: "移動", arrived: "到着", travel_replanned: "経路再探索",
  plant_discovered: "植物発見", plant_gathered: "植物採集",
  animal_born: "動物の出生", animal_died: "動物の死亡", season_changed: "季節変化",
};
const pointKey = (p: GridPoint) => `${p.x},${p.y}`;
const clock = (hour: number) => `${Math.floor((hour - 1) / 24) + 1}日目 ${String((hour - 1) % 24 + 1).padStart(2, "0")}時`;
const compactClock = (hour: number) => `${Math.floor((hour - 1) / 24) + 1}日${String((hour - 1) % 24 + 1).padStart(2, "0")}時`;
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
  const recording = decodeVillageDocument<VillageRecording>(JSON.parse(text), true);
  if (recording.rulesetId !== (recordMode === "energy" ? "autonomous-village-energy-effort-v22" : recordMode === "integrity" ? "autonomous-village-offer-integrity-v21" : recordMode === "sleep" ? "autonomous-village-sleep-regulation-v20" : recordMode === "plan" ? "autonomous-village-food-planning-v19" : recordMode === "journey" ? "autonomous-village-food-journeys-v18" : recordMode === "learn" ? "autonomous-village-experience-learning-v17" : recordMode === "load" ? "autonomous-village-bulk-transport-v16" : recordMode === "home" ? "autonomous-village-home-storage-v15" : recordMode === "market" ? "autonomous-village-food-market-v14" : legacyWood ? "autonomous-village-ecological-land-v6" :
    recordMode === "paused" ? "autonomous-village-wood-paused-v7" :
    recordMode === "farms" ? "autonomous-village-owned-farms-v8" : recordMode === "wild" ? "autonomous-village-wild-food-market-v9" : recordMode === "local" ? "autonomous-village-local-work-v10" : recordMode === "bread" ? "autonomous-village-bread-storage-v11" : "autonomous-village-anticipatory-needs-v12") || recording.untilHour !== 2160)
    throw Error("土地経済90日の記録ではありません");
  return recording;
}

const reasonLabels: Record<string, string> = {
  "purpose deadline expired; stop rather than continue unbounded effort": "目的の期限が来たので中断し、無期限の運搬を続けない",
  "retrieve a small edible amount from own locally observed ground reserve": "その場に置いてある自分の食品を、食べる分だけ回収する",
  "visit own stored surplus during a safe window; compare complete sale journey before loading": "安全な時間に自分の穀物庫へ行き、積む前に売却行程を比較する",
  "gather immediately available food before a shelter journey": "その場にある可食物を確保してから避難する",
  "reduce load and recover before shelter journey": "荷物を減らし、帰宅に必要な活動余力を回復する",
  "sleep when actually ready; nutrition is still consumed during sleep": "眠気に応じて眠る。睡眠中も栄養を消費する",
  "retrieve actual edible home reserve": "家に実在する可食物を取り出す",
  "buy locally observed food; cash is a means to nutrition": "現地で見た食品を買い、食事につなげる",
  "wait within agreed personal tolerance for a valid sale opportunity": "有効な提示の買い手を、本人の待機期限内で待つ",
  "offer bread surplus while retaining personal food": "自分の食事を残して、余剰のパンを売りに出す",
  "process stored grain into edible bread": "庫に保存した穀物を食べられるパンへ加工する",
  "buy observed grain for bread production": "現地で見た穀物を、パンの原料として買う",
  "store unplanned grain instead of carrying it without a purpose": "運ぶ目的のない穀物を保管して負担を減らす",
  "obtain a small edible reserve from an observed unoccupied plant": "他人が採集中でない植物から、少量の食料を確保する",
  "harvest owned crop into physical field storage": "自分の畑で収穫し、現物を畑の穀物庫へ保存する",
  "reobserve owned crop before committing to work": "自分の作物を現地で確認してから農作業を決める",
  "return to known bakery while retaining food and recovery margin": "食料と体力の余裕がある時間に市場の製パン場へ戻る",
  "wait at shelter with food reserve until sleep readiness": "食料を備えて家で待ち、眠気が来たら眠る",
  "choose low effort shelter and recovery with reserve sufficient": "食料の備えがあるので、帰宅して負担を減らし回復する",
  "no observed useful task outweighs its present effort": "現在の負担に見合う、観察済みの作業がない",
  "recover before undertaking effort beyond current activity capacity": "現在の活動余力を超える作業に着手する前に回復する",

  "stop at safe hourly boundary; retain actual progress and relieve discomfort": "現在の不快に対処するため区切りで中断。実際の移動・作業と消耗は残る",
  "accept bounded effort for useful food purchasing power after comparing complete journeys": "往路・販売待ち・購入・帰路を比較し、食料代のため有限の負担を引き受ける",
  "put down heavy cargo now; spent nutrition and accumulated fatigue remain": "荷卸しで現在の負担を軽減。消費した栄養と疲労は回復しない",
  "bounded valid offer wait expired; withdraw and store unsold cargo": "有効な販売提示の待機期限が来たため、取消して未売却品を保管する",
  "continue finite sale purpose while burden remains tolerable": "負担が許容範囲なので期限付きの販売目的を続ける",
  "relieve current hunger with actual edible food; absorption follows later": "実際の可食物で空腹を軽減。栄養の吸収は後になる",
  "recover independent activity fatigue before further work": "次の作業の前に活動疲労を回復する",
  "continue actual sleep; no new work while asleep": "実睡眠を続ける",
  "continue bounded work while observed discomfort remains tolerable": "現在の負担が許容範囲なので作業を続ける",
  "insufficient nutritional supply for observed work; waiting for a possible food opportunity": "栄養の供給が不足し、現在の作業はできない。食料を得られる機会を待つ",
  "return before forecast cold or sleepiness becomes severe": "寒さ・眠気が強まる前に帰宅する",
  "wait for safer temperature before an exposed food search": "屋外の食料探索に適した気温になるまで待つ",
  "explore a known landmark; learn food availability only on local observation": "知っている場所を探索し、植物の有無は現地で観察する",
  "offer actual cargo for bounded sale then food purchase and return": "現物を期限付きで売りに出し、食料購入と帰宅へつなげる",
  "store unsold grain at market before further food search": "未売却の穀物を市場に保管してから食料を探す",
  "withdraw offer before necessary shelter; do not infer absent demand": "避難のため販売提示を取り下げる。需要がないとは学習しない",

  "store unnecessary cargo before seeking edible food": "食料探しの前に、不要な重い荷物を家へ預ける",
  "recover effort before a known food acquisition journey": "観察した食料の確保と帰宅に必要な体力を先に回復する",
  "obtain food before sleep using an observed unoccupied plant": "次の食事と睡眠に間に合う、採集作業が重なっていない植物を選ぶ",
  "retrieve remembered edible home reserve before sleep": "期限と帰宅時間を見込み、家に記憶した食料を取り出す",
  "buy observed food before the next sleep and meal deadline": "次の睡眠・食事まで使える、現地の食品を購入する",
  "check known market for food; current offers are unconfirmed": "食料確保のため既知の市場を再確認する（現在の提示は未確認）",
  "sleep before a food journey that would exceed the available working window": "採集と帰宅まで起きていられるよう、出発前に睡眠を取る",
  "wait in shelter for a safer food acquisition window": "食料確保の行程が危険なため、屋内で条件の改善を待つ",
  "recover or return to shelter before an unsafe food acquisition journey": "危険な採集行程の前に、体力を回復するか家へ戻る",
  "carry edible food to shelter before another exposed meal decision": "食事中の冷え込みを見込み、食料を持って家へ戻る",
  "buy locally observed food while retaining a safe shelter journey": "帰宅までの寒さ・眠気・体力を見込み、現地の食品を先に買う",
  "offer carried sale grain while retaining a safe shelter journey": "帰宅する余裕を残し、市場へ運んだ穀物を売り出す",
  "prepare selected owned crop before loading sowing grain": "播種用の穀物を積む前に、選んだ自分の区画を耕す",
  "carry reserved grain to selected crop, then sow": "選んだ作物セルへ播種用の穀物を運び、到着したら播く",
  "retrieve grain for selected cultivated crop": "選んだ耕作済み区画に使う穀物を保管庫へ取りに行く",
  "load one grain for selected cultivated crop": "選んだ耕作済み区画に播く穀物を1単位積む",
  "leave sowing grain stored until carrying space is available": "携帯する空き容量ができるまで、播種用の穀物を保管する",
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
  "wait for actual sleep readiness": "まだ入眠できる眠気ではないため待つ",
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
const activityLabels: Record<string, string> = { settling: "入眠待ち", sleep: "睡眠", rest: "休憩", travel: "移動", bake_bread: "製パン",
  gather_plant: "採集", till_plot: "耕作", sow_plot: "播種", harvest_plot: "収穫" };

const decisionLabels: Record<string, string> = {
  set_down: "地面へ荷卸し", take_ground: "置いた荷物の回収", interrupt_action: "作業中断", withdraw_surplus_offer: "販売提示を取消", ...activityLabels, eat: "食事", wait: "待機",
  post_surplus_offer: "販売提示", buy_surplus: "購入", load_grain: "穀物積載", store_grain: "穀物保存",
  store_home: "家に収納", take_home: "家から取出", store_home_cash: "現金収納", take_home_cash: "現金取出" };

const itemNames: Record<string, string> = { ...plantNames, bread: "パン", seed: "播種用の穀物", wood: "薪" };
function ExperienceCard({ memory }: { memory?: ActionLearningMemory }) {
  const outcome = memory?.recent.at(-1), p = memory?.pending.at(-1) ?? outcome?.prediction;
  return <section className="village-status-card village-experience" aria-label="経験からの見込み"><h3>経験からの見込み</h3>
    {!memory ? <p>まだ行動経験はありません。</p> : <>
      <p>対応した結果 {memory.totals.matched}件 · 条件の記憶 {Object.keys(memory.models).length}件 · 結果待ち {memory.pending.length}件</p>
      {p && <dl className="village-experience-values">
        <div><dt>行動 / 重量</dt><dd>{decisionLabels[p.action] ?? p.action} / {p.before.mass}</dd></div>
        <div><dt>採用モデル</dt><dd>{p.selected === "experience" ? "本人の経験" : "初期の見込み"}</dd></div>
        <div><dt>体力見込み / 時間</dt><dd>{(p.selected === "experience" ? p.learnedRate! : p.priorRate).toFixed(2)}</dd></div>
        <div><dt>予定期間</dt><dd>{p.expectedHours.toFixed(1)}時間</dd></div>
      </dl>}
      {outcome && <p>結果 {outcome.status === "completed" ? "完了" : outcome.status === "failed" ? "失敗" : outcome.status === "interrupted" ? "中断" : "学習対象外"}
        {outcome.energyChange !== undefined && <> · 体力変化 {outcome.energyChange}</>}
        {outcome.error !== undefined && <> · 予測誤差 {outcome.error.toFixed(2)}</>}</p>}
      {outcome && <p>実際の増減：食事分 {outcome.mealsChange ?? "不明"} · 原料 {outcome.rawChange ?? "不明"} · 現金 {outcome.cashChange ?? "不明"}</p>}
      {outcome?.sleep && <p>実睡眠 {outcome.sleep.actualHours}時間 · 入眠待ち {outcome.sleep.waitHours}時間 ·
        {outcome.sleep.reason === "natural awakening" ? "自然起床" : outcome.sleep.reason === "personal wake reservation" ? "起床予約" : outcome.sleep.reason === "cold exposure" ? "寒さで中断" : outcome.sleep.reason === "sleep onset unavailable" ? "入眠不成立" : "本人の起床"}</p>}
      <small title="自分に届いた結果で更新します。同じ重量の荷物は共通の移動経験を使います。">本人に届いた結果で更新 · 同重量の移動経験を共有</small>
    </>}
  </section>;
}
function InventoryCard({ title, inventory, day, owner }: { title: string; inventory: InventoryStatus; day: number; owner: string }) {
  const groups = new Map<string, InventoryItem & { lots: InventoryItem[] }>();
  for (const lot of inventory.items) {
    const key = JSON.stringify([lot.kind, lot.ownerId, lot.containerId, lot.expiresDay, lot.offered]);
    const group = groups.get(key);
    if (group) { group.quantity += lot.quantity; group.mass += lot.mass; group.lots.push(lot); }
    else groups.set(key, { ...lot, lots: [lot] });
  }
  return <section className="village-status-card village-inventory-section" aria-label={title}>
    <div className="village-inventory-heading"><h3>{title}</h3><small>所有者 {owner}</small></div>
    <dl className="village-status-values">
      <div><dt>所持金</dt><dd>{inventory.cash}</dd></div>
      <div><dt>総重量 / 容量</dt><dd>{inventory.mass} / {inventory.capacity}</dd></div>
    </dl>
    {groups.size ? <table className="village-inventory-table"><thead><tr><th>物品</th><th>数量</th><th>重量</th><th>状態</th></tr></thead>
      <tbody>{[...groups].map(([key, item]) => <tr key={key}><td><details><summary>{itemNames[item.kind] ?? item.kind}
        {item.lots.length > 1 && <small>{item.lots.length}ロット</small>}</summary>
        {item.lots.map((lot) => <small key={lot.id}>{lot.id}<br />数量 {lot.quantity} · 重量 {lot.mass}<br />所有者 {lot.ownerId}<br />保管先 {lot.containerId}</small>)}</details></td>
        <td>{item.quantity}</td><td>{item.mass}</td><td>{item.expiresDay === undefined ? (item.kind === "grain" ? "原料・腐敗なし" : "期限なし") :
          `あと${Math.max(0, item.expiresDay - day)}日`}{item.offered && <span className="village-offer-tag" title="販売提示あり" aria-label="販売提示あり"> 売</span>}</td></tr>)}</tbody></table> : <p className="village-empty-inventory">物品なし</p>}
  </section>;
}
function StatusCards({ status, person, day, transport, realMealClock, recordMinute }: { status: PersonStatus; person: VillageId; day: number; transport?: LoadTransport; realMealClock?: boolean; recordMinute?: number }) {
  const needs = bodilyDiscomfort(status.body);
  return <div className="village-status-stack">
    <div className="village-status-context"><small title={recordMinute !== undefined ? replayClock(recordMinute) : status.hour === 0 ? "開始時" : clock(status.hour)}>記録：{recordMinute !== undefined ? replayClock(recordMinute) : status.hour === 0 ? "開始時" : compactClock(status.hour)}</small>
      <span title="携帯・家・市場の現金合計">現金計 <b>{status.carried.cash + status.home.cash + status.market.cash}</b></span></div>
    <InventoryCard title="携帯中の所持品" inventory={status.carried} day={day} owner={person} />
    {transport && <p aria-label="運搬負荷" title="歩行速度は無荷物時を100%とした比率">歩行速度 {Math.round(loadMovement(status.carried.mass, transport).speedRatio * 100)}% · {status.body.effort ? "歩行の作業強度" : "移動消費"} {loadMovement(status.carried.mass, transport).energyPerHour}/時間</p>}
    <section className="village-status-card" aria-label="人物の身体ステータス"><h3>{person} の身体</h3>
      <dl className="village-status-values"><div><dt>体力</dt><dd>{Number(status.body.energy.toFixed(2))} / {status.body.maxEnergy}</dd></div>
        <div><dt>気温</dt><dd>{status.body.temperature}℃</dd></div>
        <div><dt>睡眠不足</dt><dd>{status.body.sleep?.deficitHours ?? status.body.sleepDebt}時間</dd></div>
        {status.body.sleep && <><div><dt>24hの実睡眠</dt><dd>{status.body.sleep.actualHours}時間</dd></div>
        <div><dt>連続覚醒</dt><dd>{status.body.sleep.awakeHours}時間</dd></div>
        {status.body.sleep.effectiveHours < status.body.sleep.actualHours && <div><dt>有効睡眠</dt><dd>{status.body.sleep.effectiveHours}時間</dd></div>}</>}
        <div><dt>行動</dt><dd>{decisionLabels[status.body.activity] ?? status.body.activity}</dd></div></dl>
      <p>{status.body.sheltered ? "自宅の屋内" : "屋外"} · {realMealClock ? "食事からの経過" : "食事周期（旧記録）"} {status.body.mealHours}時間</p>
      {status.body.effort && <dl className="village-status-values" aria-label="栄養の帳簿">
        <div><dt>栄養備蓄</dt><dd>{status.body.effort.reserve.toFixed(2)} / {status.body.effort.capacity}</dd></div>
        <div><dt>吸収待ち</dt><dd>{status.body.effort.pendingNutrition.toFixed(2)}</dd></div>
        <div><dt>累計吸収</dt><dd>{status.body.effort.absorbed.toFixed(2)}</dd></div>
        <div><dt>累計消費</dt><dd>{status.body.effort.consumed.toFixed(2)}</dd></div>
        {(status.body.effort.lost > 0 || status.body.effort.unmet > 0) && <><div><dt>吸収損失</dt><dd>{status.body.effort.lost.toFixed(2)}</dd></div><div><dt>供給不足累計</dt><dd>{status.body.effort.unmet.toFixed(2)}</dd></div></>}
      </dl>}
      <div className="village-need-grid"><div className="village-need-meter"><span>{status.body.effort ? "快" : "快適さ"}</span><b>{needs.comfort}%</b><progress aria-label={status.body.effort ? "身体の快" : "身体の快適さ"} value={needs.comfort} max={100} /></div>
      {([["不快", needs.discomfort], ["空腹の負担", needs.hunger], ["寒さの負担", needs.cold], ["疲労", needs.fatigue], ["眠気", needs.sleepiness]] as const).map(([label, value]) =>
        <div className="village-need-meter discomfort" key={label}
          title={label === "空腹の負担" ? `空腹の記録値 ${status.body.hunger} · 表示の目安：3以上で100%` :
            label === "寒さの負担" ? `寒さの記録値 ${status.body.cold} · 表示の目安：12以上で100%` : undefined}>
          <span>{label.replace("の負担", "")}</span><b>{value}%</b><progress aria-label={label} value={value} max={100} /></div>)}</div>
      {status.body.effort ? <><div className="village-need-grid">
        {([["荷重の不快", status.body.effort.loadDiscomfort], ["負担軽減", status.body.effort.relief]] as const).map(([label, value]) => <div className="village-need-meter" key={label}><span>{label}</span><b>{Math.round(value * 100)}%</b><progress aria-label={label} value={Math.round(value * 100)} max={100} /></div>)}
      </div><small>栄養は仮の単位。体力は活動余力。快・負担軽減は不快と別の感覚です。</small></> : <small title="快・不快は身体の負担の目安。不快は4項目の最大値、快適さは100−不快。">不快＝最大負担 · 快適さ＝100−不快</small>}
    </section>
    {status.ground && status.ground.items.length > 0 && <InventoryCard title="地面に置いた所有物" inventory={status.ground} day={day} owner={person} />}
    {status.field && <InventoryCard title="畑の保管品" inventory={status.field} day={day} owner={person} />}
    <InventoryCard title={`${person} の家の保管品`} inventory={status.home} day={day} owner={person} />
    {(status.market.items.length > 0 || status.market.cash > 0) && <InventoryCard title="市場の保管品" inventory={status.market} day={day} owner={person} />}
  </div>;
}

function DecisionRow({ decision: d }: { decision: VillageRecording["decisions"][number] }) {
  const [expanded, setExpanded] = useState(false);
  return <><tr>
    <td title={clock(d.hour)}>{compactClock(d.hour)}</td>
    <td>{decisionLabels[d.chosen?.kind ?? "wait"] ?? d.chosen?.kind}
      <button className="village-decision-expand" type="button" aria-label={`${d.eventId} の入力と原因`}
        aria-expanded={expanded} aria-controls={`decision-${d.eventId}`} onClick={() => setExpanded((open) => !open)}>詳細</button>
    </td>
    <td><span>体{d.knownContext.energy} · 空{d.knownContext.hunger} · 金{d.knownContext.ownCash}</span>
      <small>地点 {d.knownContext.siteId}</small>
      {d.stimuli.some((s) => s.reason) && <small>結果：{d.stimuli.filter((s) => s.reason).map((s) => s.reason).join("、")}</small>}
    </td>
  </tr><tr id={`decision-${d.eventId}`} hidden={!expanded} className="village-decision-input"><td colSpan={3}>
    {d.eventId} · 到達刺激 {d.stimuli.map((s) => s.kind).join("、") || "なし"}
  </td></tr></>;
}

function atHour(recording: VillageRecording, hour: number, eventFrame: number, minuteOfHour: number) {
  const statusReplay = new VillageStatusReplay(recording.fixture);
  const statuses = statusReplay.statuses;
  const statusMinutes: Partial<Record<VillageId, number>> = {};
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
    if (recording.fixture.sleepRegulation) {
      if (Number(e.data.atMinute ?? e.hour * 60) > (hour - 1) * 60 + minuteOfHour) continue;
    } else if (e.hour === hour && frame++ >= eventFrame) break;
    statusReplay.apply(e);
    if (recording.fixture.sleepRegulation && e.actors[0] && statuses[e.actors[0] as VillageId])
      statusMinutes[e.actors[0] as VillageId] = Number(e.data.atMinute ?? e.hour * 60);
    if (e.kind === "body_changed") bodies[e.actors[0] as VillageId] = {
      temperature: Number(e.data.temperature), cold: Number(e.data.cold), sleepDebt: Number(e.data.sleepDebt),
      sheltered: e.data.sheltered === 1 };
    if (e.kind === "process_started") activeActions[e.actors[0] as VillageId] = String(e.data.action);
    if (recording.fixture.sleepRegulation && e.kind === "sleep_attempted") activeActions[e.actors[0] as VillageId] = "settling";
    if (e.kind === "sleep_started") activeActions[e.actors[0] as VillageId] = "sleep";
    if (e.kind === "process_completed" || e.kind === "process_failed" || e.kind === "sleep_interrupted" || e.kind === "sleep_woke" || e.kind === "sleep_unavailable" || e.kind === "process_interrupted")
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
  return { positions, plants, animals, grainStocks, activeActions, bodies, statuses, statusMinutes, totals };
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
  for (const status of Object.values(snapshot.statuses)) for (const item of status?.ground?.items ?? []) {
    const parts = item.containerId.split("_"), x = Number(parts.at(-2)) * 32, y = Number(parts.at(-1)) * 32;
    ctx.fillStyle = "#bda77a"; ctx.fillRect(x + 19, y + 20, 11, 9);
    ctx.strokeStyle = "#fff0c5"; ctx.strokeRect(x + 19, y + 20, 11, 9);
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
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth - 16);
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
  const visibleEventIds = useMemo(() => new Set((recording?.fixture.sleepRegulation ?
    eventsThisHour.filter((e) => Number(e.data.atMinute ?? e.hour * 60) <= cursorMinutes) :
    eventsThisHour.slice(0, visibleFrame)).map((e) => e.id)), [recording, eventsThisHour, visibleFrame, cursorMinutes]);
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
  const dayEvents = useMemo(() => recording?.events.filter((e) => e.kind !== "person_status" &&
    (!recording.fixture.sleepRegulation || !(["body_changed", "effort_body_changed"].includes(e.kind)) || Number(e.data.atMinute) % 60 === 0) &&
    (recording.fixture.sleepRegulation ? Math.min(90, Math.floor(Number(e.data.atMinute ?? e.hour * 60) / 1440) + 1) === day : e.day === day) &&
    (e.hour < hour || e.hour === hour && visibleEventIds.has(e.id)) &&
    (e.actors.includes(selected) ||
      ["crop_harvested", "plant_stage", "animal_born", "animal_died", "season_changed"].includes(e.kind))) ?? [],
  [recording, day, hour, visibleEventIds, selected]);
  const reachedDecisions = useMemo(() => recording?.decisions.filter((d) => d.actorId === selected &&
    (d.hour < hour || d.hour === hour && visibleEventIds.has(d.eventId))) ?? [],
  [recording, hour, visibleEventIds, selected]);
  const decisions = reachedDecisions.filter((d) => d.hour > (day - 1) * 24);
  const displayedDecisions = decisions.length ? decisions : reachedDecisions.slice(-12);
  const latestObservation = reachedDecisions.at(-1);
  const anticipation = latestObservation?.response.subjectiveUpdate?.anticipation;
  if (error) return <main className="e1-debug"><h1>土地経済の記録を開けませんでした</h1><p role="alert">{error}</p></main>;
  if (!recording || !snapshot || !gridNow) return <main className="e1-debug"><p>90日記録を読み込んでいます…</p></main>;
  const selectedFarm = recording.fixture.landEconomy?.farms?.find((farm) => farm.ownerId === selected);
  const plantList = Object.values(snapshot.plants);
  const localPlants = plantList.filter((p) => pointKey(p.cell) === pointKey(focusCell));
  const localStocks = Object.values(snapshot.grainStocks).filter((s) => pointKey(gridNow.sites[s.siteId]) === pointKey(focusCell));
  const localGroundItems = Object.values(snapshot.statuses).flatMap((s) => s?.ground?.items ?? []).filter((i) => i.containerId.endsWith(`_${focusCell.x}_${focusCell.y}`));
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
    <header className="e1-top"><div><h1>土地経済90日 · 生態デバッグ</h1></div><div>
        <label>表示する記録 <select aria-label="表示する記録" value={recordMode}
          onChange={(e) => { const url = new URL(window.location.href);
            if (e.target.value !== "energy") url.searchParams.set("wood", e.target.value);
            else url.searchParams.delete("wood");
            window.location.assign(url.href); }}>
          <option value="energy">v22：栄養・活動疲労・負担と行程判断</option><option value="integrity">v21：販売提示の整合修正だけ</option><option value="sleep">旧v20：睡眠・疲労の身体モデル</option><option value="plan">旧記録：食料の期限・採集競合・睡眠と行程比較</option><option value="journey">旧記録：農作業の目的・市場の再訪・パン購入</option><option value="learn">旧記録：経験学習・運搬・食事時計</option><option value="load">旧記録：収穫20・畑の保管・荷重と運搬</option><option value="home">旧記録：人物ステータス・自宅保管・食品市場</option><option value="market">旧記録：穀物売却・市場製パン・パン購入</option><option value="needs">旧記録：自宅製パン・欲求と経験</option><option value="bread">旧記録：穀物保存・パン加工</option><option value="local">植物セルで採集・農作業</option><option value="wild">旧記録：往復採集・余剰売買</option><option value="farms">所有畑・穀物保存</option><option value="paused">薪停止の対照記録</option><option value="legacy">旧記録：固定薪資源あり</option>
        </select></label> <a href="/">90日ゲーム</a></div></header>
    {!legacyWood && <details className="village-specification" role="note">
      <summary>記録の条件・仕様 <span>{processedFood ? "穀物＝原料・腐敗なし / パン＝3日期限 / 薪停止" : "土地・食料・作業の条件"}</span></summary>
    {recordMode === "paused" && <p className="e1-map-panel">薪の採集・売買・燃料要求は停止中です。
      B1・B2の薪販売収入もなくなるため、食料代の不足と市場の資金不足が起きる対照記録です。
      90日間の正常稼働を示す記録ではありません。旧記録でCが森に待機するのは食料の引渡し待ちです。</p>}
    {recordMode === "farms" && <p className="e1-map-panel">穀物は腐敗しません。
      F・B1・B2がそれぞれ自分の畑を耕作・播種・収穫します。薪と雇用は使いません。
      農夫3人は90日食料を確保しますが、S・Cの食料市場の資金循環は未解決です。</p>}
    {recordMode === "wild" && <p className="e1-map-panel">全員が野草・ベリーを採集して直接食べられます。
      余剰は市場で提示し、買い手が現金で購入します。採集には移動・体力と再生待ちが必要です。
      穀物は腐敗せず、薪・雇用・製パン・技能習得・転職は未導入です。</p>}
    {recordMode === "local" && <p className="e1-map-panel">採集は植物のセルへ移動してから行い、
      その場で食事・休息できます。森・畑の中心へ自動では戻りません。
      作業対象がなければ生育・再生待ち、余剰の販売中は市場で買い手待ちになります。</p>}
    {["sleep", "integrity", "energy"].includes(recordMode) && <p>身体は15分ごとに更新。直近24時間の必要睡眠6時間、夜22〜6時の眠気、強い疲労の眠気を分けます。入眠待ちは睡眠に数えず、十分回復すると自然に起床します。休憩は睡眠不足を消しません。</p>}
    {recordMode === "integrity" && <p>v21は販売提示の整合修正だけを比較する記録です。播種には指定した穀物を使い、販売提示の現物が不足したり保管されたりしたら提示を取り消します。</p>}
    {recordMode === "energy" && <><p>栄養は食事から2時間後に吸収し、生活・活動・回復で消費します。荷物の支持と歩行には負担があり、本人は売却・購入・売れない場合の帰路までを見込んで積載量を選びます。作業は1時間の区切りで再検討します。</p><p>この記録では全員の90日食料維持は未成立です。F・C・B1は途中で食料を確保できず、栄養備蓄と活動余力が枯渇します。休息だけでは栄養は増えません。</p></>}
    {processedFood && <p className="e1-map-panel">穀物は直接食べられません。原料として扱います。
      {loadRecord && <>播種1→収穫20、穀物1単位の重量2。袋の容量20、人物全体24。畑に収穫物を保管し、容量に収まる量を分けて運びます。荷物が重いほど歩行が遅く、体力消費が増えます。 </>}
      {foodMarketRecord ? <>農夫は穀物を市場で売り、代金でパンを購入します。初期の製パン技能はSだけが持ち、市場の穀物庫に買った原料を保存して加工します。</> : <>収穫後は本人の家か市場の穀物庫へ運び、腐敗せず保存します。</>}
      穀物1から2時間でパン1を作り、パンは製造日から3日で腐敗します。野草・ベリーは直接食べられます。
      {(recordMode === "needs" || foodMarketRecord) && <> 気温・睡眠不足・場所の回復を扱い、経験から先の冷え方と移動時間を見積もります。短い休憩と睡眠は別です。</>}</p>}
      <p>5/15/30/60分の移動表示は、1時間内の通過セルを均等に割り当てた補間です。植物と所持品は表示中のEventで更新します。{["sleep", "integrity", "energy"].includes(recordMode) && <>身体・入眠・起床は記録された15分単位の実時刻で表示します。</>}</p>
    </details>}
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
    <div className="e1-stats"><span>食事 <b>{recordMode === "energy" ? snapshot.totals.meals : `${snapshot.totals.meals}/450`}</b></span>
      <span>{processedFood ? "パンの食事" : "穀物の食事"} <b>{processedFood ? snapshot.totals.breadMeals : snapshot.totals.grainMeals}</b></span>
      {processedFood && <><span>製パン <b>{snapshot.totals.breadBaked}</b></span><span>穀物保存 <b>{Object.values(snapshot.grainStocks).reduce((n, s) => n + s.quantity, 0)}</b></span></>}
      <span>野生ベリーの食事 <b>{snapshot.totals.wildMeals}</b></span>
      <span>探索した植物の食事 <b>{snapshot.totals.gatheredMeals}</b></span>
      <span>穀物収穫 <b>{snapshot.totals.harvestedGrain}</b></span>
      {(recordMode === "farms" || recordMode === "wild" || recordMode === "local" || processedFood) && <span>穀物保存 <b>腐敗なし</b></span>}
      <span>薪 <b>{legacyWood ? `使用 ${snapshot.totals.wood}/450` : "停止中"}</b></span>
      {(recordMode === "wild" || recordMode === "local" || processedFood) && <span>余剰売買 <b>{snapshot.totals.surplusSales}件</b></span>}
      {foodMarketRecord && <><span>穀物売買 <b>{snapshot.totals.grainSales}件</b></span><span>パン売買 <b>{snapshot.totals.breadSales}件</b></span></>}
      <span>動物 <b>{Object.keys(snapshot.animals).length}</b></span></div>
    <main ref={layoutRef} className={`e1-layout village-resizable-layout${resizing ? " is-resizing" : ""}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) 12px ${displayedSideWidth}px` }}>
      <section className="e1-map-panel">
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
        <p className="e1-legend">32ピクセル×40列×24行 · 縮尺自動 · セルをクリックで詳細 · 右端に凡例</p>
        <section className="village-cell-inspector" aria-label="選択セルの状態">
          <h3>選択セル {pointKey(focusCell)}</h3>
          <p>{terrain} · {blocked ? "通行不可" : "通行可能"} · {localPlants.map((p) =>
            `${plantNames[p.species]} ${stageNames[p.stage] ?? p.stage} ${p.available}${p.ownerId ? ` · 所有者 ${p.ownerId} · ${p.farmId}` : ""}`).join(" / ") || "植物なし"} · {localAnimals.map((a) => a.id).join(" / ") || "動物なし"}</p>
          {localStocks.map((stock) => <p key={stock.ownerId}>穀物庫 {stock.ownerId}: {stock.quantity}単位 · 所有者 {stock.ownerId}</p>)}
        </section>
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
              transport={recording.fixture.bulkTransport} realMealClock={!!recording.fixture.experienceLearning} recordMinute={snapshot.statusMinutes[selected]} /> :
              <p>この旧記録には物品・身体のステータス記録がありません。行動ログの本人観察を参照できます。</p>}
            {recording.fixture.experienceLearning && <ExperienceCard memory={latestObservation?.response.subjectiveUpdate?.anticipation?.learning} />}
          </section>
          <section className="village-inspector-pane" aria-label="人物の行動ログ">
          <h2>{selected} の判断履歴</h2>
          {selectedFarm && <p>所有する畑: {selectedFarm.id} · {selectedFarm.plotIds.length}区画 · 穀物は腐敗なし</p>}
          {foodMarketRecord && <p>製パン技能：{recording.fixture.foodMarket!.initialBakingSkills[selected]} · 市場で加工</p>}
          {!snapshot.statuses[selected] && latestObservation && <p>最新の本人観察（{clock(latestObservation.hour)}）:
            所持金 {latestObservation.knownContext.ownCash} · 空腹 {latestObservation.knownContext.hunger} ·
            体力 {latestObservation.knownContext.energy} ·
            判断 {latestObservation.chosen?.kind ?? "待機"} ·
            進行中 {activityLabels[snapshot.activeActions[selected] ?? ""] ?? snapshot.activeActions[selected] ?? "なし"}</p>}
          {!snapshot.statuses[selected] && snapshot.bodies[selected] && <p>表示時点の身体：気温 {snapshot.bodies[selected]!.temperature}℃ ·
            寒さ {snapshot.bodies[selected]!.cold} · 睡眠不足 {snapshot.bodies[selected]!.sleepDebt} ·
            {snapshot.bodies[selected]!.sheltered ? "自宅の屋内" : "屋外"}</p>}
          {localGroundItems.length > 0 && <p>選択セルの置き荷：{localGroundItems.map((i) => `${i.ownerId} の ${itemNames[i.kind] ?? i.kind} ${i.quantity}`).join("、")}</p>}
          {latestObservation?.response.subjectiveUpdate?.anticipation?.reasoning && <p>
            判断理由：{reasonLabels[latestObservation.response.subjectiveUpdate.anticipation.reasoning.reason] ?? latestObservation.response.subjectiveUpdate.anticipation.reasoning.reason}<br />
            対処の見込み {latestObservation.response.subjectiveUpdate.anticipation.reasoning.leadHours.toFixed(1)}時間 ·
            先の寒さ {latestObservation.response.subjectiveUpdate.anticipation.reasoning.forecastCold.toFixed(1)} ·
            記憶 {latestObservation.response.subjectiveUpdate.anticipation.experiences.length}件</p>}
          {anticipation?.sleep && <p aria-label="睡眠の予測学習">眠気の予測照合 {anticipation.sleep.matched}件 · 対応しない結果の除外 {anticipation.sleep.excluded}件
            {anticipation.sleep.last && <> · 直近の予測 {Math.round(anticipation.sleep.last.expected * 100)}% / 実際 {Math.round(anticipation.sleep.last.actual * 100)}%</>}</p>}
          {anticipation?.effort && <section aria-label="負担と成果の見込み">
            <p>活動疲労の予測照合 {anticipation.effort.matched}件 · 未対応 {anticipation.effort.excluded}件
              {anticipation.effort.last && <> · 直近の誤差 {(anticipation.effort.last.error * 100).toFixed(1)}ポイント</>}</p>
            <p>販売成立 {anticipation.effort.trade.successes} · 有効提示の待機終了 {anticipation.effort.trade.failures} · 途中打切り {anticipation.effort.trade.censored}</p>
            {anticipation.effort.goal && <p>目的：穀物販売 · 終了期限 {compactClock(anticipation.effort.goal.deadline)}</p>}
            {anticipation.effort.candidates.length > 0 && <table className="village-log-table"><thead><tr><th>積載</th><th>全行程</th><th>成果 / 負担</th><th>見込み</th></tr></thead><tbody>{anticipation.effort.candidates.map((p) => <tr key={p.goal}><td>{p.goal.replace("sell-grain-", "穀物 ")}</td><td>{p.hours.toFixed(1)}h</td><td>{p.benefit.toFixed(2)} / {p.cost.toFixed(2)}</td><td>{p.feasible ? p.value > 0 ? "利益あり" : "費用が上回る" : "身体・食料の余裕不足"}</td></tr>)}</tbody></table>}
          </section>}
          {anticipation?.cropPlan && <p>農作業の目的：{anticipation.cropPlan.siteId} を耕作・播種</p>}
          {anticipation?.foodPlanning?.evaluation && <details aria-label="食料行程の比較">
            <summary>食料行程の比較 · {compactClock(anticipation.foodPlanning.evaluation.at)}の見込み · 次の需要まで{Math.max(0, anticipation.foodPlanning.evaluation.needAt - hour)}時間 ·
              期限内の携帯食料{anticipation.foodPlanning.evaluation.usableMeals}食</summary>
            <table className="village-log-table"><thead><tr><th>行先・根拠</th><th>確保 / 帰路</th><th>寒さ / 眠気</th><th>判断</th></tr></thead>
              <tbody>{anticipation.foodPlanning.evaluation.candidates.map((p, index) => <tr key={`${p.kind}:${p.siteId}`}>
                <td>{p.siteId}<br /><small>{p.source === "observed" ? "現地観察" : p.source === "remembered" ? "本人の記憶" : "食品は未確認"}</small></td>
                <td>{p.foodHours.toFixed(1)}h / {p.returnHours.toFixed(1)}h</td>
                <td>{p.cold.toFixed(1)} / {p.sleepiness !== undefined ? `${Math.round(p.sleepiness * 100)}%` : p.debt.toFixed(1)}</td>
                <td>{index === anticipation.foodPlanning!.evaluation!.selected ? "選択" : p.exclusion === "occupied" ? "他人が採集中" :
                  p.exclusion === "body" ? "身体の余裕不足" : p.exclusion === "expiry" ? "期限不足" : "候補"}</td>
              </tr>)}</tbody></table>
          </details>}
          {recording.fixture.foodJourneys && anticipation?.foodMarket && <p>市場：
            {anticipation.foodMarket.visit ? `${anticipation.foodMarket.visit.purpose === "grain-sale" ? "穀物売却" : "食品購入"}の訪問中` :
              anticipation.foodMarket.retryAt > hour ? `再訪まで${anticipation.foodMarket.retryAt - hour}時間` : "再検討可能"}
            {` · 未成立の訪問 ${anticipation.foodMarket.failures ?? 0}回`}</p>}
          {foodMarketRecord && <section aria-label="人物の最近の売買"><h3>最近の売買</h3>
            <table className="village-log-table"><thead><tr><th>時刻</th><th>品・数量</th><th>売手 → 買手</th><th>代金</th></tr></thead>
              <tbody>{recording.events.filter((e) => e.kind === "surplus_sold" && e.actors.includes(selected) &&
                (e.hour < hour || visibleEventIds.has(e.id))).slice(-6).reverse().map((e) => <tr key={e.id}>
                <td>{compactClock(e.hour)}</td><td>{e.data.product === "bread" ? "パン" : e.data.product === "grain" ? "穀物" : plantNames[String(e.data.species)]} {e.data.quantity}</td>
                <td>{e.actors[0]} → {e.actors[1]}</td><td>{e.data.price}</td>
              </tr>)}</tbody></table>
          </section>}
          <section aria-label="人物の判断一覧">
            <h3>{decisions.length ? `${day}日目の判断` : "直近の判断"}（{displayedDecisions.length}件）</h3>
            <small>体＝体力 · 空＝空腹 · 金＝所持金</small>
            <table className="village-log-table village-decision-table"><thead><tr><th>時刻</th><th>判断</th><th>観察・結果</th></tr></thead>
              <tbody>{displayedDecisions.slice().reverse().map((d) => <DecisionRow key={d.eventId} decision={d} />)}</tbody>
            </table>
          </section>
            <h3>{day}日目の関連Event（{dayEvents.length}件）</h3>
            {dayEvents.slice().reverse().slice(0, 120).map((e) =>
              <div key={e.id} className="e1-row"><b>{e.data.atMinute !== undefined ? replayClock(Number(e.data.atMinute)) : clock(e.hour)} · {e.actors.join("、") || "世界"} · {actionNames[e.kind] ?? e.kind}</b>
                <details className="village-event-details"><summary>{e.id} ← {e.causes.join(", ") || "起点"}</summary>
                  <code>{JSON.stringify(e.data)}</code></details></div>)}
            <p className="village-record-source">元記録: {recording.finalStateHash} · 判断 {recording.decisions.length}件 · Event {recording.events.length}件</p>
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
          {(recordMode === "needs" || foodMarketRecord) && <p>家：本人の家では保温と睡眠回復が有利です。帰宅時刻は固定せず、予測と身体の必要から選びます。屋外睡眠も可能です。人物の横の「Z」は睡眠中です。</p>}
          {["sleep", "integrity", "energy"].includes(recordMode) && <p>身体は15分ごとに更新。直近24時間の必要睡眠6時間、夜22〜6時の眠気、強い疲労の眠気を分けます。入眠待ちは睡眠に数えず、十分回復すると自然に起床します。休憩は睡眠不足を消しません。</p>}
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
