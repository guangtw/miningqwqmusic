import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { migrateStorage } from '@/src/frontend/lib/migrate-storage';

const track = { id: '101', name: '保留的收藏', artists: [{ id: 'a1', name: '艺人' }], durationMs: 30000 };
const success = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('frontend device migration', () => {
  it('copies favorites, history, queue, volume and quality without overwriting new data', () => {
    localStorage.setItem('qwq-music-store-v1', JSON.stringify({ state: {
      favorites: { '101': track }, recent: [track], queue: [track], currentIndex: 0,
      mode: 'loop-one', volume: 0.4, playQualityLevel: 'lossless',
    } }));
    migrateStorage(localStorage);
    expect(JSON.parse(localStorage.getItem('cph.player.v2')!)).toMatchObject({ queue: [track], index: 0, volume: 0.4, mode: 'one' });
    expect(JSON.parse(localStorage.getItem('cph.settings.v2')!)).toMatchObject({ quality: 'lossless' });
    expect(JSON.parse(localStorage.getItem('cph.library')!).favorites).toEqual({ '101': track });
    localStorage.setItem('cph.library', JSON.stringify({ favorites: {} }));
    migrateStorage(localStorage);
    expect(JSON.parse(localStorage.getItem('cph.library')!).favorites).toEqual({});
  });

  it('ignores corrupt storage and tolerates blocked storage', () => {
    localStorage.setItem('qwq-music-store-v1', '{');
    expect(() => migrateStorage(localStorage)).not.toThrow();
    const blocked = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => migrateStorage(blocked)).not.toThrow();
  });
});

describe('frontend account bridge', () => {
  it('keeps a signed-in account during a temporary refresh outage and recovers', async () => {
    let online = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) return online ? success({ accessToken: 'recovered' })
        : new Response(JSON.stringify({ code: 5403, message: 'unavailable' }), { status: 503 });
      if (url.endsWith('/auth/me')) return success({ user: { id: 'u1', email: 'listener@example.com' } });
      return success({ favorites: {}, recent: [], revision: 1 });
    }));
    const account = await import('@/src/frontend/lib/account');
    account.authStore.set({ status: 'authenticated', token: 'existing', user: { id: 'u1', email: 'listener@example.com' } });
    await account.restoreSession();
    expect(account.authStore.get()).toMatchObject({ status: 'authenticated', token: 'existing' });
    online = true;
    await account.restoreSession();
    expect(account.authStore.get()).toMatchObject({ status: 'authenticated', token: 'recovered' });
  });

  it('recovers an initially offline session on the online event', async () => {
    let online = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!online) throw new Error('offline');
      if (url.endsWith('/auth/refresh')) return success({ accessToken: 'recovered', user: { id: 'u1', email: 'listener@example.com' } });
      if (url.endsWith('/auth/me')) return success({});
      return success({ favorites: {}, recent: [], revision: 1 });
    }));
    const account = await import('@/src/frontend/lib/account');
    const stop = account.watchSessionRecovery();
    try {
      await account.restoreSession();
      expect(account.authStore.get().status).toBe('checking');
      online = true;
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(account.authStore.get().status).toBe('authenticated'));
    } finally { stop(); }
  });

  it('does not resurrect a logged-out account from an in-flight refresh', async () => {
    let resolveRefresh!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/refresh')
      ? new Promise<Response>((resolve) => { resolveRefresh = resolve; }) : Promise.resolve(success({}))));
    const account = await import('@/src/frontend/lib/account');
    const restoring = account.restoreSession();
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf('function'));
    const loggingOut = account.logout();
    resolveRefresh(success({ accessToken: 'late', user: { id: 'u1', email: 'listener@example.com' } }));
    await Promise.all([restoring, loggingOut]);
    expect(account.authStore.get()).toMatchObject({ status: 'guest', token: null, user: null });
  });

  it('retries a playback request with the refreshed bearer token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return success({ accessToken: 'fresh' });
      if (new Headers(init?.headers).get('authorization') === 'Bearer fresh') return success({ url: '/audio' });
      return new Response(JSON.stringify({ code: 5203, message: '会话失效', traceId: 'unit' }), { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { authStore } = await import('@/src/frontend/lib/account');
    authStore.set({ status: 'authenticated', token: 'expired' });
    const { music } = await import('@/src/frontend/api/music');
    await expect(music.playUrl('101', 'exhigh')).resolves.toMatchObject({ url: '/audio' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/music/track/101/play-url?level=exhigh&unblockMode=auto', '/api/account/auth/refresh', '/api/music/track/101/play-url?level=exhigh&unblockMode=auto',
    ]);
  });

  it.each(['auto', 'force_on', 'force_off'] as const)('passes the %s source mode and cancellation through the frontend playback API', async mode => {
    const fetchMock = vi.fn(async () => success({ url: '/audio' }));
    vi.stubGlobal('fetch', fetchMock);
    const { music } = await import('@/src/frontend/api/music');
    const controller = new AbortController();
    await music.playUrl('101', 'jymaster', 'member', controller.signal, mode);
    const [url, init] = fetchMock.mock.calls.find(call => String((call as unknown[])[0]).includes('/play-url')) as unknown as [string, RequestInit];
    const query = new URL(url, 'http://localhost').searchParams;
    expect(query.get('level')).toBe('jymaster');
    expect(query.get('unblockMode')).toBe(mode);
    expect(init.signal).toBe(controller.signal);
  });

  it('keeps a failed cloud deletion and retries it without resurrecting the favorite', async () => {
    localStorage.setItem('cph.library', JSON.stringify({ favorites: { '101': track }, favoriteOrder: ['101'], recent: [] }));
    let offline = true;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/library/snapshot')) return success({ favorites: { '101': track }, recent: [], revision: 1 });
      if (init?.method === 'DELETE' && offline) throw new Error('offline');
      return success({ revision: 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const account = await import('@/src/frontend/lib/account');
    account.authStore.set({ status: 'authenticated', token: 'token', user: { id: 'u1', email: 'test@example.com' } });
    await account.toggleFavorite(track);
    expect(account.libraryStore.get().pendingFavorites).toEqual({ '101': false });
    offline = false;
    await account.pullLibrary({ force: true });
    expect(account.libraryStore.get().favorites).toEqual({});
    expect(account.libraryStore.get().pendingFavorites).toEqual({});
  });

  it('preserves old imported playlists on subsequent library writes', async () => {
    const importedPlaylists = { p1: { id: 'p1', name: '旧歌单', tracks: [track] } };
    localStorage.setItem('cph.library', JSON.stringify({ importedPlaylists }));
    const account = await import('@/src/frontend/lib/account');
    account.pushRecent(track);
    expect(JSON.parse(localStorage.getItem('cph.library')!).importedPlaylists).toEqual(importedPlaylists);
  });
});

it('clearing a queue invalidates an in-flight play URL response', async () => {
  let resolveSource!: (response: Response) => void;
  let audio!: FakeAudio;
  class FakeAudio extends EventTarget {
    src = ''; preload = ''; volume = 1; paused = true; currentTime = 0;
    constructor() { super(); audio = this; }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
    load() {}
    removeAttribute() { this.src = ''; }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/play-url')
    ? new Promise<Response>((resolve) => { resolveSource = resolve; })
    : Promise.resolve(success({ trackId: '101', lines: [] }))));
  const account = await import('@/src/frontend/lib/account');
  account.authStore.set({ status: 'guest' });
  const player = await import('@/src/frontend/player/player');
  player.playList([track]);
  await vi.waitFor(() => expect(resolveSource).toBeTypeOf('function'));
  player.clearQueue();
  resolveSource(success({ trackId: '101', url: '/stale-audio', ttlSeconds: 60 }));
  await vi.waitFor(() => expect(player.playerStore.get().queue).toEqual([]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(audio.src).toBe('');
  expect(audio.paused).toBe(true);
  expect(player.playerStore.get().index).toBe(-1);
});
