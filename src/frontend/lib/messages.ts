import type {
  ConversationPage,
  DirectConversationDto,
  DirectMessageContent,
  DirectMessageDto,
  MessagePage,
  MessageSendResult,
  ReadResult,
  SendDirectMessageInput,
  SharedMessageResource,
} from '@/src/types/social';
import { ApiError, path } from '../api/http';
import { api } from '../config/site';
import { authed, authStore } from './account';
import { createStore } from './store';

/*
 * 私信。会话摘要按「对方的用户 id」存，聊天页、好友页、侧栏的小红点都看这里。
 * - 新消息、已读位置从账户事件流来（events.ts 调 onMessageCreated / onMessageRead），HTTP 只做首屏和补拉
 * - 发送先放进 outbox 显示成半透明气泡，成功后用服务端的 message.id 合并，SSE 再来一遍也不会重复
 * - 未读数、发送额度以服务端摘要为准：本地先估一下，随后重新取一次摘要校正
 * - 音乐卡片、一起听邀请和文字走同一条路；邀请状态变了会来 message.updated，按 updatedAt 新的替换旧的
 */

const p = api.paths;
export const MESSAGE_MAX = 2000;
const PAGE = 30;

/** 发送请求去掉 clientMessageId 的部分 */
export type SendBody = SendDirectMessageInput extends infer U ? (U extends unknown ? Omit<U, 'clientMessageId'> : never) : never;

export interface Outgoing {
  clientMessageId: string;
  /** 文字消息的正文，或者卡片的附言 */
  text: string;
  /** 第一次发的请求原样留着：重发时一个字都不改，服务端才认得是同一条 */
  body: SendBody;
  /** 卡片还没送达时先画出来的样子；文字消息为 null */
  preview: DirectMessageContent | null;
  status: 'sending' | 'failed';
  error?: string;
  /** 被限流时：这个时间点之后自动重发 */
  retryAt?: number;
}

export interface Thread {
  /** 按序号升序 */
  messages: DirectMessageDto[];
  outbox: Outgoing[];
  hasOlder: boolean;
  loaded: boolean;
  loadingOlder: boolean;
  error: string | null;
}

interface MessagesState {
  /** 对方用户 id → 会话摘要。还没聊过的人也会有一条（id 为 null），聊天页要用它的资料和额度 */
  conversations: Record<string, DirectConversationDto>;
  listLoaded: boolean;
  nextCursor: string | null;
  threads: Record<string, Thread>;
}

const empty = (): MessagesState => ({ conversations: {}, listLoaded: false, nextCursor: null, threads: {} });
export const messagesStore = createStore<MessagesState>(empty());

const me = () => authStore.get().user?.id;
let epoch = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 换账号、退出登录：清空，晚到的响应一律丢掉 */
export function resetMessages() {
  epoch++;
  timers.forEach(clearTimeout);
  timers.clear();
  reading.clear();
  messagesStore.set(empty());
  noticeStore.set({ notice: null });
}

/** 右下角的新私信卡片：只留最近一个人；同一个人连着发，条数往上加 */
export interface MessageNotice {
  peerId: string;
  text: string;
  count: number;
  key: number;
}
export const noticeStore = createStore<{ notice: MessageNotice | null }>({ notice: null });

export function dismissNotice() {
  noticeStore.set({ notice: null });
}

/** 补拉回来的旧消息不弹；正在看这个人的聊天、或者在好友页看着会话列表，也不弹 */
function notify(peer: string, msg: DirectMessageDto) {
  if (document.visibilityState !== 'visible' || Date.now() - Date.parse(msg.createdAt) > 120_000) return;
  // 一起听邀请有自己的右下角卡片
  if (cardOf(msg)?.kind === 'listen_invite') return;
  const hash = location.hash;
  if (hash.startsWith('#/friends') || hash === `#/chat/${encodeURIComponent(peer)}`) return;
  noticeStore.set((s) => ({
    notice: {
      peerId: peer,
      text: previewText(msg, false),
      count: s.notice?.peerId === peer ? s.notice.count + 1 : 1,
      key: (s.notice?.key ?? 0) + 1,
    },
  }));
}

/** 发请求前记下当前账号，回来时账号变了就不认 */
async function scoped<T>(run: () => Promise<T>): Promise<T | undefined> {
  const at = epoch;
  const result = await run();
  return at === epoch ? result : undefined;
}

// ---------------- 读 ----------------

export const conversationList = (s: MessagesState) =>
  Object.values(s.conversations)
    .filter((c) => c.id && c.lastMessage)
    .sort((a, b) => b.lastMessage!.createdAt.localeCompare(a.lastMessage!.createdAt) || b.id!.localeCompare(a.id!));

export const unreadTotal = (s: MessagesState) => Object.values(s.conversations).reduce((n, c) => n + c.unreadCount, 0);

/** 这条消息该按哪种样子画：旧缓存没有 kind 当文字；不认识的种类、版本也退回文字 */
export function cardOf(m: Pick<DirectMessageDto, 'kind' | 'content'>): DirectMessageContent | null {
  const c = m.content;
  if (!m.kind || m.kind === 'text' || !c || c.version !== 1 || c.kind !== m.kind) return null;
  return ['track', 'album', 'playlist', 'listen_invite'].includes(c.kind) ? c : null;
}

/** 会话列表、新消息卡片上的一行摘要 */
export function previewText(m: DirectMessageDto, mine: boolean) {
  const c = cardOf(m);
  if (!c) return m.text;
  if (c.kind === 'listen_invite') {
    const s = c.invitation.status;
    if (s === 'pending') return mine ? '邀请对方一起听' : '邀请你一起听';
    if (s === 'accepted') return '一起听 · 已加入';
    if (s === 'rejected') return '一起听 · 婉拒了';
    return '一起听 · 邀请已失效';
  }
  const [label, name] = c.kind === 'track' ? ['歌曲', c.track.name] : c.kind === 'album' ? ['专辑', c.album.name] : ['歌单', c.playlist.name];
  return c.caption ? `${c.caption}  [${label}]《${name}》` : `分享了${label}《${name}》`;
}

/** 同一条消息的两份：updatedAt 晚的那份是新的（旧数据没有 updatedAt 用 createdAt） */
const stamp = (m: DirectMessageDto) => Date.parse(m.updatedAt ?? m.createdAt) || 0;

const blankThread = (): Thread => ({ messages: [], outbox: [], hasOlder: false, loaded: false, loadingOlder: false, error: null });

function peerOf(conversationId: string) {
  for (const [peer, c] of Object.entries(messagesStore.get().conversations)) if (c.id === conversationId) return peer;
  return null;
}

function patchThread(peer: string, patch: Partial<Thread> | ((t: Thread) => Partial<Thread>)) {
  messagesStore.set((s) => {
    const t = s.threads[peer] ?? blankThread();
    return { threads: { ...s.threads, [peer]: { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } } };
  });
}

/** 合并一条摘要：末条消息取更新的那份，已读位置只前进 */
function putConversation(peer: string, next: DirectConversationDto) {
  messagesStore.set((s) => {
    const cur = s.conversations[peer];
    let merged =
      cur?.lastMessage && (!next.lastMessage || cur.lastMessage.sequence > next.lastMessage.sequence)
        ? { ...cur, peer: next.peer, sendPolicy: next.sendPolicy, id: next.id ?? cur.id }
        : next;
    // 同一条末条消息：本地已经收到更新过的状态（邀请被接受了），摘要里的旧版本不能盖回去
    if (cur?.lastMessage && merged.lastMessage?.id === cur.lastMessage.id && stamp(cur.lastMessage) > stamp(merged.lastMessage)) {
      merged = { ...merged, lastMessage: cur.lastMessage };
    }
    return {
      conversations: {
        ...s.conversations,
        [peer]: {
          ...merged,
          lastReadSequence: Math.max(merged.lastReadSequence, cur?.lastReadSequence ?? 0),
          peerLastReadSequence: Math.max(merged.peerLastReadSequence, cur?.peerLastReadSequence ?? 0),
        },
      },
    };
  });
}

function mergeMessages(peer: string, items: DirectMessageDto[]) {
  if (!items.length) return;
  patchThread(peer, (t) => {
    const byId = new Map(t.messages.map((m) => [m.id, m]));
    for (const m of items) {
      const cur = byId.get(m.id);
      if (!cur || stamp(m) >= stamp(cur)) byId.set(m.id, m);
    }
    const sent = new Set(items.map((m) => m.clientMessageId));
    return {
      messages: [...byId.values()].sort((a, b) => a.sequence - b.sequence),
      outbox: t.outbox.filter((o) => !sent.has(o.clientMessageId)),
    };
  });
}

export async function refreshConversations() {
  if (authStore.get().status !== 'authenticated') return;
  const page = await scoped(() => authed<ConversationPage>(p.conversations, { query: { limit: PAGE } }));
  if (!page) return;
  for (const c of page.items) putConversation(c.peer.id, c);
  messagesStore.set((s) => (s.listLoaded ? {} : { listLoaded: true, nextCursor: page.nextCursor }));
}

export async function loadMoreConversations() {
  const cursor = messagesStore.get().nextCursor;
  if (!cursor) return;
  const page = await scoped(() => authed<ConversationPage>(p.conversations, { query: { limit: PAGE, cursor } }));
  if (!page) return;
  for (const c of page.items) putConversation(c.peer.id, c);
  messagesStore.set({ nextCursor: page.nextCursor });
}

/** 取一次权威摘要（未读数、发送额度） */
async function refreshSummary(peer: string) {
  const c = await scoped(() => authed<DirectConversationDto>(path(p.conversation, { id: peer })));
  if (c) putConversation(peer, c);
  return c;
}

/** 好多事件挨着来时，同一个人的摘要只取一次 */
function later(key: string, ms: number, run: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => (timers.delete(key), run()), ms));
}
const summarySoon = (peer: string) => later(`summary:${peer}`, 400, () => void refreshSummary(peer).catch(() => undefined));
const listSoon = () => later('list', 400, () => void refreshConversations().catch(() => undefined));

/** 打开和某人的聊天：摘要 + 最近一页；已经开过的话只补新消息 */
export async function openThread(peer: string) {
  const summary = refreshSummary(peer);
  // 下面先失败的话 summary 没人等，它的失败别变成未处理的 rejection
  summary.catch(() => undefined);
  const t = messagesStore.get().threads[peer];
  try {
    if (t?.loaded) await catchUp(peer);
    else {
      const page = await scoped(() => authed<MessagePage>(path(p.directMessages, { id: peer }), { query: { limit: PAGE } }));
      if (page) {
        mergeMessages(peer, page.items);
        patchThread(peer, { hasOlder: page.hasMore, loaded: true, error: null });
      }
    }
    await summary;
  } catch (e) {
    patchThread(peer, { error: (e as Error).message });
    throw e;
  }
}

export async function loadOlder(peer: string) {
  const t = messagesStore.get().threads[peer];
  if (!t?.loaded || !t.hasOlder || t.loadingOlder || !t.messages.length) return;
  patchThread(peer, { loadingOlder: true });
  try {
    const page = await scoped(() =>
      authed<MessagePage>(path(p.directMessages, { id: peer }), { query: { before: t.messages[0].sequence, limit: PAGE } }),
    );
    if (!page) return;
    mergeMessages(peer, page.items);
    patchThread(peer, { hasOlder: page.hasMore });
  } finally {
    patchThread(peer, { loadingOlder: false });
  }
}

/** 从本地最后一条往后补，直到没有更多 */
async function catchUp(peer: string) {
  for (let i = 0; i < 20; i++) {
    const last = messagesStore.get().threads[peer]?.messages.at(-1)?.sequence;
    if (last == null) return;
    const page = await scoped(() => authed<MessagePage>(path(p.directMessages, { id: peer }), { query: { after: last, limit: 100 } }));
    if (!page) return;
    mergeMessages(peer, page.items);
    if (!page.hasMore) return;
  }
}

// ---------------- 写 ----------------

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

function setOutgoing(peer: string, o: Outgoing) {
  patchThread(peer, (t) => {
    const at = t.outbox.findIndex((x) => x.clientMessageId === o.clientMessageId);
    const outbox = [...t.outbox];
    if (at >= 0) outbox[at] = o;
    else outbox.push(o);
    return { outbox };
  });
}

export function discardOutgoing(peer: string, clientMessageId: string) {
  clearTimeout(timers.get(`retry:${clientMessageId}`));
  patchThread(peer, (t) => ({ outbox: t.outbox.filter((o) => o.clientMessageId !== clientMessageId) }));
}

/**
 * 发一条文字。重发时传原来的 clientMessageId：同一次发送服务端只记一次。
 * 返回 'limit' 表示陌生人额度用完了（气泡收回，文字交还输入框）
 */
export function sendMessage(peer: string, text: string, clientMessageId = uuid()) {
  const body = text.trim();
  if (!body || body.length > MESSAGE_MAX) return Promise.resolve(undefined);
  return deliver(peer, { clientMessageId, text: body, body: { text: body }, preview: null });
}

/** 发一张音乐卡片。prepare 在真正提交前跑（自建歌单要先等本机改动同步上去），抛错就算没发出去 */
export function sendCard(peer: string, body: SendBody, preview: DirectMessageContent, prepare?: () => Promise<void>) {
  return deliver(peer, { clientMessageId: uuid(), text: ('text' in body && body.text) || '', body, preview }, prepare);
}

/** 失败的气泡点「重发」：同一个 id、同一份请求 */
export function resend(peer: string, o: Outgoing) {
  return deliver(peer, { clientMessageId: o.clientMessageId, text: o.text, body: o.body, preview: o.preview });
}

type Draft = Pick<Outgoing, 'clientMessageId' | 'text' | 'body' | 'preview'>;

async function deliver(peer: string, d: Draft, prepare?: () => Promise<void>): Promise<'sent' | 'failed' | 'limit' | undefined> {
  const { clientMessageId } = d;
  clearTimeout(timers.get(`retry:${clientMessageId}`));
  setOutgoing(peer, { ...d, status: 'sending' });
  const at = epoch;
  try {
    await prepare?.();
    const r = await authed<MessageSendResult>(path(p.directMessages, { id: peer }), { method: 'POST', body: { clientMessageId, ...d.body } });
    if (at !== epoch) return;
    // 第一条消息才有会话 id：先挂上摘要，再合并消息
    putConversation(peer, r.conversation);
    mergeMessages(peer, [r.message]);
    return 'sent';
  } catch (e) {
    if (at !== epoch) return;
    const err = e instanceof ApiError ? e : null;
    if (err?.code === 5804) {
      discardOutgoing(peer, clientMessageId);
      void refreshSummary(peer).catch(() => undefined);
      return 'limit';
    }
    if (err?.code === 5805) {
      const wait = Math.max(1, err.retryAfterSeconds ?? 10) * 1000;
      setOutgoing(peer, { ...d, status: 'failed', error: '发得太快了，稍后自动重发', retryAt: Date.now() + wait });
      timers.set(`retry:${clientMessageId}`, setTimeout(() => void deliver(peer, d), wait));
      return 'failed';
    }
    // 正文和之前的记录对不上：换一个新 id 再发就是新的一条
    const id = err?.code === 5803 ? uuid() : clientMessageId;
    if (id !== clientMessageId) discardOutgoing(peer, clientMessageId);
    setOutgoing(peer, { ...d, clientMessageId: id, status: 'failed', error: (e as Error).message });
    return 'failed';
  }
}

/** 卡片对应的完整资源：自建歌单的快照带全部曲目，只有会话双方能取 */
export function fetchShared(messageId: string) {
  return authed<SharedMessageResource>(path(p.messageResource, { id: messageId }));
}

/** 接受、拒绝邀请之后取一次这条消息的最新状态（事件流也会推，先到先用） */
export async function refreshMessage(messageId: string) {
  const m = await authed<DirectMessageDto>(path(p.message, { id: messageId }));
  onMessageUpdated(m);
}

/** 正在提交的已读位置：同一个会话一次只发一个请求，期间更靠后的位置攒着下次发 */
const reading = new Map<string, { id: string; sequence: number; busy: boolean }>();

/** 页面上真的显示到了这条消息才调用；位置只前进 */
export function markRead(peer: string, message: DirectMessageDto) {
  const c = messagesStore.get().conversations[peer];
  if (!c?.id || message.sequence <= c.lastReadSequence) return;
  const cur = reading.get(peer);
  if (cur && cur.sequence >= message.sequence) return;
  reading.set(peer, { id: message.id, sequence: message.sequence, busy: cur?.busy ?? false });
  if (!cur?.busy) void flushRead(peer);
}

async function flushRead(peer: string) {
  const at = epoch;
  for (;;) {
    const next = reading.get(peer);
    const c = messagesStore.get().conversations[peer];
    if (!next || !c || next.sequence <= c.lastReadSequence) return void reading.delete(peer);
    reading.set(peer, { ...next, busy: true });
    try {
      const r = await authed<ReadResult>(path(p.directRead, { id: peer }), { method: 'POST', body: { throughMessageId: next.id } });
      if (at !== epoch) return;
      messagesStore.set((s) => {
        const cur = s.conversations[peer];
        if (!cur) return {};
        return { conversations: { ...s.conversations, [peer]: { ...cur, lastReadSequence: Math.max(cur.lastReadSequence, r.lastReadSequence), unreadCount: r.unreadCount } } };
      });
    } catch (e) {
      if (at !== epoch) return;
      reading.delete(peer);
      // 位置不属于这个会话：重新拉一遍消息
      if (e instanceof ApiError && e.code === 5806) void openThread(peer).catch(() => undefined);
      return;
    }
    if (reading.get(peer)?.sequence === next.sequence) return void reading.delete(peer);
  }
}

// ---------------- 事件 ----------------

export function onMessageCreated(msg: DirectMessageDto) {
  const mine = msg.senderUserId === me();
  const peer = peerOf(msg.conversationId) ?? (mine ? null : msg.senderUserId);
  // 自己在别的设备上给新的人发了第一条：不知道是谁，刷新列表
  if (!peer) return listSoon();
  if (!mine && !messagesStore.get().conversations[peer]) notify(peer, msg);
  const { threads, conversations } = messagesStore.get();
  const t = threads[peer];
  if (t?.loaded) {
    const last = t.messages.at(-1)?.sequence ?? 0;
    if (msg.sequence > last + 1) void catchUp(peer).catch(() => undefined);
    else mergeMessages(peer, [msg]);
  }
  const c = conversations[peer];
  if (!c) return listSoon();
  if (c.lastMessage && c.lastMessage.sequence >= msg.sequence) return;
  messagesStore.set((s) => ({
    conversations: {
      ...s.conversations,
      [peer]: { ...c, id: msg.conversationId, lastMessage: msg, unreadCount: c.unreadCount + (!mine && msg.sequence > c.lastReadSequence ? 1 : 0) },
    },
  }));
  if (!mine && msg.sequence > c.lastReadSequence) notify(peer, msg);
  summarySoon(peer);
}

/** 已有消息的内容变了（目前只有一起听邀请的状态）：原地替换，不算新消息、不动未读和排序 */
export function onMessageUpdated(msg: DirectMessageDto) {
  const peer = peerOf(msg.conversationId);
  if (!peer) return listSoon();
  const { threads, conversations } = messagesStore.get();
  if (threads[peer]?.messages.some((m) => m.id === msg.id)) mergeMessages(peer, [msg]);
  const c = conversations[peer];
  if (c?.lastMessage?.id === msg.id && stamp(msg) >= stamp(c.lastMessage)) {
    messagesStore.set((s) => ({ conversations: { ...s.conversations, [peer]: { ...s.conversations[peer], lastMessage: msg } } }));
  }
}

export function onMessageRead(e: { conversationId: string; userId: string; lastReadSequence: number }) {
  const peer = peerOf(e.conversationId);
  if (!peer) return;
  const c = messagesStore.get().conversations[peer];
  if (e.userId === me()) {
    if (e.lastReadSequence <= c.lastReadSequence) return;
    messagesStore.set((s) => ({ conversations: { ...s.conversations, [peer]: { ...c, lastReadSequence: e.lastReadSequence } } }));
    summarySoon(peer);
  } else if (e.lastReadSequence > c.peerLastReadSequence) {
    messagesStore.set((s) => ({ conversations: { ...s.conversations, [peer]: { ...c, peerLastReadSequence: e.lastReadSequence } } }));
  }
}
