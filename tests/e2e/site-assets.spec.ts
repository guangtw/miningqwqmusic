import { expect, test } from "@playwright/test";

test("site metadata assets are available", async ({ page }) => {
  const paths = [
    "/favicon.ico",
    "/icon.png",
    "/apple-icon.png",
    "/opengraph-image.png",
    "/robots.txt",
    "/sitemap.xml",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-192.png",
    "/icons/icon-maskable-512.png"
  ];

  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
  }
});

test("manifest exposes png and maskable icons", async ({ page }) => {
  const response = await page.goto("/manifest.webmanifest");
  expect(response?.status()).toBe(200);
  const manifest = JSON.parse(await page.locator("body").innerText()) as {
    icons: Array<{ src: string; type: string; purpose?: string }>;
  };

  expect(manifest.icons.some((icon) => icon.src === "/icons/icon-192.png" && icon.type === "image/png")).toBe(true);
  expect(manifest.icons.some((icon) => icon.src === "/icons/icon-512.png" && icon.type === "image/png")).toBe(true);
  expect(manifest.icons.some((icon) => icon.src === "/icons/icon-maskable-192.png" && icon.purpose === "maskable")).toBe(true);
  expect(manifest.icons.some((icon) => icon.src === "/icons/icon-maskable-512.png" && icon.purpose === "maskable")).toBe(true);
});

test("empty search gives explicit feedback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "搜索" }).first().click();
  await page.locator(".spotify-search-panel button").click();
  await expect(page.getByText("请输入关键词后再搜索。")).toBeVisible();
});

test("account dialog traps focus and returns focus after escape", async ({ page }) => {
  await page.route("**/api/account/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5203,
        message: "Refresh token invalid or expired",
        traceId: "e2e-account-focus",
        retryable: false
      })
    });
  });
  await page.route("**/api/account/auth/login", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: 5202,
        message: "Invalid credentials",
        traceId: "e2e-account-enter-submit",
        retryable: false
      })
    });
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const loginButton = page.getByRole("button", { name: "登录同步" }).first();
  await expect(loginButton).toBeVisible();
  await loginButton.click();

  const dialog = page.getByRole("dialog", { name: "账号登录" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill("test@example.com");
  await page.getByPlaceholder("至少 8 位").fill("wrong-password");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("邮箱或密码不正确，请重新输入。")).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  const activeInsideDialog = await page.evaluate(() => {
    const dialogNode = document.querySelector(".account-dialog-panel");
    return Boolean(dialogNode && document.activeElement && dialogNode.contains(document.activeElement));
  });
  expect(activeInsideDialog).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(loginButton).toBeFocused();
});
