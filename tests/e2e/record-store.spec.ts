import { devices, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c34c2b"/><circle cx="200" cy="200" r="130" fill="#efc779"/><circle cx="200" cy="200" r="55" fill="#222"/></svg>');
const tracks = [101, 102].map((id, i) => ({ id: String(id), name: ['晨光唱片', '夜间列车'][i], artists: [{ id: 'a1', name: '测试艺人' }], album: { id: 'b1', name: '测试专辑', coverUrl: cover }, durationMs: 30000, coverUrl: cover }));
const playlist = { id: 'p1', name: '本期精选', coverUrl: cover, description: '来自后端的精选歌单', tracks };
const assist = { defaultKeyword: '晨光', hotKeywords: ['晨光', '夜间'], suggestions: ['晨光唱片'] };
const discover = { blocks: [
  { id: 'discover-personalized', title: '为你挑选', items: [
    { id: 'p1', targetId: 'p1', title: playlist.name, subtitle: '放一张唱片，听一段时光', type: 'playlist', coverUrl: cover },
    { id: 'p2', targetId: 'p2', title: '午后漫游', type: 'playlist', coverUrl: cover },
  ] },
  { id: 'discover-toplist', title: '本周榜单', items: [{ id: 't1', targetId: 't1', title: '飙升榜', type: 'toplist', coverUrl: cover }] },
], searchAssist: assist };
const user = { id: 'u1', email: 'listener@example.com', nickname: '唱片听众' };
const friend = { id: 'u2', email: 'friend@example.com', nickname: '同桌' };
const listenRoom = { id: 'room1', inviteCode: 'ABC123', hostUserId: 'u1', status: 'open', version: 1, playbackState: { queue: tracks, currentIndex: 0, currentTimeMs: 0, isPlaying: false, mode: 'sequence', updatedAt: new Date().toISOString() }, members: [{ user, role: 'host', joinedAt: '', lastSeenAt: '', online: true }, { user: friend, role: 'member', joinedAt: '', lastSeenAt: '', online: true }], lastActor: user, expiresAt: '', createdAt: '', updatedAt: '' };

function wav() {
  const length = 8000 * 30 * 2;
  const out = Buffer.alloc(44 + length);
  out.write('RIFF'); out.writeUInt32LE(length + 36, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24); out.writeUInt32LE(16000, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(length, 40);
  return out;
}

async function backend(page: Page, options: { disabled?: boolean; failedHome?: boolean } = {}) {
  const calls: { path: string; method: string; authorization?: string; body: unknown }[] = [];
  let signedIn = false;
  let failHome = options.failedHome;
  let favorites: Record<string, typeof tracks[number]> = {};
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/test-audio.wav', (route) => {
    const body = wav();
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : body.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) },
      body: body.subarray(start, end + 1),
    });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ path: p + url.search, method: request.method(), authorization: request.headers().authorization, body: request.postDataJSON() });
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data, message: 'ok', traceId: 'e2e' } });
    if (p.endsWith('/auth/refresh')) {
      if (signedIn) return ok({ accessToken: 'fresh-token', user });
      return route.fulfill({ status: options.disabled ? 503 : 401, json: { code: options.disabled ? 5401 : 5203, message: '会话已过期', traceId: 'e2e', retryable: false } });
    }
    if (p.endsWith('/auth/login') || p.endsWith('/auth/register')) { signedIn = true; return ok({ accessToken: 'login-token', user }); }
    if (p.endsWith('/auth/me')) return ok({ user });
    if (p.endsWith('/auth/logout')) { signedIn = false; return ok({}); }
    if (p.endsWith('/library/snapshot')) return ok({ revision: 1, favorites, recent: [], importedPlaylists: {}, updatedAt: new Date().toISOString() });
    if (p.endsWith('/library/favorites')) {
      const track = request.postDataJSON().track;
      favorites[track.id] = track;
      return ok({ revision: 2 });
    }
    if (p.includes('/library/favorites/')) { delete favorites[p.split('/').pop()!]; return ok({ revision: 3 }); }
    if (p.endsWith('/library/recent')) return ok({ revision: 4 });
    if (p.endsWith('/discover/home')) {
      if (failHome) return route.fulfill({ status: 503, json: { code: 2003, message: '上游繁忙', retryable: true, traceId: 'e2e' } });
      return ok(discover);
    }
    if (p.endsWith('/search-assist')) return ok(assist);
    if (p.endsWith('/search/artists')) return ok({ items: [{ id: 'a1', name: '测试艺人', coverUrl: cover }], page: 1, pageSize: 30, total: 1 });
    if (p.endsWith('/search/playlists')) return ok({ items: [playlist], page: 1, pageSize: 30, total: 1 });
    if (p.endsWith('/search')) return ok({ items: url.searchParams.get('page') === '2' ? [tracks[1]] : tracks, page: Number(url.searchParams.get('page')), pageSize: 30, total: 31 });
    if (p.endsWith('/scene/sport')) {
      // 每个步频一首，奇数档和偶数档各给一首，拼出来是两首
      const id = Number(url.searchParams.get('bpm')) % 4 ? '102' : '101';
      return ok({ tags: [], resources: [{ id, title: '场景歌', trackId: id, coverUrl: cover }] });
    }
    if (p.endsWith('/scene/sati')) {
      const tag = url.searchParams.get('tag') ?? 'sleep';
      return ok({ tags: [{ id: 'sleep', name: '助眠' }, { id: 'rain', name: '雨声' }], resources: [{ id: `r-${tag}`, title: tag === 'rain' ? '窗外的雨' : '向晚', trackId: tag === 'rain' ? '102' : '101', coverUrl: cover, tag }] });
    }
    if (p.endsWith('/account/friends')) return ok([{ user: friend, since: '2026-10-01T00:00:00.000Z' }]);
    if (p.endsWith('/friends/requests')) return ok({ incoming: [], outgoing: [] });
    if (p.endsWith('/listen/invites')) return ok([]);
    if (p.endsWith('/listen/rooms') && request.method() === 'POST') return ok(listenRoom);
    if (p.endsWith(`/listen/rooms/${listenRoom.id}/stream`)) {
      // 房间里的另一个人切到了第二首，停在 0:05
      const event = { version: 2, type: 'playback', actor: friend, createdAt: new Date().toISOString(), payload: { queue: tracks, currentIndex: 1, currentTimeMs: 5000, isPlaying: false, mode: 'sequence', updatedAt: new Date().toISOString() } };
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: ready\ndata: {}\n\nevent: state\ndata: ${JSON.stringify(event)}\n\n` });
    }
    if (p.endsWith(`/listen/rooms/${listenRoom.id}/invites`)) return ok({ id: 'inv1', status: 'pending' });
    if (p.includes(`/listen/rooms/${listenRoom.id}`)) return ok(listenRoom);
    if (p.endsWith('/insight')) return ok({ trackId: '101', creators: [{ name: '某人', role: '作词' }], wikiSummary: '流行-华语流行', chorusStartMs: 12000, alternatives: [] });
    if (p.endsWith('/toplist')) return ok([{ id: 't1', name: '飙升榜', coverUrl: cover, tracksPreview: tracks }]);
    if (p.includes('/playlist/') || p.includes('/toplist/')) return ok(playlist);
    if (p.includes('/album/')) return ok({ id: 'b1', name: '测试专辑', coverUrl: cover, artists: tracks[0].artists, tracks });
    if (p.includes('/artist/')) return ok({ id: 'a1', name: '测试艺人', coverUrl: cover, topTracks: tracks });
    if (p.endsWith('/play-url')) return ok({ trackId: p.split('/')[4], url: '/test-audio.wav', preview: false, ttlSeconds: 60 });
    if (p.endsWith('/lyric')) return ok({ trackId: '101', lines: [{ timeMs: 0, text: '第一句歌词' }, { timeMs: 12000, text: '第二句歌词' }] });
    if (p.includes('/track/')) return ok(tracks[0]);
    return route.fulfill({ status: 404, json: { code: 404, message: '未匹配的测试接口', traceId: 'e2e' } });
  });
  return { calls, errors, recoverHome: () => { failHome = false; } };
}

test('search, pagination, collection, playback, lyrics, queue and local favorites', async ({ page }, info) => {
  const state = await backend(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Mining唱片行');
  await expect(page.getByRole('heading', { name: '本期精选' })).toBeVisible();
  await page.getByRole('link', { name: '搜索', exact: true }).click();
  await page.getByRole('combobox').fill('晨光');
  await page.getByRole('combobox').press('Enter');
  // 默认是综合页：最佳匹配 + 单曲 + 艺人 + 歌单
  await expect(page.locator('.best-name')).toHaveText('晨光唱片');
  await expect(page.locator('.search-songs .track')).toHaveCount(2);
  await expect(page.locator('.s-section .card-title')).toHaveText(['测试艺人', '本期精选']);
  await page.getByRole('tab', { name: '单曲', exact: true }).click();
  await expect(page.locator('.tracks .track')).toHaveCount(2);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.tracks .track')).toHaveCount(1);
  expect(state.calls.some((c) => c.path.includes('page=2'))).toBe(true);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.tracks .track')).toHaveCount(2);
  await page.locator('.track').first().getByRole('button', { name: '收藏', exact: true }).click();
  await page.locator('.track .t').first().click();
  await expect(page.getByRole('contentinfo', { name: '播放控制' }).getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  expect(state.calls.some((c) => c.path === '/api/music/track/101/play-url?level=exhigh')).toBe(true);
  await page.locator('.player .np-text').click();
  await expect(page.locator('.nowplaying')).toHaveClass(/open/);
  await expect(page.getByText('第一句歌词', { exact: true })).toBeVisible();
  // 手机上歌词平时只露两行，点一下进全屏歌词
  if (info.project.name.includes('mobile')) {
    await page.locator('.lyric-line').first().click();
    await expect(page.locator('.nowplaying')).toHaveClass(/np-focus/);
  }
  // 点没唱到的一句：先亮出句尾的播放键，点它才跳过去
  await page.locator('.lyric-line', { hasText: '第二句歌词' }).click();
  await expect(page.locator('.lyric-go')).toBeVisible();
  await page.locator('.lyric-go').click();
  await expect(page.locator('.lyric-go')).toHaveCount(0);
  if (info.project.name.includes('mobile')) {
    // 全屏歌词也占一条历史记录：返回先退回唱机
    await page.evaluate(() => ((window as Window & { __alive?: number }).__alive = 1));
    await page.evaluate(() => history.back());
    await expect(page.locator('.nowplaying')).not.toHaveClass(/np-focus/);
    await expect(page.locator('.nowplaying')).toHaveClass(/open/);
    // 没有整页刷新（外层 Next.js 路由不该接手这条记录）
    expect(await page.evaluate(() => (window as Window & { __alive?: number }).__alive)).toBe(1);
  }
  // 系统返回先收起正在播放页，不离开当前页面；再打开后用「收起」关
  const before = page.url();
  await page.evaluate(() => history.back());
  await expect(page.locator('.nowplaying')).not.toHaveClass(/open/);
  expect(page.url()).toBe(before);
  await page.locator('.player .np-text').click();
  await expect(page.locator('.nowplaying')).toHaveClass(/open/);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  // 手机上播放台要等面板收起后才缩回去，队列键随之藏起来
  await expect(page.locator('.player')).not.toHaveClass(/np-open/);
  if (await page.getByRole('button', { name: '播放队列', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '播放队列', exact: true }).click();
    await expect(page.locator('.drawer .q-item')).toHaveCount(2);
    await page.locator('.drawer').getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('link', { name: '唱片架', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的唱片架' })).toBeVisible();
  await expect(page.locator('.track .t')).toHaveCount(1);
  await expect(page.locator('.track .t')).toHaveText('晨光唱片');
  await page.reload();
  await expect(page.locator('.track .t')).toHaveText('晨光唱片');
  await page.getByRole('link', { name: '榜单', exact: true }).click();
  await page.locator('a[href="#/toplist/t1"]').first().click();
  await expect(page.locator('.detail-title')).toHaveText('本期精选');
  await page.goto('/#/album/b1');
  await expect(page.locator('.detail-title')).toHaveText('测试专辑');
  await page.locator('.byline a').first().click();
  await expect(page.locator('.detail-title')).toHaveText('测试艺人');
  expect(state.errors).toEqual([]);
});

test('play, pause and switching songs fade the audio in and out', async ({ page }) => {
  await backend(page);
  // 播放器的 <audio> 不挂在页面上：记下被播放的那个，好读它的音量
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { (window as unknown as { __audio: HTMLMediaElement }).__audio = this; return play.call(this); };
  });
  await page.goto('/#/search?q=晨光&type=song');
  const bar = page.getByRole('contentinfo', { name: '播放控制' });
  const volume = () => page.evaluate(() => (window as unknown as { __audio: HTMLMediaElement }).__audio.volume);
  const paused = () => page.evaluate(() => (window as unknown as { __audio: HTMLMediaElement }).__audio.paused);
  await page.locator('.track .t').first().click();
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(volume).toBeCloseTo(0.8);
  // 暂停：按钮立刻翻过来，声音淡完才真正停
  await bar.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  const fading = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const a = (window as unknown as { __audio: HTMLMediaElement }).__audio;
    const seen: number[] = [];
    const tick = () => { seen.push(a.paused ? -1 : a.volume); if (a.paused) resolve(seen); else requestAnimationFrame(tick); };
    tick();
  }));
  expect(fading.length).toBeGreaterThan(3);
  expect(fading.some((v) => v > 0.05 && v < 0.75)).toBe(true);
  expect(await volume()).toBe(0);
  // 继续播放从静音淡回来
  await bar.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(paused).toBe(false);
  await expect.poll(volume).toBeCloseTo(0.8);
  // 换下一首：先淡出再换源，新歌再淡入
  await bar.getByRole('button', { name: '下一首', exact: true }).click();
  await expect.poll(volume, { intervals: [10] }).toBeLessThan(0.3);
  await expect.poll(volume).toBeCloseTo(0.8);
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test.describe('iPhone', () => {
  test.use({ userAgent: devices['iPhone 13'].userAgent });

  test('long playlists open without a page snapshot, render in batches and keep the scroll position', async ({ page }) => {
    await backend(page);
    const many = Array.from({ length: 300 }, (_, i) => ({ ...tracks[i % 2], id: String(1000 + i), name: `长歌单 ${i}` }));
    await page.route('**/api/music/playlist/**', (route) => route.fulfill({ json: { code: 0, data: { ...playlist, tracks: many }, message: 'ok', traceId: 'e2e' } }));
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      const start = doc.startViewTransition?.bind(doc);
      if (start) doc.startViewTransition = (cb) => { w.__vt += 1; return start(cb); };
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-device', 'iphone');
    await page.locator('.card .sleeve').first().click();
    await expect(page.locator('.detail-title')).toHaveText('本期精选');
    // 封面自己飞过去，不拍整页快照
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0);
    expect(await page.locator('.detail-art .hero-active').evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
    // 先画一屏多，剩下的分批补齐
    const first = await page.locator('.track').count();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(300);
    await expect(page.locator('.track')).toHaveCount(300);
    // 滚到深处、去别的页再返回，位置还在
    await page.locator('.main').evaluate((m) => { m.scrollTop = 12000; });
    const y = await page.locator('.main').evaluate((m) => m.scrollTop);
    await page.evaluate(() => { location.hash = '#/album/b1'; });
    await expect(page.locator('.detail-title')).toHaveText('测试专辑');
    await page.goBack();
    await expect(page.locator('.detail-title')).toHaveText('本期精选');
    await expect.poll(() => page.locator('.main').evaluate((m) => m.scrollTop)).toBe(y);
  });
});

test('daily epigraph starts the selected song at its lyric timestamp', async ({ page }) => {
  const state = await backend(page);
  await page.route('**/api/music/track/*/lyric', (route) => route.fulfill({ json: {
    code: 0, data: { trackId: '101', lines: [{ timeMs: 12000, text: '今天的音乐陪我们继续向前' }] },
    message: 'ok', traceId: 'epigraph-e2e',
  } }));
  await page.goto('/');
  const start = page.getByRole('button', { name: /从 0:12 开始播放/ });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole('contentinfo', { name: '播放控制' }).getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  // The desktop seek bar remains in the DOM when the mobile layout hides it.
  await expect.poll(async () => Number(await page.locator('.player [aria-label="播放进度"]').getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(11200);
  expect(state.calls.some((call) => call.path.includes('/play-url'))).toBe(true);
  expect(state.errors).toEqual([]);
});

test('search categories, login, cloud sync and logout use the BFF contract', async ({ page }) => {
  const state = await backend(page);
  await page.goto('/#/search?q=晨光');
  // 换分页时上一页的卡片会多留一瞬（还在取数据），按「最后只剩一张」来等
  await page.getByRole('tab', { name: '艺人', exact: true }).click();
  await expect(page.locator('.card-title')).toHaveCount(1);
  await expect(page.locator('.card-title')).toHaveText('测试艺人');
  await page.getByRole('tab', { name: '歌单', exact: true }).click();
  await expect(page.locator('.card-title')).toHaveText(['本期精选']);
  await page.getByRole('tab', { name: '单曲', exact: true }).click();
  await page.locator('.track').first().getByRole('button', { name: '收藏', exact: true }).click();
  await page.goto('/#/account');
  await page.locator('.main').getByRole('button', { name: '登录同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="email"]').fill(user.email);
  await dialog.locator('input[type="password"]').fill('test-password');
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.calls.some((c) => c.path === '/api/account/library/favorites' && c.authorization === 'Bearer login-token')).toBe(true);
  await page.goto('/#/search?q=晨光');
  await page.locator('.track .t').first().click();
  await expect.poll(() => state.calls.some((c) => c.path.includes('/play-url') && c.authorization === 'Bearer login-token')).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('login-token');
  expect(storage).not.toContain('test-password');
  await page.goto('/#/account');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('.main').getByRole('button', { name: '登录同步' })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('disabled account, retry, theme persistence and old device data migration', async ({ page }) => {
  const state = await backend(page, { disabled: true, failedHome: true });
  await page.addInitScript((track) => localStorage.setItem('qwq-music-store-v1', JSON.stringify({ state: { favorites: { [track.id]: track }, recent: [track], queue: [track], currentIndex: 0, volume: 0.4 } })), tracks[0]);
  await page.goto('/');
  await expect(page.getByText('音乐服务有点忙，过一会儿再试。')).toBeVisible();
  state.recoverHome();
  await page.getByRole('button', { name: /重试/ }).click();
  await expect(page.getByRole('heading', { name: '本期精选' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录同步' })).toHaveCount(0);
  await page.getByRole('link', { name: '唱片架', exact: true }).click();
  await expect(page.locator('.track .t')).toHaveText('晨光唱片');
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: '夜间', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(page.getByText('后端未启用账户服务，收藏只保存在本机。')).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('radio picks songs by pace, sati tags switch and liner notes show credits', async ({ page }) => {
  const state = await backend(page);
  await page.goto('/#/radio');
  await page.getByRole('radio', { name: /跑步/ }).click();
  await page.getByRole('button', { name: '按 160 步频开跑' }).click();
  await expect(page.locator('.sport-mix .track')).toHaveCount(2);
  await expect(page.getByRole('contentinfo', { name: '播放控制' }).getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '雨声', exact: true }).click();
  await expect(page.locator('.sound-title')).toHaveText('窗外的雨');
  await page.locator('.player .np-text').click();
  await page.getByRole('button', { name: '唱片内页' }).click();
  await expect(page.locator('.notes-credits')).toContainText('某人');
  await expect(page.locator('.notes-tag')).toHaveText(['流行', '华语流行']);
  expect(state.calls.filter((c) => c.path.includes('/scene/sport')).length).toBe(11);
  expect(state.errors).toEqual([]);
});

test('listen together: open a room and follow what a friend plays', async ({ page }) => {
  const state = await backend(page);
  await page.goto('/#/search?q=晨光&type=track');
  await page.locator('.track .t').first().click();
  await page.goto('/#/account');
  await page.locator('.main').getByRole('button', { name: '登录同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="email"]').fill(user.email);
  await dialog.locator('input[type="password"]').fill('test-password');
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // 一起听在播放台中间那排的最左边；手机上平时收着，打开正在播放页后才展开
  await page.locator('.player .np-text').click();
  await page.locator('.player .t-left').getByRole('button', { name: '一起听' }).click();
  await page.getByRole('button', { name: /开一个房间/ }).click();
  await expect(page.locator('.listen-code-big')).toContainText('ABC123'.split('').join(''));
  await expect(page.locator('.listen-room .person-text b')).toHaveText(['唱片听众（我）', '同桌']);
  // 推送流里同桌切到了第二首
  await expect(page.locator('.player .np-text')).toContainText('夜间列车');
  await expect(page.locator('.listen-last')).toContainText('同桌');
  const created = state.calls.find((c) => c.path === '/api/account/listen/rooms' && c.method === 'POST');
  expect((created?.body as { playbackState: { queue: unknown[] } }).playbackState.queue).toHaveLength(2);
  expect(state.calls.some((c) => c.path.startsWith('/api/account/listen/rooms/room1/stream') && c.authorization === 'Bearer login-token')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('upstream desktop/mobile visual fidelity', async ({ page, browser }, info) => {
  test.skip(!process.env.REFERENCE_BASE_URL, 'Set REFERENCE_BASE_URL to compare with the untouched upstream SPA');
  await backend(page, { disabled: true });
  await page.goto('/');
  const reference = await browser.newPage({ viewport: page.viewportSize(), isMobile: !!info.project.use.isMobile, deviceScaleFactor: info.project.use.deviceScaleFactor, hasTouch: !!info.project.use.hasTouch });
  await backend(reference, { disabled: true });
  await reference.goto(process.env.REFERENCE_BASE_URL!);
  for (const target of [page, reference]) {
    await expect(target.getByRole('heading', { name: '本期精选' })).toBeVisible();
    await target.evaluate(() => document.fonts.ready);
    await expect(target.locator('.feature-art .cover')).toHaveClass(/ready/);
    await expect(target.locator('.epigraph')).not.toHaveClass(/is-loading/);
  }
  // Browser screenshot assertions disable finite animations, but continuously spinning
  // records need a deterministic frame on both otherwise unchanged pages.
  const freeze = '*,:before,:after{animation:none!important;transition:none!important}';
  for (const target of [page, reference]) await target.addStyleTag({ content: freeze });
  const actual = await page.screenshot({ animations: 'disabled' });
  const expected = await reference.screenshot({ animations: 'disabled' });
  const dir = process.env.PW_EVIDENCE_DIR || path.join(process.env.TEMP!, 'qwq-opus-qa');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${info.project.name}-integrated.png`), actual);
  await fs.writeFile(path.join(dir, `${info.project.name}-upstream.png`), expected);
  expect(actual.equals(expected), 'Upstream and integrated screenshots should be pixel identical').toBe(true);
  await reference.close();
});
