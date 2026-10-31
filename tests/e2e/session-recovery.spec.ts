import { expect, test } from '@playwright/test';

test('two tabs serialize cookie rotation and share logout without another password', async ({ context, baseURL }) => {
  let current = 'refresh-0';
  let rotations = 0;
  let staleRequests = 0;
  let loggedOut = false;
  const user = { id: 'session-user', email: 'session@example.com', nickname: '并发用户' };
  await context.addCookies([{ name: 'mqm_refresh_token', value: current, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown, headers: Record<string, string> = {}) => route.fulfill({ json: { code: 0, data }, headers });
    if (path.endsWith('/auth/refresh')) {
      const cookie = request.headers().cookie ?? '';
      if (loggedOut || !cookie.split(';').some((part) => part.trim() === `mqm_refresh_token=${current}`)) {
        if (!loggedOut) staleRequests++;
        return route.fulfill({ status: 401, json: { code: 5203, message: 'expired' } });
      }
      current = `refresh-${++rotations}`;
      return ok({ user, accessToken: `access-${rotations}` }, { 'Set-Cookie': `mqm_refresh_token=${current}; HttpOnly; Path=/; SameSite=Lax` });
    }
    if (path.endsWith('/auth/logout')) {
      loggedOut = true;
      return ok({}, { 'Set-Cookie': 'mqm_refresh_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }
    if (path.endsWith('/auth/me')) return ok({ user });
    if (path.endsWith('/library/snapshot')) return ok({ favorites: {}, recent: [], revision: 1 });
    return ok({});
  });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto('/#/settings'), second.goto('/#/settings')]);
  for (const page of [first, second]) await expect(page.locator('.who-name')).toHaveText(user.nickname);
  expect(rotations).toBe(2);
  expect(staleRequests).toBe(0);
  await first.getByRole('button', { name: '退出登录', exact: true }).click();
  for (const page of [first, second]) await expect(page.locator('.main').getByRole('button', { name: '登录同步', exact: true })).toBeVisible();
  await second.reload();
  await expect(second.locator('.main').getByRole('button', { name: '登录同步', exact: true })).toBeVisible();
});

test('temporary startup outage recovers the existing cookie without showing a false logout', async ({ page }) => {
  let available = false;
  const user = { id: 'recovery-user', email: 'recovery@example.com', nickname: '恢复用户' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/refresh') && !available)
      return route.fulfill({ status: 503, json: { code: 5403, message: 'temporary outage', retryable: true } });
    const data = path.endsWith('/auth/refresh') ? { accessToken: 'recovered', user }
      : path.endsWith('/auth/me') ? { user } : { favorites: {}, recent: [], revision: 1 };
    return route.fulfill({ json: { code: 0, data } });
  });
  await page.goto('/#/settings');
  await expect(page.locator('.qp [role="radio"]')).toHaveCount(9);
  await expect(page.locator('.side-foot').getByRole('button', { name: '登录同步' })).toHaveCount(0);
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.who-name')).toHaveText(user.nickname);
});
