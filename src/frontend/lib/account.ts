import { ApiError, coverOf, type AccountUser, type AuthPayload, type AuthTokenData, type LibraryRevisionResult, type LibrarySnapshot, type Track } from '../api';
import type { PlaybackAuthorization } from '@/src/types/account';
import type { ImportedPlaylist } from '@/src/types/music';
import { path, request, type RequestInitEx } from '../api/http';
import { api } from '../config/site';
import { readJSON, writeJSON } from './storage';
import { createStore } from './store';
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

function apply(data: AuthTokenData | AuthPayload) {
  authStore.set((s) => ({
    token: data.accessToken ?? s.token,
    user: data.user ?? s.user,
    status: 'authenticated',
    playbackAuthorization: data.playbackAuthorization ?? s.playbackAuthorization,
  }));
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  // 并发请求同时 401 时只刷新一次
  refreshing ??= request<AuthTokenData>(p.authRefresh, { method: 'POST' })
    .then((d) => {
      apply(d);
      return true;
    })
    .catch((e) => {
      if (isDisabled(e)) authStore.set({ status: 'unavailable', user: null, token: null, playbackAuthorization: null });
      else if (isInvalidSession(e) || (e instanceof ApiError && e.status === 401))
        authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** 带登录态的请求：401 时刷新一次 token 再重试 */
export async function authed<T>(urlPath: string, init: RequestInitEx = {}): Promise<T> {
  if (authStore.get().status === 'checking') await refresh();
  try {
    return await request<T>(urlPath, { ...init, token: authStore.get().token });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (!(await refresh())) throw e;
    return request<T>(urlPath, { ...init, token: authStore.get().token });
  }
}

/** 启动时恢复会话；账户服务没开就进入 unavailable，界面会隐藏登录入口 */
export async function restoreSession() {
  const ok = await refresh();
  if (!ok) {
    if (authStore.get().status === 'checking') authStore.set({ status: 'guest' });
    return;
  }
  try {
    apply(await authed<AuthPayload>(p.authMe));
  } catch {
    // me 失败不影响已拿到的 token
  }
  void pullLibrary({ merge: true });
}

export async function login(email: string, password: string) {
  lastPull = 0;
  apply(await request<AuthPayload>(p.authLogin, { method: 'POST', body: { email, password } }));
  void pullLibrary({ merge: true });
}

export async function register(email: string, password: string, nickname?: string) {
  lastPull = 0;
  apply(await request<AuthPayload>(p.authRegister, { method: 'POST', body: { email, password, nickname: nickname || undefined } }));
  void pullLibrary({ merge: true });
}

export async function logout() {
  await authed(p.authLogout, { method: 'POST' }).catch(() => undefined);
  authStore.set({ status: 'guest', user: null, token: null, playbackAuthorization: null });
  lastPull = 0;
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
  /** Preserve old imports even though the upstream UI only exposes favorites/recent. */
  importedPlaylists: Record<string, ImportedPlaylist>;
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
