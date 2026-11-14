// 播放器网络场景的测试台：本地可控「CDN」（Range、限速、挂起、强制断开）+ 模拟接口 + 页面内只读观察
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type BrowserContext, type Page } from '@playwright/test';

const RATE_HZ = 8000;
function wav(seconds: number) {
  const len = RATE_HZ * seconds * 2;
  const out = Buffer.alloc(44 + len);
  out.write('RIFF'); out.writeUInt32LE(len + 36, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE_HZ, 24); out.writeUInt32LE(RATE_HZ * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(len, 40);
  for (let i = 0; i < RATE_HZ * seconds; i++) out.writeInt16LE(Math.round(3000 * Math.sin((i / RATE_HZ) * 2 * Math.PI * 440)), 44 + i * 2);
  return out;
}
const files = { long: wav(600), short: wav(8) };
/** 1.1 倍实时：缓冲只比播放快一点，断网后几秒内就会卡住 */
export const NEAR_REALTIME = 17_600;

export class AudioServer {
  /** 0 = 不限速；否则每秒字节数（先快发 burst 字节让 Chromium 起播） */
  rate = 0;
  burst = 300_000;
  /** 连接不断，但不再发数据 */
  hang = false;
  private live = new Set<http.ServerResponse>();
  private srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const body = u.pathname.includes('short') ? files.short : files.long;
    const m = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = m ? +m[1] : 0;
    const end = m?.[2] ? +m[2] : body.length - 1;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Access-Control-Allow-Origin': '*',
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}),
    });
    let pos = start;
    let sent = 0;
    this.live.add(res);
    res.on('close', () => this.live.delete(res));
    const pump = () => {
      if (res.destroyed) return;
      if (this.hang) return void setTimeout(pump, 100);
      if (!this.rate) return void res.end(body.subarray(pos, end + 1));
      const n = Math.min(sent < this.burst ? this.burst - sent : Math.round(this.rate / 10), end + 1 - pos);
      res.write(body.subarray(pos, pos + n));
      pos += n; sent += n;
      if (pos > end) return void res.end();
      setTimeout(pump, 100);
    };
    pump();
  });
  origin = '';
  async start() {
    await new Promise<void>((r) => this.srv.listen(0, '127.0.0.1', r));
    this.origin = `http://127.0.0.1:${(this.srv.address() as AddressInfo).port}`;
  }
  /** 真断网时已建立的连接也活不了 */
  dropAll() { for (const r of this.live) r.destroy(); }
  async stop() { this.dropAll(); await new Promise((r) => this.srv.close(r)); }
}

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c34c2b"/></svg>');
const track = (id: string, name: string, sec: number) => ({ id, name, artists: [{ id: 'a1', name: '测试艺人' }], album: { id: 'b1', name: '测试专辑', coverUrl: cover }, durationMs: sec * 1000, coverUrl: cover });
export const LONG = [track('101', '长曲A', 600), track('102', '长曲B', 600)];
export const SHORT = [track('201', '短曲A', 8), track('202', '短曲B', 8)];

type Reply = () => Promise<void>;
/** 模拟接口；play-url 可设成 ok / hang（挂着不回）/ abort */
export class Api {
  mode: 'ok' | 'hang' | 'abort' = 'ok';
  offline = false;
  calls: string[] = [];
  hung: Reply[] = [];
  release() { const h = this.hung; this.hung = []; h.forEach((f) => void f()); }
}

export type Player = {
  page: Page; context: BrowserContext; api: Api; cdn: AudioServer;
  /** 断网：浏览器离线 + 模拟接口也按断网失败（route 会绕过离线模拟，所以手动对齐）+ 断开已有音频连接 */
  setOffline(v: boolean): Promise<void>;
};

export async function openPlayer(page: Page, cdn: AudioServer, opts: { queue?: unknown[]; mode?: string; resume?: { id: string; at: number } } = {}): Promise<Player> {
  const context = page.context();
  const api = new Api();
  await context.addInitScript(({ queue, mode, resume }) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('cph.player.v2', JSON.stringify({ queue, index: 0, volume: 0.8, mode }));
      if (resume) localStorage.setItem('cph.player.resume.v1', JSON.stringify(resume)); else localStorage.removeItem('cph.player.resume.v1');
    }
    const w = window as unknown as Record<string, unknown> & { __toasts: string[]; __ev: unknown[][]; __ms: Record<string, () => void>; __audio?: HTMLMediaElement };
    w.__toasts = []; w.__ev = []; w.__ms = {};
    // 记下页面注册的系统媒体控制回调：浏览器收到媒体键 / 通知栏按钮时调用的就是它们
    if (navigator.mediaSession) {
      const o = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { w.__ms[a] = h as () => void; return o(a, h); };
    }
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!w.__audio) {
        w.__audio = this;
        for (const e of ['play', 'pause', 'waiting', 'playing', 'ended', 'error'])
          this.addEventListener(e, () => w.__ev.push([Math.round(performance.now()), e, +this.currentTime.toFixed(2), e === 'error' ? this.error?.code : null]));
      }
      return origPlay.call(this);
    };
    new MutationObserver(() => {
      const txt = document.querySelector('.toast')?.textContent?.trim();
      if (txt && w.__toasts.at(-1) !== txt) w.__toasts.push(txt);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, { queue: opts.queue ?? LONG, mode: opts.mode ?? 'order', resume: opts.resume });

  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (api.offline) return route.abort('internetdisconnected');
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data, message: 'ok', traceId: 'e2e' } });
    if (p.endsWith('/play-url')) {
      const id = p.split('/')[4];
      api.calls.push(api.mode);
      const n = api.calls.length;
      const reply = () => ok({ trackId: id, url: `${cdn.origin}/${id.startsWith('2') ? 'short' : 'long'}.wav?id=${id}&n=${n}`, preview: false, ttlSeconds: 3600, level: 'exhigh', resolvedVia: 'primary', access: 'free' }).catch(() => {});
      if (api.mode === 'hang') return void api.hung.push(reply);
      if (api.mode === 'abort') return route.abort('failed');
      return reply();
    }
    if (p.endsWith('/auth/refresh')) return route.fulfill({ status: 401, json: { code: 5203, message: '会话已过期', traceId: 'e2e', retryable: false } });
    if (p.endsWith('/lyric')) return ok({ trackId: p.split('/')[4], lines: [{ timeMs: 0, text: '测试歌词' }] });
    if (p.endsWith('/discover/home')) return ok({ blocks: [], searchAssist: { defaultKeyword: '', hotKeywords: [], suggestions: [] } });
    if (p.endsWith('/quality-options')) return ok({ trackId: p.split('/')[4], availableLevels: ['standard', 'higher', 'exhigh'], fallbackMap: {} });
    if (p.endsWith('/insight')) return ok({ trackId: p.split('/')[4], creators: [], alternatives: [] });
    if (p.endsWith('/toplist')) return ok([]);
    return ok({ items: [], page: 1, pageSize: 30, total: 0 });
  });
  await page.goto('/');
  await page.locator('.play-btn').waitFor();
  return {
    page, context, api, cdn,
    async setOffline(v) { api.offline = v; await context.setOffline(v); if (v) cdn.dropAll(); },
  };
}

export type State = { cur: number; paused: boolean; src: string; label: string; playingBtn: boolean; loading: boolean };
export const state = (page: Page): Promise<State> => page.evaluate(() => {
  const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
  const btn = document.querySelector('.play-btn');
  return {
    cur: a ? +a.currentTime.toFixed(2) : 0, paused: a ? a.paused : true, src: a?.src ?? '',
    label: btn?.getAttribute('aria-label') ?? '', playingBtn: !!btn?.classList.contains('is-playing'), loading: !!btn?.classList.contains('is-loading'),
  };
});
export const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
export const errorCodes = (page: Page) => page.evaluate(() => (window as unknown as { __ev: unknown[][] }).__ev.filter((e) => e[1] === 'error').map((e) => e[3]));

/** 等到真的在出声：没暂停、不在加载、进度超过 minCur */
export async function expectSounding(page: Page, minCur: number, timeout = 30_000) {
  await expect.poll(async () => { const s = await state(page); return !s.paused && !s.loading && s.cur > minCur; }, { timeout, intervals: [500] }).toBe(true);
  return state(page);
}
export async function expectToast(page: Page, text: string, timeout = 60_000) {
  await expect.poll(async () => (await toasts(page)).some((t) => t.includes(text)), { timeout, intervals: [500] }).toBe(true);
}
/** 断网后等到真的卡住：出现 waiting 且进度不再动 */
export async function expectStuck(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as unknown as { __ev: unknown[][] }).__ev.some((e) => e[1] === 'waiting' && (e[2] as number) > 1), null, { timeout });
}
/** 在 ms 毫秒内不断采样，确认条件始终成立（用来断言「这段时间里没有自己出声 / 没有乱发请求」） */
export async function holdsFor(page: Page, ms: number, check: (s: State) => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state(page);
    if (!check(s)) return s;
    await page.waitForTimeout(500);
  }
  return null;
}
