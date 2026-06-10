import { expect, test, type Page } from "@playwright/test";

const e2eTrack = {
  id: "e2e-seeded-track",
  name: "E2E Seeded Track",
  artists: [{ id: "e2e-artist", name: "E2E Artist" }],
  albumName: "E2E Album",
  durationMs: 180000,
  coverUrl: "https://picsum.photos/seed/e2e-seeded-track/300/300"
};

async function seedPlaybackFromPlaylist(page: Page, playlistId = "100100100", title = "E2E 播放种子歌单") {
  const track = {
    ...e2eTrack,
    id: `${e2eTrack.id}-${playlistId}`,
    name: `${e2eTrack.name} ${playlistId}`,
    album: { id: `album-${playlistId}`, name: title }
  };
  await page.route("**/api/music/search?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: `e2e-search-${playlistId}`,
        data: { items: [track], page: 1, pageSize: 20, total: 1 }
      })
    });
  });
  await page.goto("/");
  const homeSearchButton = page.locator(".home-toolbar-actions button", { hasText: "搜索音乐" }).first();
  if (await homeSearchButton.isVisible()) {
    await homeSearchButton.click();
  } else {
    await openSearchTab(page);
  }
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await page.locator(".spotify-search-panel input").fill(title);
  await page.locator(".spotify-search-panel button").click();
  await expect(page.getByRole("button", { name: "播放歌曲" }).first()).toBeVisible();
  await page.getByRole("button", { name: "播放歌曲" }).first().evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  await expect(page.locator(".spotify-player-bar .player-title").filter({ hasText: track.name }).first()).toHaveCount(1);
  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  if (await expandDetailButton.count()) {
    await expect(expandDetailButton).toBeVisible();
  } else {
    await expect(page.locator(".spotify-player-bar .player-title").filter({ hasText: track.name }).first()).toHaveCount(1);
  }
}

async function usesMobileShell(page: Page) {
  return page
    .evaluate(() => window.matchMedia("(max-width: 899px), (pointer: coarse), (hover: none)").matches)
    .catch(() => false);
}

async function openSearchTab(page: Page) {
  if (await usesMobileShell(page)) {
    const mobileTab = page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "搜索", exact: true }).first();
    await mobileTab.waitFor({ state: "visible" });
    await mobileTab.click();
    return;
  }
  await page.getByRole("button", { name: "搜索", exact: true }).first().evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  if (!(await page.getByRole("heading", { name: "搜索音乐" }).isVisible().catch(() => false))) {
    const homeSearchButton = page.getByRole("button", { name: "搜索音乐", exact: true }).first();
    if (await homeSearchButton.isVisible().catch(() => false)) {
      await homeSearchButton.evaluate((button) => {
        if (button instanceof HTMLButtonElement) button.click();
      });
    }
  }
}

async function openLibraryTab(page: Page) {
  if (await usesMobileShell(page)) {
    const mobileTab = page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "我的", exact: true }).first();
    await mobileTab.waitFor({ state: "visible" });
    await mobileTab.click();
    return;
  }
  await page.getByRole("button", { name: "你的音乐库", exact: true }).first().evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  if (!(await page.locator(".library-segmented-pill").isVisible().catch(() => false))) {
    const homeLibraryButton = page.getByRole("button", { name: "我的音乐库", exact: true }).first();
    if (await homeLibraryButton.isVisible().catch(() => false)) {
      await homeLibraryButton.evaluate((button) => {
        if (button instanceof HTMLButtonElement) button.click();
      });
    }
  }
}

async function openHomeTab(page: Page) {
  if (await usesMobileShell(page)) {
    const mobileTab = page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "首页", exact: true }).first();
    await mobileTab.waitFor({ state: "visible" });
    await mobileTab.click();
    return;
  }
  await page.getByRole("button", { name: "主页", exact: true }).first().evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
}

test("home page renders player shell", async ({ page }, testInfo) => {
  await page.goto("/");
  if (!testInfo.project.name.includes("mobile")) {
    await expect(page.locator(".spotify-logo")).toContainText("MiningQwQ Music");
    await expect(page.locator(".now-playing-merged")).toHaveCount(0);
  } else {
    await expect(page.locator(".spotify-logo")).toHaveCount(0);
  }
  await openSearchTab(page);
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
  if (await usesMobileShell(page)) {
    await openLibraryTab(page);
  }
  const loginButton = page.getByRole("button", { name: "登录同步" }).first();
  await expect(loginButton).toBeVisible();
  await loginButton.click();
  await expect(page.getByRole("dialog", { name: "账号登录" })).toBeVisible();
});

test("logged-in account entry opens account management drawer", async ({ page }) => {
  const user = {
    id: "e2e-user",
    email: "user@example.com",
    nickname: "普通用户A",
    avatarFallbackText: "普",
    avatarFallbackBg: "#22c55e"
  };
  const successPayload = (data: unknown) =>
    JSON.stringify({
      code: 0,
      data,
      message: "ok",
      traceId: "e2e-account-manager"
    });

  await page.route("**/api/account/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5203,
        message: "Refresh token invalid or expired",
        traceId: "e2e-account-manager-refresh",
        retryable: false
      })
    });
  });
  await page.route("**/api/account/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: successPayload({ user, accessToken: "e2e-token" })
    });
  });
  await page.route("**/api/account/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: successPayload(user)
    });
  });
  await page.route("**/api/account/library/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: successPayload({ revision: 1, favorites: {}, recent: [], importedPlaylists: {}, updatedAt: new Date(0).toISOString() })
    });
  });
  await page.route("**/api/account/music/unblock/entitlement", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: successPayload({ enabled: false })
    });
  });
  await page.route("**/api/account/profile", async (route) => {
    const updatedUser = { ...user, nickname: "新昵称", avatarFallbackText: "新" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: successPayload(updatedUser)
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  if (!(await usesMobileShell(page))) {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  if (await usesMobileShell(page)) {
    await openLibraryTab(page);
  }

  await page.getByRole("button", { name: "登录同步" }).first().click();
  await page.getByLabel("邮箱").fill("user@example.com");
  await page.getByLabel("密码").fill("StrongP@ss1");
  await page.getByRole("button", { name: "登录并同步" }).click();

  const accountButton = page.getByRole("button", { name: /账户管理/ }).first();
  await expect(accountButton).toBeVisible();
  await expect(accountButton).toContainText("普通用户");
  await accountButton.click();

  const drawer = page.getByRole("dialog", { name: "账户管理" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("高级功能")).toBeVisible();
  await expect(drawer.getByPlaceholder("输入兑换码")).toBeVisible();
  await expect(page.getByText("解灰")).toHaveCount(0);

  await drawer.getByLabel("昵称").fill("新昵称");
  await drawer.getByRole("button", { name: "保存昵称" }).click();
  await expect(drawer.getByText("昵称已更新。")).toBeVisible();
});

test("empty player state offers search CTA instead of opening detail", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "展开详情" })).toHaveCount(0);

  const playerBar = page.locator(".spotify-player-bar:visible").first();
  await expect(playerBar).toBeVisible();
  await playerBar.click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog", { name: "播放详情" })).toHaveCount(0);

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "去搜索音乐" }).click();
  } else {
    await expect(page.getByRole("button", { name: "去搜索音乐" })).toHaveCount(0);
    await openSearchTab(page);
  }
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await expect(page.locator(".spotify-search-panel input")).toBeVisible();
});

test("desktop listen entry opens playlist-style drawer from sidebar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "桌面侧栏入口仅在桌面项目验证。");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");

  const listenEntry = page.locator(".listen-sidebar-entry").first();
  await expect(listenEntry).toBeVisible();
  await listenEntry.click();

  const drawer = page.getByRole("dialog", { name: "一起听" });
  await expect(drawer).toBeVisible();
  await expect(page.locator(".listen-utility-drawer")).toBeVisible();
  await expect(page.locator(".listen-drawer-overlay")).toHaveCount(0);
});

test("short desktop sidebar keeps account warning, retry and theme switch visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "桌面短屏侧栏布局仅在桌面项目验证。");
  await page.route("**/api/account/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5203,
        message: "Refresh token invalid or expired",
        traceId: "e2e-account-warning",
        retryable: true
      })
    });
  });

  for (const viewport of [
    { width: 1366, height: 700 },
    { width: 1626, height: 771 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const loginButton = page.getByRole("button", { name: "登录同步" }).first();
    const retryButton = page.getByRole("button", { name: "重试连接" }).first();
    const themeSwitch = page.locator(".theme-switch-card .theme-switch").first();
    await expect(loginButton).toBeVisible();
    await expect(retryButton).toBeVisible();
    await expect(themeSwitch).toBeVisible();

    const playerBox = await page.locator(".spotify-player-bar:visible").first().boundingBox();
    const retryBox = await retryButton.boundingBox();
    const themeBox = await themeSwitch.boundingBox();
    expect(playerBox).not.toBeNull();
    expect(retryBox).not.toBeNull();
    expect(themeBox).not.toBeNull();
    if (playerBox && retryBox && themeBox) {
      expect(retryBox.y + retryBox.height).toBeLessThan(playerBox.y);
      expect(themeBox.y + themeBox.height).toBeLessThan(playerBox.y);
      expect(Math.round(retryBox.height)).toBeGreaterThanOrEqual(36);
    }
  }
});

test("escape closes detail overlay and returns search tab to home", async ({ page }) => {
  await seedPlaybackFromPlaylist(page);
  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  if (await expandDetailButton.count()) {
    await expandDetailButton.click();
  } else {
    const playerBar = page.locator(".spotify-player-bar:visible").first();
    await expect(playerBar).toBeVisible();
    await playerBar.click({ position: { x: 8, y: 8 } });
  }
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();

  await openSearchTab(page);
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

test("desktop theme switch toggles data-theme", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "桌面主题开关尺寸断言仅在桌面项目验证。");
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

test("mobile dock exposes three primary tabs and library tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spotify-logo")).toHaveCount(0);
  await expect(page.locator(".sidebar-mobile-tools")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "菜单" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "菜单" })).toHaveCount(0);
  await expect(page.locator(".spotify-nav")).toHaveCount(0);

  const dockTabs = page.locator(".mobile-bottom-tabs").getByRole("tab");
  await expect(dockTabs).toHaveCount(3);
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "首页", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "搜索", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "我的", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "首页", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "搜索音乐" })).toBeVisible();
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "搜索", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "我的", exact: true }).click();
  await expect(page.locator(".library-segmented-pill")).toBeVisible();
  await expect(page.locator(".mobile-bottom-tabs").getByRole("tab", { name: "我的", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".mobile-library-tools")).toBeVisible();
  await expect(page.locator(".mobile-library-tools").getByRole("button", { name: /一起听/ })).toBeVisible();
  await expect(page.locator(".mobile-library-compact-tools")).toBeVisible();
  await expect(page.locator(".mobile-library-compact-tools > *")).toHaveCount(2);
  await expect(page.getByText("解灰")).toHaveCount(0);
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
  if (await usesMobileShell(page)) {
    await openLibraryTab(page);
    await page.locator(".theme-switch:visible").first().click();
    await openHomeTab(page);
  } else {
    await page.locator(".theme-switch:visible").first().click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const playlistCard = page.locator(".home-playlist-card").first();
  const cardCount = await page.locator(".home-playlist-card").count();
  test.skip(cardCount === 0, "当前环境无可展示歌单卡片，跳过抽屉高度验证。");
  await playlistCard.click();
  const drawer = page.locator(".home-playlist-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/phase-open/);
  const drawerBackground = await drawer.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(drawerBackground).toContain("255");
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box ? box.y : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(90);
});

test("mobile detail layout hides lyric mode chips and tab switch remains clickable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证详情布局。");
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlaybackFromPlaylist(page, "100100101", "E2E 移动详情歌单");
  await page.getByRole("button", { name: "展开详情" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  const detailScreen = page.locator(".player-detail-screen");
  await expect(detailScreen).toHaveClass(/phase-open/);
  const pointerFocusState = await detailScreen.evaluate((node) => {
    const collapseButton = node.querySelector(".detail-collapse-btn");
    return {
      activeIsDetailScreen: document.activeElement === node,
      collapseButtonFocusVisible: collapseButton?.matches(":focus-visible") ?? false
    };
  });
  expect(pointerFocusState.activeIsDetailScreen).toBe(true);
  expect(pointerFocusState.collapseButtonFocusVisible).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "收起播放器" })).toBeFocused();
  const keyboardFocusVisible = await page.getByRole("button", { name: "收起播放器" }).evaluate((node) => node.matches(":focus-visible"));
  expect(keyboardFocusVisible).toBe(true);
  await expect(page.getByRole("button", { name: "原文" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "翻译" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "逐字" })).toHaveCount(0);
  await expect(page.locator(".detail-dock-song")).toHaveCount(0);

  await page.getByRole("button", { name: "歌曲信息" }).click();
  await expect(page.locator(".detail-meta-list")).toBeVisible();
  await page.getByRole("button", { name: "歌词" }).click();
  const lyricScroll = page.locator(".detail-lyric-scroll");
  await expect(lyricScroll).toBeVisible();
  const detailTransition = await detailScreen.evaluate((node) => ({
    property: getComputedStyle(node).transitionProperty,
    timing: getComputedStyle(node).transitionTimingFunction,
    duration: getComputedStyle(node).transitionDuration
  }));
  expect(detailTransition.property).toContain("transform");
  expect(detailTransition.property).not.toContain("opacity");
  expect(detailTransition.timing).toContain("cubic-bezier(0.2, 0.86, 0.16, 1)");
  expect(detailTransition.duration).toContain("0.62s");
  const backdropMotion = await page.locator(".player-detail-backdrop").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      transitionDelay: style.transitionDelay
    };
  });
  expect(backdropMotion.backgroundColor).toContain("0.46");
  expect(backdropMotion.opacity).toBe("0.72");
  expect(backdropMotion.transitionDelay).toContain("0.16s");
  const backgroundLayerMotion = await detailScreen.locator(".detail-bg-layer.current").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      animationName: style.animationName,
      filter: style.filter
    };
  });
  expect(backgroundLayerMotion.animationName).toBe("none");
  expect(backgroundLayerMotion.filter).toBe("none");
  const nestedEntryAnimations = await detailScreen.evaluate((node) =>
    [".detail-topbar", ".detail-stage-left", ".detail-stage-right", ".detail-dock"].map((selector) => {
      const target = node.querySelector(selector);
      return target ? getComputedStyle(target).animationName : "";
    })
  );
  expect(nestedEntryAnimations.every((name) => name === "none")).toBe(true);
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
  await expect(detailScreen).toHaveClass(/phase-closing/);
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
});

test("mobile library does not introduce page-level horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openLibraryTab(page);
  await expect(page.locator(".library-hub-head")).toBeVisible();

  const pageMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth + 1);

});

test("library segmented pill is compact and uses subtle content fade on mobile", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证库页胶囊尺寸。");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openLibraryTab(page);
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
    const switcher = document.querySelector(".library-content-switcher") as HTMLElement | null;
    const switcherStyle = switcher ? getComputedStyle(switcher) : null;
    const switcherBefore = switcher ? getComputedStyle(switcher, "::before") : null;
    return {
      left: thumbRect.left - rootRect.left,
      right: thumbRect.right - rootRect.left,
      width: rootRect.width,
      height: rootRect.height,
      switcherTransformTransition: switcherStyle?.transitionProperty ?? "",
      switcherBeforeContent: switcherBefore?.content ?? ""
    };
  });
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.height).toBeGreaterThanOrEqual(34);
    expect(bounds.height).toBeLessThanOrEqual(38);
    expect(bounds.switcherTransformTransition).toContain("opacity");
    expect(bounds.switcherBeforeContent === "none" || bounds.switcherBeforeContent === "normal").toBe(true);
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
  await openLibraryTab(page);
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
  await page.waitForTimeout(450);
  await page.locator(".spotify-player-bar:visible button[aria-label='打开播放队列']").first().click({ force: true });
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
});

test("search controls stay visible after playing a result", async ({ page }) => {
  await page.route("**/api/music/search?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-search",
        data: {
          items: [
            {
              id: "search-jay-1",
              name: "周杰伦搜索测试曲",
              artists: [{ id: "jay", name: "周杰伦" }],
              albumName: "搜索测试专辑",
              durationMs: 210000,
              coverUrl: "https://picsum.photos/seed/search-jay-1/300/300"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1
        }
      })
    });
  });

  await page.setViewportSize({ width: 1366, height: 700 });
  await page.goto("/");
  await openSearchTab(page);
  const searchInput = page.locator(".spotify-search-panel input");
  await searchInput.fill("周杰伦");
  await page.locator(".spotify-search-panel button").click();
  await expect(page.getByRole("button", { name: "播放歌曲" }).first()).toBeVisible();
  await page.getByRole("button", { name: "播放歌曲" }).first().click();

  await expect(searchInput).toBeVisible();
  await expect(page.getByRole("tab", { name: "单曲" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "歌手" })).toBeVisible();
  const modeThumb = page.locator(".search-mode-switch-thumb");
  await expect(modeThumb).toBeVisible();
  const trackThumbBox = await modeThumb.boundingBox();
  await page.getByRole("tab", { name: "歌手" }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  await page.waitForTimeout(320);
  const artistThumbBox = await modeThumb.boundingBox();
  expect(trackThumbBox).not.toBeNull();
  expect(artistThumbBox).not.toBeNull();
  if (trackThumbBox && artistThumbBox) {
    expect(artistThumbBox.x).toBeGreaterThan(trackThumbBox.x + 20);
  }
});

test("single-track queue drawer stays compact and starts list near the top", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 700 });
  await seedPlaybackFromPlaylist(page, "100100102", "E2E 短队列歌单");
  await page.waitForTimeout(450);
  await page.locator(".spotify-player-bar:visible button[aria-label='打开播放队列']").first().click({ force: true });
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();

  const drawer = page.locator(".home-playlist-drawer.source-queue.compact-list").first();
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  const firstRowBox = await drawer.locator(".home-playlist-track-row").first().boundingBox();
  const actionsBox = await drawer.locator(".home-playlist-drawer-actions").first().boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(firstRowBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  if (drawerBox && firstRowBox && actionsBox) {
    expect(drawerBox.height).toBeLessThan(560);
    expect(firstRowBox.y).toBeLessThan(actionsBox.y + actionsBox.height + 60);
  }
});

test("home cards clamp long descriptions without scrollable text blocks", async ({ page }) => {
  await page.route("**/api/music/discover/home**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        traceId: "e2e-discover-cards",
        data: {
          blocks: [
            {
              id: "discover-personalized",
              title: "推荐歌单",
              items: [
                {
                  id: "long-card-1",
                  title: "长描述测试歌单",
                  subtitle: "这是一段非常长的推荐歌单描述，用来验证首页卡片中的副标题只展示两行，并且不会在卡片内部形成可以滚动的隐藏文本节点。",
                  type: "playlist",
                  targetId: "123456789",
                  coverUrl: "https://picsum.photos/seed/long-card-1/300/300"
                }
              ]
            }
          ],
          searchAssist: {
            defaultKeyword: "周杰伦",
            hotKeywords: [],
            suggestions: []
          }
        }
      })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "查看更多" }).click();
  await expect(page.locator(".home-playlist-card p").first()).toBeVisible();
  const cardTextMetrics = await page.locator(".home-playlist-card p").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        overflowY: style.overflowY,
        lineClamp: style.webkitLineClamp,
        clientHeight: (node as HTMLElement).clientHeight
      };
    })
  );
  expect(cardTextMetrics.length).toBeGreaterThan(0);
  for (const metric of cardTextMetrics) {
    expect(metric.overflowY).not.toBe("auto");
    expect(metric.overflowY).not.toBe("scroll");
    expect(metric.lineClamp).toBe("2");
    expect(metric.clientHeight).toBeGreaterThan(0);
  }
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
  await openLibraryTab(page);
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
  await seedPlaybackFromPlaylist(page, "100100104", "E2E 控制栏种子歌单");
  const dockControlButtons = page.locator(".spotify-player-bar .spotify-player-controls .icon-btn");
  const dockOrder = await dockControlButtons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(dockOrder).toHaveLength(5);
  expect(dockOrder[0]).toBe("打开播放队列");
  expect(dockOrder[1]).toBe("上一首");
  expect(["播放", "暂停"]).toContain(dockOrder[2]);
  expect(dockOrder[3]).toBe("下一首");

  const dockChildOrder = await page.locator(".spotify-player-bar .spotify-player-center").evaluate((node) =>
    Array.from(node.children).map((child) => child.className)
  );
  expect(dockChildOrder[0]).toContain("spotify-progress-row");
  expect(dockChildOrder[1]).toContain("spotify-player-controls");

  const dockCenters = await dockControlButtons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left + rect.width / 2;
    })
  );
  expect(Math.abs((dockCenters[1] + dockCenters[3]) / 2 - dockCenters[2])).toBeLessThanOrEqual(1.2);

  const playerBar = page.locator(".spotify-player-bar:visible").first();
  const playerBarBox = await playerBar.boundingBox();
  expect(playerBarBox).not.toBeNull();
  if (playerBarBox) {
    await page.mouse.click(playerBarBox.x + 4, playerBarBox.y + 4);
  }
  const detailDialog = page.getByRole("dialog", { name: "播放详情" });
  const detailVisibleCount = await detailDialog.count();
  if (detailVisibleCount === 0) {
    return;
  }
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
  await openSearchTab(page);
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
  await openLibraryTab(page);
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
  await openLibraryTab(page);
  await page.locator(".library-segmented-pill-btn[data-library-view='library-playlists']").click();
  await page.locator(".library-import-row input").fill("https://music.163.com/playlist?id=555666777");
  await page.getByRole("button", { name: "导入歌单" }).click();
  await page.locator(".library-imported-item", { hasText: "E2E 超长描述歌单" }).first().getByRole("button", { name: "打开" }).click();
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
  await expect(page.getByRole("dialog", { name: "歌单详情" })).toBeHidden();
  const expandDetailButton = page.getByRole("button", { name: "展开详情" }).first();
  if (await expandDetailButton.count()) {
    await expandDetailButton.click();
  } else {
    const playerBar = page.locator(".spotify-player-bar:visible").first();
    await expect(playerBar).toBeVisible();
    const playerBarBox = await playerBar.boundingBox();
    expect(playerBarBox).not.toBeNull();
    if (playerBarBox) {
      await page.mouse.click(playerBarBox.x + 8, playerBarBox.y + 8);
    }
  }
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();
  await expect(page.locator(".detail-bottom-meta .marquee-text")).toContainClass("is-overflow");
});

test("mobile library tab hides merged now-playing module to free vertical space", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证库页空间策略。");
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlaybackFromPlaylist(page, "100100105", "E2E 移动库页空间歌单");
  await openHomeTab(page);

  await expect(page.locator(".now-playing-merged")).toBeVisible();
  await openLibraryTab(page);
  await expect(page.locator(".now-playing-merged")).toHaveCount(0);
  await openHomeTab(page);
  await expect(page.locator(".now-playing-merged")).toBeVisible();
});

test("detail queue button closes detail first then opens queue drawer", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅在移动端项目验证详情到队列顺序。");
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlaybackFromPlaylist(page, "100100103", "E2E 移动队列歌单");

  await page.getByRole("button", { name: "展开详情" }).first().click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeVisible();

  await page.locator(".detail-dock-controls").getByRole("button", { name: "打开播放队列" }).click();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "播放详情" })).toBeHidden();
});
