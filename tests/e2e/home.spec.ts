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

test("desktop theme switch toggles data-theme", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const toggle = page.locator(".theme-switch:visible").first();
  const thumb = toggle.locator(".theme-switch-thumb");
  const thumbIcon = toggle.locator(".theme-switch-thumb-icon");
  const sunRef = toggle.locator(".theme-switch-icon.sun");
  const moonRef = toggle.locator(".theme-switch-icon.moon");
  await expect(toggle).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveClass(/is-dark/);
  await expect(thumbIcon.locator("svg")).toHaveCount(1);
  await expect(moonRef).toHaveCSS("opacity", "0");
  const sunOpacityDark = await sunRef.evaluate((node) => Number.parseFloat(getComputedStyle(node).opacity));
  expect(sunOpacityDark).toBeGreaterThan(0.5);

  const toggleBoxDark = await toggle.boundingBox();
  const thumbBoxDark = await thumb.first().boundingBox();
  const moonBoxDark = await moonRef.first().boundingBox();
  expect(toggleBoxDark).not.toBeNull();
  expect(thumbBoxDark).not.toBeNull();
  expect(moonBoxDark).not.toBeNull();
  if (toggleBoxDark && thumbBoxDark && moonBoxDark) {
    expect(Math.round(toggleBoxDark.width)).toBe(72);
    const darkDistance = Math.abs(thumbBoxDark.x + thumbBoxDark.width / 2 - (moonBoxDark.x + moonBoxDark.width / 2));
    expect(darkDistance).toBeLessThan(14);
  }

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveClass(/is-light/);
  await expect(sunRef).toHaveCSS("opacity", "0");
  const moonOpacityLight = await moonRef.evaluate((node) => Number.parseFloat(getComputedStyle(node).opacity));
  expect(moonOpacityLight).toBeGreaterThan(0.5);
  await page.waitForTimeout(420);

  const thumbBoxLight = await thumb.first().boundingBox();
  const sunBox = await sunRef.first().boundingBox();
  expect(thumbBoxLight).not.toBeNull();
  expect(sunBox).not.toBeNull();
  if (thumbBoxLight && thumbBoxDark && sunBox) {
    expect(thumbBoxLight.x).toBeLessThan(thumbBoxDark.x - 18);
    const lightDistance = Math.abs(thumbBoxLight.x + thumbBoxLight.width / 2 - (sunBox.x + sunBox.width / 2));
    expect(lightDistance).toBeLessThan(14);
  }
});

test("mobile topbar theme switch toggles theme and keeps line icons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.locator(".theme-switch-mobile .theme-switch").first();
  await expect(toggle).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".theme-switch-card")).toHaveCount(0);
  await expect(toggle.locator(".theme-switch-icon.sun path")).toHaveAttribute("fill", "none");
  await expect(toggle.locator(".theme-switch-icon.moon path")).toHaveAttribute("fill", "none");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("playlist drawer keeps a small top gap", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await page.locator(".theme-switch:visible").first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const playlistCard = page.locator(".home-playlist-card").first();
  const cardCount = await page.locator(".home-playlist-card").count();
  test.skip(cardCount === 0, "当前环境无可展示歌单卡片，跳过抽屉高度验证。");
  await playlistCard.click();
  const drawer = page.locator(".home-playlist-drawer");
  await expect(drawer).toBeVisible();
  const drawerBackground = await drawer.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(drawerBackground).toContain("255");
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  const topGap = box ? box.y : 0;
  expect(topGap).toBeLessThanOrEqual(90);
});

test("mobile detail layout hides lyric mode chips and tab switch remains clickable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".spotify-player-bar").click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "原文" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "翻译" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "逐字" })).toHaveCount(0);
  await expect(page.locator(".detail-dock-song")).toHaveCount(0);

  await page.getByRole("button", { name: "歌曲信息" }).click();
  await expect(page.locator(".detail-meta-list")).toBeVisible();
  await page.getByRole("button", { name: "歌词" }).click();
  const lyricScroll = page.locator(".detail-lyric-scroll");
  await expect(lyricScroll).toBeVisible();
  const topbar = page.locator(".detail-topbar");
  const topbarBox = await topbar.boundingBox();
  const lyricBox = await lyricScroll.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(lyricBox).not.toBeNull();
  if (topbarBox && lyricBox) {
    expect(lyricBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height - 1);
  }

  const detailViewportMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(detailViewportMetrics.scrollWidth).toBeLessThanOrEqual(detailViewportMetrics.clientWidth + 1);

  const lyricMetrics = await lyricScroll.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(lyricMetrics.scrollWidth).toBeLessThanOrEqual(lyricMetrics.clientWidth + 1);

  await page.getByRole("button", { name: "收起播放器" }).click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
});

test("mobile library does not introduce page-level horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await expect(page.getByRole("heading", { name: "你的音乐库" })).toBeVisible();

  const pageMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth + 1);

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
