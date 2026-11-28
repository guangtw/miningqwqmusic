// 沉浸舞台：正在播放页的默认样子（components/Immersive.tsx + lib/stage.ts + lib/beats.ts）
import { expect, test, type Page } from '@playwright/test';

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1d3f73"/><rect y="120" width="200" height="80" fill="#e9a23b"/></svg>');
const tracks = [101, 102].map((id, i) => ({ id: String(id), name: ['夜间列车', '晨光唱片'][i], artists: [{ id: 'a1', name: '测试艺人' }], album: { id: 'b1', name: '城市夜曲', coverUrl: cover }, durationMs: 30000, coverUrl: cover }));
const playlist = { id: 'p1', name: '本期精选', coverUrl: cover, description: '精选', tracks };
const lines = ['夜车穿过沉睡的城', '窗外的灯一盏一盏地后退', '我把耳机调到最大声', '好像这样就能听见你'].map((text, i) => ({ timeMs: 300 + i * 2500, text }));

/** 30 秒 120 BPM 的底鼓 */
function wav() {
  const rate = 8000;
  const n = rate * 30;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF'); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const tb = (i / rate) % 0.5;
    const v = Math.sin(2 * Math.PI * (45 + 70 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9) * 0.8;
    out.writeInt16LE(Math.round(v * 30000), 44 + i * 2);
  }
  return out;
}

async function backend(page: Page, { cors = true } = {}) {
  const body = wav();
  await page.route('**/test-audio.wav', (route) => {
    // 节拍分析那一份是 fetch（CORS）；cors=false 时模拟 CDN 不给跨域
    if (!cors && route.request().resourceType() === 'fetch') return route.abort();
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : body.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) },
      body: body.subarray(start, end + 1) });
  });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data, message: 'ok', traceId: 'e2e' } });
    if (p.endsWith('/auth/refresh')) return route.fulfill({ status: 401, json: { code: 5203, message: '会话已过期', traceId: 'e2e', retryable: false } });
    if (p.endsWith('/discover/home')) return ok({ blocks: [], searchAssist: { defaultKeyword: '夜', hotKeywords: [], suggestions: [] } });
    if (p.endsWith('/search-assist')) return ok({ defaultKeyword: '夜', hotKeywords: [], suggestions: [] });
    if (p.includes('/playlist/')) return ok(playlist);
    if (p.endsWith('/quality-options')) return ok({ trackId: p.split('/')[4], availableLevels: ['standard', 'exhigh'], fallbackMap: {} });
    if (p.endsWith('/play-url')) return ok({ trackId: p.split('/')[4], url: '/test-audio.wav', preview: false, ttlSeconds: 600, access: 'free' });
    if (p.endsWith('/lyric')) return ok({ trackId: p.split('/')[4], lines });
    if (p.endsWith('/insight')) return ok({ trackId: p.split('/')[4], creators: [], alternatives: [] });
    if (p.includes('/track/')) return ok(tracks[0]);
    if (p.includes('/scene/')) return ok({ tags: [], resources: [] });
    return route.fulfill({ status: 404, json: { code: 404, message: '未匹配的测试接口', traceId: 'e2e' } });
  });
}

async function openStage(page: Page) {
  await page.goto('/#/playlist/p1');
  await page.getByRole('button', { name: '放上唱机' }).first().click();
  await page.getByRole('button', { name: '打开正在播放' }).first().click();
  const stage = page.locator('.nowplaying.open .immersive');
  await expect(stage).toBeVisible();
  return stage;
}

/** 叫出控件：桌面动一下鼠标，触屏点一下空白处 */
async function wake(page: Page, touch: boolean) {
  if (touch) {
    if (!(await page.locator('.immersive.ui').count())) await page.locator('.im-hit').tap();
  } else await page.mouse.move(300 + Math.random() * 400, 400);
  await expect(page.locator('.immersive.ui')).toHaveCount(1);
}

test('the now-playing page opens as the immersive stage, with lyrics, beat-driven motion and its own controls', async ({ page }, info) => {
  const touch = info.project.name === 'chromium-mobile';
  await backend(page);
  const stage = await openStage(page);
  await expect(page.locator('html')).toHaveAttribute('data-immersive', '');
  // 普通唱机页的内容不挂；播放台和底栏让开
  await expect(page.locator('.nowplaying .np-body')).toHaveCount(0);
  await expect(page.locator('.player')).toHaveCSS('pointer-events', 'none');
  // 画布在，或者 WebGL 不可用时退回到虚化封面
  await expect(stage.locator('canvas.im-gl')).toHaveCount(1);
  if (await stage.evaluate((el) => el.classList.contains('no-gl'))) await expect(stage.locator('.im-fallback')).toHaveCount(1);
  // 歌词跟着唱：当前句逐字点亮，下一句在下面
  await expect(stage.locator('.im-line.cur .im-text')).toHaveText(/夜车穿过沉睡的城|窗外的灯一盏一盏地后退/, { timeout: 8000 });
  await expect(stage.locator('.im-next')).toHaveCount(1);
  await expect.poll(() => stage.locator('.im-line.cur').evaluate((el) => parseFloat(el.style.getPropertyValue('--p')) || 0)).toBeGreaterThan(0);
  // 能跨域取到整曲：按底鼓起伏
  await expect(page.locator('html')).toHaveAttribute('data-beat', 'kick', { timeout: 10000 });

  // 控件闲置后隐去，再唤醒；触屏上点空白处能叫出来（以前按下时先唤醒、抬手又藏回去）
  await expect(page.locator('.immersive.ui')).toHaveCount(0, { timeout: 6000 });
  await wake(page, touch);
  await stage.getByRole('button', { name: '暂停' }).click();
  await expect(stage.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  // 暂停时控件常驻
  await page.waitForTimeout(3500);
  await expect(page.locator('.immersive.ui')).toHaveCount(1);
});

test('without CORS on the audio CDN, lyric changes drive the stage instead', async ({ page }) => {
  await backend(page, { cors: false });
  await openStage(page);
  await expect(page.locator('html')).toHaveAttribute('data-beat', 'lyric', { timeout: 10000 });
});

test('switching to the classic record player is remembered, and the stage is one tap away', async ({ page }, info) => {
  const touch = info.project.name === 'chromium-mobile';
  await backend(page);
  const stage = await openStage(page);
  await wake(page, touch);
  await stage.locator('.im-mode').click();
  await expect(page.locator('.nowplaying .np-head')).toBeVisible();
  await expect(page.locator('.immersive')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-immersive', '');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cph.settings.v2')!).npMode)).toBe('classic');

  await page.reload();
  await page.getByRole('button', { name: '放上唱机' }).first().click();
  await page.getByRole('button', { name: '打开正在播放' }).first().click();
  await expect(page.locator('.nowplaying.open .np-head')).toBeVisible();
  await page.locator('.np-to-stage').click();
  await expect(page.locator('.nowplaying.open .immersive')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cph.settings.v2')!).npMode)).toBe('immersive');
});
