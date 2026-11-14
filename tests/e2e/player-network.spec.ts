// issue #7 播放器网络时序：断网、挂起、拦截、超时在真 Chromium 里的行为。
// 时间都卡在 player.ts 的产品常量上（卡住判定 12 秒、取地址慢提示 12 秒 / 超时 40 秒），所以用例按条件轮询等待，不靠固定 sleep；
// 只有「这段时间里不该发生某事」的断言需要真的等一段时间。
import { expect, test } from '@playwright/test';
import { AudioServer, errorCodes, expectSounding, expectStuck, expectToast, holdsFor, LONG, NEAR_REALTIME, openPlayer, SHORT, state, toasts } from './player/harness';

const OFFLINE_TOAST = '暂时连不上';
let cdn: AudioServer;
test.beforeEach(async () => { cdn = new AudioServer(); await cdn.start(); });
test.afterEach(async () => { await cdn.stop(); });
test.describe.configure({ timeout: 180_000 });

test('A3 播放中断网：保持等网不放弃，恢复网络后不用点就从断网处接着放', async ({ page }) => {
  cdn.rate = NEAR_REALTIME;
  const p = await openPlayer(page, cdn);
  await page.locator('.play-btn').click();
  await expectSounding(page, 4);
  await p.setOffline(true);
  await expectToast(page, OFFLINE_TOAST);
  const held = await holdsFor(page, 15_000, (s) => s.loading && s.label === '暂停');
  expect(held, '断网等待期间应一直保持「要放、加载中」').toBeNull();
  const stuck = (await state(page)).cur;
  await p.setOffline(false);
  const back = await expectSounding(page, stuck + 1, 40_000);
  expect(back.cur).toBeLessThan(stuck + 8);
  expect(await toasts(page)).not.toContainEqual(expect.stringContaining('加载失败'));
});

test('A9 断网等网时用系统媒体控制先暂停再播放：仍保持等网，恢复网络后自己接着放', async ({ page }) => {
  cdn.rate = NEAR_REALTIME;
  const p = await openPlayer(page, cdn);
  await page.locator('.play-btn').click();
  await expectSounding(page, 4);
  await p.setOffline(true);
  await expectToast(page, OFFLINE_TOAST);
  const stuck = (await state(page)).cur;
  const handlers = await page.evaluate(() => Object.keys((window as unknown as { __ms: object }).__ms));
  expect(handlers).toEqual(expect.arrayContaining(['play', 'pause']));
  await page.evaluate(() => (window as unknown as { __ms: Record<string, () => void> }).__ms.pause());
  await expect(page.locator('.play-btn')).toHaveAttribute('aria-label', '播放');
  await page.evaluate(() => (window as unknown as { __ms: Record<string, () => void> }).__ms.play());
  await expect(page.locator('.play-btn')).toHaveAttribute('aria-label', '暂停');
  const callsBefore = p.api.calls.length;
  const held = await holdsFor(page, 15_000, (s) => s.loading && s.label === '暂停');
  expect(held, '媒体控制暂停→播放后仍断网，应保持等网').toBeNull();
  expect(p.api.calls.length - callsBefore, '断网期间不应有取地址请求打到接口').toBe(0);
  await p.setOffline(false);
  const back = await expectSounding(page, stuck + 0.5, 40_000);
  expect(back.cur).toBeLessThan(stuck + 8);
});

test('主按钮：卡顿重连取地址途中点一下就取消，地址晚到也不在旧位置出声', async ({ page }) => {
  cdn.rate = NEAR_REALTIME;
  const p = await openPlayer(page, cdn);
  await page.locator('.play-btn').click();
  await expectSounding(page, 3);
  cdn.hang = true;
  p.api.mode = 'hang';
  await expect.poll(() => p.api.calls.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const btn = page.locator('.play-btn');
  await expect(btn, '重连中按钮应显示「暂停」（想放且加载中）').toHaveAttribute('aria-label', '暂停');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-label', '播放');
  await expect(btn).not.toHaveClass(/is-loading/);
  const stoppedAt = (await state(page)).cur;
  cdn.hang = false;
  p.api.mode = 'ok';
  p.api.release();
  const leaked = await holdsFor(page, 6_000, (s) => s.paused && s.label === '播放');
  expect(leaked, '取消后晚到的地址不应自己开始放').toBeNull();
  await btn.click();
  const back = await expectSounding(page, Math.max(0, stoppedAt - 1));
  expect(back.cur).toBeLessThan(stoppedAt + 8);
});

test('A4 拦掉音频域名：按重连处理并最终提示网络不稳，不判「这首歌加载失败」', async ({ page }) => {
  cdn.rate = NEAR_REALTIME;
  await openPlayer(page, cdn);
  await page.locator('.play-btn').click();
  await expectSounding(page, 4);
  const block = (route: import('@playwright/test').Route) => route.abort('blockedbyclient');
  await page.route(`${cdn.origin}/**`, block);
  cdn.dropAll();
  await expectToast(page, '网络不太稳', 150_000);
  expect(await toasts(page)).not.toContainEqual(expect.stringContaining('加载失败'));
  const stoppedAt = (await state(page)).cur;
  await page.unroute(`${cdn.origin}/**`, block);
  await page.locator('.play-btn').click();
  await expectSounding(page, Math.max(0.5, stoppedAt - 1));
  // Chromium 对拦截报的是 code 4（不是 2），这正是本轮要归因对的情况
  expect(await errorCodes(page)).toContain(4);
});

for (const when of ['刚卡住', '等网提示后'] as const) {
  test(`A5 ${when}点暂停、随即恢复网络：保持暂停，不自己开始放`, async ({ page }) => {
    cdn.rate = NEAR_REALTIME;
    const p = await openPlayer(page, cdn);
    await page.locator('.play-btn').click();
    await expectSounding(page, 4);
    await p.setOffline(true);
    await expectStuck(page);
    if (when === '等网提示后') await expectToast(page, OFFLINE_TOAST);
    const s0 = await state(page);
    const calls = p.api.calls.length;
    await page.locator('.play-btn').click();
    await p.setOffline(false);
    // 暂停有 260ms 淡出，淡出完 <audio> 才真正 paused
    await expect.poll(async () => (await state(page)).paused, { timeout: 3_000 }).toBe(true);
    const moved = await holdsFor(page, 15_000, (s) => s.paused && s.label === '播放' && !s.loading);
    expect(moved, '暂停后恢复网络不应自己开始放').toBeNull();
    expect(p.api.calls.length - calls, '暂停后不应再起重连').toBe(0);
    await page.locator('.play-btn').click();
    await expectSounding(page, Math.max(0.5, s0.cur - 1));
  });
}

test('A8 新起播时取地址一直不回：先提示慢、再提示超时并停下，不再发请求；放开后点播放能出声', async ({ page }) => {
  const p = await openPlayer(page, cdn, { resume: { id: '101', at: 60_000 } });
  p.api.mode = 'hang';
  await page.locator('.play-btn').click();
  await expectToast(page, '网络有点慢', 30_000);
  await expectToast(page, '超时', 60_000);
  const btn = page.locator('.play-btn');
  await expect(btn).toHaveAttribute('aria-label', '播放');
  await expect(btn).not.toHaveClass(/is-loading/);
  const calls = p.api.calls.length;
  await page.waitForTimeout(14_000);
  expect(p.api.calls.length - calls, '超时停下后不应自己继续请求').toBe(0);
  p.api.mode = 'ok';
  await btn.click();
  const back = await expectSounding(page, 0.5);
  expect(back.cur).toBeGreaterThan(55);
});

test('A8 卡顿重连时取地址挂起：提示慢、转入等网，放开后自己接着放', async ({ page }) => {
  cdn.rate = NEAR_REALTIME;
  const p = await openPlayer(page, cdn);
  await page.locator('.play-btn').click();
  await expectSounding(page, 3);
  cdn.hang = true;
  p.api.mode = 'hang';
  await expect.poll(() => p.api.calls.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await expectToast(page, '网络有点慢', 30_000);
  await expectToast(page, OFFLINE_TOAST, 60_000);
  const atHold = await state(page);
  expect(atHold.label).toBe('暂停');
  p.api.mode = 'ok';
  cdn.hang = false;
  await expectSounding(page, atHold.cur + 0.5, 60_000);
});

test('A7 单曲循环：短曲自然播完后同一首从头再放，不重新取地址', async ({ page }) => {
  const p = await openPlayer(page, cdn, { queue: [...SHORT, LONG[0]], mode: 'one' });
  await page.locator('.play-btn').click();
  await expectSounding(page, 0.5);
  const calls = p.api.calls.length;
  await page.waitForFunction(() => (window as unknown as { __ev: unknown[][] }).__ev.some((e) => e[1] === 'ended'), null, { timeout: 20_000 });
  const s = await expectSounding(page, 0.3, 10_000);
  expect(s.src).toContain('id=201');
  expect(s.cur).toBeLessThan(6);
  expect(p.api.calls.length - calls).toBe(0);
});
