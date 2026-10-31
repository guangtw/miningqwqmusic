import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ source: vi.fn(), recent: vi.fn() }));
vi.mock('@/src/frontend/api', () => ({
  ApiError: class extends Error {}, coverOf: () => '',
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
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); vi.stubGlobal('Audio', FakeAudio); });
afterEach(() => vi.unstubAllGlobals());

it('uses the latest remote seek/pause while one address request is still loading', async () => {
  let resolve!: (value: typeof source) => void;
  f.source.mockReturnValue(new Promise(r => { resolve = r; }));
  const player = await import('@/src/frontend/player/player');
  player.applyRemote({ queue: [track], index: 0, positionMs: 1000, playing: true });
  player.applyRemote({ queue: [track], index: 0, positionMs: 12000, playing: false });
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
