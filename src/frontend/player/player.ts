import { ApiError, coverOf, music, type Track, type TrackLyric } from '../api';
import { api } from '../config/site';
import { authStore, pushRecent } from '../lib/account';
import type { PlayQualityLevel } from '../api/types';
import { getSettings, updateSettings } from '../lib/settings';
import { readJSON, writeJSON } from '../lib/storage';
import { createStore } from '../lib/store';
import { toast } from '../lib/toast';

export type PlayMode = 'order' | 'loop' | 'one' | 'shuffle';

export interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  loading: boolean;
  /** 毫秒；低频更新（timeupdate），需要丝滑进度的地方用 audioTime() */
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  mode: PlayMode;
  lyric: TrackLyric | null;
  /** 当前是试听片段 */
  preview: boolean;
  /** 后端实际给的音质（账号权限不够时会比设置的低）；还没取到地址时为 null */
  level: PlayQualityLevel | null;
}

const SAVE_KEY = 'cph.player.v2';
const saved = readJSON<Partial<PlayerState>>(SAVE_KEY, {});

export const playerStore = createStore<PlayerState>({
  queue: saved.queue ?? [],
  index: saved.index ?? -1,
  playing: false,
  loading: false,
  position: 0,
  duration: saved.queue?.[saved.index ?? -1]?.durationMs ?? 0,
  volume: saved.volume ?? 0.8,
  muted: false,
  mode: saved.mode ?? 'order',
  lyric: null,
  preview: false,
  level: null,
});

const audio = new Audio();
audio.preload = 'auto';
audio.volume = playerStore.get().volume;

/** 当前 <audio> 里装的是哪首、地址何时过期 */
let loaded: { id: string; expiresAt: number } | null = null;
let loadToken = 0;
/** 本次加载是否已经因为地址失效重取过一次 */
let renewedOnce = false;
let recentPushed = false;
const history: number[] = [];

const set = playerStore.set;
const get = playerStore.get;

// A cached guest/authorized URL must not survive an account or entitlement change.
const authorizationKey = () => {
  const auth = authStore.get();
  return `${auth.user?.id ?? ''}:${auth.status === 'authenticated'}:${auth.playbackAuthorization?.enabled ?? false}:${auth.playbackAuthorization?.version ?? 0}`;
};
let lastAuthorization = authorizationKey();
authStore.subscribe(() => {
  const key = authorizationKey();
  if (key === lastAuthorization) return;
  lastAuthorization = key;
  if (!loaded) return;
  const resumeAt = audio.currentTime * 1000;
  const autoplay = !audio.paused;
  loaded = null;
  loadToken += 1;
  audio.pause();
  if (autoplay) void resolveAndPlay(get().index, { resumeAt, autoplay: true });
});

export const currentTrack = (s: PlayerState = get()) => s.queue[s.index] ?? null;

/** 高精度播放位置（毫秒），给进度条、歌词逐帧读取 */
export const audioTime = () => audio.currentTime * 1000;
export const audioDuration = () => (Number.isFinite(audio.duration) ? audio.duration * 1000 : get().duration);
export const isAudioPlaying = () => !audio.paused;

// ---- 持久化 ----
let lastSaved = '';
playerStore.subscribe(() => {
  const { queue, index, volume, mode } = get();
  const snap = JSON.stringify({ queue, index, volume, mode });
  if (snap !== lastSaved) {
    lastSaved = snap;
    writeJSON(SAVE_KEY, { queue, index, volume, mode });
  }
});

// ---- <audio> 事件 ----
audio.addEventListener('timeupdate', () => set({ position: audio.currentTime * 1000 }));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) set({ duration: audio.duration * 1000 });
});
audio.addEventListener('play', () => set({ playing: true }));
audio.addEventListener('pause', () => set({ playing: false }));
audio.addEventListener('waiting', () => set({ loading: true }));
audio.addEventListener('playing', () => {
  set({ loading: false });
  const t = currentTrack();
  if (t && !recentPushed) {
    recentPushed = true;
    pushRecent(t);
  }
});
audio.addEventListener('ended', () => {
  if (get().mode === 'one') {
    audio.currentTime = 0;
    void audio.play();
  } else next(true);
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  const at = audio.currentTime * 1000;
  // 播放地址是短时效的：第一次出错先续签再接着放
  if (!renewedOnce) {
    renewedOnce = true;
    void resolveAndPlay(get().index, { resumeAt: at, autoplay: true });
    return;
  }
  set({ loading: false, playing: false });
  toast('这首歌加载失败，换下一首。');
  next(true);
});

function expiryOf(src: { expiresAt?: string; ttlSeconds?: number }) {
  if (src.expiresAt && Number.isFinite(Date.parse(src.expiresAt))) return Date.parse(src.expiresAt);
  if (src.ttlSeconds) return Date.now() + src.ttlSeconds * 1000;
  return Infinity;
}

const expiringSoon = () => !!loaded && Date.now() > loaded.expiresAt - api.playUrlRenewLeadSeconds * 1000;

/** 取播放地址并装进 <audio>；resumeAt 用于续签后从原位置继续 */
async function resolveAndPlay(
  index: number,
  opts: { autoplay?: boolean; resumeAt?: number; startAt?: number; skipped?: number } = {},
) {
  const { queue } = get();
  const track = queue[index];
  if (!track) return;
  const fresh = opts.resumeAt == null;
  const token = ++loadToken;
  audio.pause();
  if (fresh) {
    renewedOnce = false;
    recentPushed = false;
    set({ index, position: 0, duration: track.durationMs, lyric: null, preview: false });
    updateMediaSession(track);
    loadLyric(track.id, token);
  }
  set({ loading: true });

  try {
    const src = await music.playUrl(track.id, getSettings().quality, authStore.get().token);
    if (token !== loadToken) return;
    if (!src.url) throw new ApiError('没有可用的播放地址', 0, 0);
    loaded = { id: track.id, expiresAt: expiryOf(src) };
    audio.src = src.url;
    if (opts.resumeAt) audio.currentTime = opts.resumeAt / 1000;
    else if (opts.startAt) audio.currentTime = opts.startAt / 1000;
    set({ preview: src.preview, level: src.level ?? null });
    if (fresh && src.preview) toast(src.restrictionReason && /[一-鿿]/.test(src.restrictionReason)
      ? src.restrictionReason : '这首只能试听片段。');
    if (opts.autoplay !== false) await audio.play().catch(() => {
      if (token === loadToken) set({ playing: false });
    });
    if (token !== loadToken) return;
    set({ loading: false });
  } catch (e) {
    if (token !== loadToken) return;
    const skipped = (opts.skipped ?? 0) + 1;
    if (fresh && skipped < queue.length) {
      toast(`《${track.name}》暂时放不了：${(e as Error).message}`);
      return resolveAndPlay(nextIndex(index), { ...opts, startAt: undefined, skipped });
    }
    set({ loading: false, playing: false });
    toast((e as Error).message || '获取播放地址失败。');
  }
}

function loadLyric(id: string, token: number) {
  music
    .lyric(id)
    .then((lyric) => token === loadToken && set({ lyric }))
    .catch(() => token === loadToken && set({ lyric: { trackId: id, lines: [] } }));
}

function nextIndex(from: number): number {
  const { queue, mode } = get();
  if (mode === 'shuffle' && queue.length > 1) {
    let i = from;
    while (i === from) i = Math.floor(Math.random() * queue.length);
    return i;
  }
  return (from + 1) % queue.length;
}

// ---- 对外操作 ----

export function playList(tracks: Track[], start = 0) {
  if (!tracks.length) return toast('这里没有能播放的歌。');
  history.length = 0;
  set({ queue: tracks, index: start });
  void resolveAndPlay(start);
}

/** 播放一首歌；startAt（毫秒）给了就从那里开始，例如首页卷首语「从这句开始听」 */
export function playTrack(track: Track, startAt?: number) {
  const { queue, index } = get();
  const existing = queue.findIndex((t) => t.id === track.id);
  // 正在放的就是这首：直接跳过去，不重新取地址
  if (existing >= 0 && existing === index && loaded?.id === track.id && startAt != null) {
    seek(startAt);
    if (!get().playing) toggle();
    return;
  }
  if (existing >= 0) return jumpTo(existing, startAt);
  const q = [...queue];
  q.splice(index + 1, 0, track);
  set({ queue: q });
  jumpTo(index + 1, startAt);
}

/** 只知道 id 时（例如首页推荐里的单曲）先取详情再播 */
export async function playTrackById(id: string) {
  try {
    playTrack(await music.track(id));
  } catch (e) {
    toast((e as Error).message);
  }
}

export function addNext(track: Track) {
  const { queue } = get();
  const cur = currentTrack();
  const q = queue.filter((t) => t.id === cur?.id || t.id !== track.id);
  const at = cur ? q.findIndex((t) => t.id === cur.id) + 1 : 0;
  q.splice(at, 0, track);
  set({ queue: q, index: cur ? at - 1 : get().index });
  toast(`《${track.name}》会在下一首播放。`);
}

export function jumpTo(i: number, startAt?: number) {
  if (get().index >= 0) history.push(get().index);
  void resolveAndPlay(i, { startAt });
}

export function toggle() {
  const s = get();
  const track = currentTrack(s);
  if (!track) return;
  if (loaded?.id !== track.id) return void resolveAndPlay(s.index);
  if (!audio.paused) return audio.pause();
  // 暂停太久地址可能过期，先续签
  if (expiringSoon()) return void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: true });
  void audio.play().catch(() => set({ playing: false }));
}

export function next(auto = false) {
  const { queue, index, mode } = get();
  if (!queue.length) return;
  if (auto && mode === 'order' && index === queue.length - 1) {
    set({ playing: false });
    return;
  }
  history.push(index);
  void resolveAndPlay(nextIndex(index));
}

export function prev() {
  const { queue, index, mode } = get();
  if (!queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  const back = mode === 'shuffle' ? history.pop() : undefined;
  void resolveAndPlay(back ?? (index - 1 + queue.length) % queue.length);
}

export function seek(ms: number) {
  const track = currentTrack();
  if (!track || loaded?.id !== track.id) return;
  audio.currentTime = Math.max(0, ms / 1000);
  set({ position: ms });
}

export function setVolume(v: number) {
  audio.volume = Math.max(0, Math.min(1, v));
  audio.muted = false;
  set({ volume: audio.volume, muted: false });
}

export function toggleMute() {
  audio.muted = !audio.muted;
  set({ muted: audio.muted });
}

const MODES: PlayMode[] = ['order', 'loop', 'one', 'shuffle'];
export const MODE_LABEL: Record<PlayMode, string> = {
  order: '顺序播放',
  loop: '列表循环',
  one: '单曲循环',
  shuffle: '随机播放',
};

export function cycleMode() {
  const mode = MODES[(MODES.indexOf(get().mode) + 1) % MODES.length];
  set({ mode });
  toast(MODE_LABEL[mode]);
}

function unload() {
  loadToken += 1;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loaded = null;
}

export function removeAt(i: number) {
  const { queue, index } = get();
  const q = queue.filter((_, k) => k !== i);
  if (i === index) {
    unload();
    set({ queue: q, index: q.length ? Math.min(i, q.length - 1) : -1, playing: false, position: 0 });
    if (q.length) void resolveAndPlay(Math.min(i, q.length - 1));
  } else {
    set({ queue: q, index: i < index ? index - 1 : index });
  }
}

export function clearQueue() {
  unload();
  history.length = 0;
  set({ queue: [], index: -1, playing: false, position: 0, duration: 0, lyric: null });
}

// ---- 系统媒体控制 ----
function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return;
  const cover = coverOf(track);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.name,
    artist: track.artists.map((a) => a.name).join(' / '),
    album: track.album?.name ?? '',
    artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
  });
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { if (audio.paused) toggle(); });
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime * 1000));
}

// 刷新页面后恢复的那首歌也先把歌词取回来，打开唱机时不用等按下播放
{
  const restored = currentTrack();
  if (restored) loadLyric(restored.id, loadToken);
}

/** 换音质：记进设置，正在放的这首立刻按新音质重取地址，从当前位置接着放 */
export function setQuality(level: PlayQualityLevel) {
  if (getSettings().quality === level) return;
  updateSettings({ quality: level });
  const s = get();
  if (!loaded || !currentTrack(s)) return;
  void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: s.playing });
}
