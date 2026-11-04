import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ source: vi.fn(), recent: vi.fn() }));
vi.mock('@/src/frontend/api', () => ({
  ApiError: class extends Error {
    constructor(message: string, readonly code: number, readonly status: number, readonly traceId?: string, readonly retryable = false, readonly retryAfterSeconds?: number) { super(message); }
  }, coverOf: () => '',
  music: { playUrl: f.source, lyric: async () => ({ lines: [] }) }
}));
vi.mock('@/src/frontend/lib/account', () => ({
  authStore: { get: () => ({ user: { id: 'me' }, status: 'authenticated' }), subscribe: () => () => {} }, pushRecent: f.recent
}));
class FakeAudio extends EventTarget {
  static last: FakeAudio;
  paused = true; currentTime = 0; duration = 180; volume = 1; muted = false; preload = ''; src = '';
  constructor() { super(); FakeAudio.last = this; }
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('play')); });
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute() { this.src = ''; }
  getAttribute() { return this.src; }
}
const track = { id: 'one', name: 'One', artists: [{ id: 'a', name: 'Artist' }], durationMs: 180000 };
const source = { url: 'https://example.test/audio', preview: false };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); f.source.mockReset(); localStorage.clear(); vi.stubGlobal('Audio', FakeAudio); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('stops on upstream cooldown and blocks manual retry until Retry-After expires', async () => {
  vi.useFakeTimers();
  const { ApiError } = await import('@/src/frontend/api');
  f.source.mockRejectedValue(new ApiError('cooling', 2002, 503, undefined, true, 60));
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(player.playerStore.get()).toMatchObject({ loading: false, playing: false });
  expect(f.source).toHaveBeenCalledTimes(1);
  player.next(); await vi.advanceTimersByTimeAsync(59000);
  expect(f.source).toHaveBeenCalledTimes(1);
  f.source.mockResolvedValue(source);
  await vi.advanceTimersByTimeAsync(1001);
  player.next(); await vi.advanceTimersByTimeAsync(0);
  expect(f.source).toHaveBeenCalledTimes(2);
});

it('limits missing-song skips to three attempts with a delay', async () => {
  vi.useFakeTimers();
  const { ApiError } = await import('@/src/frontend/api');
  f.source.mockRejectedValue(new ApiError('missing', 3002, 404));
  const player = await import('@/src/frontend/player/player');
  player.playList(Array.from({ length: 10 }, (_, i) => ({ ...track, id: String(i) })));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.source).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2001);
  expect(f.source).toHaveBeenCalledTimes(3);
  expect(player.playerStore.get()).toMatchObject({ loading: false, playing: false });
});

it('allows a manual switch after a local timeout instead of declaring global recovery', async () => {
  vi.useFakeTimers();
  const { ApiError } = await import('@/src/frontend/api');
  f.source.mockRejectedValueOnce(new ApiError('slow', 2004, 504)).mockResolvedValue(source);
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]); await vi.advanceTimersByTimeAsync(0);
  player.next(); await vi.advanceTimersByTimeAsync(1000);
  expect(f.source).toHaveBeenCalledTimes(2);
  expect(player.playerStore.get()).toMatchObject({ index: 1, playing: true });
});

it('aborts obsolete playback loads and coalesces same-tick switches', async () => {
  f.source.mockResolvedValue(source);
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }, { ...track, id: 'three' }]);
  player.next(); player.next();
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(1));
  expect(f.source.mock.calls[0][0]).toBe('three');
  const signal = f.source.mock.calls[0][3] as AbortSignal;
  player.clearQueue(); expect(signal.aborted).toBe(true);
});

it('honors pause while waiting to skip a missing song', async () => {
  vi.useFakeTimers();
  const { ApiError } = await import('@/src/frontend/api');
  f.source.mockRejectedValue(new ApiError('missing', 3002, 404));
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.advanceTimersByTimeAsync(0);
  player.toggle();
  await vi.advanceTimersByTimeAsync(1001);
  expect(f.source).toHaveBeenCalledTimes(1);
  expect(player.playerStore.get()).toMatchObject({ loading: false, playing: false });
});

it('uses the latest remote seek/pause while one address request is still loading', async () => {
  let resolve!: (value: typeof source) => void;
  f.source.mockReturnValue(new Promise(r => { resolve = r; }));
  const player = await import('@/src/frontend/player/player');
  player.applyRemote({ queue: [track], index: 0, positionMs: 1000, playing: true });
  player.applyRemote({ queue: [track], index: 0, positionMs: 12000, playing: false });
  await Promise.resolve();
  expect(f.source).toHaveBeenCalledTimes(1);
  resolve(source);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  expect(FakeAudio.last.currentTime).toBe(12);
  expect(FakeAudio.last.paused).toBe(true);
});

it('clears audio and invalidates a pending load when the room queue is cleared', async () => {
  let resolve!: (value: typeof source) => void;
  f.source.mockReturnValue(new Promise(r => { resolve = r; }));
  const player = await import('@/src/frontend/player/player');
  player.applyRemote({ queue: [track], index: 0, positionMs: 0, playing: true });
  player.applyRemote({ queue: [], index: -1, positionMs: 0, playing: false });
  resolve(source); await Promise.resolve(); await Promise.resolve();
  expect(player.playerStore.get()).toMatchObject({ queue: [], index: -1, loading: false, playing: false });
  expect(FakeAudio.last.src).toBe('');
});

it('publishes actual downgraded quality and a notice as soon as the address resolves', async () => {
  const settings = await import('@/src/frontend/lib/settings');
  settings.updateSettings({ quality: 'jymaster' });
  f.source.mockResolvedValue({ ...source, level: 'exhigh', requestedLevel: 'jymaster' });
  const player = await import('@/src/frontend/player/player');
  const { toastStore } = await import('@/src/frontend/lib/toast');
  player.playList([track]);
  await vi.waitFor(() => expect(player.playerStore.get().level).toBe('exhigh'));
  expect(player.playerStore.get().level).toBe('exhigh');
  expect(settings.getSettings().quality).toBe('jymaster');
  expect(toastStore.get().message).toContain('极高');
  player.clearQueue();
  expect(player.playerStore.get()).toMatchObject({ level: null });
});

it('clears stale quality on a track change when a response omits its level', async () => {
  f.source.mockResolvedValueOnce({ ...source, level: 'lossless' });
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.waitFor(() => expect(player.playerStore.get().level).toBe('lossless'));
  let resolve!: (value: typeof source) => void;
  f.source.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  player.next();
  expect(player.playerStore.get()).toMatchObject({ level: null });
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(2));
  resolve(source);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  expect(player.playerStore.get().level).toBeNull();
});

it('honors a local pause during address loading and lets only the leader loop automatically', async () => {
  let resolve!: (value: typeof source) => void;
  f.source.mockReturnValue(new Promise(r => { resolve = r; }));
  const player = await import('@/src/frontend/player/player');
  player.playList([track]); player.toggle(); resolve(source);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  expect(FakeAudio.last.paused).toBe(true);
  const action = vi.fn(); player.onPlayerAction(action);
  player.playerStore.set({ mode: 'one' });
  player.setAutoAdvanceGuard(() => false);
  FakeAudio.last.dispatchEvent(new Event('ended'));
  expect(action).not.toHaveBeenCalled();
  player.setAutoAdvanceGuard(() => true);
  FakeAudio.last.dispatchEvent(new Event('ended'));
  expect(action).toHaveBeenCalledWith('seek');
});
