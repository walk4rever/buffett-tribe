import { expect, test } from "@playwright/test";

test("Escape closes search after clearing the query", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "搜索大师、公司或洞见" }).click();

  const dialog = page.getByRole("dialog", { name: "全站搜索" });
  await expect(dialog).toBeVisible();

  await page.getByRole("combobox", { name: "搜索大师、公司或洞见主题" }).fill("AAPL");
  await page.getByRole("button", { name: "清空搜索" }).click();
  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
});
