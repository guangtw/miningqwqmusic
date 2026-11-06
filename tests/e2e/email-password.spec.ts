import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 邮箱验证码改密：账户服务全部打桩，不会发真实邮件。验证的是交给后端的内容和退出后的状态。
const user = { id: "pw-user", email: "pw@example.test", nickname: "改密码的人" };
const NEW_PASSWORD = "Synthetic-123!";
const challengeIdOf = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

type Failure = { status: number; code: number; retryAfterSeconds?: number };
type Options = {
  sendFailures?: Failure[];
  confirmFailures?: Failure[];
  /** 桩的服务器时钟比本机快多少，用来验证倒计时按服务端校准 */
  clockAheadMs?: number;
  resendAfterMs?: number;
  expiresInMs?: number;
};

async function setup(context: BrowserContext, baseURL: string, opts: Options = {}) {
  const sendFailures = [...(opts.sendFailures ?? [])];
  const confirmFailures = [...(opts.confirmFailures ?? [])];
  const sendBodies: unknown[] = [];
  const confirmBodies: { challengeId: string; code: string; newPassword: string }[] = [];
  const confirmTokens: (string | undefined)[] = [];
  let sent = 0;
  let rotations = 0;
  let loggedOut = false;

  await context.addCookies([{ name: "mqm_refresh_token", value: "refresh", url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown, headers: Record<string, string> = {}) => route.fulfill({ json: { code: 0, data, message: "ok", traceId: "e2e" }, headers });
    const failWith = (f: Failure) =>
      route.fulfill({
        status: f.status,
        json: { code: f.code, message: "internal", traceId: "e2e", retryable: f.status !== 400, retryAfterSeconds: f.retryAfterSeconds },
        headers: f.retryAfterSeconds ? { "retry-after": String(f.retryAfterSeconds) } : {},
      });
    if (path.endsWith("/auth/refresh")) {
      if (loggedOut) return route.fulfill({ status: 401, json: { code: 5203, message: "expired" } });
      rotations += 1;
      return ok({ user, accessToken: `access-${rotations}` });
    }
    if (path.endsWith("/auth/me")) return ok({ user });
    if (path.endsWith("/library/snapshot")) return ok({ favorites: {}, recent: [], revision: 1 });
    if (path.endsWith("/auth/email/password/request")) {
      sendBodies.push(request.postDataJSON());
      const failure = sendFailures.shift();
      if (failure) return failWith(failure);
      sent += 1;
      const now = Date.now() + (opts.clockAheadMs ?? 0);
      return ok({
        challengeId: challengeIdOf(sent),
        serverTime: new Date(now).toISOString(),
        resendAfter: new Date(now + (opts.resendAfterMs ?? 60_000)).toISOString(),
        expiresAt: new Date(now + (opts.expiresInMs ?? 600_000)).toISOString(),
      });
    }
    if (path.endsWith("/auth/email/password/confirm")) {
      confirmBodies.push(request.postDataJSON());
      confirmTokens.push(request.headers().authorization);
      const failure = confirmFailures.shift();
      if (failure) return failWith(failure);
      loggedOut = true;
      return ok({ ok: true, requiresLogin: true }, { "set-cookie": "mqm_refresh_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" });
    }
    return ok({});
  });
  return { sendBodies, confirmBodies, confirmTokens };
}

async function openEmailWay(page: Page) {
  await page.goto("/#/account");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await page.getByRole("radio", { name: "邮箱验证码" }).click();
}

const sendButton = (page: Page) => page.locator(".acct-pw-send");
const codeInput = (page: Page) => page.getByLabel("验证码", { exact: true });
const newPassword = (page: Page) => page.getByLabel("新密码", { exact: true });
const again = (page: Page) => page.getByLabel("再输一次新密码", { exact: true });
const confirmButton = (page: Page) => page.getByRole("button", { name: "确认修改" });

/** 验证码框出现后会自动抢焦点，等它落稳再填别的框，否则脚本打的字会被抢走 */
async function sendCode(page: Page) {
  await sendButton(page).click();
  await expect(codeInput(page)).toBeFocused();
}

test("发码、开头为 0 的验证码、改完退出，其他标签页跟着退出", async ({ page, context, baseURL }) => {
  const { sendBodies, confirmBodies } = await setup(context, baseURL!);
  const other = await context.newPage();
  await other.goto("/#/account");
  await expect(other.getByRole("button", { name: "修改密码", exact: true })).toBeVisible();

  await page.goto("/#/account");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  // 旧密码方式还是默认，切到邮箱后不要旧密码，也没有可改的收件邮箱
  await expect(page.getByLabel("现在的密码", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "邮箱验证码" }).click();
  await expect(page.getByLabel("现在的密码", { exact: true })).toHaveCount(0);
  await expect(page.locator(".acct-pw")).toContainText(user.email);
  await expect(page.locator('.acct-pw input[type="email"]')).toHaveCount(0);

  await sendCode(page);
  await expect(sendButton(page)).toBeDisabled();
  await expect(codeInput(page)).toHaveAttribute("autocomplete", "one-time-code");
  await expect(codeInput(page)).toHaveAttribute("inputmode", "numeric");
  expect(sendBodies).toEqual([{}]);

  await codeInput(page).fill("012345");
  // 密码原样提交，不 trim
  await newPassword(page).fill(` ${NEW_PASSWORD} `);
  await again(page).fill(` ${NEW_PASSWORD} `);
  await confirmButton(page).click();

  await expect(page.getByText("密码已修改，请用新密码重新登录")).toBeVisible();
  await expect(page.getByRole("heading", { name: "回到唱片架" })).toBeVisible();
  expect(confirmBodies).toEqual([{ challengeId: challengeIdOf(1), code: "012345", newPassword: ` ${NEW_PASSWORD} ` }]);
  await expect(other.locator(".main").getByRole("button", { name: "登录同步", exact: true })).toBeVisible();

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(NEW_PASSWORD);
  expect(stored).not.toContain("012345");
  expect(page.url()).not.toContain(NEW_PASSWORD);
});

test("本机校验不过就不提交", async ({ page, context, baseURL }) => {
  const { confirmBodies } = await setup(context, baseURL!);
  await openEmailWay(page);
  await confirmButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText("先发一个验证码");

  await sendCode(page);
  await codeInput(page).fill("12345");
  await confirmButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText("验证码是 6 位数字");

  // 非数字进不了格子
  await codeInput(page).fill("12a345");
  await expect(codeInput(page)).toHaveValue("12345");
  await codeInput(page).fill("123456");
  await newPassword(page).fill("weak");
  await confirmButton(page).click();
  await expect(page.locator(".acct-pw .field-error")).toBeVisible();

  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(`${NEW_PASSWORD}x`);
  await confirmButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText("两次输入的新密码不一样");
  expect(confirmBodies).toEqual([]);
});

test("倒计时按服务端时间校准，收起表单绕不过，还会清掉密码和验证码", async ({ page, context, baseURL }) => {
  await setup(context, baseURL!, { clockAheadMs: 3_600_000 });
  await openEmailWay(page);
  await sendCode(page);
  await expect(sendButton(page)).toHaveText(/^(60|59|58|57|56) 秒后可重发$/);

  await codeInput(page).fill("654321");
  await newPassword(page).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "修改密码", exact: true }).click();

  await expect(newPassword(page)).toHaveValue("");
  await expect(codeInput(page)).toHaveValue("");
  await expect(sendButton(page)).toBeDisabled();
  await expect(sendButton(page)).toHaveText(/秒后可重发$/);
});

test("重发后换成新的 challengeId，旧验证码清空，新密码保留", async ({ page, context, baseURL }) => {
  const { confirmBodies } = await setup(context, baseURL!, { resendAfterMs: 1000 });
  await openEmailWay(page);
  await sendCode(page);
  await codeInput(page).fill("111111");
  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(NEW_PASSWORD);

  await expect(sendButton(page)).toHaveText("重新发送", { timeout: 4000 });
  await sendButton(page).click();
  await expect(codeInput(page)).toHaveValue("");
  await expect(newPassword(page)).toHaveValue(NEW_PASSWORD);

  await codeInput(page).fill("222222");
  await confirmButton(page).click();
  await expect(page.getByText("密码已修改，请用新密码重新登录")).toBeVisible();
  expect(confirmBodies.map((b) => [b.challengeId, b.code])).toEqual([[challengeIdOf(2), "222222"]]);
});

test("验证码不对不算登录失效，输入都留着，改对后能过", async ({ page, context, baseURL }) => {
  const { confirmBodies } = await setup(context, baseURL!, { confirmFailures: [{ status: 400, code: 5905 }] });
  await openEmailWay(page);
  await sendCode(page);
  await codeInput(page).fill("000000");
  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(NEW_PASSWORD);
  await confirmButton(page).click();

  await expect(page.locator(".acct-pw")).toContainText("验证码不对或已经失效");
  await expect(page.locator(".main").getByRole("button", { name: "登录同步", exact: true })).toHaveCount(0);
  await expect(codeInput(page)).toHaveValue("000000");
  await expect(newPassword(page)).toHaveValue(NEW_PASSWORD);
  await expect(confirmButton(page)).toBeEnabled();

  await codeInput(page).fill("123456");
  await confirmButton(page).click();
  await expect(page.getByText("密码已修改，请用新密码重新登录")).toBeVisible();
  expect(confirmBodies).toHaveLength(2);
});

test("确认时 access token 过期：刷新一次再提交，不会卡在会话锁上", async ({ page, context, baseURL }) => {
  const { confirmBodies, confirmTokens } = await setup(context, baseURL!, { confirmFailures: [{ status: 401, code: 5204 }] });
  await openEmailWay(page);
  await sendCode(page);
  await codeInput(page).fill("123456");
  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(NEW_PASSWORD);
  await confirmButton(page).click();

  await expect(page.getByText("密码已修改，请用新密码重新登录")).toBeVisible();
  expect(confirmBodies).toHaveLength(2);
  expect(confirmTokens[0]).not.toEqual(confirmTokens[1]);
});

test("验证码过期先在本机拦下，让用户重发", async ({ page, context, baseURL }) => {
  const { confirmBodies } = await setup(context, baseURL!, { expiresInMs: 500 });
  await openEmailWay(page);
  await sendCode(page);
  await codeInput(page).fill("123456");
  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(NEW_PASSWORD);
  await page.waitForTimeout(700);
  await confirmButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText("已经过期了");
  expect(confirmBodies).toEqual([]);
});

test("发送被限流时按服务端秒数等，到时间能再发", async ({ page, context, baseURL }) => {
  await setup(context, baseURL!, { sendFailures: [{ status: 429, code: 5910, retryAfterSeconds: 2 }] });
  await openEmailWay(page);
  await sendButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText(/尝试太频繁了。请在 [12] 秒后再试/);
  await expect(sendButton(page)).toBeDisabled();

  await expect(page.locator(".acct-pw")).toContainText("现在可以再试一次了", { timeout: 5000 });
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect(codeInput(page)).toBeVisible();
});

test("确认被限流时只锁确认按钮，还能重发验证码", async ({ page, context, baseURL }) => {
  await setup(context, baseURL!, { resendAfterMs: 500, confirmFailures: [{ status: 429, code: 5910, retryAfterSeconds: 30 }] });
  await openEmailWay(page);
  await sendCode(page);
  await codeInput(page).fill("123456");
  await newPassword(page).fill(NEW_PASSWORD);
  await again(page).fill(NEW_PASSWORD);
  await confirmButton(page).click();

  await expect(page.locator(".acct-pw")).toContainText(/尝试太频繁了。请在 \d+ 秒后再试/);
  await expect(confirmButton(page)).toBeDisabled();
  await expect(sendButton(page)).toHaveText("重新发送", { timeout: 4000 });
  await expect(sendButton(page)).toBeEnabled();
});

test("邮件服务不可用时按钮能恢复，旧密码方式还能用", async ({ page, context, baseURL }) => {
  await setup(context, baseURL!, { sendFailures: [{ status: 503, code: 5900 }] });
  await openEmailWay(page);
  await sendButton(page).click();
  await expect(page.locator(".acct-pw")).toContainText("邮件服务暂时不可用");
  await expect(sendButton(page)).toBeEnabled();
  await expect(sendButton(page)).toHaveText("发送验证码");

  await page.getByRole("radio", { name: "现在的密码" }).click();
  await expect(page.getByLabel("现在的密码", { exact: true })).toBeVisible();
  await expect(page.locator(".acct-pw")).not.toContainText("邮件服务暂时不可用");
});

test.describe("窄屏", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("表单不横向溢出", async ({ page, context, baseURL }) => {
    await setup(context, baseURL!);
    await openEmailWay(page);
    await sendCode(page);
    await expect(codeInput(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
