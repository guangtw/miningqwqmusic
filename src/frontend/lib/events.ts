import type { AccountEventDto, AccountEventPage } from '@/src/types/social';
import { api } from '../config/site';
import { accessToken, authed, authStore, libraryStore, pullLibrary } from './account';
import { parseSse } from './listen';
import { onMessageCreated, onMessageRead, refreshConversations, resetMessages } from './messages';
import { readJSON, writeJSON } from './storage';

/*
 * 账户事件：私信、已读、歌单变动都从这一条流来。
 * 启动顺序：用存下的游标把 /events 补拉完 → 接 SSE。游标只在事件处理完后前进，按账号分开存；
 * 断线用最后处理过的游标重连，服务端会从日志重放，重复的按 id 丢掉。
 * 推送流要带 Authorization 头，所以和一起听一样用 fetch 读流。
 */

const p = api.paths;
const cursorKey = (user: string) => `qwq-account-events:${user}`;

let cursor = '0';
let user: string | undefined;
let ctrl: AbortController | null = null;

/** 游标是十进制字符串，只拿来比大小，不做加减 */
function after(a: string, b: string) {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

let pullTimer: ReturnType<typeof setTimeout> | undefined;

export function handleAccountEvent(ev: AccountEventDto) {
  if (!after(ev.id, cursor)) return;
  switch (ev.type) {
    case 'message.created':
      onMessageCreated(ev.payload.message);
      break;
    case 'message.read':
      onMessageRead(ev.payload);
      break;
    case 'playlist.changed':
      // 比本机新才重新拉；连着来的几条合成一次。本机还没提交的改动由 mergeCloudPlaylists 保留
      if (ev.payload.revision > libraryStore.get().revision) {
        clearTimeout(pullTimer);
        pullTimer = setTimeout(() => void pullLibrary({ force: true }), 300);
      }
      break;
  }
  cursor = ev.id;
  if (user) writeJSON(cursorKey(user), cursor);
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

async function catchUpLog(signal: AbortSignal) {
  for (let i = 0; i < 50 && !signal.aborted; i++) {
    const page = await authed<AccountEventPage>(p.accountEvents, { query: { after: cursor, limit: 100 }, signal });
    if (signal.aborted) return;
    for (const ev of page.items) handleAccountEvent(ev);
    if (!page.hasMore) return;
  }
}

async function run(me: string, c: AbortController) {
  const { signal } = c;
  const alive = () => !signal.aborted && user === me;
  let delay = 1000;
  let force = false;
  let caughtUp = false;
  while (alive()) {
    try {
      if (!caughtUp) {
        await catchUpLog(signal);
        caughtUp = true;
      }
      const token = await accessToken(force);
      force = false;
      if (!alive()) return;
      if (!token) throw new Error('Session recovery pending');
      const res = await fetch(`${api.base}${p.accountEventStream}?after=${encodeURIComponent(cursor)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal,
      });
      if (!alive()) return void res.body?.cancel().catch(() => undefined);
      if (res.status === 401) {
        force = true;
        throw new Error('Refresh stream authorization');
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        read: for (;;) {
          // 服务端每 15 秒一个 keepalive，45 秒没动静就当断了
          const watchdog = setTimeout(() => void reader.cancel().catch(() => undefined), 45_000);
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } finally {
            clearTimeout(watchdog);
          }
          if (!alive()) return;
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          if (buffer.length > 1024 * 1024) throw new Error('Invalid event stream');
          for (const { event, data } of parsed.events) {
            if (event === 'ready') delay = 1000;
            else if (event === 'auth.expired') {
              force = true;
              break read;
            } else if (event === 'closed') break read;
            else if (data && typeof data === 'object' && 'type' in data) handleAccountEvent(data as AccountEventDto);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (force) continue;
    } catch {
      if (!alive()) return;
    }
    await wait(delay, signal);
    delay = Math.min(30_000, delay * 2);
  }
}

function start(me: string) {
  ctrl?.abort();
  const c = new AbortController();
  ctrl = c;
  void run(me, c);
}

let watching = false;

/** App 启动时调一次：登录就接上事件流，换账号或退出立刻断开、清掉上一个账号的私信 */
export function watchAccountEvents() {
  if (watching) return;
  watching = true;
  const sync = () => {
    const s = authStore.get();
    if (s.status === 'checking') return;
    const next = s.status === 'authenticated' ? s.user?.id : undefined;
    if (next === user) return;
    ctrl?.abort();
    ctrl = null;
    resetMessages();
    user = next;
    if (!next) return;
    cursor = readJSON<string>(cursorKey(next), '0');
    void refreshConversations().catch(() => undefined);
    start(next);
  };
  // 网络恢复、回到前台：不等退避，马上重连（游标还在，漏掉的会重放）
  const resume = () => {
    if (!user || document.visibilityState === 'hidden') return;
    void refreshConversations().catch(() => undefined);
    start(user);
  };
  const unsubscribe = authStore.subscribe(sync);
  window.addEventListener('online', resume);
  sync();
  return () => {
    watching = false;
    unsubscribe();
    window.removeEventListener('online', resume);
    ctrl?.abort();
    ctrl = null;
    user = undefined;
    resetMessages();
  };
}
