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

it.each(['lossless', 'hires', 'jyeffect', 'sky', 'dolby', 'jymaster'] as const)('remembers a manual upgrade from full official exhigh to %s', async level => {
  f.source.mockResolvedValueOnce({ ...source, level: 'exhigh', resolvedVia: 'primary', access: 'free' })
    .mockResolvedValue({ ...source, level, resolvedVia: 'unblock', access: 'free' });
  const player = await import('@/src/frontend/player/player');
  const settings = await import('@/src/frontend/lib/settings');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  expect(f.source.mock.calls[0][4]).toBe('auto');
  player.setQuality(level);
  await vi.waitFor(() => expect(player.playerStore.get().level).toBe(level));
  expect(f.source.mock.calls[1][4]).toBe('force_on');
  expect(settings.getSettings()).toMatchObject({ preferUnblock: true, quality: level });
  expect(JSON.parse(localStorage.getItem('cph.settings.v2')!)).toMatchObject({ preferUnblock: true, quality: level });
  player.next();
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(3));
  expect(f.source.mock.calls[2][4]).toBe('force_on');
  player.clearQueue();
  vi.resetModules();
  expect((await import('@/src/frontend/lib/settings')).getSettings().preferUnblock).toBe(true);
});

it('upgrades even if the preferred master tier was already selected before official playback fell back', async () => {
  const settings = await import('@/src/frontend/lib/settings');
  settings.updateSettings({ quality: 'jymaster' });
  f.source.mockResolvedValueOnce({ ...source, level: 'exhigh', resolvedVia: 'primary' })
    .mockResolvedValue({ ...source, level: 'jymaster', resolvedVia: 'unblock' });
  const player = await import('@/src/frontend/player/player');
  player.playList([track]);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  player.setQuality('jymaster');
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(2));
  expect(f.source.mock.calls[1][4]).toBe('force_on');
  expect(settings.getSettings().preferUnblock).toBe(true);
});

it.each([
  { level: 'exhigh', resolvedVia: 'primary', preview: true },
  { level: 'exhigh', resolvedVia: 'unblock', preview: false },
  { level: 'lossless', resolvedVia: 'primary', preview: false },
  { level: 'exhigh', preview: false }
])('does not infer a persistent preference from an unconfirmed official-exhigh result: %j', async response => {
  f.source.mockResolvedValue({ ...source, ...response });
  const player = await import('@/src/frontend/player/player');
  const settings = await import('@/src/frontend/lib/settings');
  player.playList([track]);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  player.setQuality('jymaster');
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(2));
  expect(settings.getSettings().preferUnblock).toBe(false);
  expect(f.source.mock.calls[1][4]).toBe('auto');
});

it.each([
  ['free', 'unblock', false, true], ['vip', 'unblock', false, false], ['paid', 'unblock', false, false],
  [undefined, 'unblock', false, false], ['free', 'primary', false, false], ['free', 'unblock', true, false]
])('exposes recovery eligibility for access=%s via=%s preview=%s, without a default prompt', async (access, resolvedVia, preview, eligible) => {
  f.source.mockResolvedValue({ ...source, level: 'exhigh', access, resolvedVia, preview });
  const player = await import('@/src/frontend/player/player');
  const { toastStore } = await import('@/src/frontend/lib/toast');
  player.playList([track]);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  expect(player.playerStore.get().canSwitchToStableSource).toBe(eligible);
  expect(toastStore.get().message ?? '').not.toContain('放的歌不对');
  if (!eligible) expect(player.switchToStableSource()).toBe(false);
});

it('temporarily restores official audio, preserves seek/pause and renewals, then uses the saved preference on the next track', async () => {
  const settings = await import('@/src/frontend/lib/settings');
  settings.updateSettings({ preferUnblock: true, quality: 'jymaster' });
  f.source.mockImplementation(async (_id, _level, _token, _signal, mode) => ({ ...source, access: 'free',
    resolvedVia: mode === 'force_off' ? 'primary' : 'unblock', level: mode === 'force_off' ? 'exhigh' : 'jymaster' }));
  const player = await import('@/src/frontend/player/player');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  FakeAudio.last.currentTime = 42;
  expect(player.switchToStableSource('a-previous-track')).toBe(false);
  expect(f.source).toHaveBeenCalledTimes(1);
  player.toggle();
  expect(player.switchToStableSource()).toBe(true);
  expect(player.switchToStableSource()).toBe(false);
  await vi.waitFor(() => expect(player.playerStore.get()).toMatchObject({ loading: false, unblockMode: 'force_off', resolvedVia: 'primary' }));
  expect(FakeAudio.last.currentTime).toBe(42);
  expect(FakeAudio.last.paused).toBe(true);
  expect(settings.getSettings()).toMatchObject({ preferUnblock: true, quality: 'jymaster' });
  FakeAudio.last.dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(3));
  expect(f.source.mock.calls[2][4]).toBe('force_off');
  await vi.waitFor(() => expect(player.playerStore.get().loading).toBe(false));
  player.next();
  await vi.waitFor(() => expect(f.source).toHaveBeenCalledTimes(4));
  expect(f.source.mock.calls[3][4]).toBe('force_on');
});

it('walks the source recovery entry through switching, done and back to hidden', async () => {
  f.source.mockImplementation(async (_id, _level, _token, _signal, mode) => ({ ...source, access: 'free',
    resolvedVia: mode === 'force_off' ? 'primary' : 'unblock', level: 'exhigh' }));
  const player = await import('@/src/frontend/player/player');
  const { recoverSource, recoveryStore } = await import('@/src/frontend/lib/sourceRecovery');
  player.playList([track, { ...track, id: 'two' }]);
  await vi.waitFor(() => expect(player.playerStore.get().canSwitchToStableSource).toBe(true));
  expect(recoverSource()).toBe(true);
  expect(recoveryStore.get()).toMatchObject({ trackId: 'one', settledAt: 0 });
  expect(recoverSource()).toBe(false);
  await vi.waitFor(() => expect(recoveryStore.get()).toMatchObject({ trackId: 'one', ok: true }));
  expect(f.source.mock.calls[1][4]).toBe('force_off');
  player.next();
  expect(recoveryStore.get().trackId).toBeNull();
  await vi.waitFor(() => expect(player.playerStore.get().canSwitchToStableSource).toBe(true));
});

it('nudges near the title on every 超清母带 track, but only once per visit for other qualities', async () => {
  let level = 'jymaster';
  f.source.mockImplementation(async () => ({ ...source, access: 'free', resolvedVia: 'unblock', level }));
  const player = await import('@/src/frontend/player/player');
  const { recoveryStore } = await import('@/src/frontend/lib/sourceRecovery');
  const ids = ['m1', 'm2', 'o1', 'o2'];
  player.playList(ids.map((id) => ({ ...track, id })));
  const nudged: (string | null)[] = [];
  for (const id of ids) {
    if (id !== 'm1') player.next();
    level = id.startsWith('m') ? 'jymaster' : 'lossless';
    await vi.waitFor(() => expect(player.playerStore.get()).toMatchObject({ loading: false, canSwitchToStableSource: true }));
    expect(player.currentTrack()?.id).toBe(id);
    nudged.push(recoveryStore.get().nudge);
  }
  expect(nudged).toEqual(['m1', 'm2', 'o1', null]);
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
