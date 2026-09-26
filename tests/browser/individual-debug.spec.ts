import { expect, test } from "@playwright/test";

test("individual life map shows foraging, meals, ownership and physical sites", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?individual=life");
  await expect(page.getByRole("heading", { name: "制度なし採集生活" })).toBeVisible();
  await expect(page.locator(".e1-stats")).toContainText("食事 3");
  await page.getByRole("button", { name: "人物 A" }).click();
  await expect(page.locator(".e1-detail")).toContainText("空腹: 0");
  await expect(page.locator(".e1-detail")).toContainText("foraged");
  await page.getByRole("button", { name: "木立と食料資源 grove" }).click();
  await expect(page.locator(".e1-detail")).toContainText("所有者: なし");
  expect(errors).toEqual([]);
});

test("individual market map shows S-owned site and local price response", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?individual=market");
  await expect(page.getByRole("heading", { name: "S個人の市場と取引" })).toBeVisible();
  await page.getByRole("button", { name: "Sの市場 market" }).click();
  await expect(page.locator(".e1-detail")).toContainText("所有者: S");
  await expect(page.locator(".e1-stats")).toContainText("店頭価格 4");
  await expect(page.locator(".e1-stats")).toContainText("Sの留保額 4");
  await page.getByRole("button", { name: "人物 F" }).click();
  await expect(page.locator(".e1-detail")).toContainText("harvest_contract_accepted");
  await expect(page.locator(".e1-detail")).toContainText("foraged");
  await page.getByRole("button", { name: "＋1日" }).click();
  await expect(page.locator(".e1-stats")).toContainText("店頭価格 5");
  await page.getByRole("button", { name: "人物 C" }).click();
  await expect(page.locator(".e1-detail")).toContainText("carrier_paid");
  for (let day = 2; day < 7; day++) await page.getByRole("button", { name: "＋1日" }).click();
  await expect(page.locator(".e1-stats")).toContainText("腐敗 5");
  expect(errors).toEqual([]);
});
