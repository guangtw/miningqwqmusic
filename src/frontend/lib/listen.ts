import type { AcceptListenInviteResult, AccountUser, ListenPlaybackState, ListenRoomEvent, ListenRoomInviteSummary, ListenRoomSummary } from '@/src/types/account';
import type { Track } from '../api';
import { ApiError, path } from '../api/http';
import { api } from '../config/site';
import { applyRemote, audioTime, onPlayerAction, playerStore, type PlayerAction, type PlayerState, type PlayMode } from '../player/player';
import { accessToken, authed, authStore, displayName } from './account';
import { refreshSocial } from './friends';
import { countFields } from './playlists';
import { createStore } from './store';
import { toast } from './toast';

/*
 * 一起听：房间在账户服务的内存里，谁都能控制播放。
 * - 本机的「操作」（播放暂停、换歌、拖进度、换模式、改队列）发到房间：POST state
 * - 别人的操作从推送流（SSE）收下来，照着摆播放器；自己的回声按 actor 过滤掉
 * - 播放中每 30 秒报一次进度，后来进房间的人能对上位置；每 45 秒心跳一次表示在线
 * - 推送流要带 Authorization 头，EventSource 不支持，所以用 fetch 读流自己拆事件
 */

const p = api.paths;
const ROOM_KEY = 'qwq-listen-room';
const HEARTBEAT_MS = 45_000;
const PROGRESS_MS = 30_000;
/** 操作后等播放器稳定下来（取地址、play() 回来）再取状态发出去 */
const SETTLE_MS = 400;
/** 账户服务每个请求最多 400 个字段：队列只带当前这首前后的一段 */
const FIELD_BUDGET = api.cloudFieldLimit - 16;
/** 这些错误表示房间没了或者自己已经不在里面，结束本地会话 */
const GONE = new Set([5503, 5504, 5505]);

export type ListenPhase = 'idle' | 'busy' | 'live' | 'reconnecting';

interface ListenState {
  room: ListenRoomSummary | null;
  phase: ListenPhase;
  /** 最近一次别人做了什么：「小林 切到了下一首」 */
  last: { who: string; what: string; at: number } | null;
}

export const listenStore = createStore<ListenState>({ room: null, phase: 'idle', last: null });

const me = () => authStore.get().user?.id;
const roomId = () => listenStore.get().room?.id;

// ---------------- 状态互转 ----------------

/** 账户服务的曲目格式：艺人、专辑的 id 和名字都不能空 */
function shareTrack(t: Track): Track {
  const cover = t.coverUrl ?? t.album?.coverUrl;
  return {
    id: t.id,
    name: t.name || '未知曲目',
    artists: t.artists.filter((a) => a.name).map((a) => ({ id: a.id || '0', name: a.name })),
    ...(t.album?.id && t.album.name ? { album: { id: t.album.id, name: t.album.name } } : {}),
    durationMs: Math.max(0, Math.round(t.durationMs || 0)),
    ...(cover ? { coverUrl: cover } : {}),
  } as Track;
}

const toRemoteMode = (m: PlayMode): ListenPlaybackState['mode'] => (m === 'one' ? 'loop-one' : m === 'shuffle' ? 'shuffle' : 'sequence');
function fromRemoteMode(m: ListenPlaybackState['mode'], local: PlayMode): PlayMode {
  if (m === 'loop-one') return 'one';
  if (m === 'shuffle') return 'shuffle';
  return local === 'order' || local === 'loop' ? local : 'loop';
}

/** 本机播放器 → 房间状态。队列从当前这首往前带两首、往后带到字段上限为止 */
export function sharedState(s: PlayerState, positionMs = audioTime()): ListenPlaybackState {
  const queue = s.queue.map(shareTrack);
  const base = {
    currentTimeMs: Math.max(0, Math.round(positionMs)),
    isPlaying: s.playing || s.loading,
    mode: toRemoteMode(s.mode),
    updatedAt: new Date().toISOString(),
  };
  const i = s.index;
  if (!queue[i]) return { ...base, queue: [], currentIndex: -1, isPlaying: false };
  let used = countFields({ type: '', playbackState: { ...base, queue: [], currentIndex: 0 } }) + countFields(queue[i]);
  let lo = i;
  let hi = i;
  for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
    const c = countFields(queue[k]);
    if (used + c > FIELD_BUDGET) break;
    used += c;
    lo = k;
  }
  for (let k = i + 1; k < queue.length; k++) {
    const c = countFields(queue[k]);
    if (used + c > FIELD_BUDGET) break;
    used += c;
    hi = k;
  }
  return { ...base, queue: queue.slice(lo, hi + 1), currentIndex: i - lo };
}

/** 房间状态 → 本机播放器。maxLagMs 限制按时间差往前追多少（各人的时钟不一定准） */
function follow(state: ListenPlaybackState, maxLagMs: number) {
  // 房间里还没放歌（房主空着队列开的房）：不动自己的播放器
  if (!state.queue.length) return;
  const lag = state.isPlaying ? Math.min(maxLagMs, Math.max(0, Date.now() - Date.parse(state.updatedAt || ''))) || 0 : 0;
  applyRemote({
    queue: state.queue as Track[],
    index: state.currentIndex,
    positionMs: state.currentTimeMs + lag,
    playing: state.isPlaying && state.currentIndex >= 0,
    mode: fromRemoteMode(state.mode, playerStore.get().mode),
  });
}

// ---------------- 往房间发 ----------------

let pending: PlayerAction | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** 同一下操作可能连着发好几个事件（插一首再跳过去），合成一次，队列变化优先 */
const RANK: Record<PlayerAction, number> = { seek: 0, mode: 1, playback: 2, queue: 3 };

onPlayerAction((type) => {
  if (listenStore.get().phase !== 'live' && listenStore.get().phase !== 'reconnecting') return;
  pending = pending && RANK[pending] >= RANK[type] ? pending : type;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const t = pending!;
    pending = null;
    void send(t);
  }, SETTLE_MS);
});

async function send(type: PlayerAction | 'progress') {
  const id = roomId();
  if (!id) return;
  try {
    const room = await authed<ListenRoomSummary>(path(p.listenRoomAction, { id, action: 'state' }), {
      method: 'POST',
      body: { type, playbackState: sharedState(playerStore.get()) },
    });
    if (roomId() === id) listenStore.set({ room });
  } catch (e) {
    handleError(e, id);
  }
}

function handleError(e: unknown, id: string) {
  if (e instanceof ApiError && GONE.has(e.code)) {
    if (roomId() === id) {
      toast(e.message);
      end();
    }
  }
}

// ---------------- 推送流 ----------------

let stream: AbortController | null = null;
let version = 0;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let progress: ReturnType<typeof setInterval> | undefined;

type StreamEvent = { event: string; data: unknown };

/** 把 SSE 文本拆成事件：空行分隔，每块里有 event: 和 data: */
export function parseSse(buffer: string): { events: StreamEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: StreamEvent[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      // 拆坏的一块直接丢掉
    }
  }
  return { events, rest };
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

async function runStream(id: string, ctrl: AbortController) {
  let delay = 1000;
  let force = false;
  while (!ctrl.signal.aborted && roomId() === id) {
    try {
      const token = await accessToken(force);
      force = false;
      if (!token) return end();
      const res = await fetch(`${path(p.listenRoomAction, { id, action: 'stream' })}?sinceVersion=${version}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        force = true;
        continue;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        if (body && GONE.has(body.code)) return handleError(new ApiError(api.errorText[body.code] ?? '', body.code, res.status), id);
        throw new Error(String(res.status));
      }
      listenStore.set({ phase: 'live' });
      delay = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          if (onEvent(id, ev) === 'closed') return;
        }
      }
    } catch {
      if (ctrl.signal.aborted) return;
    }
    // 断了：等一会儿接着上次的版本号重连
    if (roomId() !== id) return;
    listenStore.set({ phase: 'reconnecting' });
    await wait(delay, ctrl.signal);
    delay = Math.min(15_000, delay * 2);
  }
}

const ACTION_TEXT: Record<string, string> = {
  playback: '调了播放',
  queue: '换了歌单',
  seek: '拖了进度',
  mode: '换了播放模式',
};

function onEvent(id: string, { event, data }: StreamEvent): 'closed' | void {
  if (event === 'closed') {
    const code = (data as { code?: number }).code ?? 0;
    if (GONE.has(code)) {
      handleError(new ApiError(api.errorText[code] ?? '房间已经散了。', code, 410), id);
      return 'closed';
    }
    return;
  }
  if (event !== 'state' && event !== 'member') return;
  const ev = data as ListenRoomEvent;
  version = Math.max(version, ev.version);
  const fromMe = ev.actor?.id === me();
  if (event === 'member') {
    const action = (ev.payload as { action?: string } | null)?.action;
    if (action === 'sync') return void resync(id);
    void reloadRoom(id);
    if (!fromMe && (action === 'join' || action === 'leave')) {
      const who = displayName(ev.actor as AccountUser);
      listenStore.set({ last: { who, what: action === 'join' ? '进来了' : '离开了', at: Date.now() } });
      toast(`${who} ${action === 'join' ? '进来一起听了' : '离开了房间'}。`);
    }
    return;
  }
  if (fromMe || !ev.payload) return;
  const state = ev.payload as ListenPlaybackState;
  // 进度报告只在差得多的时候才跟
  follow(state, ev.type === 'progress' ? 35_000 : 3_000);
  if (ev.type !== 'progress') listenStore.set({ last: { who: displayName(ev.actor as AccountUser), what: ACTION_TEXT[ev.type] ?? '动了播放器', at: Date.now() } });
  listenStore.set((s) => (s.room ? { room: { ...s.room, playbackState: state, version: ev.version } } : {}));
}

async function reloadRoom(id: string) {
  try {
    const room = await authed<ListenRoomSummary>(path(p.listenRoom, { id }));
    if (roomId() === id) listenStore.set({ room });
    return room;
  } catch (e) {
    handleError(e, id);
    return null;
  }
}

/** 推送流说漏掉的事件太多了：整个房间重新拉一次，照着摆 */
async function resync(id: string) {
  const room = await reloadRoom(id);
  if (room) {
    version = room.version;
    follow(room.playbackState, 35_000);
  }
}

// ---------------- 进出房间 ----------------

function enter(room: ListenRoomSummary, opts: { follow: boolean }) {
  stop();
  version = room.version;
  listenStore.set({ room, phase: 'live', last: null });
  try {
    sessionStorage.setItem(ROOM_KEY, room.id);
  } catch {
    // 隐私模式：刷新后就不自动回房间了
  }
  if (opts.follow) follow(room.playbackState, 35_000);
  const ctrl = new AbortController();
  stream = ctrl;
  void runStream(room.id, ctrl);
  heartbeat = setInterval(() => {
    const id = roomId();
    if (id) authed<ListenRoomSummary>(path(p.listenRoomAction, { id, action: 'heartbeat' }), { method: 'POST' }).then(
      (r) => roomId() === id && listenStore.set({ room: r }),
      (e) => handleError(e, id),
    );
  }, HEARTBEAT_MS);
  progress = setInterval(() => {
    if (playerStore.get().playing) void send('progress');
  }, PROGRESS_MS);
}

function stop() {
  stream?.abort();
  stream = null;
  clearInterval(heartbeat);
  clearInterval(progress);
  clearTimeout(settleTimer);
  pending = null;
}

/** 结束本地会话（不通知服务器） */
function end() {
  stop();
  listenStore.set({ room: null, phase: 'idle', last: null });
  try {
    sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // 忽略
  }
}

async function busy<T>(work: () => Promise<T>): Promise<T> {
  const before = listenStore.get().phase;
  listenStore.set({ phase: 'busy' });
  try {
    return await work();
  } catch (e) {
    listenStore.set({ phase: listenStore.get().room ? before : 'idle' });
    throw e;
  }
}

/** 开一个房间，把现在的播放状态带进去 */
export const createRoom = () =>
  busy(async () => {
    const room = await authed<ListenRoomSummary>(p.listenRooms, { method: 'POST', body: { playbackState: sharedState(playerStore.get()) } });
    enter(room, { follow: false });
    return room;
  });

/** 用房间码加入：进去后照着房间里的进度放 */
export const joinRoom = (code: string) =>
  busy(async () => {
    const room = await authed<ListenRoomSummary>(p.listenJoin, { method: 'POST', body: { inviteCode: code.trim().toUpperCase() } });
    enter(room, { follow: true });
    return room;
  });

export const acceptInvite = (inviteId: string) =>
  busy(async () => {
    // 已经在别的房间里：先离开
    if (roomId()) await leaveRoom();
    const r = await authed<AcceptListenInviteResult>(path(p.listenInviteAction, { id: inviteId, action: 'accept' }), { method: 'POST' });
    enter(r.room, { follow: true });
    void refreshSocial();
    return r.room;
  });

export async function rejectInvite(inviteId: string) {
  await authed<ListenRoomInviteSummary>(path(p.listenInviteAction, { id: inviteId, action: 'reject' }), { method: 'POST' });
  void refreshSocial();
}

export async function inviteFriend(friendUserId: string) {
  const id = roomId() ?? (await createRoom()).id;
  return authed<ListenRoomInviteSummary>(path(p.listenRoomAction, { id, action: 'invites' }), { method: 'POST', body: { friendUserId } });
}

export async function leaveRoom() {
  const id = roomId();
  if (!id) return;
  end();
  await authed(path(p.listenRoomAction, { id, action: 'leave' }), { method: 'POST' }).catch(() => undefined);
}

/** App 启动时调一次：刷新页面后回到原来的房间；换账号或退出登录就离开 */
let watching = false;
export function watchListen() {
  if (watching) return;
  watching = true;
  let lastUser: string | undefined;
  const sync = () => {
    const s = authStore.get();
    if (s.status === 'checking') return;
    const user = s.status === 'authenticated' ? s.user?.id : undefined;
    if (user === lastUser) return;
    const was = lastUser;
    lastUser = user;
    if (was) end();
    if (!user) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(ROOM_KEY);
    } catch {
      // 忽略
    }
    if (!saved) return;
    authed<ListenRoomSummary>(path(p.listenRoom, { id: saved })).then(
      (room) => lastUser === user && enter(room, { follow: true }),
      () => {
        try {
          sessionStorage.removeItem(ROOM_KEY);
        } catch {
          // 忽略
        }
      },
    );
  };
  authStore.subscribe(sync);
  sync();
}
