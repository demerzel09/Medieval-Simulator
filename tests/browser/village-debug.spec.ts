import { expect, test } from "@playwright/test";

test("land economy recording opens from the browser route and shows timed person history", async ({ page }) => {
  await page.goto("/?village=land-economy");
  await expect(page.getByRole("heading", { name: "土地経済90日 · 空間デバッグ" })).toBeVisible();
  await expect(page.getByText("穀物の食事")).toBeVisible();
  const map = page.getByRole("img", { name: "土地経済の1280×768ピクセル地図" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("width", "1280");
  await expect(map).toHaveAttribute("height", "768");
  await expect(page.getByText("32ピクセル×40列×24行")).toBeVisible();
  await map.click({ position: { x: 20 * 32 + 16, y: 10 * 32 + 16 } });
  await expect(page.getByRole("heading", { name: "選択セル 20,10" })).toBeVisible();
  await expect(page.getByText(/穀物 .* \d+ · 動物なし/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "F の判断履歴" })).toBeVisible();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await expect(page.getByText("90日目 24時")).toBeVisible();
  await expect(page.locator(".e1-stats span").filter({ hasText: "穀物の食事" }).locator("b")).toHaveText("435");
  await page.getByLabel("土地経済の人物").selectOption("C");
  await expect(page.getByRole("heading", { name: "C の判断履歴" })).toBeVisible();
  await page.getByLabel("経路の行先").selectOption("grain_plot_4");
  await expect(page.getByText(/経路 \d+セル/)).toBeVisible();
});
