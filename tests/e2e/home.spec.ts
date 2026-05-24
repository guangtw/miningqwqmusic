import { expect, test } from "@playwright/test";

test("home page renders player shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".spotify-logo")).toContainText("MiningQwQ Music");
  await page.getByRole("button", { name: "搜索" }).first().click();
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await expect(page.locator(".spotify-search-panel input")).toBeVisible();
  await expect(page.locator(".spotify-player-controls .play-main").first()).toBeVisible();
});

test("escape closes detail overlay and returns search tab to home", async ({ page }) => {
  await page.goto("/");
  await page.locator(".spotify-player-bar").click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();

  await page.getByRole("button", { name: "搜索" }).first().click();
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await expect(page.locator(".spotify-search-panel input")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "发现音乐" })).toBeVisible();
});

test("playlist card opens second-level panel without forced autoplay", async ({ page }) => {
  await page.goto("/");
  const playlistCard = page.locator(".home-playlist-card").first();
  const cardCount = await page.locator(".home-playlist-card").count();
  test.skip(cardCount === 0, "当前环境无可展示歌单卡片，跳过二级歌单交互用例。");
  await expect(playlistCard).toBeVisible();
  await playlistCard.click();
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放全部" })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停" })).toHaveCount(0);
});

test("can import a playlist link into library and open it", async ({ page }) => {
  await page.route("**/api/music/playlist/123456789", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-import",
        data: {
          id: "123456789",
          name: "E2E 导入歌单",
          description: "来自自动化测试",
          coverUrl: "https://picsum.photos/seed/e2e/300/300",
          tracks: [
            {
              id: "track-1",
              name: "E2E Track",
              artists: [{ id: "artist-1", name: "E2E Artist" }],
              durationMs: 180000,
              coverUrl: "https://picsum.photos/seed/e2e-track/300/300"
            }
          ]
        }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await page.getByRole("button", { name: "我的歌单" }).first().click();
  await expect(page.locator(".library-import-row input")).toBeVisible();
  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=123456789");
  await page.getByRole("button", { name: "导入歌单" }).click();
  await expect(page.locator(".library-imported-item")).toContainText("E2E 导入歌单");
  await page.getByRole("button", { name: "打开" }).first().click();
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeVisible();
});
