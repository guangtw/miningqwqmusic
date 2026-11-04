import { ApiError, coverOf, music, type Track, type TrackLyric } from '../api';
import { api } from '../config/site';
import { authStore, pushRecent } from '../lib/account';
import type { PlayQualityLevel } from '../api/types';
import { getSettings, updateSettings } from '../lib/settings';
import { readJSON, writeJSON } from '../lib/storage';
import { createStore } from '../lib/store';
import { toast } from '../lib/toast';
import { getPlayQualityLabel } from '@/src/lib/play-quality';

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
  /** 已收到本次音源的音质结果；null 音质此时表示来源未知。 */
  qualityResolved: boolean;
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
  qualityResolved: false,
});

const audio = new Audio();
audio.preload = 'auto';
// iOS Safari 的 volume 是只读的（永远读回 1），那里没法渐变，播放暂停照旧立刻生效
audio.volume = 0.5;
const canFade = audio.volume === 0.5;

// ---- 淡入淡出 ----
// 只动 audio.volume：播放地址在第三方 CDN 上、不保证带 CORS，接 Web Audio 增益节点会被浏览器静音
const FADE_IN_MS = 450;
const FADE_OUT_MS = 260;
/** 渐变增益，乘在用户音量上 */
let gain = 1;
let fadeId = 0;
/** 正在淡出、淡完就暂停：声音还在，但已经算暂停了 */
let pausing = false;
const applyVolume = () => { audio.volume = playerStore.get().volume * gain; };
applyVolume();
const audible = () => !audio.paused && !pausing;

/** 把增益渐变到 to；中途被下一次渐变打断时得到 false */
function fadeTo(to: number, ms: number): Promise<boolean> {
  const id = ++fadeId;
  const from = gain;
  if (!canFade || document.hidden || from === to) {
    gain = to;
    applyVolume();
    return Promise.resolve(true);
  }
  const start = performance.now();
  const span = ms * Math.abs(to - from);
  return new Promise((resolve) => {
    const tick = () => {
      if (id !== fadeId) return resolve(false);
      const t = Math.min(1, (performance.now() - start) / span);
      // 振幅走平方曲线，听感上接近匀速
      gain = from + (to - from) * (to > from ? t * t : 1 - (1 - t) * (1 - t));
      applyVolume();
      if (t < 1) setTimeout(tick, 16);
      else resolve(true);
    };
    tick();
  });
}

/** 淡出后暂停；淡出途中又按了播放就作罢 */
function softPause() {
  if (!audible()) return;
  if (!canFade) return audio.pause();
  pausing = true;
  set({ playing: false });
  void fadeTo(0, FADE_OUT_MS).then((done) => {
    if (!done) return;
    pausing = false;
    audio.pause();
  });
}

/** 播放并淡入：暂停中的从静音起，淡出到一半的从当前音量接着淡回来 */
function softPlay(): Promise<void> {
  const id = ++fadeId;
  if (pausing) {
    pausing = false;
    set({ playing: true });
  } else if (audio.paused) {
    gain = canFade ? 0 : 1;
    applyVolume();
  }
  // 等真正出声再淡入，缓冲的那段不白白耗掉渐变
  return audio.play().then(() => { if (id === fadeId) void fadeTo(1, FADE_IN_MS); });
}

/** 当前 <audio> 里装的是哪首、地址何时过期 */
let loaded: { id: string; expiresAt: number } | null = null;
let loadToken = 0;
/** 本次加载是否已经因为地址失效重取过一次 */
let renewedOnce = false;
let recentPushed = false;
const history: number[] = [];
let canAutoAdvance = () => true;
let intendedPlaying = false;
let retryNotBefore = 0;
let loadController: AbortController | undefined;
let lastLimitToast = 0;
let remoteTarget: { positionMs: number; playing: boolean; receivedAt: number } | null = null;
export const isPlaybackIntended = () => get().loading ? intendedPlaying : audible();
export function setAutoAdvanceGuard(guard: () => boolean) { canAutoAdvance = guard; }

const set = playerStore.set;
const get = playerStore.get;

/**
 * 播放器上发生了一次「操作」：换歌、播放暂停、拖进度、换模式、改队列。
 * 一起听只把这些同步出去；照着房间状态摆播放器（applyRemote）、续签地址都不算操作，不会被回传。
 */
export type PlayerAction = 'queue' | 'playback' | 'seek' | 'mode';
const actionListeners = new Set<(type: PlayerAction) => void>();
export function onPlayerAction(fn: (type: PlayerAction) => void) {
  actionListeners.add(fn);
  return () => void actionListeners.delete(fn);
}
const emit = (type: PlayerAction) => actionListeners.forEach((fn) => fn(type));

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
export const isAudioPlaying = audible;

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
/** 换歌时上一首还在淡出：它的进度和播完不能算到新歌头上 */
const outgoing = () => !!loaded && loaded.id !== currentTrack()?.id;
audio.addEventListener('timeupdate', () => { if (!outgoing()) set({ position: audio.currentTime * 1000 }); });
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
function advanceOnEnd() {
  if (outgoing()) return;
  if (!canAutoAdvance()) { set({ playing: false }); return; }
  if (get().mode === 'one') {
    audio.currentTime = 0;
    void softPlay().catch(() => set({ playing: false }));
    emit('seek');
  } else next(true);
}
audio.addEventListener('ended', advanceOnEnd);
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  const at = audio.currentTime * 1000;
  // 播放地址是短时效的：第一次出错先续签再接着放
  if (!renewedOnce) {
    renewedOnce = true;
    void resolveAndPlay(get().index, { resumeAt: at, autoplay: intendedPlaying });
    return;
  }
  set({ loading: false, playing: false });
  toast('这首歌加载失败，稍后再试。');
  // Repeated media errors must not walk the entire queue requesting fresh URLs.
});

function expiryOf(src: { expiresAt?: string; ttlSeconds?: number }) {
  if (src.expiresAt && Number.isFinite(Date.parse(src.expiresAt))) return Date.parse(src.expiresAt);
  if (src.ttlSeconds) return Date.now() + src.ttlSeconds * 1000;
  return Infinity;
}

const expiringSoon = () => !!loaded && Date.now() > loaded.expiresAt - api.playUrlRenewLeadSeconds * 1000;
let lastQualityNotice = '';

/** 取播放地址并装进 <audio>；resumeAt 用于续签后从原位置继续 */
async function resolveAndPlay(
  index: number,
  opts: { autoplay?: boolean; resumeAt?: number; startAt?: number; skipped?: number; remote?: boolean } = {},
): Promise<void> {
  const { queue } = get();
  const track = queue[index];
  if (!track) return;
  if (Date.now() < retryNotBefore) {
    loadToken += 1;
    intendedPlaying = false;
    loaded = null;
    audio.pause();
    set({ loading: false, playing: false });
    if (Date.now() - lastLimitToast > 3000) {
      lastLimitToast = Date.now();
      toast(`音乐上游限制了请求频率，请在 ${Math.ceil((retryNotBefore - Date.now()) / 1000)} 秒后重试。`);
    }
    return;
  }
  if (!opts.remote) remoteTarget = null;
  intendedPlaying = opts.autoplay !== false;
  const fresh = opts.resumeAt == null;
  const token = ++loadToken;
  loadController?.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  // 上一首先淡出，和取地址同时进行；淡完再换源
  pausing = false;
  if (!audio.paused) set({ playing: false });
  const silenced = fadeTo(0, FADE_OUT_MS).then(() => { if (token === loadToken) audio.pause(); });
  if (fresh) {
    lastQualityNotice = '';
    renewedOnce = false;
    recentPushed = false;
    set({ index, position: 0, duration: track.durationMs, lyric: null, preview: false, level: null, qualityResolved: false });
    updateMediaSession(track);
  }
  set({ loading: true });

  try {
    // Coalesce same-tick changes before starting either request.
    await Promise.resolve();
    if (token !== loadToken || signal.aborted) return;
    const requestedQuality = getSettings().quality;
    const source = music.playUrl(track.id, requestedQuality, authStore.get().token, signal);
    if (fresh) loadLyric(track.id, token, signal);
    const src = await source;
    if (token !== loadToken) return;
    if (!src.url) throw new ApiError('没有可用的播放地址', 0, 0);
    await silenced;
    if (token !== loadToken) return;
    loaded = { id: track.id, expiresAt: expiryOf(src) };
    audio.src = src.url;
    const alignRemote = () => {
      if (!remoteTarget || token !== loadToken) return;
      const target = remoteTarget;
      const elapsed = target.playing ? Math.max(0, performance.now() - target.receivedAt) : 0;
      const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : track.durationMs;
      const position = Math.min(duration || Infinity, target.positionMs + elapsed);
      audio.currentTime = position / 1000;
      set({ position });
      if (!target.playing) audio.pause();
    };
    if (remoteTarget) audio.addEventListener('loadedmetadata', alignRemote, { once: true });
    // 暂停状态下不会触发 timeupdate，进度条的位置要自己同步一下
    const at = opts.resumeAt ?? opts.startAt;
    if (at !== undefined) {
      audio.currentTime = at / 1000;
      set({ position: at });
    }
    set({ preview: src.preview, level: src.level ?? null, qualityResolved: true });
    const qualityNotice = `${track.id}:${requestedQuality}:${src.level ?? 'unknown'}`;
    if (fresh && src.preview) toast(src.restrictionReason && /[一-鿿]/.test(src.restrictionReason)
      ? src.restrictionReason : '这首只能试听片段。');
    else if (src.level && src.level !== requestedQuality && qualityNotice !== lastQualityNotice) {
      toast(`本曲实际以「${getPlayQualityLabel(src.level)}」音质播放。`);
    }
    lastQualityNotice = qualityNotice;
    if (remoteTarget) alignRemote();
    if (intendedPlaying) await softPlay().catch(() => {
      if (token === loadToken) set({ playing: false });
    });
    if (token !== loadToken) return;
    if (remoteTarget) alignRemote();
    set({ loading: false });
  } catch (e) {
    if (token !== loadToken) return;
    if (signal.aborted || (e as Error).name === 'AbortError') return;
    if (e instanceof ApiError && (e.code === 2002 || e.status === 429)) {
      retryNotBefore = Date.now() + Math.max(1, e.retryAfterSeconds ?? 30) * 1000;
    }
    const skipped = (opts.skipped ?? 0) + 1;
    const songUnavailable = e instanceof ApiError && [3001, 3002].includes(e.code);
    if (songUnavailable && fresh && canAutoAdvance() && !opts.remote && skipped < Math.min(queue.length, 3)) {
      toast(`《${track.name}》暂时放不了：${(e as Error).message}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (token !== loadToken) return;
      if (!intendedPlaying) { set({ loading: false, playing: false }); return; }
      const retry = resolveAndPlay(nextIndex(index), { ...opts, startAt: undefined, skipped });
      emit('playback');
      return retry;
    }
    intendedPlaying = false;
    loaded = null;
    set({ loading: false, playing: false });
    toast((e as Error).message || '获取播放地址失败。');
  }
}

function loadLyric(id: string, token: number, signal?: AbortSignal) {
  music
    .lyric(id, signal)
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
  emit('queue');
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
  emit('queue');
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
  emit('queue');
}

export function jumpTo(i: number, startAt?: number) {
  if (get().index >= 0) history.push(get().index);
  void resolveAndPlay(i, { startAt });
  emit('playback');
}

export function toggle() {
  const s = get();
  const track = currentTrack(s);
  if (!track) return;
  emit('playback');
  if (s.loading && loaded?.id !== track.id) {
    intendedPlaying = !intendedPlaying;
    if (remoteTarget) remoteTarget.playing = intendedPlaying;
    if (!intendedPlaying) softPause();
    return;
  }
  if (loaded?.id !== track.id) return void resolveAndPlay(s.index);
  if (audible()) { intendedPlaying = false; return softPause(); }
  intendedPlaying = true;
  // 暂停太久地址可能过期，先续签
  if (expiringSoon()) return void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: true });
  void softPlay().catch(() => set({ playing: false }));
}

/** 上一首 / 下一首换到了哪一格、往哪个方向。唱机和播放台按方向换唱片；点列表、一起听同步算往后 */
let step = { index: -1, dir: 1 as 1 | -1, at: 0 };
export const swapDirection = (index = get().index): 1 | -1 =>
  step.index === index && performance.now() - step.at < 2000 ? step.dir : 1;

export function next(auto = false) {
  const { queue, index, mode } = get();
  if (!queue.length) return;
  if (auto && !canAutoAdvance()) return;
  if (auto && mode === 'order' && index === queue.length - 1) {
    set({ playing: false });
    emit('playback');
    return;
  }
  history.push(index);
  step = { index: nextIndex(index), dir: 1, at: performance.now() };
  void resolveAndPlay(step.index);
  emit('playback');
}

export function prev() {
  const { queue, index, mode } = get();
  if (!queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    emit('seek');
    return;
  }
  const back = mode === 'shuffle' ? history.pop() : undefined;
  step = { index: back ?? (index - 1 + queue.length) % queue.length, dir: -1, at: performance.now() };
  void resolveAndPlay(step.index);
  emit('playback');
}

export function seek(ms: number) {
  const track = currentTrack();
  if (!track || loaded?.id !== track.id) return;
  audio.currentTime = Math.max(0, ms / 1000);
  set({ position: ms });
  emit('seek');
}

/**
 * 一起听：照着房间里的状态摆好播放器。
 * 换了歌就按新位置重新取地址；同一首只在差得多时才挪进度，免得来回抖。
 */
export function applyRemote(r: { queue: Track[]; index: number; positionMs: number; playing: boolean; mode?: PlayMode }) {
  const s = get();
  remoteTarget = { positionMs: Math.max(0, r.positionMs), playing: r.playing, receivedAt: performance.now() };
  intendedPlaying = r.playing;
  const sameQueue = s.queue.length === r.queue.length && s.queue.every((t, i) => t.id === r.queue[i]?.id);
  if (!sameQueue) history.length = 0;
  set({ ...(sameQueue ? {} : { queue: r.queue }), ...(r.mode ? { mode: r.mode } : {}) });
  const track = r.queue[r.index];
  if (!track) {
    unload();
    set({ queue: [], index: -1, position: 0, duration: 0, playing: false, loading: false, lyric: null });
    return;
  }
  if (r.playing && loaded?.id === track.id && track.durationMs > 0 && r.positionMs >= track.durationMs && canAutoAdvance()) {
    set({ index: r.index });
    advanceOnEnd();
    return;
  }
  if (currentTrack(s)?.id === track.id && s.loading) {
    set({ index: r.index });
    if (!r.playing) softPause();
    return;
  }
  // 房间里的队列只带当前这首前后一段，传来传去序号会挪：认歌不认序号，同一首就只改序号、不重新加载
  if (loaded?.id !== track.id || currentTrack(s)?.id !== track.id) {
    void resolveAndPlay(r.index, { startAt: r.positionMs, autoplay: r.playing, remote: true });
    return;
  }
  if (s.index !== r.index) set({ index: r.index });
  if (Math.abs(audio.currentTime * 1000 - r.positionMs) > 1500) {
    audio.currentTime = r.positionMs / 1000;
    set({ position: r.positionMs });
  }
  if (r.playing && !audible()) {
    if (expiringSoon()) void resolveAndPlay(r.index, { resumeAt: r.positionMs, autoplay: true });
    else void softPlay().catch(() => toast('浏览器拦下了自动播放，点一下播放键跟上大家。'));
  } else if (!r.playing && audible()) softPause();
}

export function setVolume(v: number) {
  audio.muted = false;
  set({ volume: Math.max(0, Math.min(1, v)), muted: false });
  applyVolume();
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
  emit('mode');
}

function unload() {
  loadToken += 1;
  loadController?.abort();
  fadeId += 1;
  pausing = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loaded = null;
  lastQualityNotice = '';
  set({ level: null, qualityResolved: false });
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
  emit('queue');
}

export function clearQueue() {
  unload();
  history.length = 0;
  set({ queue: [], index: -1, playing: false, position: 0, duration: 0, lyric: null });
  emit('queue');
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
  navigator.mediaSession.setActionHandler('play', () => { if (!audible()) toggle(); });
  navigator.mediaSession.setActionHandler('pause', () => {
    intendedPlaying = false;
    softPause();
    emit('playback');
  });
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
