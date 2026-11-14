import { ApiError, coverOf, music, type Track, type TrackLyric } from '../api';
import { api } from '../config/site';
import { authStore, pushRecent } from '../lib/account';
import type { PlayQualityLevel, PlaySource, PlayUnblockMode } from '../api/types';
import { getSettings, updateSettings } from '../lib/settings';
import { readJSON, writeJSON } from '../lib/storage';
import { createStore } from '../lib/store';
import { toast } from '../lib/toast';
import { getPlayQualityLabel, PLAY_QUALITY_LEVELS } from '@/src/lib/play-quality';

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
  /** 后端报告的音质（可低于偏好）；未取到地址或缺少字段时为 null。 */
  level: PlayQualityLevel | null;
  /** 本次请求的策略与实际命中的链路分开提供给展示层。 */
  unblockMode: PlayUnblockMode;
  resolvedVia: PlaySource['resolvedVia'] | null;
  access: PlaySource['access'] | null;
  /** 展示层可据此提供“放的歌不对？”入口；播放器不自动弹提示。 */
  canSwitchToStableSource: boolean;
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
  unblockMode: 'auto',
  resolvedVia: null,
  access: null,
  canSwitchToStableSource: false,
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
  clearStall();
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
/** 正在取地址的那次加载；这期间 <audio> 里还是旧地址，它报的错不算数 */
let fetching = 0;
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
  set({ resolvedVia: null, access: null, canSwitchToStableSource: false });
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

// 播到哪一秒另外存：安卓 WebView 在后台被系统收掉、重开后按播放要接着放，不能从头来（issue #7）
const RESUME_KEY = 'cph.player.resume.v1';
/** 离结尾不到这么多就算听完了，重开从头放 */
const RESUME_TAIL_MS = 5000;
const RESUME_EVERY_MS = 5000;
let lastResumeWrite = 0;
/** 重开页面后第一次按播放用的位置；换了歌就作废 */
let resumeFor: { id: string; at: number } | null = null;
{
  const r = readJSON<{ id?: unknown; at?: unknown }>(RESUME_KEY, {});
  const t = currentTrack();
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  if (t && r.id === t.id && at > 0 && !(t.durationMs > 0 && at > t.durationMs - RESUME_TAIL_MS)) {
    resumeFor = { id: t.id, at };
    set({ position: at });
  }
}
function saveResume() {
  const t = currentTrack();
  // 淡出中的上一首、试听片段都不记
  if (!t || loaded?.id !== t.id || get().preview) return;
  lastResumeWrite = Date.now();
  writeJSON(RESUME_KEY, { id: t.id, at: Math.round(audio.currentTime * 1000) });
}
function takeResume(id: string) {
  const r = resumeFor;
  resumeFor = null;
  return r?.id === id ? r.at : undefined;
}
/** 没放成：记住这首停在哪，下次按播放从这里接着放 */
function rememberStop(id: string, at: number | undefined) {
  if (!at) return;
  resumeFor = { id, at };
  writeJSON(RESUME_KEY, { id, at: Math.round(at) });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });
window.addEventListener('pagehide', saveResume);

// ---- <audio> 事件 ----
/** 换歌时上一首还在淡出：它的进度和播完不能算到新歌头上 */
const outgoing = () => !!loaded && loaded.id !== currentTrack()?.id;
audio.addEventListener('timeupdate', () => {
  if (outgoing()) return;
  set({ position: audio.currentTime * 1000 });
  if (Date.now() - lastResumeWrite >= RESUME_EVERY_MS) saveResume();
  // 重连后稳稳放过一段，重连次数重新算
  if (stallRetries && audio.currentTime - recoveredAt > 30) stallRetries = 0;
});
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) set({ duration: audio.duration * 1000 });
});
audio.addEventListener('play', () => set({ playing: true }));
audio.addEventListener('pause', () => {
  if (!audio.paused) return; // A queued pause may arrive after playback resumed.
  // Browser pause events are asynchronous: an internal fade can finish after
  // recovery has armed its retry timer. Do not cancel that recovery.
  if (!(recovering && intendedPlaying)) clearStall();
  set({ playing: false });
  saveResume();
});
audio.addEventListener('waiting', () => {
  set({ loading: true });
  watchStall();
});
audio.addEventListener('stalled', watchStall);
audio.addEventListener('progress', () => { lastProgress = Date.now(); });
audio.addEventListener('playing', () => {
  clearStall();
  if (!outgoing()) { recovering = null; resumeFor = null; }
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
    void softPlay().catch(playRejected);
    emit('seek');
  } else next(true);
}
audio.addEventListener('ended', advanceOnEnd);
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src') || fetching === loadToken || (recovering && !intendedPlaying)) return;
  const at = audio.currentTime * 1000;
  // 播放地址是短时效的：第一次出错先续签再接着放
  if (!renewedOnce) {
    renewedOnce = true;
    void resolveAndPlay(get().index, { resumeAt: at, autoplay: intendedPlaying, recover: intendedPlaying });
    return;
  }
  // 续签过还断网：按卡住处理，有限次重连
  if ((audio.error?.code === MEDIA_ERR_NETWORK || audio.error?.code === 4) && intendedPlaying) return reconnect();
  giveUp('这首歌加载失败，稍后再试。');
  // Repeated media errors must not walk the entire queue requesting fresh URLs.
});

// ---- 卡住自救 ----
// 缓冲停住（waiting）以后浏览器不会自己重连：断过网、地址失效都会一直静默挂着，没声也没提示（issue #7）
const STALL_MS = 12_000;
const STALL_RETRIES = 3;
const MEDIA_ERR_NETWORK = 2;
/** 等待中（卡住待查、断网待重连）的定时器；有它就说明网一回来该马上重连 */
let stallTimer: ReturnType<typeof setTimeout> | undefined;
let stallRetries = 0;
/** 上次重连时放到的秒数 */
let recoveredAt = 0;
/** 最近一次收到音频数据的时间：慢但还在下，就不算卡死 */
let lastProgress = 0;
/** 正在重连的那首和要接着放的位置；重连取地址失败后 <audio> 里已没有它，只能靠这里记着 */
let recovering: { id: string; at: number } | null = null;
let offlineToastFor: { id: string; at: number } | null = null;
function clearStall() {
  clearTimeout(stallTimer);
  stallTimer = undefined;
}
function watchStall() {
  if (stallTimer || !intendedPlaying || audio.paused || outgoing()) return;
  armStall(loadToken, audio.currentTime);
}
function armStall(token: number, at: number) {
  stallTimer = setTimeout(() => {
    stallTimer = undefined;
    if (token !== loadToken || !intendedPlaying || pausing || audio.paused) return;
    // 往前挪了一点、或者数据还在慢慢下：没死，接着盯（挪一下又卡住不能就此没人管）
    if (audio.currentTime !== at || Date.now() - lastProgress < STALL_MS) return armStall(token, audio.currentTime);
    reconnect();
  }, STALL_MS);
}
/** 卡在哪：<audio> 里还是这首就读它，重连取地址失败后读记下的位置 */
function stuckPosition() {
  const t = currentTrack();
  if (!t) return undefined;
  if (loaded?.id === t.id) return audio.currentTime * 1000;
  return recovering?.id === t.id ? recovering.at : undefined;
}
/** 重新取地址、从卡住的地方接着放；连着重连太多次就停下来告诉用户 */
function reconnect() {
  clearStall();
  const t = currentTrack();
  const at = stuckPosition();
  // 用户已经按了暂停（含淡出途中）、或者正在取地址，都不再起一轮
  if (!t || at === undefined || !intendedPlaying || pausing || fetching === loadToken) return;
  // 明确断网时不白耗重连次数：等网回来（online）再连
  if (navigator.onLine === false) return holdForNetwork(t.id, at);
  if (stallRetries >= STALL_RETRIES) return giveUp('网络不太稳，播放停在这里了。点播放键接着放。');
  stallRetries += 1;
  recoveredAt = at / 1000;
  recovering = { id: t.id, at };
  void resolveAndPlay(get().index, { resumeAt: at, autoplay: true, recover: true });
}
/** 重连没取到地址：保持「要放」，网一回来或过一会儿再试；这期间按播放键可以作罢 */
function holdForNetwork(id: string, at: number) {
  recovering = { id, at };
  rememberStop(id, at);
  clearStall();
  stallTimer = setTimeout(reconnect, STALL_MS);
  set({ loading: true, playing: false });
  if (offlineToastFor?.id !== id || offlineToastFor.at !== at) {
    offlineToastFor = { id, at };
    toast('暂时连不上，网络恢复后会自动接着放。');
  }
}
/** 停下并提示；记住位置，下次按播放重新取地址从这里接着放 */
function giveUp(message: string) {
  const t = currentTrack();
  if (t) rememberStop(t.id, stuckPosition());
  recovering = null;
  clearStall();
  loadToken += 1;
  intendedPlaying = false;
  loaded = null;
  audio.pause();
  set({ loading: false, playing: false });
  toast(message);
}
window.addEventListener('online', () => { if (stallTimer && intendedPlaying && !pausing) reconnect(); });

let lastPlayToast = 0;
/** play() 被拒：换源、暂停打断的不吭声，其余要让用户知道为什么没声 */
function playRejected(e: unknown) {
  set({ playing: false });
  if ((e as Error)?.name === 'AbortError') return;
  intendedPlaying = false;
  if (Date.now() - lastPlayToast < 3000) return;
  lastPlayToast = Date.now();
  toast((e as Error)?.name === 'NotAllowedError'
    ? '系统拦下了播放，点一下播放键继续。'
    : '这首没能开始播放，点播放键再试一次。');
}

function expiryOf(src: { expiresAt?: string; ttlSeconds?: number }) {
  if (src.expiresAt && Number.isFinite(Date.parse(src.expiresAt))) return Date.parse(src.expiresAt);
  if (src.ttlSeconds) return Date.now() + src.ttlSeconds * 1000;
  return Infinity;
}

// 取地址的请求挂着不回（弱网里常见）也不能一直转圈：先提示慢，再超时按连不上处理
// 40 秒是产品等待上限，不保证覆盖服务端多次排队和全部上游请求。
const PLAY_URL_SLOW_MS = 12_000;
const PLAY_URL_TIMEOUT_MS = 40_000;
function withDeadline<T>(request: Promise<T>, abort: () => void, token: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const slow = setTimeout(() => { if (token === loadToken) toast('网络有点慢，还在加载。'); }, PLAY_URL_SLOW_MS);
    const deadline = setTimeout(() => {
      abort();
      reject(new ApiError('取播放地址超时了，网络可能不太稳。', 5000, 0, undefined, true));
    }, PLAY_URL_TIMEOUT_MS);
    request.then(resolve, reject).finally(() => { clearTimeout(slow); clearTimeout(deadline); });
  });
}

const expiringSoon = () => !!loaded && Date.now() > loaded.expiresAt - api.playUrlRenewLeadSeconds * 1000;
let lastQualityNotice = '';
/** 只影响当前一轮播放；不写入持久音源偏好。 */
let stableSourceTrackId: string | null = null;

/** 取播放地址并装进 <audio>；resumeAt 用于续签后从原位置继续 */
async function resolveAndPlay(
  index: number,
  opts: { autoplay?: boolean; resumeAt?: number; startAt?: number; skipped?: number; remote?: boolean; recover?: boolean } = {},
): Promise<void> {
  const { queue } = get();
  const track = queue[index];
  if (!track) return;
  if (Date.now() < retryNotBefore) {
    rememberStop(track.id, opts.resumeAt ?? opts.startAt);
    loadToken += 1;
    intendedPlaying = false;
    loaded = null;
    audio.pause();
    set({ loading: false, playing: false, canSwitchToStableSource: false });
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
  fetching = token;
  clearStall();
  loadController?.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  // 上一首先淡出，和取地址同时进行；淡完再换源
  pausing = false;
  if (!audio.paused) set({ playing: false });
  const silenced = fadeTo(0, FADE_OUT_MS).then(() => { if (token === loadToken) audio.pause(); });
  if (fresh) {
    stableSourceTrackId = null;
    lastQualityNotice = '';
    renewedOnce = false;
    recentPushed = false;
    resumeFor = null;
    recovering = null;
    stallRetries = 0;
    set({ index, position: opts.startAt ?? 0, duration: track.durationMs, lyric: null, preview: false, level: null,
      resolvedVia: null, access: null, canSwitchToStableSource: false });
    updateMediaSession(track);
  }
  const unblockMode: PlayUnblockMode = stableSourceTrackId === track.id ? 'force_off'
    : getSettings().preferUnblock === true ? 'force_on' : 'auto';
  set({ loading: true, unblockMode, canSwitchToStableSource: false });

  try {
    // Coalesce same-tick changes before starting either request.
    await Promise.resolve();
    if (token !== loadToken || signal.aborted) return;
    const requestedQuality = getSettings().quality;
    // 超时只掐取地址这一个请求，歌词照常
    const request = new AbortController();
    signal.addEventListener('abort', () => request.abort(), { once: true });
    const source = music.playUrl(track.id, requestedQuality, authStore.get().token, request.signal, unblockMode);
    if (fresh) loadLyric(track.id, token, signal);
    const src = await withDeadline(source, () => request.abort(), token);
    if (token !== loadToken) return;
    if (!src.url) throw new ApiError('没有可用的播放地址', 0, 0);
    await silenced;
    if (token !== loadToken) return;
    loaded = { id: track.id, expiresAt: expiryOf(src) };
    audio.src = src.url;
    fetching = 0;
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
    set({ preview: src.preview, level: src.level ?? null, resolvedVia: src.resolvedVia ?? null, access: src.access ?? null });
    const qualityNotice = `${track.id}:${requestedQuality}:${src.level ?? 'unknown'}`;
    if (fresh && src.preview) toast(src.restrictionReason && /[一-鿿]/.test(src.restrictionReason)
      ? src.restrictionReason : '这首只能试听片段。');
    else if (src.level && src.level !== requestedQuality && qualityNotice !== lastQualityNotice) {
      toast(`本曲实际以「${getPlayQualityLabel(src.level)}」音质播放。`);
    }
    lastQualityNotice = qualityNotice;
    if (remoteTarget) alignRemote();
    if (intendedPlaying) await softPlay().catch((e) => {
      if (token === loadToken) playRejected(e);
    });
    if (token !== loadToken) return;
    if (remoteTarget) alignRemote();
    set({ loading: false, canSwitchToStableSource: src.resolvedVia === 'unblock' && src.access === 'free' && !src.preview });
  } catch (e) {
    if (fetching === token) fetching = 0;
    if (token !== loadToken) return;
    if (signal.aborted || (e as Error).name === 'AbortError') return;
    const limited = e instanceof ApiError && (e.code === 2002 || e.status === 429);
    if (limited) retryNotBefore = Date.now() + Math.max(1, e.retryAfterSeconds ?? 30) * 1000;
    // 重连时取地址连不上（断网、服务端暂时出错）：不算失败，等网回来接着重连
    if (opts.recover && opts.resumeAt != null && intendedPlaying && !limited && e instanceof ApiError && e.retryable) {
      loaded = null;
      await silenced;
      if (token !== loadToken) return;
      return holdForNetwork(track.id, opts.resumeAt);
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
    // 续签、重连、换音质时失败：下次按播放从这里接着放，而不是从头
    if (!fresh || opts.startAt) rememberStop(track.id, opts.resumeAt ?? opts.startAt);
    recovering = null;
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

/** 不想放了（播放键、通知栏都走这里）；断网等着重连的先不等了，停住的位置留着，再按播放接着连 */
function pauseIntent() {
  intendedPlaying = false;
  if (remoteTarget) remoteTarget.playing = false;
  if (get().loading) {
    const t = currentTrack();
    const at = stuckPosition() ?? get().position;
    if (t) rememberStop(t.id, at);
    if (fetching === loadToken) {
      loadToken += 1;
      loadController?.abort();
      fetching = 0;
      loaded = null;
    }
    set({ loading: false });
  }
  softPause();
}

/** 等网重连时被暂停过、又要接着放：计时器已经停了，按记下的位置重新连（断着网就接着等） */
function resumeRecovery() {
  const t = currentTrack();
  if (!t || recovering?.id !== t.id || !intendedPlaying || stallTimer || fetching === loadToken) return false;
  set({ loading: true });
  reconnect();
  return true;
}

export function toggle() {
  const s = get();
  const track = currentTrack(s);
  if (!track) return;
  emit('playback');
  if (s.loading) {
    if (intendedPlaying) return pauseIntent();
    intendedPlaying = true;
    if (remoteTarget) remoteTarget.playing = true;
    resumeRecovery();
    return;
  }
  if (recovering?.id === track.id) {
    intendedPlaying = true;
    if (resumeRecovery()) return;
  }
  if (loaded?.id !== track.id) {
    intendedPlaying = true;
    if (resumeRecovery()) return;
    // 重开页面或放弃重连后：从记下的位置接着放
    return void resolveAndPlay(s.index, { startAt: takeResume(track.id) });
  }
  if (audible()) { intendedPlaying = false; return softPause(); }
  intendedPlaying = true;
  // 暂停太久地址可能过期，先续签
  if (expiringSoon()) return void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: true });
  void softPlay().catch(playRejected);
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
    if (!r.playing) {
      if (recovering?.id === track.id) pauseIntent();
      else softPause();
    } else resumeRecovery();
    return;
  }
  if (r.playing && currentTrack(s)?.id === track.id && recovering?.id === track.id && resumeRecovery()) return;
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
  clearStall();
  fadeId += 1;
  pausing = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loaded = null;
  lastQualityNotice = '';
  stableSourceTrackId = null;
  set({ level: null, resolvedVia: null, access: null, canSwitchToStableSource: false, unblockMode: 'auto' });
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
  // 加载、重连途中按通知栏的播放不能被当成「暂停」
  navigator.mediaSession.setActionHandler('play', () => { if (!isPlaybackIntended()) toggle(); });
  // 和播放键走同一套暂停：等网重连时按了暂停要把「加载中」一并收掉，不然再按播放会卡在加载里（二姐复验 #7）
  navigator.mediaSession.setActionHandler('pause', () => {
    pauseIntent();
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
  const s = get();
  const upgradeOfficial = !!loaded && !s.loading && !s.preview && s.resolvedVia === 'primary' && s.level === 'exhigh'
    && PLAY_QUALITY_LEVELS.indexOf(level) > PLAY_QUALITY_LEVELS.indexOf('exhigh');
  // Clicking the already-selected preference must still upgrade an official
  // fallback. This preference survives subsequent tracks and page reloads.
  if (getSettings().quality === level && !upgradeOfficial) return;
  updateSettings({ quality: level, ...(upgradeOfficial ? { preferUnblock: true } : {}) });
  if (upgradeOfficial) stableSourceTrackId = null;
  if (!loaded || !currentTrack(s)) return;
  void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: s.playing });
}

/** 展示层主动调用：本曲临时改走官方；切歌后仍沿用持久解灰偏好。 */
export function switchToStableSource(expectedTrackId?: string): boolean {
  const s = get();
  const track = currentTrack(s);
  if (!loaded || !track || (expectedTrackId != null && expectedTrackId !== track.id) || s.loading || !s.canSwitchToStableSource) return false;
  stableSourceTrackId = track.id;
  void resolveAndPlay(s.index, { resumeAt: audio.currentTime * 1000, autoplay: s.playing });
  return true;
}
