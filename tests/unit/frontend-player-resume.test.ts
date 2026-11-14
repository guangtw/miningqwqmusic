import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// issue #7：安卓上听着听着没声、重开后从头放
const f = vi.hoisted(() => ({
  source: vi.fn(), toast: vi.fn(),
  ApiError: class extends Error {
    constructor(message: string, readonly code = 0, readonly status = 0, readonly traceId?: string, readonly retryable = false) {
      super(message);
    }
  },
}));
vi.mock('@/src/frontend/api', () => ({
  ApiError: f.ApiError, coverOf: () => '',
  music: { playUrl: f.source, lyric: async () => ({ lines: [] }) }
}));
vi.mock('@/src/frontend/lib/account', () => ({
  authStore: { get: () => ({ user: { id: 'me' }, status: 'authenticated' }), subscribe: () => () => {} }, pushRecent: () => {}
}));
vi.mock('@/src/frontend/lib/toast', () => ({ toast: f.toast }));
class FakeAudio extends EventTarget {
  static last: FakeAudio;
  paused = true; currentTime = 0; duration = 180; volume = 1; muted = false; preload = ''; src = '';
  error: { code: number } | null = null;
  constructor() { super(); FakeAudio.last = this; }
  play = vi.fn(async () => { if (this.paused) { this.paused = false; this.dispatchEvent(new Event('play')); } });
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() {}
  removeAttribute() { this.src = ''; }
  getAttribute() { return this.src; }
}
const track = { id: 'one', name: 'One', artists: [{ id: 'a', name: 'Artist' }], durationMs: 180000 };
const RESUME_KEY = 'cph.player.resume.v1';
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); f.toast.mockReset(); vi.stubGlobal('Audio', FakeAudio);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  f.source.mockReset();
  f.source.mockImplementation(async (id: string) => ({ url: `https://example.test/${id}`, preview: false }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const saved = () => JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null');

function reopen(at: number, id = 'one') {
  localStorage.setItem('cph.player.v2', JSON.stringify({ queue: [track], index: 0, volume: 0.8, mode: 'order' }));
  localStorage.setItem(RESUME_KEY, JSON.stringify({ id, at }));
  return import('@/src/frontend/player/player');
}

async function playing() {
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.advanceTimersByTimeAsync(1000);
  return { player, audio: FakeAudio.last };
}

it('reopening the app resumes the last position instead of starting over', async () => {
  const player = await reopen(73_000);
  expect(player.playerStore.get().position).toBe(73_000);
  player.toggle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(FakeAudio.last.src).toBe('https://example.test/one');
  expect(FakeAudio.last.currentTime).toBe(73);
  expect(FakeAudio.last.paused).toBe(false);
});

it('starts over when the saved position belongs to another song or the song had finished', async () => {
  let player = await reopen(73_000, 'two');
  expect(player.playerStore.get().position).toBe(0);
  player.toggle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(FakeAudio.last.currentTime).toBe(0);

  vi.resetModules();
  player = await reopen(178_000);
  expect(player.playerStore.get().position).toBe(0);
});

it('picking another song drops the saved position', async () => {
  const player = await reopen(73_000);
  player.playList([{ ...track, id: 'two' }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(FakeAudio.last.src).toBe('https://example.test/two');
  expect(FakeAudio.last.currentTime).toBe(0);
});

it('keeps the position on disk while playing, on pause and when the page is hidden', async () => {
  const { player, audio } = await playing();
  audio.currentTime = 42;
  await vi.advanceTimersByTimeAsync(5000);
  audio.dispatchEvent(new Event('timeupdate'));
  expect(saved()).toEqual({ id: 'one', at: 42_000 });

  audio.currentTime = 43;
  audio.dispatchEvent(new Event('timeupdate'));
  expect(saved().at).toBe(42_000); // 节流：不会每次 timeupdate 都写

  audio.currentTime = 50;
  window.dispatchEvent(new Event('pagehide'));
  expect(saved().at).toBe(50_000);

  audio.currentTime = 61;
  player.toggle();
  await vi.advanceTimersByTimeAsync(500);
  expect(audio.paused).toBe(true);
  expect(saved().at).toBe(61_000);
});

it('reconnects from the same spot when buffering hangs', async () => {
  const { audio } = await playing();
  expect(f.source).toHaveBeenCalledTimes(1);
  audio.currentTime = 95;
  audio.dispatchEvent(new Event('waiting'));
  await vi.advanceTimersByTimeAsync(11_000);
  expect(f.source).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(2);
  expect(audio.currentTime).toBe(95);
  expect(audio.paused).toBe(false);
});

it('does not reconnect when playback recovers on its own or the user paused', async () => {
  const { player, audio } = await playing();
  audio.dispatchEvent(new Event('waiting'));
  await vi.advanceTimersByTimeAsync(3000);
  audio.dispatchEvent(new Event('playing'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.source).toHaveBeenCalledTimes(1);

  audio.dispatchEvent(new Event('waiting'));
  player.toggle();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.source).toHaveBeenCalledTimes(1);
});

it('reconnects at once when the network comes back', async () => {
  const { audio } = await playing();
  audio.currentTime = 30;
  audio.dispatchEvent(new Event('waiting'));
  await vi.advanceTimersByTimeAsync(2000);
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(2);
  expect(audio.currentTime).toBe(30);
});

it('gives up after a few reconnects, says so, and the next tap continues from there', async () => {
  const { player, audio } = await playing();
  audio.currentTime = 120;
  for (let i = 0; i < 4; i++) {
    audio.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(13_000);
  }
  expect(f.source).toHaveBeenCalledTimes(4);
  expect(f.toast).toHaveBeenLastCalledWith('网络不太稳，播放停在这里了。点播放键接着放。');
  expect(player.playerStore.get().playing).toBe(false);
  expect(player.playerStore.get().loading).toBe(false);

  player.toggle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(5);
  expect(audio.currentTime).toBe(120);
  expect(audio.paused).toBe(false);
});

it('a network error after the URL was already renewed is retried rather than dropped', async () => {
  const { audio } = await playing();
  audio.currentTime = 10;
  audio.dispatchEvent(new Event('error'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(2);
  audio.error = { code: 2 };
  audio.dispatchEvent(new Event('error'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(3);
  expect(f.toast).not.toHaveBeenCalled();
});

it('tells the user when the system refuses to start playback', async () => {
  const { player, audio } = await playing();
  player.toggle();
  await vi.advanceTimersByTimeAsync(500);
  audio.play.mockImplementationOnce(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
  player.toggle();
  await vi.advanceTimersByTimeAsync(0);
  expect(player.playerStore.get().playing).toBe(false);
  expect(player.isPlaybackIntended()).toBe(false);
  expect(f.toast).toHaveBeenCalledWith('系统拦下了播放，点一下播放键继续。');
});

it('stays quiet when play() is merely interrupted', async () => {
  const { player, audio } = await playing();
  player.toggle();
  await vi.advanceTimersByTimeAsync(500);
  audio.play.mockImplementationOnce(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
  player.toggle();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.toast).not.toHaveBeenCalled();
});

// ---- 二姐评审补出来的场景 ----
const offline = () => new f.ApiError('连不上服务，检查一下网络。', 5000, 0, undefined, true);

async function stuckAt(seconds: number) {
  const ctx = await playing();
  ctx.audio.currentTime = seconds;
  ctx.audio.dispatchEvent(new Event('waiting'));
  return ctx;
}

it('if fetching a new URL fails while reconnecting, it waits and reconnects once the network is back', async () => {
  const { player, audio } = await stuckAt(95);
  f.source.mockRejectedValueOnce(offline());
  await vi.advanceTimersByTimeAsync(13_000);
  expect(f.source).toHaveBeenCalledTimes(2);
  expect(player.isPlaybackIntended()).toBe(true);
  expect(player.playerStore.get().loading).toBe(true);

  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(3);
  expect(audio.currentTime).toBe(95);
  expect(audio.paused).toBe(false);
});

it('a manual retry after a failed reconnect continues from where it stopped', async () => {
  // 取地址直接失败（不可重试）：停下提示，按播放从 95 秒接着放
  let { player, audio } = await stuckAt(95);
  f.source.mockRejectedValueOnce(new f.ApiError('服务出错了', 5000, 500));
  await vi.advanceTimersByTimeAsync(13_000);
  expect(player.playerStore.get().playing).toBe(false);
  expect(player.playerStore.get().loading).toBe(false);
  player.toggle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(3);
  expect(audio.currentTime).toBe(95);
  expect(audio.paused).toBe(false);

  // 断网等着重连时用户先按暂停、再按播放：同样接着放
  vi.resetModules(); f.source.mockClear();
  ({ player, audio } = await stuckAt(140));
  f.source.mockRejectedValueOnce(offline());
  await vi.advanceTimersByTimeAsync(13_000);
  player.toggle();
  expect(player.isPlaybackIntended()).toBe(false);
  expect(player.playerStore.get().loading).toBe(false);
  player.toggle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(audio.currentTime).toBe(140);
  expect(audio.paused).toBe(false);
});

it('pausing while stuck is not undone when the network comes back mid-fade', async () => {
  const { player, audio } = await stuckAt(30);
  player.toggle(); // 正在淡出
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.source).toHaveBeenCalledTimes(1);
  expect(audio.paused).toBe(true);
  expect(player.playerStore.get().playing).toBe(false);
});

it('keeps watching when playback inches forward and then sticks again', async () => {
  const { audio } = await stuckAt(95);
  await vi.advanceTimersByTimeAsync(5000);
  audio.currentTime = 96; // 挪了一秒，没有新的 waiting
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.source).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(13_000);
  expect(f.source).toHaveBeenCalledTimes(2);
  expect(audio.currentTime).toBe(96);
});

it('does not reconnect a slow stream that is still downloading', async () => {
  const { audio } = await stuckAt(50);
  for (let i = 0; i < 30; i++) {
    audio.dispatchEvent(new Event('progress'));
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(f.source).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(f.source).toHaveBeenCalledTimes(2);
});

it('an error from the old source while a new URL is being fetched does not start a second request', async () => {
  const { audio } = await stuckAt(70);
  let release!: () => void;
  f.source.mockImplementationOnce((id: string) => new Promise((r) => { release = () => r({ url: `https://example.test/${id}?2`, preview: false }); }));
  await vi.advanceTimersByTimeAsync(13_000);
  expect(f.source).toHaveBeenCalledTimes(2);
  audio.error = { code: 2 };
  audio.dispatchEvent(new Event('error'));
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(2);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(audio.src).toBe('https://example.test/one?2');
  expect(audio.currentTime).toBe(70);
  expect(audio.paused).toBe(false);
});
