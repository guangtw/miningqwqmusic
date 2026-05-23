import { expect, test } from "@playwright/test";

test("home page renders player shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MiningQwQ Music" })).toBeVisible();
  await page.getByRole("button", { name: "搜索" }).first().click();
  await expect(page.getByPlaceholder("例如：周杰伦、晴天")).toBeVisible();
  await expect(page.getByRole("button", { name: "播放" })).toBeVisible();
});
