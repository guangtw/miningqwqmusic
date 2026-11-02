import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ source: vi.fn() }));
vi.mock('@/src/frontend/api', () => ({
  ApiError: class extends Error {}, coverOf: () => '',
  music: { playUrl: f.source, lyric: async () => ({ lines: [] }) }
}));
vi.mock('@/src/frontend/lib/account', () => ({
  authStore: { get: () => ({ user: { id: 'me' }, status: 'authenticated' }), subscribe: () => () => {} }, pushRecent: () => {}
}));
class FakeAudio extends EventTarget {
  static last: FakeAudio;
  paused = true; currentTime = 0; duration = 180; volume = 1; muted = false; preload = ''; src = '';
  constructor() { super(); FakeAudio.last = this; }
  play = vi.fn(async () => { if (this.paused) { this.paused = false; this.dispatchEvent(new Event('play')); } });
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() {}
  removeAttribute() { this.src = ''; }
  getAttribute() { return this.src; }
}
const track = { id: 'one', name: 'One', artists: [{ id: 'a', name: 'Artist' }], durationMs: 180000 };
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); vi.stubGlobal('Audio', FakeAudio);
  vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
  f.source.mockImplementation(async (id: string) => ({ url: `https://example.test/${id}`, preview: false }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function playing() {
  const player = await import('@/src/frontend/player/player');
  player.setVolume(0.8);
  player.playList([track, { ...track, id: 'two' }]);
  await vi.advanceTimersByTimeAsync(1000);
  return { player, audio: FakeAudio.last };
}

it('fades in from silence when playback starts', async () => {
  const player = await import('@/src/frontend/player/player');
  player.setVolume(0.8);
  player.playList([track]);
  await vi.waitFor(() => expect(FakeAudio.last.paused).toBe(false));
  expect(FakeAudio.last.volume).toBeLessThan(0.1);
  await vi.advanceTimersByTimeAsync(200);
  expect(FakeAudio.last.volume).toBeGreaterThan(0.05);
  expect(FakeAudio.last.volume).toBeLessThan(0.8);
  await vi.advanceTimersByTimeAsync(400);
  expect(FakeAudio.last.volume).toBeCloseTo(0.8);
});

it('fades out before pausing, and a quick resume picks the fade back up', async () => {
  const { player, audio } = await playing();
  player.toggle();
  expect(player.playerStore.get().playing).toBe(false);
  expect(player.isPlaybackIntended()).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(audio.paused).toBe(false);
  expect(audio.volume).toBeLessThan(0.8);
  const mid = audio.volume;
  player.toggle();
  await vi.advanceTimersByTimeAsync(0);
  expect(player.playerStore.get().playing).toBe(true);
  expect(audio.paused).toBe(false);
  expect(audio.volume).toBeGreaterThanOrEqual(mid);
  await vi.advanceTimersByTimeAsync(600);
  expect(audio.volume).toBeCloseTo(0.8);
  player.toggle();
  await vi.advanceTimersByTimeAsync(300);
  expect(audio.paused).toBe(true);
  expect(audio.volume).toBe(0);
});

it('fades the old song out before switching source, then fades the new one in', async () => {
  const { player, audio } = await playing();
  audio.currentTime = 90;
  player.next();
  await vi.advanceTimersByTimeAsync(100);
  expect(audio.src).toBe('https://example.test/one');
  expect(audio.paused).toBe(false);
  // 淡出中的上一首不能把进度和播完算到新歌头上
  audio.dispatchEvent(new Event('timeupdate'));
  expect(player.playerStore.get().position).toBe(0);
  audio.dispatchEvent(new Event('ended'));
  expect(player.playerStore.get().index).toBe(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(audio.src).toBe('https://example.test/two');
  expect(audio.volume).toBeLessThan(0.1);
  await vi.advanceTimersByTimeAsync(500);
  expect(audio.volume).toBeCloseTo(0.8);
});

it('keeps the user volume when the volume changes mid-fade', async () => {
  const { player, audio } = await playing();
  player.setVolume(0.5);
  expect(audio.volume).toBeCloseTo(0.5);
  expect(player.playerStore.get().volume).toBe(0.5);
});
