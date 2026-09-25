import { test, expect } from "@playwright/test";
test("new game, commands, reports, commitments, persistence, ending", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "統治を始める" }).click();
  await expect(
    page.getByRole("heading", { name: "領邦と交易路" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "了解", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "artifacts/strategy-screen.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "通行料＋不可侵を提案" }).click();
  await expect(
    page.getByText("文書作成キューへ登録しました。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1日", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  await expect(
    page.getByText("商用通行権を獲得。", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "約束", exact: true }).click();
  await page.getByRole("button", { name: "約束を送る" }).click();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1日", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".promise")).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("端末に保存しました。")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "保存から再開" }).click();
  await expect(
    page.getByRole("heading", { name: "領邦と交易路" }),
  ).toBeVisible();
  await expect(
    page.getByText("商用通行権", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "会戦", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "準備が、会戦を変える。" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("90 days through UI reaches diplomatic ending", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "統治を始める" }).click();
  await page.getByRole("button", { name: "通行料＋不可侵を提案" }).click();
  await page.getByRole("checkbox", { name: "重要報告で停止" }).uncheck();
  for (let i = 0; i < 90; i++) {
    await page.getByRole("button", { name: "1日", exact: true }).click();
    await expect(page.getByRole("button", { name: "1日", exact: true }))
      .toBeEnabled({ timeout: 5000 })
      .catch(async () => {
        await expect(
          page.getByRole("heading", { name: "峠への道は開かれた" }),
        ).toBeVisible();
      });
  }
  await expect(
    page.getByRole("heading", { name: "峠への道は開かれた" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "artifacts/ending-screen.png",
    fullPage: true,
  });
});

test("sample save, battle reports and small screen remain usable", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("JSONセーブを読み込む")
    .setInputFiles("artifacts/sample-war-day4.json");
  await expect(
    page.getByRole("heading", { name: "領邦と交易路" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "了解", exact: true }).click();
  await page.getByRole("button", { name: "会戦", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "準備が、会戦を変える。" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "artifacts/battle-screen.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("developer view lists all residents and shows staff actions without leaking into normal view", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "統治を始める" }).click();
  await page.getByRole("button", { name: "了解", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "開発", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "開発モード" }).check();
  await page.getByRole("button", { name: "開発", exact: true }).click();
  await expect(page.getByText("該当 1000 人", { exact: false })).toBeVisible();
  await page.getByLabel("人物ID・名前・仕事を検索").fill("a_0005");
  await expect(
    page.getByRole("button", { name: /a_0005 書記イーサ/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "地図", exact: true }).click();
  await page.getByRole("button", { name: "通行料＋不可侵を提案" }).click();
  await page.getByRole("button", { name: "1時間", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1時間", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "開発", exact: true }).click();
  await expect(
    page.getByText("scribe_prepared", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/debug-screen.png", fullPage: true });
});
