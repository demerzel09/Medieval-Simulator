import { expect, test } from "@playwright/test";

test("land economy recording opens from the browser route and shows timed person history", async ({ page }) => {
  await page.goto("/?village=land-economy&wood=legacy");
  await expect(page.getByRole("heading", { name: "土地経済90日 · 生態デバッグ" })).toBeVisible();
  await expect(page.getByText("穀物の食事")).toBeVisible();
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("width", "1280");
  await expect(map).toHaveAttribute("height", "768");
  await expect(page.getByText("32ピクセル×40列×24行")).toBeVisible();
  await map.click({ position: { x: 15 * 32 + 16, y: 9 * 32 + 16 } });
  await expect(page.getByRole("heading", { name: "選択セル 15,9" })).toBeVisible();
  await expect(page.getByText(/野草 .* \d+ · 動物なし/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "F の判断履歴" })).toBeVisible();
  const historyTab = page.getByRole("tab", { name: "人物の履歴" });
  const legendTab = page.getByRole("tab", { name: "凡例" });
  await expect(historyTab).toHaveAttribute("aria-selected", "true");
  await legendTab.click();
  await expect(page.getByRole("heading", { name: "地図の凡例" })).toBeVisible();
  await expect(page.getByText("畑：茶色。区画ごとに作物が育つ")).toBeVisible();
  await expect(page.getByText(/野草：薄黄の葉。採集後は葉が消え/)).toBeVisible();
  await expect(page.getByText(/休止中の畑：縦の薄い筋/)).toBeVisible();
  await expect(page.getByText(/森 · 通行可能 · 野草/)).toBeVisible();
  await historyTab.click();
  await historyTab.press("ArrowRight");
  await expect(legendTab).toHaveAttribute("aria-selected", "true");
  await legendTab.press("ArrowLeft");
  await expect(historyTab).toHaveAttribute("aria-selected", "true");
  const collapse = page.getByRole("button", { name: "履歴・凡例を閉じる" });
  await collapse.click();
  await expect(page.getByRole("button", { name: "履歴・凡例を開く" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("土地経済の人物")).toHaveCount(0);
  await page.getByRole("button", { name: "履歴・凡例を開く" }).click();
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
  await map.click({ position: { x: 14 * 32 + 16, y: 11 * 32 + 16 } });
  await expect(page.getByText(/野生ベリー 再生中 1/)).toBeVisible();
  await page.getByLabel("土地経済の日").fill("4");
  await page.getByLabel("土地経済の時刻").fill("24");
  await minute.fill("55");
  await map.click({ position: { x: 36 * 32 + 16, y: 4 * 32 + 16 } });
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
  await map.click({ position: { x: 3 * 32 + 16, y: 5 * 32 + 16 } });
  await expect(page.getByText(/所有者 B1 · farm_B1/)).toBeVisible();
  await page.getByRole("tab", { name: "凡例" }).click();
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


test("the default scene stores raw grain and feeds processed bread", async ({ page }) => {
  await page.goto("/?village=land-economy");
  await expect(page.getByLabel("表示する記録")).toHaveValue("bread");
  await expect(page.getByRole("note")).toContainText("穀物は直接食べられません");
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await page.getByLabel("土地経済の分").fill("60");
  await expect(page.locator(".e1-stats span").filter({ hasText: /^食事/ }).locator("b")).toHaveText("450/450");
  await expect(page.locator(".e1-stats span").filter({ hasText: "パンの食事" }).locator("b")).toHaveText("269");
  await expect(page.locator(".e1-stats span").filter({ hasText: "製パン" }).locator("b")).toHaveText("275");
  await page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" }).click({ position: { x: 2 * 32 + 16, y: 4 * 32 + 16 } });
  await expect(page.getByText(/穀物庫 B1: \d+単位 · 所有者 B1/)).toBeVisible();
});
