import { ApiError, coverOf, type AccountUser, type AuthPayload, type AuthTokenData, type LibraryRevisionResult, type LibrarySnapshot, type Track } from '../api';
import type { PlaybackAuthorization } from '@/src/types/account';
import type { ImportedPlaylist } from '@/src/types/music';
import { path, request, type RequestInitEx } from '../api/http';
import { api } from '../config/site';
import { readJSON, writeJSON } from './storage';
import { createStore } from './store';
import { mergeCloudPlaylists } from './playlists';
import { toast } from './toast';

const p = api.paths;

// ================= 登录态 =================

type AuthStatus = 'checking' | 'unavailable' | 'guest' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: AccountUser | null;
  /** access token 只放内存；刷新靠 BFF 下发的 httpOnly cookie */
  token: string | null;
  playbackAuthorization: PlaybackAuthorization | null;
}

export const authStore = createStore<AuthState>({ status: 'checking', user: null, token: null, playbackAuthorization: null });

const isInvalidSession = (e: unknown) =>
  e instanceof ApiError && e.status === 401 && (api.codes.invalidSession as readonly number[]).includes(e.code);
const isDisabled = (e: unknown) => e instanceof ApiError && e.code === api.codes.accountDisabled;

let authGeneration = 0;
let refreshError: unknown = null;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let recoveryWatching = false;
let recoveryDelay = 1000;
const AUTH_EVENT = 'cph.auth.event';

async function sessionLock<T>(run: () => Promise<T>): Promise<T> {
  // Shared across tabs: the browser applies Set-Cookie before releasing this lock.
  return navigator.locks ? await navigator.locks.request('mqm-session-cookie', run) : await run();
}

function expiresSoon(token: string | null): boolean {
  const expiry = tokenExpiry(token);
  return expiry != null && expiry <= Date.now() + 30_000;
}

function tokenExpiry(token: string | null): number | null {
  try {
    const payload = JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

function scheduleRecovery(delay: number) {
  clearTimeout(recoveryTimer);
  if (recoveryWatching) recoveryTimer = setTimeout(() => void restoreSession(), delay);
}

function publishAuth(type: 'login' | 'logout') {
  writeJSON(AUTH_EVENT, { type, at: Date.now(), nonce: Math.random() });
}

function apply(data: AuthTokenData | AuthPayload) {
  authStore.set((s) => ({
    token: data.accessToken ?? s.token,
    user: data.user ?? s.user,
    status: 'authenticated',
    playbackAuthorization: data.playbackAuthorization ?? s.playbackAuthorization,
  }));
  refreshError = null;
  recoveryDelay = 1000;
  const expiry = tokenExpiry(authStore.get().token);
  if (expiry != null) scheduleRecovery(Math.max(1000, expiry - Date.now() - 30_000));
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  // 并发请求同时 401 时只刷新一次
  const generation = authGeneration;
  refreshing ??= sessionLock(async () => {
    if (generation !== authGeneration) return false;
    return request<AuthTokenData>(p.authRefresh, { method: 'POST' })
    .then((d) => {
      if (generation !== authGeneration) return false;
      apply(d);
      return true;
    })
    .catch((e) => {
      if (generation !== authGeneration) return false;
      refreshError = e;
      if (isDisabled(e)) {
        refreshError = null;
        clearTimeout(recoveryTimer);
        authStore.set({ status: 'unavailable', user: null, token: null, playbackAuthorization: null });
      } else if (isInvalidSession(e) || (e instanceof ApiError && e.status === 401)) {
        refreshError = null;
        clearTimeout(recoveryTimer);
        authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
      } else {
        // Network/429/5xx do not prove that the session expired.
        scheduleRecovery(recoveryDelay);
        recoveryDelay = Math.min(30_000, recoveryDelay * 2);
      }
      return false;
    });
  })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * 给自己发请求的地方（一起听的推送流）用：拿一个还没过期的 token。
 * force 为 true 表示刚收到 401，强制换一次。
 */
export async function accessToken(force = false): Promise<string | null> {
  const s = authStore.get();
  if (force || s.status === 'checking' || expiresSoon(s.token)) await refresh();
  return authStore.get().token;
}

/** 带登录态的请求：401 时刷新一次 token 再重试 */
export async function authed<T>(urlPath: string, init: RequestInitEx = {}): Promise<T> {
  const generation = authGeneration;
  if (authStore.get().status === 'checking' || expiresSoon(authStore.get().token)) await refresh();
  const sentToken = authStore.get().token;
  try {
    return await request<T>(urlPath, { ...init, token: sentToken });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (generation !== authGeneration) throw e;
    // A late 401 from the old token must not rotate an already renewed cookie.
    if (sentToken === authStore.get().token && !(await refresh())) throw refreshError ?? e;
    return request<T>(urlPath, { ...init, token: authStore.get().token });
  }
}

/** 启动时恢复会话；账户服务没开就进入 unavailable，界面会隐藏登录入口 */
export async function restoreSession() {
  const generation = authGeneration;
  const ok = await refresh();
  if (!ok || generation !== authGeneration) {
    return;
  }
  try {
    const data = await authed<AuthPayload>(p.authMe);
    if (generation !== authGeneration) return;
    apply(data);
  } catch {
    // me 失败不影响已拿到的 token
  }
  if (generation === authGeneration) void pullLibrary({ merge: true });
}

export async function login(email: string, password: string) {
  lastPull = 0;
  const generation = ++authGeneration;
  const data = await sessionLock(() => request<AuthPayload>(p.authLogin, { method: 'POST', body: { email, password } }));
  if (generation !== authGeneration) return;
  apply(data);
  publishAuth('login');
  void pullLibrary({ merge: true });
}

export async function register(email: string, password: string, nickname?: string) {
  lastPull = 0;
  const generation = ++authGeneration;
  const data = await sessionLock(() => request<AuthPayload>(p.authRegister, { method: 'POST', body: { email, password, nickname: nickname || undefined } }));
  if (generation !== authGeneration) return;
  apply(data);
  publishAuth('login');
  void pullLibrary({ merge: true });
}

export async function logout() {
  ++authGeneration;
  refreshError = null;
  clearTimeout(recoveryTimer);
  const token = authStore.get().token;
  authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
  await sessionLock(() => request(p.authLogout, { method: 'POST', token })).catch(() => undefined);
  publishAuth('logout');
  lastPull = 0;
}

/** 退出所有设备：撤销这个账号的全部会话（包括这台），其他标签页跟着退出 */
export async function logoutAll() {
  await sessionLock(() => authed(p.authLogoutAll, { method: 'POST' }));
  ++authGeneration;
  refreshError = null;
  clearTimeout(recoveryTimer);
  authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
  publishAuth('logout');
  lastPull = 0;
}

/**
 * 改密码。账户服务改完会撤销全部会话（包括这台），
 * 所以接着用新密码重新登录一次，这台设备不用掉线。
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<'relogged' | 'signed-out'> {
  const email = authStore.get().user?.email;
  await authed(p.authChangePassword, { method: 'POST', body: { oldPassword, newPassword } });
  // 重新登录会广播 login，其他标签页随之用新 Cookie 恢复会话
  if (email) {
    try {
      await login(email, newPassword);
      return 'relogged';
    } catch {
      /* 重新登录失败就当退出了 */
    }
  }
  ++authGeneration;
  clearTimeout(recoveryTimer);
  authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
  publishAuth('logout');
  return 'signed-out';
}

/** 资料改动（昵称、头像）后，用账户服务返回的新资料替换当前用户 */
export function setUser(user: AccountUser) {
  if (authStore.get().user?.id === user.id) authStore.set({ user });
}

/** Retry after connectivity/foreground recovery; coordinate login/logout across tabs. */
export function watchSessionRecovery() {
  recoveryWatching = true;
  const recover = () => {
    if (document.visibilityState !== 'hidden' && (refreshError || authStore.get().status === 'checking' || expiresSoon(authStore.get().token)))
      void restoreSession();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== AUTH_EVENT || !event.newValue) return;
    try {
      const { type } = JSON.parse(event.newValue);
      if (type === 'logout') {
        ++authGeneration;
        clearTimeout(recoveryTimer);
        refreshError = null;
        authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
      } else if (type === 'login') {
        ++authGeneration;
        const pending = refreshing;
        void (pending ?? Promise.resolve()).then(() => restoreSession());
      }
    } catch { /* Ignore malformed device events. */ }
  };
  window.addEventListener('online', recover);
  document.addEventListener('visibilitychange', recover);
  window.addEventListener('storage', storage);
  return () => {
    recoveryWatching = false;
    clearTimeout(recoveryTimer);
    window.removeEventListener('online', recover);
    document.removeEventListener('visibilitychange', recover);
    window.removeEventListener('storage', storage);
  };
}

export const displayName = (u: AccountUser) => u.nickname || u.email.split('@')[0];

// ================= 唱片架（收藏 / 最近播放） =================

interface LibraryState {
  favorites: Record<string, Track>;
  /** 收藏顺序，最新的在前 */
  favoriteOrder: string[];
  recent: Track[];
  revision: number;
  /** Keep failed/offline favorite mutations until the server acknowledges them. */
  pendingFavorites: Record<string, boolean>;
  /** 歌单（自建 + 链接导入），分卷已拼好；云端格式见 playlists.ts */
  importedPlaylists: Record<string, ImportedPlaylist>;
  /** 本机改了还没同步上去的歌单 */
  pendingPlaylists: Record<string, 'upsert' | 'delete' | 'reorder'>;
  /** 每张歌单在云端占了哪些记录（分卷 id） */
  cloudParts: Record<string, string[]>;
  /** 云端每条记录的内容签名，没变的分卷保存时跳过 */
  cloudSigs: Record<string, string>;
}

const LIB_KEY = 'cph.library';
const saved = readJSON<Partial<LibraryState>>(LIB_KEY, {});

export const libraryStore = createStore<LibraryState>({
  favorites: saved.favorites ?? {},
  favoriteOrder: saved.favoriteOrder ?? Object.keys(saved.favorites ?? {}),
  recent: saved.recent ?? [],
  revision: saved.revision ?? 0,
  pendingFavorites: saved.pendingFavorites ?? {},
  importedPlaylists: saved.importedPlaylists ?? {},
  pendingPlaylists: saved.pendingPlaylists ?? {},
  cloudParts: saved.cloudParts ?? {},
  cloudSigs: saved.cloudSigs ?? {},
});

libraryStore.subscribe(() => writeJSON(LIB_KEY, libraryStore.get()));

/** 云端只存精简后的曲目，避免把大字段带上去 */
const slim = (t: Track): Track => ({
  id: t.id,
  name: t.name,
  artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
  album: t.album ? { id: t.album.id, name: t.album.name, coverUrl: t.album.coverUrl } : undefined,
  durationMs: t.durationMs,
  coverUrl: coverOf(t),
});

const signedIn = () => authStore.get().status === 'authenticated';

export const isFavorite = (id: string) => id in libraryStore.get().favorites;

export async function toggleFavorite(track: Track) {
  const { favorites, favoriteOrder } = libraryStore.get();
  const was = track.id in favorites;
  const nextFav = { ...favorites };
  if (was) delete nextFav[track.id];
  else nextFav[track.id] = slim(track);
  libraryStore.set({
    favorites: nextFav,
    favoriteOrder: was ? favoriteOrder.filter((id) => id !== track.id) : [track.id, ...favoriteOrder],
    pendingFavorites: { ...libraryStore.get().pendingFavorites, [track.id]: !was },
  });
  toast(was ? '已从唱片架取下。' : `《${track.name}》放上唱片架了。`);

  if (!signedIn()) return;
  const userId = authStore.get().user?.id;
  try {
    const r = was
      ? await authed<LibraryRevisionResult>(path(p.libraryFavorite, { id: track.id }), { method: 'DELETE' })
      : await authed<LibraryRevisionResult>(p.libraryFavorites, { method: 'POST', body: { track: slim(track) } });
    if (!signedIn() || authStore.get().user?.id !== userId) return;
    const pendingFavorites = { ...libraryStore.get().pendingFavorites };
    if (pendingFavorites[track.id] === !was) delete pendingFavorites[track.id];
    libraryStore.set({ revision: r.revision, pendingFavorites });
  } catch (e) {
    toast(`云端同步失败：${(e as Error).message}`);
  }
}

export function pushRecent(track: Track) {
  const recent = [slim(track), ...libraryStore.get().recent.filter((t) => t.id !== track.id)].slice(0, api.recentLimit);
  libraryStore.set({ recent });
  if (signedIn()) void authed(p.libraryRecent, { method: 'POST', body: { track: slim(track) } }).catch(() => undefined);
}

let lastPull = 0;

/** 拉云端唱片架。merge=true（刚登录）时把本机独有的收藏补传上去 */
export async function pullLibrary(opts: { merge?: boolean; force?: boolean } = {}) {
  if (!signedIn()) return;
  if (!opts.force && !opts.merge && Date.now() - lastPull < api.libraryPullIntervalMs) return;
  try {
    const userId = authStore.get().user?.id;
    const snap = await authed<LibrarySnapshot>(p.librarySnapshot);
    if (!signedIn() || authStore.get().user?.id !== userId) return;
    lastPull = Date.now();
    const local = libraryStore.get();
    const localOnly = local.favoriteOrder.filter((id) => local.pendingFavorites[id] === true ||
      (opts.merge && !(id in snap.favorites)));

    const favorites = { ...snap.favorites };
    for (const id of localOnly) favorites[id] = local.favorites[id];
    for (const [id, liked] of Object.entries(local.pendingFavorites)) if (!liked) delete favorites[id];
    const cloudOrder = Object.keys(snap.favorites);
    const order = [...localOnly, ...local.favoriteOrder.filter((id) => id in snap.favorites), ...cloudOrder];

    const seen = new Set<string>();
    const recent = [...snap.recent, ...(opts.merge ? local.recent : [])]
      .filter((t) => !seen.has(t.id) && !!seen.add(t.id))
      .slice(0, api.recentLimit);

    libraryStore.set({ favorites, favoriteOrder: [...new Set(order)].filter((id) => id in favorites), recent, revision: snap.revision });
    void mergeCloudPlaylists(snap.importedPlaylists ?? {}, !!opts.merge);

    const pending = { ...Object.fromEntries(localOnly.map((id) => [id, true])), ...local.pendingFavorites };
    for (const [id, liked] of Object.entries(pending)) {
      if (!signedIn() || authStore.get().user?.id !== userId) return;
      try {
        if (liked) await authed(p.libraryFavorites, { method: 'POST', body: { track: favorites[id] } });
        else await authed(path(p.libraryFavorite, { id }), { method: 'DELETE' });
        const pendingFavorites = { ...libraryStore.get().pendingFavorites };
        if (pendingFavorites[id] === liked) delete pendingFavorites[id];
        libraryStore.set({ pendingFavorites });
      } catch { /* Retain pending device edits for the next synchronization. */ }
    }
  } catch {
    // 拉取失败保留本地数据，下次再试
  }
}
