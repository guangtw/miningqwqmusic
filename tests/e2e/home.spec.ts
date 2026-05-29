import { expect, test } from "@playwright/test";

test("home page renders player shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".spotify-logo")).toContainText("MiningQwQ Music");
  await page.getByRole("button", { name: "搜索" }).first().click();
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await expect(page.locator(".spotify-search-panel input")).toBeVisible();
  await expect(page.locator(".spotify-player-controls .play-main").first()).toBeVisible();
});

test("account entry stays hidden when account proxy is not configured", async ({ page }) => {
  await page.route("**/api/account/auth/refresh", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5401,
        message: "Account service is not configured",
        traceId: "e2e-no-account",
        retryable: false
      })
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "登录同步" })).toHaveCount(0);
});

test("account entry is available when account proxy responds and can open dialog", async ({ page }) => {
  await page.route("**/api/account/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5203,
        message: "Refresh token invalid or expired",
        traceId: "e2e-account-on",
        retryable: false
      })
    });
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const loginButton = page.getByRole("button", { name: "登录同步" }).first();
  await expect(loginButton).toBeVisible();
  await loginButton.click();
  await expect(page.getByRole("dialog", { name: "账号登录" })).toBeVisible();
});

test("escape closes detail overlay and returns search tab to home", async ({ page }) => {
  await page.goto("/");
  const playerBar = page.locator(".spotify-player-bar");
  const playerBarBox = await playerBar.boundingBox();
  expect(playerBarBox).not.toBeNull();
  if (playerBarBox) {
    await page.mouse.click(playerBarBox.x + 4, playerBarBox.y + 4);
  }
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
  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  if (await expandDetailButton.count()) {
    await expandDetailButton.click();
  } else {
    const playerBar = page.locator(".spotify-player-bar");
    await expect(playerBar).toBeVisible();
    const playerBarBox = await playerBar.boundingBox();
    expect(playerBarBox).not.toBeNull();
    if (playerBarBox) {
      await page.mouse.click(playerBarBox.x + 4, playerBarBox.y + 4);
    }
  }
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
  const detailScreen = page.locator(".player-detail-screen");
  const detailTransition = await detailScreen.evaluate((node) => ({
    timing: getComputedStyle(node).transitionTimingFunction,
    duration: getComputedStyle(node).transitionDuration
  }));
  expect(detailTransition.timing).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  expect(detailTransition.duration).toContain("0.34s");
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

  const mobileLyricWindow = await lyricScroll.evaluate((node) => {
    const firstLine = node.querySelector(".detail-lyric-line") as HTMLElement | null;
    if (!firstLine) return null;
    const style = getComputedStyle(firstLine);
    const rowHeight = firstLine.getBoundingClientRect().height;
    return {
      rowHeight,
      visibleRows: node.clientHeight / rowHeight,
      fontSize: Number.parseFloat(style.fontSize)
    };
  });
  if (mobileLyricWindow) {
    expect(mobileLyricWindow.visibleRows).toBeGreaterThan(3.4);
    expect(mobileLyricWindow.visibleRows).toBeLessThan(4.6);
    expect(mobileLyricWindow.fontSize).toBeGreaterThanOrEqual(16);
  }

  const lyricFocusOffset = await lyricScroll.evaluate((node) => {
    const active = node.querySelector(".detail-lyric-line.active") as HTMLElement | null;
    if (!active) return null;
    const hostRect = node.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return {
      offset:
        activeRect.top + activeRect.height / 2 - (hostRect.top + hostRect.height / 2),
      hostHeight: hostRect.height
    };
  });
  if (lyricFocusOffset) {
    expect(Math.abs(lyricFocusOffset.offset)).toBeLessThanOrEqual(lyricFocusOffset.hostHeight * 0.3);
  }

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

test("library segmented pill keeps thumb in bounds and fades content on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await expect(page.locator(".library-segmented-pill")).toBeVisible();
  await expect(page.locator(".library-content-switcher")).toHaveClass(/phase-idle/);

  await page.locator(".library-segmented-pill-btn[data-library-view='library-playlists']").click();
  await expect(page.locator(".library-content-switcher")).toHaveClass(/phase-(leaving|entering|idle)/);
  await expect(page.getByPlaceholder("粘贴网易云歌单链接、分享文案或歌单 ID")).toBeVisible();
  await expect(page.locator(".library-content-switcher")).toHaveClass(/phase-idle/);

  const bounds = await page.locator(".library-segmented-pill").evaluate((root) => {
    const thumb = root.querySelector(".library-segmented-pill-thumb") as HTMLElement | null;
    if (!thumb) return null;
    const rootRect = root.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    return {
      left: thumbRect.left - rootRect.left,
      right: thumbRect.right - rootRect.left,
      width: rootRect.width
    };
  });
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  }

  await page.locator(".library-segmented-pill-btn[data-library-view='library-favorites']").click();
  await expect(page.locator(".library-content-switcher")).toHaveClass(/phase-idle/);
  await expect(page.getByRole("heading", { name: "收藏歌曲" })).toBeVisible();
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
  await page.locator(".library-segmented-pill-btn[data-library-view='library-playlists']").click();
  await expect(page.locator(".library-import-row input")).toBeVisible();
  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=123456789");
  await page.getByRole("button", { name: "导入歌单" }).click();
  await expect(page.locator(".library-imported-item")).toContainText("E2E 导入歌单");
  await page.getByRole("button", { name: "打开" }).first().click();
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeVisible();
});

test("queue button opens queue drawer and can close", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开播放队列" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
});

test("locate playing button works for queue and is disabled when playlist has no current track", async ({ page }) => {
  await page.route("**/api/music/playlist/111111", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-locate-seed",
        data: {
          id: "111111",
          name: "定位功能种子歌单",
          description: "用于准备当前播放歌曲",
          coverUrl: "https://picsum.photos/seed/e2e-seed/300/300",
          tracks: [
            {
              id: "queue-seed-track-1",
              name: "队列定位测试歌曲",
              artists: [{ id: "artist-seed-1", name: "E2E Seed Artist" }],
              durationMs: 182000,
              coverUrl: "https://picsum.photos/seed/e2e-seed-track/300/300"
            }
          ]
        }
      })
    });
  });

  await page.route("**/api/music/playlist/909090", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-locate-panel",
        data: {
          id: "909090",
          name: "定位禁用验证歌单",
          description: "用于验证定位当前播放歌曲按钮",
          coverUrl: "https://picsum.photos/seed/e2e-locate/300/300",
          tracks: [
            {
              id: "locate-only-1",
              name: "不在当前播放中的歌曲",
              artists: [{ id: "artist-locate-1", name: "E2E Locate Artist" }],
              durationMs: 182000,
              coverUrl: "https://picsum.photos/seed/e2e-locate-track/300/300"
            }
          ]
        }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await page.locator(".library-segmented-pill-btn[data-library-view='library-playlists']").click();
  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=111111");
  await page.getByRole("button", { name: "导入歌单" }).click();
  const seedPlaylistItem = page.locator(".library-imported-item", { hasText: "定位功能种子歌单" }).first();
  await expect(seedPlaylistItem).toBeVisible();
  await seedPlaylistItem.getByRole("button", { name: "播放" }).click();

  await page.getByRole("button", { name: "打开播放队列" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();
  const locateButton = page.getByRole("button", { name: "定位正在播放" }).first();
  await expect(locateButton).toBeVisible();
  await expect(locateButton).toBeEnabled();
  await locateButton.click();
  const locatedCount = await page.locator(".home-playlist-track-row.located").count();
  expect(locatedCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "关闭" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();

  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=909090");
  await page.getByRole("button", { name: "导入歌单" }).click();
  const mismatchPlaylistItem = page.locator(".library-imported-item", { hasText: "定位禁用验证歌单" }).first();
  await expect(mismatchPlaylistItem).toBeVisible();
  await mismatchPlaylistItem.getByRole("button", { name: "打开" }).click();
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeVisible();
  const locateButtonInPlaylist = page.getByRole("button", { name: "定位正在播放" }).first();
  await expect(locateButtonInPlaylist).toBeVisible();
  await expect(locateButtonInPlaylist).toBeDisabled();
  await expect(locateButtonInPlaylist).toHaveAttribute("title", "当前播放歌曲不在此列表中");
});

test("player controls stay consistent and centered in dock/detail", async ({ page }) => {
  await page.goto("/");
  const dockControlButtons = page.locator(".spotify-player-bar .spotify-player-controls .icon-btn");
  const dockOrder = await dockControlButtons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(dockOrder).toHaveLength(5);
  expect(dockOrder[0]).toBe("打开播放队列");
  expect(dockOrder[1]).toBe("上一首");
  expect(["播放", "暂停"]).toContain(dockOrder[2]);
  expect(dockOrder[3]).toBe("下一首");

  const dockCenters = await dockControlButtons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left + rect.width / 2;
    })
  );
  expect(Math.abs((dockCenters[1] + dockCenters[3]) / 2 - dockCenters[2])).toBeLessThanOrEqual(1.2);

  const playerBar = page.locator(".spotify-player-bar");
  const playerBarBox = await playerBar.boundingBox();
  expect(playerBarBox).not.toBeNull();
  if (playerBarBox) {
    await page.mouse.click(playerBarBox.x + 4, playerBarBox.y + 4);
  }
  const detailDialog = page.getByRole("dialog", { name: "播放详情" });
  const detailVisibleCount = await detailDialog.count();
  test.skip(detailVisibleCount === 0, "当前环境无可播放曲目，跳过详情区按钮验证。");
  await expect(detailDialog).toBeVisible();

  const detailOrder = await page.locator(".detail-dock-controls .icon-btn").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(detailOrder).toHaveLength(5);
  expect(detailOrder[0]).toBe("打开播放队列");
  expect(detailOrder[1]).toBe("上一首");
  expect(["播放", "暂停"]).toContain(detailOrder[2]);
  expect(detailOrder[3]).toBe("下一首");
  expect(detailOrder[4]).toBe("循环");

  const detailCenters = await page.locator(".detail-dock-controls .icon-btn").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left + rect.width / 2;
    })
  );
  expect(Math.abs((detailCenters[1] + detailCenters[3]) / 2 - detailCenters[2])).toBeLessThanOrEqual(1.2);
});

test("search assist hot and suggestion are capped within two rows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "搜索" }).first().click();
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();

  const countRows = async (selector: string) =>
    page.locator(selector).evaluate((node) => {
      const buttons = Array.from(node.querySelectorAll("button")) as HTMLButtonElement[];
      const uniqueRows = Array.from(new Set(buttons.map((button) => button.offsetTop)));
      return uniqueRows.length;
    });

  const hotRows = await page.locator(".search-assist-row").nth(0).count();
  if (hotRows > 0) {
    expect(await countRows(".search-assist-row:nth-of-type(1) div")).toBeLessThanOrEqual(2);
  }
  const suggestRows = await page.locator(".search-assist-row").nth(1).count();
  if (suggestRows > 0) {
    expect(await countRows(".search-assist-row:nth-of-type(2) div")).toBeLessThanOrEqual(2);
  }
});

test("mobile library hub head has sufficient height for touch operations", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证触控高度。");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await expect(page.locator(".library-hub-head")).toBeVisible();
  const headHeight = await page.locator(".library-hub-head").evaluate((node) => node.getBoundingClientRect().height);
  expect(headHeight).toBeGreaterThanOrEqual(170);
});

test("playlist summary supports expand collapse and shows active playing row indicator", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "该场景在移动端覆盖交互主路径。");
  await page.route("**/api/music/playlist/555666777", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-long-playlist",
        data: {
          id: "555666777",
          name: "E2E 超长描述歌单",
          description:
            "这是一个用于自动化测试的超长歌单简介。".repeat(14),
          coverUrl: "https://picsum.photos/seed/e2e-long/300/300",
          tracks: [
            {
              id: "track-long-1",
              name: "这是一首名字非常非常长用于验证详情页单行滚动展示能力的测试歌曲第一首",
              artists: [{ id: "artist-1", name: "E2E Artist" }],
              durationMs: 180000,
              coverUrl: "https://picsum.photos/seed/e2e-track-a/300/300"
            },
            {
              id: "track-long-2",
              name: "用于验证单曲循环手动下一首切歌逻辑的第二首测试歌曲",
              artists: [{ id: "artist-2", name: "E2E Artist B" }],
              durationMs: 180000,
              coverUrl: "https://picsum.photos/seed/e2e-track-b/300/300"
            }
          ]
        }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await page.locator(".library-segmented-pill-btn[data-library-view='library-playlists']").click();
  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=555666777");
  await page.getByRole("button", { name: "导入歌单" }).click();
  await page.getByRole("button", { name: "打开" }).first().click();
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeVisible();

  const expandButton = page.getByRole("button", { name: "展开", exact: true });
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect(page.getByRole("button", { name: "收起", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await expect(expandButton).toBeVisible();

  await page.locator(".home-playlist-track-play").first().click();
  await expect(page.locator(".home-playlist-track-row.active").first()).toBeVisible();
  await expect(page.locator(".home-playlist-track-row.active .playing-indicator")).toBeVisible();

  await page.getByRole("button", { name: "关闭" }).first().click();
  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  if (await expandDetailButton.count()) {
    await expandDetailButton.click();
  } else {
    const playerBar = page.locator(".spotify-player-bar");
    const playerBarBox = await playerBar.boundingBox();
    expect(playerBarBox).not.toBeNull();
    if (playerBarBox) {
      await page.mouse.click(playerBarBox.x + 4, playerBarBox.y + 4);
    }
  }
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  await expect(page.locator(".detail-bottom-meta .marquee-text")).toContainClass("is-overflow");
});

test("mobile library tab hides merged now-playing module to free vertical space", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证库页空间策略。");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator(".now-playing-merged")).toBeVisible();
  await page.getByRole("button", { name: "你的音乐库" }).first().click();
  await expect(page.locator(".now-playing-merged")).toHaveCount(0);
  await page.getByRole("button", { name: "主页" }).first().click();
  await expect(page.locator(".now-playing-merged")).toBeVisible();
});

test("detail queue button closes detail first then opens queue drawer", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证详情到队列顺序。");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  await expect(expandDetailButton).toBeVisible();
  await expandDetailButton.click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();

  await page.locator(".detail-dock-controls").getByRole("button", { name: "打开播放队列" }).click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
});
