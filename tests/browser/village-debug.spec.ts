import { expect, test } from "@playwright/test";

test("land economy recording opens from the browser route and shows timed person history", async ({ page }) => {
  await page.goto("/?village=land-economy");
  await expect(page.getByRole("heading", { name: "土地経済90日 · 記録デバッグ" })).toBeVisible();
  await expect(page.getByText("穀物の食事")).toBeVisible();
  await expect(page.getByRole("img", { name: "土地経済の矩形地図" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "F の判断履歴" })).toBeVisible();
  await page.getByLabel("土地経済の日").fill("90");
  await page.getByLabel("土地経済の時刻").fill("24");
  await expect(page.getByText("90日目 24時")).toBeVisible();
  await expect(page.locator(".e1-stats span").filter({ hasText: "穀物の食事" }).locator("b")).toHaveText("435");
  await page.getByLabel("土地経済の人物").selectOption("C");
  await expect(page.getByRole("heading", { name: "C の判断履歴" })).toBeVisible();
});
