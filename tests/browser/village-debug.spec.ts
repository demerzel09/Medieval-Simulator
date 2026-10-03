import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test, type Locator } from "@playwright/test";
import type { VillageEvent } from "../../packages/sim/autonomous-world";

async function clickCell(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: (x + .5) / 40 * box.width, y: (y + .5) / 24 * box.height } });
}

test("person and home status follow recorded cash, items, weight and physical needs", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/?village=land-economy&wood=home");
  await expect(page.getByLabel("表示する記録")).toHaveValue("home", { timeout: 30000 });
  const carried = page.getByRole("region", { name: "携帯中の所持品" });
  const home = page.getByRole("region", { name: "F の家の保管品" });
  await expect(carried).toContainText("所持金");
  await expect(carried).toContainText("総重量 / 容量");
  await expect(carried).toContainText("播種用の穀物");
  await expect(home).toContainText("所有者 F");
  await expect(page.getByRole("progressbar", { name: "身体の快適さ" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "不快", exact: true })).toBeVisible();
  await page.getByLabel("土地経済の人物").selectOption("S");
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  const storedCash = page.getByRole("region", { name: "S の家の保管品" }).locator("dl div").filter({ hasText: "所持金" }).locator("dd");
  await expect(storedCash).toHaveText(/^[1-9]\d*$/);
  await expect(page.getByRole("region", { name: "人物の最近の売買" })).toContainText("パン");
  await page.screenshot({ path: "/tmp/medieval-v15-status.png", fullPage: true });
  await page.getByLabel("土地経済の日").fill("1");
  await page.getByLabel("土地経済の時刻").fill("1");
  await page.getByLabel("土地経済の分").fill("0");
  await expect(carried.locator("dl div").filter({ hasText: "所持金" }).locator("dd")).toHaveText("20");
  await expect(storedCash).toHaveText("0");
});

test("the default food market records farmers selling grain and purchasing bread", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/?village=land-economy&wood=market");
  await expect(page.getByLabel("表示する記録")).toHaveValue("market", { timeout: 30000 });
  await expect(page.getByRole("note")).toContainText("農夫は穀物を市場で売り");
  await page.getByLabel("土地経済の日").fill("10");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  for (const id of ["F", "B1", "B2"]) {
    await page.getByLabel("土地経済の人物").selectOption(id);
    await expect(page.getByText("製パン技能：0 · 市場で加工")).toBeVisible();
    const sales = page.getByRole("region", { name: "人物の最近の売買" });
    await expect(sales).toContainText("穀物");
    await expect(sales).toContainText("パン");
    await expect(sales).toContainText(`S → ${id}`);
  }
  await page.getByLabel("土地経済の人物").selectOption("S");
  await expect(page.getByText("製パン技能：1 · 市場で加工")).toBeVisible();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
  for (const label of ["穀物売買", "パン売買"]) {
    await expect(page.locator(".e1-stats span").filter({ hasText: label }).locator("b")).toHaveText(/^[1-9]\d*件$/);
  }
});

test("land economy recording opens from the browser route and shows timed person history", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=legacy");
  await expect(page.getByRole("heading", { name: "土地経済90日 · 生態デバッグ" })).toBeVisible();
  await expect(page.getByText("穀物の食事")).toBeVisible();
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("width", "1280");
  await expect(map).toHaveAttribute("height", "768");
  await expect(page.getByText("32ピクセル×40列×24行")).toBeVisible();
  await clickCell(map, 15, 9);
  await expect(page.getByRole("heading", { name: "選択セル 15,9" })).toBeVisible();
  await expect(page.getByText(/野草 .* \d+ · 動物なし/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "F の判断履歴" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "F のステータス" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "履歴・凡例を閉じる" })).toHaveCount(0);
  const legend = page.getByRole("button", { name: "凡例を引き出す" });
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await legend.click();
  await expect(page.getByRole("heading", { name: "地図の凡例" })).toBeVisible();
  await expect(page.getByText("畑：茶色。区画ごとに作物が育つ")).toBeVisible();
  await expect(page.getByText(/野草：薄黄の葉。採集後は葉が消え/)).toBeVisible();
  await expect(page.getByText(/休止中の畑：縦の薄い筋/)).toBeVisible();
  await expect(page.getByText(/森 · 通行可能 · 野草/)).toBeVisible();
  await page.getByRole("button", { name: "凡例をしまう" }).click();
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await legend.focus();
  await legend.press("Enter");
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await legend.press("Escape");
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("土地経済の人物")).toBeVisible();
  await expect(page.getByText(/経路 表示なし/)).toBeVisible();
  await page.getByLabel("経路の行先").selectOption("herb_patch");
  await expect(page.getByText(/経路 3セル/)).toBeVisible();
  const routePixel = await map.evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext("2d")!.getImageData(15 * 32 + 16, 11 * 32 + 16, 1, 1).data[0]);
  expect(routePixel).toBeGreaterThan(200);
  await page.getByLabel("経路の行先").selectOption("");
  const minute = page.getByLabel("土地経済の分");
  await expect(minute).toBeVisible();
  await expect(page.getByLabel("移動の刻み")).toHaveValue("5");
  await expect(page.getByText(/現在のセル: 16,12/)).toBeVisible();
  await minute.fill("10");
  await expect(page.getByText(/現在のセル: 15,11/)).toBeVisible();
  await page.getByLabel("移動の刻み").selectOption("15");
  await minute.fill("15");
  await expect(page.getByText(/現在のセル: 15,11/)).toBeVisible();
  await page.getByLabel("移動の刻み").selectOption("30");
  await minute.fill("30");
  await expect(page.getByText(/現在のセル: 15,9/)).toBeVisible();
  await page.getByLabel("移動の刻み").selectOption("60");
  await minute.fill("60");
  await expect(page.getByText(/現在のセル: 16,12/)).toBeVisible();
  await page.getByLabel("移動の刻み").selectOption("5");
  await page.getByLabel("土地経済の時刻").fill("2");
  await page.getByRole("button", { name: "＋1刻み" }).click();
  await expect(page.getByText("1日目 01:05")).toBeVisible();
  await page.getByLabel("土地経済の時刻").fill("2");
  await page.getByRole("button", { name: "再生" }).click();
  await expect(page.getByRole("status")).toContainText("再生中");
  await expect.poll(() => minute.inputValue()).not.toBe("0");
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByRole("status")).toContainText("停止中");
  const stoppedClock = await page.locator("strong[aria-live='polite']").textContent();
  const stoppedMinute = await minute.inputValue();
  await page.waitForTimeout(550);
  await expect(page.locator("strong[aria-live='polite']")).toHaveText(stoppedClock!);
  await page.getByRole("button", { name: "早送り ×4" }).click();
  await expect(page.getByRole("status")).toContainText("早送り中");
  await expect.poll(() => minute.inputValue()).not.toBe(stoppedMinute);
  await page.getByRole("button", { name: "停止" }).click();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await minute.fill("60");
  await expect(page.getByText("90日目 24:00")).toBeVisible();
  await expect(page.locator(".e1-stats span").filter({ hasText: "穀物の食事" }).locator("b")).toHaveText("435");
  await expect(page.locator(".e1-stats span").filter({ hasText: "探索した植物の食事" }).locator("b")).toHaveText("3");
  await page.getByLabel("土地経済の人物").selectOption("C");
  await expect(page.getByRole("heading", { name: "C の判断履歴" })).toBeVisible();
  await page.getByLabel("経路の行先").selectOption("grain_plot_4");
  await expect(page.getByText(/経路 \d+セル/)).toBeVisible();
  await page.getByLabel("土地経済の日").fill("1");
  await page.getByLabel("土地経済の時刻").fill("24");
  await minute.fill("55");
  await clickCell(map, 14, 11);
  await expect(page.getByText(/野生ベリー 再生中 1/)).toBeVisible();
  await page.getByLabel("土地経済の日").fill("4");
  await page.getByLabel("土地経済の時刻").fill("24");
  await minute.fill("55");
  await clickCell(map, 36, 4);
  await expect(page.getByText(/穀物 休止中 0/)).toBeVisible();
});


test("the wood suspension control suspends wood and identifies the income shortage", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=paused");
  await expect(page.getByRole("heading", { name: "土地経済90日 · 生態デバッグ" })).toBeVisible();
  await expect(page.getByLabel("表示する記録")).toHaveValue("paused");
  await expect(page.getByRole("note")).toContainText("90日間の正常稼働を示す記録ではありません");
  await expect(page.locator(".e1-stats span").filter({ hasText: "薪" }).locator("b")).toHaveText("停止中");
  await page.getByLabel("土地経済の人物").selectOption("B1");
  await page.getByLabel("土地経済の日").fill("10");
  await expect(page.getByText(/現在のセル: 2,4/)).toBeVisible();
  await expect(page.getByText(/所持金 0/).first()).toBeVisible();
  await page.getByLabel("表示する記録").selectOption("legacy");
  await expect(page.getByLabel("表示する記録")).toHaveValue("legacy");
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(page.locator(".e1-stats span").filter({ hasText: "薪" }).locator("b")).toContainText("使用");
});


test("independent farms show crop ownership and grain storage", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=farms");
  await expect(page.getByLabel("表示する記録")).toHaveValue("farms");
  await expect(page.getByRole("note")).toContainText("農夫3人は90日食料を確保");
  await expect(page.getByText("腐敗なし", { exact: true })).toBeVisible();
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  await clickCell(map, 3, 5);
  await expect(page.getByText(/所有者 B1 · farm_B1/)).toBeVisible();
  await page.getByRole("button", { name: "凡例を引き出す" }).click();
  await expect(page.getByText(/Fは黄、B1は青、B2は紫/)).toBeVisible();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("274/450");
});


test("the old round-trip gathering recording remains available", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=wild");
  await expect(page.getByLabel("表示する記録")).toHaveValue("wild");
  await expect(page.getByRole("note")).toContainText("全員が野草・ベリーを採集して直接食べられます");
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
  await expect(page.locator(".e1-stats span").filter({ hasText: "余剰売買" }).locator("b")).toHaveText("17件");
});


test("the previous scene keeps gatherers at real plant cells", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=local");
  await expect(page.getByLabel("表示する記録")).toHaveValue("local");
  await expect(page.getByRole("note")).toContainText("森・畑の中心へ自動では戻りません");
  await page.getByLabel("土地経済の人物").selectOption("S");
  await page.getByLabel("土地経済の時刻").fill("8");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.getByText(/現在のセル: 16,12/)).toHaveCount(0);
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
  await expect(page.locator(".e1-stats span").filter({ hasText: "余剰売買" }).locator("b")).toHaveText("6件");
});


test("the previous scene stores raw grain and feeds processed bread", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=bread");
  await expect(page.getByLabel("表示する記録")).toHaveValue("bread");
  await expect(page.getByRole("note")).toContainText("穀物は直接食べられません");
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
  await expect(page.locator(".e1-stats span").filter({ hasText: "パンの食事" }).locator("b")).toHaveText("269");
  await expect(page.locator(".e1-stats span").filter({ hasText: "製パン" }).locator("b")).toHaveText("275");
  await clickCell(page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" }), 2, 4);
  await expect(page.getByText(/穀物庫 B1: \d+単位 · 所有者 B1/)).toBeVisible();
});


test("the previous needs scene exposes the basis of anticipatory decisions", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=needs");
  await expect(page.getByLabel("表示する記録")).toHaveValue("needs");
  await expect(page.getByRole("note")).toContainText("短い休憩と睡眠は別");
  await page.getByLabel("土地経済の時刻").fill("18");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.getByText(/表示時点の身体：気温/)).toBeVisible();
  await expect(page.getByText(/判断理由：/)).toBeVisible();
  await page.getByLabel("土地経済の時刻").fill("10");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".village-person-location")).toContainText("進行中 睡眠");
  await page.getByRole("button", { name: "凡例を引き出す" }).click();
  await expect(page.getByText(/帰宅時刻は固定せず/)).toBeVisible();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
});


test("v16 grain comparison shows load-dependent walking and actual field inventories", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/?village=land-economy&wood=load");
  await expect(page.getByLabel("表示する記録")).toHaveValue("load", { timeout: 30000 });
  await expect(page.getByRole("note")).toContainText("播種1→収穫20");
  const carried = page.getByRole("region", { name: "携帯中の所持品" });
  const fields = page.getByRole("region", { name: "畑の保管品" });
  await expect(carried).toContainText("穀物");
  await expect(carried).not.toContainText("播種用の穀物");
  await expect(carried.locator("dl div").filter({ hasText: "総重量" }).locator("dd")).toHaveText("8 / 24");
  await expect(page.getByLabel("運搬負荷")).toContainText("56%");
  await expect(page.getByLabel("運搬負荷")).toContainText("2/時間");
  await expect(fields).toContainText("物品なし");
  const record = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-bulk-transport-90.v2.json.gz")).toString());
  const first = record.events.find((e: { kind: string; actors: string[]; data: { storeId?: string } }) => e.kind === "grain_loaded" && e.actors[0] === "B1" && e.data.storeId?.startsWith("granary_field_"));
  await page.getByLabel("土地経済の人物").selectOption("B1");
  await page.getByLabel("土地経済の日").fill(String(Math.floor((first.hour - 1) / 24) + 1));
  await page.getByLabel("土地経済の時刻").fill(String((first.hour - 1) % 24 + 1));
  await page.getByLabel("土地経済の分").fill("60");
  // Real field lots remain visible even after the person leaves the crop cell.
  await expect(fields).toContainText("穀物");
  await expect(fields.locator("dl div").filter({ hasText: "総重量" }).locator("dd")).toHaveText("30 / 512");
  await page.screenshot({ path: "/tmp/medieval-v16-load.png", fullPage: true });
  await page.getByLabel("土地経済の人物").selectOption("F");
  await page.getByLabel("土地経済の日").fill("1");
  await page.getByLabel("土地経済の時刻").fill("1");
  await page.getByLabel("土地経済の分").fill("0");
  await expect(fields).toContainText("物品なし");
  await expect(carried.locator("dl div").filter({ hasText: "総重量" }).locator("dd")).toHaveText("8 / 24");
});

test("v19 comparison shows observed food journey choices and preserves the v18 comparison", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/?village=land-economy&wood=plan");
  await expect(page.getByLabel("表示する記録")).toHaveValue("plan", { timeout: 60000 });
  const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-food-planning-90.v2.json.gz")).toString());
  const choice = r.decisions.find((d: { actorId: string; response: { subjectiveUpdate: { anticipation: { foodPlanning?: { evaluation?: { selected?: number } } } } } }) =>
    d.actorId === "F" && d.response.subjectiveUpdate.anticipation.foodPlanning?.evaluation?.selected !== undefined);
  await page.getByLabel("土地経済の日").fill(String(Math.floor((choice.hour - 1) / 24) + 1));
  await page.getByLabel("土地経済の時刻").fill(String((choice.hour - 1) % 24 + 1));
  await page.getByLabel("土地経済の分").fill("60");
  const comparison = page.getByLabel("食料行程の比較");
  await expect(comparison.locator("summary")).toContainText("次の需要まで");
  await comparison.locator("summary").click();
  await expect(comparison).toContainText("選択");
  await expect(comparison).toContainText("現地観察");
  await page.screenshot({ path: "/tmp/medieval-village-food-planning.png", fullPage: true });
  await page.getByLabel("表示する記録").selectOption("journey");
  await expect(page.getByLabel("表示する記録")).toHaveValue("journey", { timeout: 60000 });
});

test("v18 comparison shows F's real grain sale, bread purchase and cultivation purpose", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/?village=land-economy&wood=journey");
  await expect(page.getByLabel("表示する記録")).toHaveValue("journey", { timeout: 30000 });
  await expect(page.getByRole("region", { name: "経験からの見込み" })).toBeVisible();
  const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-food-journeys-90.v2.json.gz")).toString());
  const jump = async (hour: number) => {
    await page.getByLabel("土地経済の日").fill(String(Math.floor((hour - 1) / 24) + 1));
    await page.getByLabel("土地経済の時刻").fill(String((hour - 1) % 24 + 1));
    await page.getByLabel("土地経済の分").fill("60");
  };
  const trades = r.events.filter((e: VillageEvent) => e.kind === "surplus_sold");
  const grain = trades.find((e: VillageEvent) => e.data.product === "grain" && e.actors[0] === "F");
  const bread = trades.find((e: VillageEvent) => e.data.product === "bread" && e.actors[1] === "F");
  await jump(grain.hour);
  await expect(page.getByRole("region", { name: "人物の最近の売買" })).toContainText("F → S");
  await expect(page.getByRole("region", { name: "人物の最近の売買" })).toContainText("穀物");
  await jump(bread.hour);
  await expect(page.getByRole("region", { name: "人物の最近の売買" })).toContainText("S → F");
  await expect(page.getByRole("region", { name: "人物の最近の売買" })).toContainText("パン");
  const loading = r.decisions.find((d: { actorId: string; response: { subjectiveUpdate: { anticipation: { reasoning: { reason: string } } } } }) =>
    d.actorId === "F" && d.response.subjectiveUpdate.anticipation.reasoning.reason === "load one grain for selected cultivated crop");
  await jump(loading.hour);
  await expect(page.getByRole("region", { name: "人物の行動ログ", exact: true })).toContainText("農作業の目的");
  await page.screenshot({ path: "/tmp/medieval-village-food-journeys.png", fullPage: true });
});

test("v17 comparison shows actual time since eating and matched personal experience", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/?village=land-economy&wood=learn");
  await expect(page.getByLabel("表示する記録")).toHaveValue("learn", { timeout: 30000 });
  await expect(page.getByRole("region", { name: "経験からの見込み" })).toBeVisible();
  await page.getByLabel("土地経済の日").fill("10");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  const r = JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-experience-learning-90.v2.json.gz")).toString());
  const status = JSON.parse(r.events.filter((e: { kind: string; actors: string[]; hour: number }) => e.kind === "person_status" && e.actors[0] === "F" && e.hour === 240)[0].data.status);
  const last = r.decisions.filter((d: { actorId: string; hour: number }) => d.actorId === "F" && d.hour <= 240).at(-1);
  await expect(page.getByRole("region", { name: "人物の身体ステータス" })).toContainText(`食事からの経過 ${status.body.mealHours}時間`);
  await expect(page.getByRole("region", { name: "経験からの見込み" })).toContainText(`対応した結果 ${last.response.subjectiveUpdate.anticipation.learning.totals.matched}件`);
  await page.setViewportSize({ width: 1280, height: 768 });
  await expect(page.getByRole("region", { name: "全員の状態", exact: true })).toHaveCount(0);
  await page.getByLabel("土地経済の人物").selectOption("C");
  await expect(page.getByLabel("土地経済の人物")).toHaveValue("C");
  await expect(page.getByRole("heading", { name: "C のステータス" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "C の判断履歴" })).toBeVisible();
  await page.getByLabel("土地経済の人物").selectOption("F");
  const bounds = await page.getByRole("region", { name: "人物の身体ステータス" }).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  const homeBounds = (await page.getByRole("region", { name: "F の家の保管品" }).boundingBox())!;
  expect(homeBounds.y + homeBounds.height).toBeLessThanOrEqual(768);
  const recent = page.getByRole("region", { name: "人物の判断一覧", exact: true });
  await expect(recent.getByRole("heading")).toContainText("直近の判断");
  await expect(recent.locator("tbody tr")).not.toHaveCount(0);
  const firstDecision = recent.locator("tbody tr").first();
  await expect(firstDecision).toContainText(`体${last.knownContext.energy}`);
  await expect(firstDecision).toContainText(`金${last.knownContext.ownCash}`);
  await firstDecision.getByRole("button", { name: `${last.eventId} の入力と原因` }).click();
  await expect(recent.locator(`#decision-${last.eventId}`)).toBeVisible();
  await expect(recent.locator(`#decision-${last.eventId}`)).toContainText(last.eventId);
  await firstDecision.getByRole("button", { name: `${last.eventId} の入力と原因` }).click();
  const mapPanel = (await page.locator(".village-resizable-layout > .e1-map-panel").boundingBox())!;
  const mapArea = (await page.locator(".village-canvas-scroll").boundingBox())!;
  const cellInfo = (await page.getByRole("region", { name: "選択セルの状態", exact: true }).boundingBox())!;
  expect(mapArea.height).toBeGreaterThan(mapPanel.height - 90);
  expect(mapPanel.y + mapPanel.height - cellInfo.y - cellInfo.height).toBeLessThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(768);
  const specification = page.getByRole("note");
  await expect(specification).not.toHaveAttribute("open");
  await specification.locator("summary").click();
  await expect(specification).toHaveAttribute("open");
  await expect(specification.locator("p").filter({ hasText: "穀物は直接食べられません" })).toBeVisible();
  await specification.locator("summary").click();
  await page.screenshot({ path: "/tmp/medieval-village-dense-tables.png", fullPage: true });
  await page.screenshot({ path: "/tmp/medieval-v17-experience.png", fullPage: true });
  await expect(page.getByRole("region", { name: "人物の行動ログ", exact: true })).toContainText("判断理由");

  // Find a five-minute frame that includes gathering but precedes eating and the hourly checkpoint.
  const moments = (r.events as VillageEvent[]).filter((e) => e.kind === "plant_gathered" && e.actors[0] === "F")
    .map((event) => {
      const hourEvents = (r.events as VillageEvent[]).filter((e) => e.hour === event.hour);
      const index = hourEvents.findIndex((e) => e.id === event.id);
      const minute = Math.ceil((index + 1) / hourEvents.length * 12) * 5;
      const before = Math.floor(hourEvents.length * (minute - 5) / 60);
      const after = Math.floor(hourEvents.length * minute / 60);
      return { event, minute, hourEvents, before, after };
    }).find(({ minute, hourEvents, before, after }) => minute <= 55 &&
      !hourEvents.some((e) => e.kind === "travel_step" && e.actors[0] === "F") &&
      !hourEvents.slice(before, after).some((e) => e.actors[0] === "F" && ["ate", "person_status"].includes(e.kind)))!;
  expect(moments).toBeTruthy();
  const { event, minute } = moments;
  const plant = r.initialLand.plants[event.data.plantId];
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  const carried = page.getByRole("region", { name: "携帯中の所持品" });
  const lot = carried.locator("tbody tr").filter({ hasText: String(event.data.lotId) });
  await page.getByLabel("土地経済の日").fill(String(Math.floor((event.hour - 1) / 24) + 1));
  await page.getByLabel("土地経済の時刻").fill(String((event.hour - 1) % 24 + 1));
  await page.getByLabel("土地経済の分").fill(String(minute - 5));
  await clickCell(map, plant.cell.x, plant.cell.y);
  await expect(lot).toHaveCount(0);
  const position = (await page.locator(".village-person-location").textContent())!.split(" · ")[0];
  const pixels = () => map.evaluate((canvas: HTMLCanvasElement, cell: { x: number; y: number }) =>
    [...canvas.getContext("2d")!.getImageData(cell.x * 32, cell.y * 32, 32, 32).data], plant.cell);
  const beforePixels = await pixels();
  const beforeMass = Number((await carried.locator("dl div").filter({ hasText: "総重量" }).locator("dd").textContent())!.split("/")[0]);
  await page.getByLabel("土地経済の分").fill(String(minute));
  await expect(lot.locator("td").nth(1)).toHaveText(String(event.data.quantity));
  await expect(carried.locator("dl div").filter({ hasText: "総重量" }).locator("dd")).toHaveText(`${beforeMass + Number(event.data.quantity)} / 24`);
  await expect(page.locator(".village-person-location")).toContainText(position);
  expect(await pixels()).not.toEqual(beforePixels);
  await page.screenshot({ path: "/tmp/medieval-village-gather-status.png", fullPage: true });
  await expect(page.getByRole("region", { name: "選択セルの状態", exact: true })).toContainText("再生中");
});

test("inspector panes resize together with the map and the independent legend pulls from the edge", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=legacy");
  const separator = page.getByRole("separator", { name: "地図と人物パネルの幅" });
  await expect(separator).toBeVisible();
  const side = page.getByRole("complementary", { name: "人物のステータスと行動ログ" });
  const status = page.getByRole("region", { name: "人物のステータス", exact: true });
  const log = page.getByRole("region", { name: "人物の行動ログ", exact: true });
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  const personBox = (await page.getByLabel("土地経済の人物").boundingBox())!;
  const routeBox = (await page.getByLabel("経路の行先").boundingBox())!;
  expect(Math.abs(personBox.y - routeBox.y)).toBeLessThan(2);
  const statusBox = (await status.boundingBox())!;
  const logBox = (await log.boundingBox())!;
  expect(Math.abs(statusBox.y - logBox.y)).toBeLessThan(2);
  expect(logBox.x).toBeGreaterThan(statusBox.x + statusBox.width);
  const sideBefore = (await side.boundingBox())!;
  const mapBefore = (await map.boundingBox())!;
  const dividerBox = (await separator.boundingBox())!;
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x - 100, dividerBox.y + 80, { steps: 8 });
  await page.mouse.up();
  expect((await side.boundingBox())!.width).toBeGreaterThan(sideBefore.width + 90);
  expect((await map.boundingBox())!.width).toBeLessThan(mapBefore.width - 90);
  await expect(map).toHaveAttribute("width", "1280");
  await expect(map).toHaveAttribute("height", "768");
  const resizedMap = (await map.boundingBox())!;
  expect(resizedMap.width / resizedMap.height).toBeCloseTo(1280 / 768, 2);
  await clickCell(map, 15, 9);
  await expect(page.getByRole("heading", { name: "選択セル 15,9" })).toBeVisible();
  await separator.press("ArrowRight");
  expect((await side.boundingBox())!.width).toBeLessThan(sideBefore.width + 90);

  const legend = page.getByRole("button", { name: "凡例を引き出す" });
  const handle = (await legend.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 340, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "地図の凡例" })).toBeVisible();
  await expect(status).toBeVisible();
  await expect(log).toBeVisible();
  await page.screenshot({ path: "/tmp/medieval-village-resizable.png", fullPage: true });
  await legend.press("Escape");
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1920, height: 768 });
  const expandedArea = (await page.locator(".village-canvas-scroll").boundingBox())!;
  const expandedMap = (await map.boundingBox())!;
  expect(expandedMap.height).toBeGreaterThan(430);
  expect(expandedMap.height).toBeLessThanOrEqual(expandedArea.height);
  expect(expandedMap.width).toBeLessThanOrEqual(expandedArea.width);
  expect(expandedMap.width / expandedMap.height).toBeCloseTo(1280 / 768, 2);
  await page.screenshot({ path: "/tmp/medieval-village-expanded-map.png", fullPage: true });
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(separator).toBeHidden();
  await clickCell(map, 36, 4);
  await expect(page.getByRole("heading", { name: "選択セル 36,4" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
});

test("v20 default replays settling and actual sleep at their recorded quarter-hour times", async ({ page }) => {
  test.setTimeout(180000);
  const { decodeVillageDocument } = await import("../../packages/sim/shared-village-json");
  const r = decodeVillageDocument<import("../../packages/sim/village-recording").VillageRecording>(
    JSON.parse(gunzipSync(readFileSync("fixtures/recordings/autonomous-village-sleep-regulation-90.v2.json.gz")).toString()), true);
  const attempt = r.events.find((e) => e.kind === "sleep_attempted" && e.actors[0] === "F")!;
  const onset = r.events.find((e) => e.kind === "sleep_started" && e.actors[0] === "F")!;
  await page.goto("/?village=land-economy");
  await expect(page.getByLabel("表示する記録")).toHaveValue("sleep", { timeout: 60000 });
  const body = page.getByRole("region", { name: "人物の身体ステータス" });
  await expect(body).toContainText("24hの実睡眠");
  await page.getByLabel("移動の刻み").selectOption("5");
  const seek = async (minutes: number) => {
    await page.getByLabel("土地経済の日").fill(String(Math.floor(minutes / 1440) + 1));
    await page.getByLabel("土地経済の時刻").fill(String(Math.floor(minutes % 1440 / 60) + 1));
    await page.getByLabel("土地経済の分").fill(String(minutes % 60));
  };
  await seek(Number(attempt.data.atMinute) + 5);
  await expect(body.locator("dl div").filter({ hasText: /^行動/ }).locator("dd")).toHaveText("入眠待ち");
  const at = Number(onset.data.atMinute) + 15;
  await seek(at);
  await expect(body.locator("dl div").filter({ hasText: /^行動/ }).locator("dd")).toHaveText("睡眠");
  const checkpoint = r.events.filter((e) => e.actors[0] === "F" && e.kind === "body_changed" && Number(e.data.atMinute) <= at).at(-1)!;
  await expect(page.locator(".village-status-context")).toContainText(`${Math.floor(at / 1440) + 1}日目 ${String(Math.floor(at % 1440 / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
  await expect(body.locator("dl div").filter({ hasText: /^24hの実睡眠/ }).locator("dd")).toHaveText(`${checkpoint.data.actualSleep24}時間`);
  await expect(body.locator("dl div").filter({ hasText: /^睡眠不足/ }).locator("dd")).toHaveText(`${checkpoint.data.sleepDeficit}時間`);
  await expect(page.getByRole("progressbar", { name: "眠気", exact: true })).toHaveAttribute("value", String(Math.round(Number(checkpoint.data.sleepiness) * 100)));
  await expect(page.getByLabel("睡眠の予測学習")).toBeVisible();
  await page.screenshot({ path: "/tmp/medieval-village-sleep-regulation.png", fullPage: true });
  await seek(Number(attempt.data.atMinute) + 5);
  await expect(body.locator("dl div").filter({ hasText: /^行動/ }).locator("dd")).toHaveText("入眠待ち");
  await page.getByLabel("表示する記録").selectOption("plan");
  await expect(page.getByLabel("表示する記録")).toHaveValue("plan", { timeout: 60000 });
  await expect(body).not.toContainText("24hの実睡眠");
});
