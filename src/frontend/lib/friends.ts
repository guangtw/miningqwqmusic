import type { FriendRequestsResult, FriendRequestSummary, FriendSearchResult, FriendSummary, ListenRoomInviteSummary } from '@/src/types/account';
import { path } from '../api/http';
import { api } from '../config/site';
import { authed, authStore } from './account';
import { createStore } from './store';

// 好友和收到的一起听邀请。登录后每半分钟问一次（页面在后台时不问），
// 侧栏头像上的小红点和右下角的邀请卡片都看这里。

const p = api.paths;
const POLL_MS = 30_000;

interface SocialState {
  friends: FriendSummary[];
  requests: FriendRequestsResult;
  invites: ListenRoomInviteSummary[];
  /** 好友列表至少拉到过一次 */
  loaded: boolean;
}

const empty = (): SocialState => ({ friends: [], requests: { incoming: [], outgoing: [] }, invites: [], loaded: false });
export const socialStore = createStore<SocialState>(empty());

export async function refreshSocial() {
  const user = authStore.get().user?.id;
  if (authStore.get().status !== 'authenticated') return;
  const [friends, requests, invites] = await Promise.allSettled([
    authed<FriendSummary[]>(p.friends),
    authed<FriendRequestsResult>(p.friendRequests),
    authed<ListenRoomInviteSummary[]>(p.listenInvites),
  ]);
  // 等回来的时候已经换了账号：丢掉
  if (authStore.get().user?.id !== user) return;
  socialStore.set((s) => ({
    friends: friends.status === 'fulfilled' ? friends.value : s.friends,
    requests: requests.status === 'fulfilled' ? requests.value : s.requests,
    invites: invites.status === 'fulfilled' ? invites.value.filter((i) => i.status === 'pending') : s.invites,
    loaded: s.loaded || friends.status === 'fulfilled',
  }));
}

let timer: ReturnType<typeof setInterval> | undefined;
let started = false;

/** App 启动时调一次：登录了就开始轮询，退出登录清空 */
export function watchSocial() {
  if (started) return;
  started = true;
  let lastUser: string | undefined;
  const sync = () => {
    const s = authStore.get();
    const user = s.status === 'authenticated' ? s.user?.id : undefined;
    if (user === lastUser) return;
    lastUser = user;
    clearInterval(timer);
    socialStore.set(empty());
    if (!user) return;
    void refreshSocial();
    timer = setInterval(() => document.visibilityState === 'visible' && void refreshSocial(), POLL_MS);
  };
  authStore.subscribe(sync);
  sync();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && lastUser && void refreshSocial());
}

// ---------------- 好友 ----------------

export const searchUsers = (q: string, signal?: AbortSignal) => authed<FriendSearchResult[]>(p.friendSearch, { query: { q: q.trim() }, signal });

async function then<T>(work: Promise<T>) {
  const r = await work;
  void refreshSocial();
  return r;
}

export const sendFriendRequest = (userId: string) =>
  then(authed<FriendRequestSummary>(p.friendRequests, { method: 'POST', body: { userId } }));

export const answerFriendRequest = (id: string, action: 'accept' | 'reject' | 'cancel') =>
  then(authed<FriendRequestSummary>(path(p.friendRequestAction, { id, action }), { method: 'POST' }));

export const removeFriend = (id: string) => then(authed<{ ok: true }>(path(p.friend, { id }), { method: 'DELETE' }));

/** 别人的邮箱只露头尾：li***@example.com */
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const head = name.slice(0, Math.min(2, Math.max(1, name.length - 1)));
  return `${head}***@${domain}`;
}
