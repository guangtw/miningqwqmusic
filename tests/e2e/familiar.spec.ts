import { expect, test, type Page } from "@playwright/test";

// 对暗号的主流程：后端全部打桩，题目是合成的，判分结果由桩决定。验证的是前端的状态流转和交给后端的内容。
const user = { id: "fq-user", email: "fq@example.test", nickname: "敲门的人" };
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

const challenge = (attemptsRemaining: number, rule: "any" | "all" = "any") => ({
  challengeId: "00000000-0000-4000-8000-000000000001",
  serverTime: iso(),
  expiresAt: iso(DAY),
  nextChallengeAt: iso(DAY),
  available: attemptsRemaining > 0,
  attemptsRemaining,
  passRule: rule,
  requiredCorrectCount: rule === "all" ? 2 : 1,
  period: { id: "p-1", label: "某个时期" },
  questions:
    attemptsRemaining > 0
      ? [
          {
            slot: 0,
            kind: "single_choice",
            prompt: "黑板上写的是哪个？\n@stage chalk\n@kicker 后黑板\n@hint 圈一个。",
            options: [
              { id: "opt-a", label: "甲壳虫" },
              { id: "opt-b", label: "乙字号" },
            ],
          },
          { slot: 1, kind: "text", prompt: "门牌上空着什么？\n@stage plaque\n@suffix 老师\n@kicker 办公室" },
        ]
      : [],
});

async function setup(page: Page, opts: { verifyPassesWith?: string; attempts?: number; rule?: "any" | "all" } = {}) {
  let attempts = opts.attempts ?? 3;
  let started = false;
  const verifyBodies: { challengeId: string; answers: unknown[] }[] = [];
  let verified = false;
  await page.context().addCookies([{ name: "mqm_refresh_token", value: "refresh", url: test.info().project.use.baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.context().route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data, message: "ok", traceId: "e2e" } });
    if (path.endsWith("/auth/refresh")) return ok({ user, accessToken: "access" });
    if (path.endsWith("/auth/me")) return ok({ user });
    if (path.endsWith("/library/snapshot")) return ok({ favorites: {}, recent: [], revision: 1 });
    if (path.endsWith("/membership/application")) {
      return ok({ serverTime: iso(), applicationsOpen: true, dispatchEnabled: true, emailLoginEnabled: true, emailVerifiedAt: iso(), canApply: true, reason: null, application: null, familiar: { verified, verifiedAt: verified ? iso() : null } });
    }
    if (path.endsWith("/membership/familiar")) {
      return ok({ verified, verifiedAt: verified ? iso() : null, serverTime: iso(), canVerify: true, reason: verified ? "verified" : null, nextChallengeAt: started ? iso(DAY) : null, periodOptions: [{ id: "p-1", label: "某个时期" }], canUseRandom: true });
    }
    if (path.endsWith("/membership/familiar/challenge")) {
      started = true;
      return ok(challenge(attempts, opts.rule));
    }
    if (path.endsWith("/membership/familiar/verify")) {
      const body = request.postDataJSON();
      verifyBodies.push(body);
      if (opts.verifyPassesWith && body.answers[1] === opts.verifyPassesWith) {
        verified = true;
        return ok({ passed: true, verified: true, verifiedAt: iso(), serverTime: iso(), canVerify: true, reason: "verified", nextChallengeAt: iso(DAY) });
      }
      attempts -= 1;
      return ok({ passed: false, serverTime: iso(), attemptsRemaining: attempts, nextChallengeAt: iso(DAY) });
    }
    return ok({});
  });
  await page.goto("/#/account");
  return { verifyBodies };
}

test("抽单曲、答错保留答案、再答对开门，全程不说错在哪面", async ({ page }) => {
  const { verifyBodies } = await setup(page, { verifyPassesWith: "王" });
  await page.getByRole("button", { name: "敲门", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "对暗号" });

  await dialog.getByRole("button", { name: /某个时期/ }).click();
  await expect(dialog.getByRole("heading", { name: "黑板上写的是哪个？" })).toBeVisible();
  // @ 行不能漏给用户看
  await expect(dialog).not.toContainText("@stage");
  await expect(dialog).toContainText("后黑板");

  await dialog.locator(".fq-chalk-word", { hasText: "甲壳虫" }).click();
  await dialog.getByRole("button", { name: "翻到 B 面" }).click();
  await dialog.getByLabel("门牌上空着什么？").fill("李");
  await dialog.getByRole("button", { name: "落针" }).click();

  await expect(dialog.locator(".fq-deck")).toBeVisible();
  await expect(dialog.locator(".fq-chances")).toHaveAttribute("aria-label", "还能落针 2 次", { timeout: 8000 });
  await expect(dialog).toContainText("放不出声");
  expect(verifyBodies[0].answers).toEqual(["opt-a", "李"]);

  // 答案都留着
  await expect(dialog.getByLabel("门牌上空着什么？")).toHaveValue("李");
  await dialog.getByLabel("门牌上空着什么？").fill("王");
  await dialog.getByRole("button", { name: "落针" }).click();
  await expect(dialog.getByRole("heading", { name: "是你啊。进来坐。" })).toBeVisible({ timeout: 8000 });
  await expect(dialog).toContainText("熟客");
  await expect(dialog).toContainText("某个时期");

  await dialog.getByRole("button", { name: "收好，回去" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".fq-entry.verified")).toContainText("对上暗号");
  // 答案不进本地存储
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain("opt-a");
  expect(stored).not.toContain("李");
});

test("刷新后恢复原题，全对规则下答一面不能落针；浏览器返回只关浮层", async ({ page }) => {
  await setup(page, { rule: "all" });
  await page.getByRole("button", { name: "敲门", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "对暗号" });
  await dialog.getByRole("button", { name: /某个时期/ }).click();
  await expect(dialog.getByRole("heading", { name: "黑板上写的是哪个？" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "接着答" }).click();
  await expect(dialog.getByRole("heading", { name: "黑板上写的是哪个？" })).toBeVisible();
  await expect(dialog.locator(".fq-sleeve")).toHaveCount(0);

  await dialog.locator(".fq-chalk-word", { hasText: "乙字号" }).click();
  await expect(dialog.getByRole("button", { name: "留白，直接落针" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "翻到 B 面" }).click();
  await expect(dialog.getByRole("button", { name: "落针" })).toBeDisabled();

  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/account/);
});

test("三次用完显示打烊和倒计时，能走普通申请，横向不溢出", async ({ page }) => {
  await setup(page, { attempts: 1 });
  await page.getByRole("button", { name: "敲门", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "对暗号" });
  await dialog.getByRole("button", { name: /某个时期/ }).click();
  await dialog.locator(".fq-chalk-word", { hasText: "甲壳虫" }).click();
  await dialog.getByRole("button", { name: "留白，直接落针" }).click();
  await expect(dialog.getByText("今日打烊")).toBeVisible({ timeout: 8000 });
  await expect(dialog).toContainText("后再敲门");
  await expect(dialog).not.toContainText("陌生人");
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector(".fq-scroll")!;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await dialog.getByRole("button", { name: "去普通申请" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "申请会员" })).toBeVisible();
});
