// 安卓手机：Apple Music 式底栏（一个胶囊放五个页面 + 一个圆是缩起来的迷你播放台，下翻时两者换个个儿，#12）和主内容区左右滑动切换一级页面（#13）。
// 只在 chromium-mobile（Pixel 7，412 宽，安卓 UA，可触摸）里跑；触摸用 CDP 发真实的 touchStart/Move/End，
// 走浏览器自己的手势判定（touch-action、竖向滚动），不是直接调脚本。
import { devices, expect, test, type Page } from '@playwright/test';

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
/** 底栏里亮着的那一项（data-key：home / charts / radio / library / search） */
const current = (page: Page) => page.locator('.dock [aria-current="page"]').getAttribute('data-key');
/**
 * 露出来的那段玻璃。胶囊和播放台的盒子尺寸固定，收展时玻璃在一层固定的圆角外壳里平移（refresh.css 第 1 节），
 * 看到的形状 = 外壳 ∩ 玻璃。播放台的玻璃在它后面的 .player-skin 里
 */
const glass = (page: Page, which: 'pill' | 'player') => page.evaluate((which) => {
  const shell = which === 'pill' ? '.dock-pill .dock-skin' : '.player-skin';
  const skin = document.querySelector(shell)!.getBoundingClientRect();
  const fill = document.querySelector(`${shell} .dock-skin-fill`)!.getBoundingClientRect();
  const left = Math.max(skin.left, fill.left);
  const right = Math.min(skin.right, fill.right);
  return { x: left, y: skin.top, width: right - left, height: skin.height };
}, which);
/** 收起时左边那颗圆钮就是当前页那一项（点它展开） */
const foldedPill = (page: Page) => page.locator('.dock-pill a.cur');
const lens = async (page: Page) => {
  const [l, on] = await Promise.all([page.locator('.dock-lens').boundingBox(), page.locator('.dock-pill a.cur').boundingBox()]);
  return !!l && !!on && Math.abs(l.x - on.x) < 2 && Math.abs(l.width - on.width) < 2;
};

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-mobile', '安卓手机上的交互');
  await backend(page);
});

test('the bottom dock is one capsule of pages plus one circle for the mini player, all within thumb reach', async ({ page }) => {
  await page.goto('/#/');
  const dock = page.getByRole('navigation', { name: '主导航' }).filter({ has: page.locator('.dock-pill') });
  await expect(dock).toBeVisible();
  // 顶栏不再放导航
  await expect(page.locator('.side .nav')).toBeHidden();
  const search = dock.getByRole('link', { name: '搜索', exact: true });
  const box = (await search.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // 贴在屏幕底部
  expect(box.y + box.height).toBeGreaterThan(vh - 32);
  // 还没放歌：没有右边那颗圆，胶囊占满一行
  await expect(page.locator('.player')).toBeHidden();
  const pill = await glass(page, 'pill');
  expect(pill.width).toBeGreaterThan(width(page) - 40);
  await expect.poll(() => current(page)).toBe('home');

  await search.tap();
  await expect.poll(() => hash(page)).toBe('#/search');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await expect.poll(() => current(page)).toBe('search');
  await expect.poll(() => lens(page)).toBe(true);
  await input.fill('晨光');
  await input.press('Enter');
  await expect.poll(() => hash(page)).toBe(`#/search?q=${encodeURIComponent('晨光')}`);
  await expect(page.locator('.search-songs .track')).toHaveCount(2);

  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/search');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/');
  await expect.poll(() => current(page)).toBe('home');
});

test('scrolling down swaps the capsule and the circle: pages fold into a circle, the mini player opens up', async ({ page }) => {
  await page.goto('/#/search?q=晨光&type=track');
  await page.locator('.track .t').first().click();
  // 放上新歌时底栏先换到播放台那边；换页后回到页面导航
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('.main .page')).toBeVisible();
  // 等切页过渡播完：过渡期间整页盖着快照，手指滚不动主内容区
  await page.waitForTimeout(800);
  const main = page.locator('.main');
  const player = page.locator('.player');
  const sameRow = async () => {
    const [p, pl] = [await glass(page, 'pill'), await glass(page, 'player')];
    return Math.abs(p.y - pl.y) < 4 && Math.abs(p.height - pl.height) < 4 && p.x + p.width <= pl.x + 0.5;
  };

  // 平时：胶囊放页面，右边一颗圆是转着的小唱片，点它打开唱机
  await expect.poll(async () => (await glass(page, 'player')).width).toBeLessThan(80);
  expect(await sameRow()).toBe(true);
  await expect(player.locator('.np-text')).toBeHidden();

  await drag(page, { x: 200, y: 600 }, { x: 206, y: 250 });
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await expect.poll(async () => (await glass(page, 'pill')).width).toBeLessThan(80);
  await expect.poll(async () => (await glass(page, 'player')).width).toBeGreaterThan(220);
  // 还是一行两个：左边一颗圆（只剩当前页图标），右边完整的播放台
  await expect.poll(sameRow).toBe(true);
  await expect(player.locator('.np-text')).toBeVisible();
  // 那颗圆里只剩当前页的图标，正好在圆心
  await expect.poll(async () => {
    const [p, icon] = [await glass(page, 'pill'), (await page.locator('.dock-pill a.cur svg').boundingBox())!];
    return Math.abs(p.x + p.width / 2 - (icon.x + icon.width / 2)) < 1 && Math.abs(p.y + p.height / 2 - (icon.y + icon.height / 2)) < 1;
  }).toBe(true);
  await expect(player.getByRole('button', { name: '暂停', exact: true })).toBeVisible();

  // 点那颗圆钮：展开，不跳页
  await foldedPill(page).tap();
  await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');
  expect(await hash(page)).toBe('#/');
  await expect.poll(async () => (await glass(page, 'pill')).width).toBeGreaterThan(200);

  // 再往下翻收起，往回翻展开
  await drag(page, { x: 200, y: 600 }, { x: 206, y: 250 });
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await drag(page, { x: 200, y: 300 }, { x: 206, y: 520 });
  await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');

  // 换页时总是展开
  await drag(page, { x: 200, y: 600 }, { x: 206, y: 250 });
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await main.evaluate(() => (location.hash = '#/charts'));
  await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');
});

test('mobile navigation stays above the page throughout the route transition', async ({ page }) => {
  await page.goto('/#/');
  const charts = page.locator('.dock [data-key="charts"]');
  await expect(charts).toBeVisible();
  const layers = await charts.evaluate(link => new Promise<{
    name: string; page: number; hero: number; nav: number; deck: number; blur: string;
  }>(resolve => {
    function capture(event: AnimationEvent) {
      if (event.animationName !== 'vt-page-in') return;
      document.removeEventListener('animationstart', capture);
      const root = document.documentElement;
      const group = (name: string) => getComputedStyle(root, `::view-transition-group(${name})`);
      const z = (name: string) => Number.parseInt(group(name).zIndex, 10) || 0;
      resolve({ name: getComputedStyle(link.closest('.dock-pill')!).viewTransitionName,
        page: z('page'), hero: z('hero'), nav: z('mobile-nav'), deck: z('deck'),
        blur: group('mobile-nav').backdropFilter });
    }
    document.addEventListener('animationstart', capture);
    (link as HTMLAnchorElement).click();
  }));
  expect(layers.name).toBe('mobile-nav');
  expect(layers.nav).toBeGreaterThan(Math.max(layers.page, layers.hero));
  expect(layers.nav).toBeLessThan(layers.deck);
  expect(layers.blur).toContain('blur(24px)');
  await expect.poll(() => lens(page)).toBe(true);
});

/**
 * 逐帧记下底栏：右边那张小唱片的圆心、播放台盒子自己的底色、两块玻璃露出来的范围，以及 data-vt / data-deck-anim。
 * 过渡（切页、开合唱机）结束后底栏要原样停着：唱片不能从导航那边横穿回来，播放台盒子不能露出一条长底色（#18）
 */
const recordFrames = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __dock: unknown[]; __dockStop?: () => void };
  w.__dockStop?.();
  w.__dock = [];
  let on = true;
  w.__dockStop = () => { on = false; };
  const visible = (shell: string) => {
    const s = document.querySelector(shell);
    const f = document.querySelector(`${shell} .dock-skin-fill`);
    if (!s || !f || !(s as HTMLElement).offsetWidth) return null;
    const [a, b] = [s.getBoundingClientRect(), f.getBoundingClientRect()];
    return { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right) };
  };
  const loop = () => {
    if (!on) return;
    const root = document.documentElement;
    const player = document.querySelector<HTMLElement>('.player');
    const disc = document.querySelector('.player:not(.np-open) [aria-label="打开正在播放"]')?.getBoundingClientRect();
    const flight = document.querySelector('.disc-flight')?.getBoundingClientRect();
    const bg = player ? getComputedStyle(player).backgroundColor : '';
    w.__dock.push({
      vt: root.dataset.vt ?? '', deck: root.dataset.deckAnim ?? '', min: root.dataset.dock === 'min',
      open: !!player?.classList.contains('np-open'),
      disc: disc?.width ? disc.left + disc.width / 2 : null,
      flight: flight?.width ? flight.left + flight.width / 2 : null,
      boxFill: bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? player!.getBoundingClientRect().width : 0,
      pill: visible('.dock-pill .dock-skin'), bar: visible('.player-skin'),
      // 过渡期间胶囊自己画玻璃（盒子就是露出来的那段）
      pillRight: root.dataset.vt ? document.querySelector('.dock-pill')!.getBoundingClientRect().right : (visible('.dock-pill .dock-skin')?.right ?? null),
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
type DockFrame = { vt: string; deck: string; min: boolean; open: boolean; disc: number | null; flight: number | null; boxFill: number; pillRight: number | null;
  pill: { left: number; right: number } | null; bar: { left: number; right: number } | null };
/** 等 ms 毫秒（至少覆盖过渡结束后 0.7 秒），停止记录并取回 */
const framesAfter = async (page: Page, ms = 1700) => {
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const w = window as unknown as { __dock: DockFrame[]; __dockStop?: () => void };
    w.__dockStop?.();
    return w.__dock;
  });
};
/** 平时（不在过渡里）的每一帧：唱片停在 rest，播放台盒子不画底色，两块玻璃左右分开 */
const expectSettled = (frames: DockFrame[], rest: number) => {
  const plain = frames.filter((f) => !f.vt && !f.deck && !f.open);
  expect(plain.length).toBeGreaterThan(20);
  for (const f of plain) {
    expect(f.disc, JSON.stringify(f)).not.toBeNull();
    expect(Math.abs(f.disc! - rest), JSON.stringify(f)).toBeLessThan(2);
    expect(f.boxFill, JSON.stringify(f)).toBe(0);
    if (f.pill && f.bar) expect(f.pill.right, JSON.stringify(f)).toBeLessThan(f.bar.left);
  }
};
const playThenHome = async (page: Page) => {
  await page.goto('/#/search?q=晨光&type=track');
  await page.locator('.track .t').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');
  await expect(page.locator('html')).not.toHaveAttribute('data-vt');
  await page.waitForTimeout(800);
  const disc = (await page.getByRole('button', { name: '打开正在播放' }).boundingBox())!;
  return disc.x + disc.width / 2;
};

test('switching pages, opening details and closing the record player leave the dock where it was', async ({ page }) => {
  const rest = await playThenHome(page);
  const dock = page.locator('.dock');

  // 切一级页面，再切回来
  await recordFrames(page);
  await dock.locator('[data-key="charts"]').tap();
  expectSettled(await framesAfter(page), rest);
  await recordFrames(page);
  await dock.locator('[data-key="home"]').tap();
  expectSettled(await framesAfter(page), rest);

  // 首页 → 歌单详情 → 返回（不是点底栏进的新页面）
  await recordFrames(page);
  await page.locator('.main .card .sleeve').first().tap();
  await expect(page.locator('.detail-title')).toHaveText('本期精选');
  expectSettled(await framesAfter(page), rest);
  await recordFrames(page);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/');
  const back = await framesAfter(page);
  expectSettled(back, rest);
  // 返回时滚回离开时的位置，那一下不是手指翻的：底栏不收起
  expect(back.some((f) => f.min)).toBe(false);

  // 开唱机、关唱机：唱片飞回右边那颗圆，落地后不再挪
  await page.getByRole('button', { name: '打开正在播放' }).tap();
  await expect(page.locator('.nowplaying')).toHaveClass(/open/);
  await expect(page.locator('html')).not.toHaveAttribute('data-vt');
  await recordFrames(page);
  await page.locator('.np-head').getByRole('button', { name: /收起/ }).click();
  expectSettled(await framesAfter(page), rest);

  // 快速连点：过渡还没播完又点别的标签
  await recordFrames(page);
  await dock.locator('[data-key="radio"]').tap();
  await dock.locator('[data-key="library"]').tap();
  await page.waitForTimeout(150);
  await dock.locator('[data-key="home"]').tap();
  expectSettled(await framesAfter(page, 2200), rest);
});

test('tapping a tab or the record does not stretch the capsule over the record first', async ({ page }) => {
  await playThenHome(page);
  const right = await page.evaluate(() => Math.min(document.querySelector('.dock-pill .dock-skin')!.getBoundingClientRect().right, document.querySelector('.dock-pill .dock-skin-fill')!.getBoundingClientRect().right));
  const check = (frames: DockFrame[]) => {
    expect(frames.some((f) => f.vt)).toBe(true);
    // 过渡快照显示期间也算：右沿不能先伸到唱片那边再缩回来（#23）
    for (const f of frames.filter((x) => x.pillRight != null && !x.min)) expect(f.pillRight!, JSON.stringify(f)).toBeLessThan(right + 1);
  };
  await recordFrames(page);
  await page.locator('.dock [data-key="charts"]').tap();
  check(await framesAfter(page));
  await recordFrames(page);
  await page.getByRole('button', { name: '打开正在播放' }).tap();
  await expect(page.locator('.nowplaying')).toHaveClass(/open/);
  check(await framesAfter(page));
});

test('the dock shadow has no hard vertical seams', async ({ page }) => {
  await playThenHome(page);
  // 纯色背景，只看底栏下面的投影（#24：拼缝处原来有一道明暗突变）
  await page.addStyleTag({ content: '.main, .side, .np-glow, .vinyl { visibility: hidden !important } html, body, .app { background: #eeeeea !important; background-image: none !important }' });
  for (const folded of [false, true]) {
    // 主内容区藏起来了手指拖不动：直接滚它（收展跟着滚动事件走）
    if (folded) await page.evaluate(async () => { const m = document.querySelector('.main') as HTMLElement; for (let i = 1; i <= 10; i++) { m.scrollTop = i * 40; await new Promise((r) => setTimeout(r, 30)); } });
    if (folded) await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
    else await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');
    await page.waitForTimeout(900);
    const dock = (await page.locator('.dock').boundingBox())!;
    const vw = page.viewportSize()!;
    const y0 = Math.ceil(dock.y + dock.height + 1);
    const png = await page.screenshot({ clip: { x: 0, y: y0, width: vw.width, height: vw.height - y0 } });
    const step = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let worst = 0;
      for (let i = 4; i < d.length; i += 4) if ((i / 4) % c.width) worst = Math.max(worst, ...[0, 1, 2].map((k) => Math.abs(d[i + k] - d[i - 4 + k])));
      return worst;
    }, png.toString('base64'));
    // 拼缝处原来一跳 4~8 级（深色主题 23 级）；平滑的投影相邻像素只差一两级
    expect(step, folded ? 'folded' : 'unfolded').toBeLessThan(4);
  }
});

test('the scroll fold still animates instead of snapping', async ({ page }) => {
  await playThenHome(page);
  await recordFrames(page);
  await drag(page, { x: 200, y: 600 }, { x: 206, y: 250 });
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  const frames = await framesAfter(page, 300);
  const widths = frames.filter((f) => f.pill).map((f) => f.pill!.right - f.pill!.left);
  const [lo, hi] = [Math.min(...widths), Math.max(...widths)];
  expect(hi - lo).toBeGreaterThan(150);
  // 中间有过渡帧：不是一下子跳过去
  expect(widths.filter((w) => w > lo + 20 && w < hi - 20).length).toBeGreaterThan(3);
});

test.describe('iPhone', () => {
  test.use({ userAgent: devices['iPhone 13'].userAgent });

  test('closing the record player flies the record back onto the circle and it stays put', async ({ page }) => {
    const rest = await playThenHome(page);
    await expect(page.locator('html')).toHaveAttribute('data-device', 'iphone');
    await page.getByRole('button', { name: '打开正在播放' }).tap();
    await expect(page.locator('.nowplaying')).toHaveClass(/open/);
    await expect(page.locator('html')).not.toHaveAttribute('data-deck-anim');
    await recordFrames(page);
    await page.locator('.np-head').getByRole('button', { name: /收起/ }).click();
    const frames = await framesAfter(page);
    expect(frames.some((f) => f.deck === 'np-close')).toBe(true);
    // 复制的唱片落在真唱片上（以前对准的是换歌滑入动画的起点，落地后错开 18px）
    const flights = frames.filter((f) => f.flight != null);
    expect(flights.length).toBeGreaterThan(5);
    expect(Math.abs(flights.at(-1)!.flight! - rest)).toBeLessThan(2);
    // 飞行期间真唱片就在终点等着，不滑
    for (const f of frames.filter((x) => x.deck && !x.open)) expect(Math.abs(f.disc! - rest), JSON.stringify(f)).toBeLessThan(2);
    expectSettled(frames, rest);

    // iPhone 上返回详情页（视图过渡）同样不动
    await recordFrames(page);
    await page.locator('.main .card .sleeve').first().tap();
    await expect(page.locator('.detail-title')).toHaveText('本期精选');
    expectSettled(await framesAfter(page), rest);
    await recordFrames(page);
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/');
    const back = await framesAfter(page);
    expectSettled(back, rest);
    expect(back.some((f) => f.min)).toBe(false);
  });
});

test('HarmonyOS safe-area injection keeps both dock states aligned and tappable', async ({ page }, info) => {
  await page.goto('/#/search?q=晨光&type=track');
  await page.locator('.track .t').first().click();
  // Existing HarmonyOS clients append WebLayout.ets styles after the site's CSS.
  await page.addStyleTag({ content: `
    :root { --harmony-safe-left: 16px; --harmony-safe-right: 24px; --harmony-safe-bottom: 18px; }
    body { padding-inline: var(--harmony-safe-left) var(--harmony-safe-right); }
    .app .player { bottom: max(var(--deck-gap), var(--harmony-safe-bottom));
      left: max(var(--deck-gap), var(--harmony-safe-left)); right: max(var(--deck-gap), var(--harmony-safe-right)); }
  ` });
  const pill = page.locator('.dock-pill');
  const player = page.locator('.player');
  const { width, height } = page.viewportSize()!;
  const assertDock = async (folded: boolean) => {
    const y = height - 18 - 12 - 62;
    await expect.poll(async () => {
      const [nav, bar] = [await glass(page, 'pill'), await glass(page, 'player')];
      return Math.abs(nav.x - 16) < 1 && Math.abs(bar.x + bar.width - (width - 24)) < 1 &&
        Math.abs(nav.y - y) < 1 && Math.abs(bar.y - y) < 1 && nav.height === 62 && bar.height === 62 &&
        Math.abs(bar.x - nav.x - nav.width - 10) < 1 && Math.abs((folded ? nav : bar).width - 62) < 1;
    }).toBe(true);
    await info.attach(folded ? 'harmony-folded.png' : 'harmony-expanded.png', {
      body: await page.screenshot({ clip: { x: 0, y: y - 12, width, height: height - y + 12 } }), contentType: 'image/png'
    });
  };
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  await assertDock(true);
  await foldedPill(page).tap();
  await assertDock(false);
  await pill.locator('[data-key="home"]').tap();
  await expect.poll(() => hash(page)).toBe('#/');
  await player.locator('.mini-vinyl').tap();
  await expect(page.locator('.nowplaying')).toHaveClass(/\bopen\b/);
});

test('swiping the main area moves between neighbouring top-level pages', async ({ page }) => {
  await page.goto('/#/');
  await expect.poll(() => current(page)).toBe('home');

  // 首页往右划：没有上一页，原地弹回
  await swipeRight(page);
  expect(await hash(page)).toBe('#/');
  await expect(page.locator('.main > .page').first()).toHaveAttribute('style', /^(?!.*translate)/);

  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/charts');
  await expect.poll(() => current(page)).toBe('charts');
  // 镜片跟着滑到「榜单」
  await expect.poll(() => lens(page)).toBe(true);

  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/radio');
  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/library');
  await expect.poll(() => current(page)).toBe('library');
  // 底栏最后是搜索
  await swipeLeft(page);
  await expect.poll(() => hash(page)).toBe('#/search');
  await expect.poll(() => current(page)).toBe('search');
  // 最后一页往左划：拉不动
  await swipeLeft(page, 600);
  expect(await hash(page)).toBe('#/search');

  await swipeRight(page, 600);
  await expect.poll(() => hash(page)).toBe('#/library');

  // 返回键按来时的顺序退回去
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/search');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/library');
});

test('vertical scroll, horizontal rails, screen edges, inputs and detail pages keep their own gestures', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('.main .page')).toBeVisible();
  const main = page.locator('.main');

  // 竖着划：照常滚动，不切页
  const tabReads = await page.evaluateHandle(() => {
    const reads = { count: 0 };
    document.querySelectorAll<HTMLAnchorElement>('.dock-pill a').forEach((tab) => {
      const measure = tab.getClientRects.bind(tab);
      tab.getClientRects = () => {
        reads.count++;
        return measure();
      };
    });
    return reads;
  });
  await drag(page, { x: 200, y: 640 }, { x: 214, y: 300 });
  expect(await tabReads.evaluate((reads) => reads.count)).toBe(0);
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

  // 详情页（不是一级导航）不响应横滑；底栏仍亮着来时那一项
  await page.goto('/#/charts');
  await expect(page.locator('.dock-pill a.cur')).toHaveAttribute('data-key', 'charts');
  await page.evaluate(() => (location.hash = '#/playlist/p1'));
  await expect(page.getByRole('heading', { name: '本期精选' })).toBeVisible();
  await expect(page.locator('.dock-pill a.cur')).toHaveAttribute('data-key', 'charts');
  await swipeLeft(page, 600);
  await swipeRight(page, 600);
  expect(await hash(page)).toBe('#/playlist/p1');

  // 搜索框里横划：是在挪光标，不切页
  await page.goto('/#/search');
  const input = (await page.getByRole('combobox').boundingBox())!;
  await drag(page, { x: input.x + input.width - 30, y: input.y + input.height / 2 }, { x: input.x + 30, y: input.y + input.height / 2 + 2 });
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
  // 放上新歌：底栏换到播放台那边，暂停键就在手边
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-dock', 'min');
  // 点左边那颗圆换回页面导航，再去「本期」
  await foldedPill(page).tap();
  await expect(page.locator('html')).not.toHaveAttribute('data-dock', 'min');
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
