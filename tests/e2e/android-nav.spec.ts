// 安卓手机：顶栏的整宽搜索栏（#12）和主内容区左右滑动切换一级页面（#13）。
// 只在 chromium-mobile（Pixel 7，412 宽，安卓 UA，可触摸）里跑；触摸用 CDP 发真实的 touchStart/Move/End，
// 走浏览器自己的手势判定（touch-action、竖向滚动），不是直接调脚本。
import { expect, test, type Page } from '@playwright/test';

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c34c2b"/></svg>');
const tracks = [101, 102].map((id, i) => ({ id: String(id), name: ['晨光唱片', '夜间列车'][i], artists: [{ id: 'a1', name: '测试艺人' }], album: { id: 'b1', name: '测试专辑', coverUrl: cover }, durationMs: 30000, coverUrl: cover }));
const playlist = { id: 'p1', name: '本期精选', coverUrl: cover, description: '精选', tracks };
const assist = { defaultKeyword: '晨光', hotKeywords: ['晨光', '夜间'], suggestions: ['晨光唱片'] };
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, targetId: `p${i}`, title: `歌单 ${i}`, type: 'playlist', coverUrl: cover }));
const discover = { blocks: [
  { id: 'discover-personalized', title: '为你挑选', items: many(12) },
  { id: 'discover-albums', title: '新碟', items: many(12).map((x) => ({ ...x, type: 'album' })) },
  { id: 'discover-toplist', title: '本周榜单', items: [{ id: 't1', targetId: 't1', title: '飙升榜', type: 'toplist', coverUrl: cover }] },
], searchAssist: assist };

function wav() {
  const length = 8000 * 30 * 2;
  const out = Buffer.alloc(44 + length);
  out.write('RIFF'); out.writeUInt32LE(length + 36, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24); out.writeUInt32LE(16000, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(length, 40);
  return out;
}

async function backend(page: Page) {
  await page.route('**/test-audio.wav', (route) => {
    const body = wav();
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : body.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) },
      body: body.subarray(start, end + 1) });
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data, message: 'ok', traceId: 'e2e' } });
    if (p.endsWith('/auth/refresh')) return route.fulfill({ status: 401, json: { code: 5203, message: '会话已过期', traceId: 'e2e', retryable: false } });
    if (p.endsWith('/discover/home')) return ok(discover);
    if (p.endsWith('/search-assist')) return ok(assist);
    if (p.endsWith('/search/artists')) return ok({ items: [], page: 1, pageSize: 30, total: 0 });
    if (p.endsWith('/search/playlists')) return ok({ items: [], page: 1, pageSize: 30, total: 0 });
    if (p.endsWith('/search')) return ok({ items: tracks, page: 1, pageSize: 30, total: 2 });
    if (p.endsWith('/toplist')) return ok([{ id: 't1', name: '飙升榜', coverUrl: cover, tracksPreview: tracks }]);
    if (p.endsWith('/scene/sport')) return ok({ tags: [], resources: [] });
    if (p.endsWith('/scene/sati')) return ok({ tags: [{ id: 'sleep', name: '助眠' }], resources: [] });
    if (p.includes('/playlist/') || p.includes('/toplist/')) return ok(playlist);
    if (p.endsWith('/quality-options')) return ok({ trackId: p.split('/')[4], availableLevels: ['standard', 'higher', 'exhigh'], fallbackMap: {} });
    if (p.endsWith('/play-url')) return ok({ trackId: p.split('/')[4], url: '/test-audio.wav', preview: false, ttlSeconds: 60, access: 'free' });
    if (p.endsWith('/lyric')) return ok({ trackId: '101', lines: [] });
    if (p.endsWith('/insight')) return ok({ trackId: '101', creators: [], alternatives: [] });
    if (p.includes('/track/')) return ok(tracks[0]);
    return route.fulfill({ status: 404, json: { code: 404, message: '未匹配的测试接口', traceId: 'e2e' } });
  });
}

type Point = { x: number; y: number };

/** 一根手指从 from 划到 to，duration 毫秒内匀速走完 */
async function drag(page: Page, from: Point, to: Point, duration = 220, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }] });
    await page.waitForTimeout(duration / steps);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  // 等切页过渡（或弹回）走完
  await page.waitForTimeout(650);
}

const width = (page: Page) => page.viewportSize()!.width;
const swipeLeft = (page: Page, y = 520) => drag(page, { x: width(page) * 0.78, y }, { x: width(page) * 0.22, y: y + 6 });
const swipeRight = (page: Page, y = 520) => drag(page, { x: width(page) * 0.22, y }, { x: width(page) * 0.78, y: y + 6 });
const hash = (page: Page) => page.evaluate(() => location.hash || '#/');
const current = (page: Page) => page.locator('.side .nav a[aria-current="page"]');

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-mobile', '安卓手机上的交互');
  await backend(page);
});

test('the search entry is a full-width bar under the nav and runs the whole search flow', async ({ page }) => {
  await page.goto('/#/');
  const bar = page.locator('.side-search');
  await expect(bar).toBeVisible();
  // 导航里的「搜索」收起来了，只剩这一条
  await expect(page.locator('.side .nav a[data-key="search"]')).toBeHidden();
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThan(width(page) - 40);
  // 和导航项之间留着空：最近的导航项底边在搜索栏上沿之上
  const navBottom = await page.locator('.side .nav a').first().evaluate((a) => a.getBoundingClientRect().bottom);
  expect(box.y - navBottom).toBeGreaterThanOrEqual(6);

  await page.getByRole('link', { name: '搜索', exact: true }).tap();
  await expect.poll(() => hash(page)).toBe('#/search');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  // 到了搜索页，顶栏这一条让给页面自己的搜索框
  await expect(bar).toBeHidden();
  await input.fill('晨光');
  await input.press('Enter');
  await expect.poll(() => hash(page)).toBe(`#/search?q=${encodeURIComponent('晨光')}`);
  await expect(page.locator('.search-songs .track')).toHaveCount(2);

  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/search');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/');
  await expect(bar).toBeVisible();
  await expect(current(page)).toHaveText('本期');
});

test('swiping the main area moves between neighbouring top-level pages', async ({ page }) => {
  await page.goto('/#/');
  await expect(current(page)).toHaveText('本期');

  // 首页往右划：没有上一页，原地弹回
  await swipeRight(page);
  expect(await hash(page)).toBe('#/');
  await expect(page.locator('.main > .page').first()).toHaveAttribute('style', /^(?!.*translate)/);

  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/charts');
  await expect(current(page)).toHaveText('榜单');
  // 选中指示条跟着到了「榜单」
  const pillOn = async () => {
    const [pill, on] = await Promise.all([
      page.locator('.nav-pill').boundingBox(),
      current(page).boundingBox(),
    ]);
    return Math.abs(pill!.x - on!.x) < 2;
  };
  await expect.poll(pillOn).toBe(true);

  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/radio');
  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/library');
  await expect(current(page)).toHaveText('唱片架');
  // 最后一页往左划：拉不动
  await swipeLeft(page);
  expect(await hash(page)).toBe('#/library');

  await swipeRight(page);
  await expect.poll(() => hash(page)).toBe('#/radio');

  // 返回键按来时的顺序退回去
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/library');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/radio');
});

test('vertical scroll, horizontal rails, screen edges and detail pages keep their own gestures', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('.main .page')).toBeVisible();
  const main = page.locator('.main');

  // 竖着划：照常滚动，不切页
  await drag(page, { x: 200, y: 640 }, { x: 214, y: 300 });
  expect(await hash(page)).toBe('#/');
  expect(await main.evaluate((m) => m.scrollTop)).toBeGreaterThan(100);
  await main.evaluate((m) => m.scrollTo(0, 0));

  // 从屏幕边缘起手：留给系统返回手势
  await drag(page, { x: 8, y: 520 }, { x: 300, y: 524 });
  expect(await hash(page)).toBe('#/');
  await drag(page, { x: width(page) - 8, y: 520 }, { x: 100, y: 524 });
  expect(await hash(page)).toBe('#/');

  // 能横向滚动的卡片轨道：手指在上面横划只滚轨道
  const rail = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.main *')].find((e) => {
      const cs = getComputedStyle(e);
      return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1;
    });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { y: r.top + r.height / 2 };
  });
  expect(rail, '首页应该有横向卡片轨道').not.toBeNull();
  await drag(page, { x: 320, y: rail!.y }, { x: 80, y: rail!.y + 4 });
  expect(await hash(page)).toBe('#/');
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.main *')].some((e) => e.scrollLeft > 0))).toBe(true);

  // 详情页（不是一级导航）不响应横滑
  await page.goto('/#/playlist/p1');
  await expect(page.getByRole('heading', { name: '本期精选' })).toBeVisible();
  await swipeLeft(page, 600);
  await swipeRight(page, 600);
  expect(await hash(page)).toBe('#/playlist/p1');

  // 搜索页（搜索栏不在导航那一排里）也不响应，输入框照常用
  await page.goto('/#/search');
  await swipeLeft(page, 400);
  expect(await hash(page)).toBe('#/search');
});

test('playback keeps going while swiping between pages', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { (window as unknown as { __audio: HTMLMediaElement }).__audio = this; return play.call(this); };
  });
  await page.goto('/#/search?q=晨光&type=track');
  await page.locator('.track .t').first().click();
  const bar = page.getByRole('contentinfo', { name: '播放控制' });
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '本期' }).tap();
  await expect.poll(() => hash(page)).toBe('#/');

  const before = await page.evaluate(() => { const a = (window as unknown as { __audio: HTMLMediaElement & { __id?: number } }).__audio; a.__id = 7; return { src: a.currentSrc, t: a.currentTime }; });
  // 刚点完「本期」就开始划：第一下落在还没播完的切页过渡上，也要接得住
  for (let i = 0; i < 3; i++) await swipeLeft(page);
  await swipeRight(page);
  await expect.poll(() => hash(page)).toBe('#/radio');

  const after = await page.evaluate(() => { const a = (window as unknown as { __audio: HTMLMediaElement & { __id?: number } }).__audio; return { id: a.__id, src: a.currentSrc, t: a.currentTime, paused: a.paused }; });
  expect(after.id).toBe(7);
  expect(after.src).toBe(before.src);
  expect(after.paused).toBe(false);
  expect(after.t).toBeGreaterThan(before.t);
  await expect(bar).toContainText('晨光唱片');
});
