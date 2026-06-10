import { useAuthStore } from "@/src/store/auth-store";
import type {
  ApiFailure,
  ApiResult,
  AuthPayload,
  AuthTokenData,
  ChangePasswordInput,
  AcceptListenInviteResult,
  FriendRequestSummary,
  FriendRequestsResult,
  FriendSearchResult,
  FriendSummary,
  ListenPlaybackState,
  ListenRoomInviteSummary,
  ListenRoomEvent,
  ListenRoomSummary,
  LibraryChangesResult,
  LibraryRevisionResult,
  LibrarySnapshot,
  LoginInput,
  MusicUnblockEntitlement,
  RegisterInput,
  UpdateProfileInput
} from "@/src/types/account";
import type { ImportedPlaylist, Track } from "@/src/types/music";

type RequestOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  authorization?: string | null;
  retryOnUnauthorized?: boolean;
};

export type RefreshAttemptResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error?: AccountApiError;
    };

export class AccountApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly traceId?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code: number; status: number; traceId?: string; retryable?: boolean }) {
    super(message);
    this.name = "AccountApiError";
    this.code = options.code;
    this.status = options.status;
    this.traceId = options.traceId;
    this.retryable = options.retryable ?? false;
  }
}

function isApiFailure(payload: unknown): payload is ApiFailure {
  if (!payload || typeof payload !== "object") return false;
  return "code" in payload && "message" in payload && "traceId" in payload && "retryable" in payload;
}

async function parseResult<T>(response: Response): Promise<ApiResult<T>> {
  const payload = (await response.json()) as ApiResult<T>;
  return payload;
}

function normalizeFailure(response: Response, payload: unknown): AccountApiError {
  if (isApiFailure(payload)) {
    return new AccountApiError(payload.message || "请求失败", {
      code: payload.code,
      status: response.status,
      traceId: payload.traceId,
      retryable: payload.retryable
    });
  }
  return new AccountApiError(`请求失败（HTTP ${response.status}）`, {
    code: 5000,
    status: response.status,
    retryable: false
  });
}

function withJsonHeaders(options: RequestInit): RequestInit {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return {
    ...options,
    headers
  };
}

async function fetchAccount<T>(path: string, options: RequestOptions): Promise<T> {
  const token = options.authorization ?? useAuthStore.getState().accessToken;
  const headers = new Headers();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const init = withJsonHeaders({
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store"
  });

  let response = await fetch(path, init);
  let payload: ApiResult<T> | unknown;
  try {
    payload = await parseResult<T>(response);
  } catch {
    throw new AccountApiError(`请求失败（HTTP ${response.status}）`, {
      code: 5000,
      status: response.status,
      retryable: false
    });
  }

  if (response.ok && payload && typeof payload === "object" && "code" in payload && payload.code === 0 && "data" in payload) {
    return payload.data as T;
  }

  const shouldRetryUnauthorized =
    options.retryOnUnauthorized !== false &&
    response.status === 401 &&
    path !== "/api/account/auth/refresh";

  if (shouldRetryUnauthorized) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers();
      const retriedToken = useAuthStore.getState().accessToken;
      if (retriedToken) {
        retryHeaders.set("authorization", `Bearer ${retriedToken}`);
      }
      const retriedInit = withJsonHeaders({
        method: options.method,
        headers: retryHeaders,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store"
      });
      response = await fetch(path, retriedInit);
      payload = await parseResult<T>(response);
      if (response.ok && payload && typeof payload === "object" && "code" in payload && payload.code === 0 && "data" in payload) {
        return payload.data as T;
      }
    }
    useAuthStore.getState().setGuest();
  }

  throw normalizeFailure(response, payload);
}

async function fetchAccountForm<T>(path: string, form: FormData): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  let response = await fetch(path, {
    method: "POST",
    headers,
    body: form,
    cache: "no-store"
  });
  let payload: ApiResult<T> | unknown;
  try {
    payload = await parseResult<T>(response);
  } catch {
    throw new AccountApiError(`请求失败（HTTP ${response.status}）`, {
      code: 5000,
      status: response.status,
      retryable: false
    });
  }
  if (response.ok && payload && typeof payload === "object" && "code" in payload && payload.code === 0 && "data" in payload) {
    return payload.data as T;
  }
  if (response.status === 401) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      const retryToken = useAuthStore.getState().accessToken;
      const retryHeaders = new Headers();
      if (retryToken) retryHeaders.set("authorization", `Bearer ${retryToken}`);
      response = await fetch(path, {
        method: "POST",
        headers: retryHeaders,
        body: form,
        cache: "no-store"
      });
      payload = await parseResult<T>(response);
      if (response.ok && payload && typeof payload === "object" && "code" in payload && payload.code === 0 && "data" in payload) {
        return payload.data as T;
      }
    }
  }
  throw normalizeFailure(response, payload);
}

export async function tryRefreshAccessToken(): Promise<boolean> {
  const result = await tryRefreshAccessTokenDetailed();
  return result.ok;
}

export async function tryRefreshAccessTokenDetailed(): Promise<RefreshAttemptResult> {
  try {
    const data = await fetchAccount<AuthTokenData>("/api/account/auth/refresh", {
      method: "POST",
      retryOnUnauthorized: false
    });
    useAuthStore.getState().updateAccessToken(data.accessToken);
    if (data.user) {
      useAuthStore.getState().updateUser(data.user);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof AccountApiError) {
      return {
        ok: false,
        error
      };
    }
    return { ok: false };
  }
}

export async function registerAccount(input: RegisterInput): Promise<AuthPayload> {
  const data = await fetchAccount<AuthPayload>("/api/account/auth/register", {
    method: "POST",
    body: input,
    retryOnUnauthorized: false
  });
  useAuthStore.getState().setAuthenticated(data.user, data.accessToken);
  return data;
}

export async function loginAccount(input: LoginInput): Promise<AuthPayload> {
  const data = await fetchAccount<AuthPayload>("/api/account/auth/login", {
    method: "POST",
    body: input,
    retryOnUnauthorized: false
  });
  useAuthStore.getState().setAuthenticated(data.user, data.accessToken);
  return data;
}

export async function loadCurrentAccountUser() {
  return fetchAccount<AuthPayload["user"]>("/api/account/auth/me", {
    method: "GET"
  });
}

export async function uploadAccountAvatar(file: File): Promise<AuthPayload["user"]> {
  const form = new FormData();
  form.set("avatar", file);
  const user = await fetchAccountForm<AuthPayload["user"]>("/api/account/profile/avatar", form);
  useAuthStore.getState().updateUser(user);
  return user;
}

export async function deleteAccountAvatar(): Promise<AuthPayload["user"]> {
  const user = await fetchAccount<AuthPayload["user"]>("/api/account/profile/avatar", {
    method: "DELETE"
  });
  useAuthStore.getState().updateUser(user);
  return user;
}

export async function searchFriends(query: string): Promise<FriendSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return fetchAccount<FriendSearchResult[]>(`/api/account/friends/search?q=${encodeURIComponent(trimmed)}`, {
    method: "GET"
  });
}

export async function listFriends(): Promise<FriendSummary[]> {
  return fetchAccount<FriendSummary[]>("/api/account/friends", {
    method: "GET"
  });
}

export async function listFriendRequests(): Promise<FriendRequestsResult> {
  return fetchAccount<FriendRequestsResult>("/api/account/friends/requests", {
    method: "GET"
  });
}

export async function sendFriendRequest(userId: string): Promise<FriendRequestSummary> {
  return fetchAccount<FriendRequestSummary>("/api/account/friends/requests", {
    method: "POST",
    body: { userId }
  });
}

export async function acceptFriendRequest(requestId: string): Promise<FriendRequestSummary> {
  return fetchAccount<FriendRequestSummary>(`/api/account/friends/requests/${encodeURIComponent(requestId)}/accept`, {
    method: "POST"
  });
}

export async function rejectFriendRequest(requestId: string): Promise<FriendRequestSummary> {
  return fetchAccount<FriendRequestSummary>(`/api/account/friends/requests/${encodeURIComponent(requestId)}/reject`, {
    method: "POST"
  });
}

export async function cancelFriendRequest(requestId: string): Promise<FriendRequestSummary> {
  return fetchAccount<FriendRequestSummary>(`/api/account/friends/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST"
  });
}

export async function deleteFriend(friendUserId: string): Promise<void> {
  await fetchAccount<{ ok: true }>(`/api/account/friends/${encodeURIComponent(friendUserId)}`, {
    method: "DELETE"
  });
}

export async function createListenRoom(playbackState: ListenPlaybackState): Promise<ListenRoomSummary> {
  return fetchAccount<ListenRoomSummary>("/api/account/listen/rooms", {
    method: "POST",
    body: { playbackState }
  });
}

export async function joinListenRoom(inviteCode: string): Promise<ListenRoomSummary> {
  return fetchAccount<ListenRoomSummary>("/api/account/listen/rooms/join", {
    method: "POST",
    body: { inviteCode }
  });
}

export async function getListenRoom(roomId: string): Promise<ListenRoomSummary> {
  return fetchAccount<ListenRoomSummary>(`/api/account/listen/rooms/${encodeURIComponent(roomId)}`, {
    method: "GET"
  });
}

export async function sendListenRoomState(
  roomId: string,
  type: "playback" | "queue" | "seek" | "mode" | "progress",
  playbackState: ListenPlaybackState
): Promise<ListenRoomSummary> {
  return fetchAccount<ListenRoomSummary>(`/api/account/listen/rooms/${encodeURIComponent(roomId)}/state`, {
    method: "POST",
    body: { type, playbackState }
  });
}

export async function heartbeatListenRoom(roomId: string): Promise<ListenRoomSummary> {
  return fetchAccount<ListenRoomSummary>(`/api/account/listen/rooms/${encodeURIComponent(roomId)}/heartbeat`, {
    method: "POST"
  });
}

export async function leaveListenRoom(roomId: string): Promise<void> {
  await fetchAccount<{ ok: true }>(`/api/account/listen/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: "POST"
  });
}

export async function listListenInvites(): Promise<ListenRoomInviteSummary[]> {
  return fetchAccount<ListenRoomInviteSummary[]>("/api/account/listen/invites", {
    method: "GET"
  });
}

export async function inviteFriendToListenRoom(roomId: string, friendUserId: string): Promise<ListenRoomInviteSummary> {
  return fetchAccount<ListenRoomInviteSummary>(`/api/account/listen/rooms/${encodeURIComponent(roomId)}/invites`, {
    method: "POST",
    body: { friendUserId }
  });
}

export async function acceptListenInvite(inviteId: string): Promise<AcceptListenInviteResult> {
  return fetchAccount<AcceptListenInviteResult>(`/api/account/listen/invites/${encodeURIComponent(inviteId)}/accept`, {
    method: "POST"
  });
}

export async function rejectListenInvite(inviteId: string): Promise<ListenRoomInviteSummary> {
  return fetchAccount<ListenRoomInviteSummary>(`/api/account/listen/invites/${encodeURIComponent(inviteId)}/reject`, {
    method: "POST"
  });
}

export async function openListenRoomStream(
  roomId: string,
  sinceVersion: number,
  onEvent: (event: ListenRoomEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`/api/account/listen/rooms/${encodeURIComponent(roomId)}/stream?sinceVersion=${Math.max(0, sinceVersion)}`, {
    method: "GET",
    headers,
    cache: "no-store",
    signal
  });
  if (!response.ok || !response.body) {
    throw new AccountApiError(`一起听连接失败（HTTP ${response.status}）`, {
      code: 5506,
      status: response.status,
      retryable: true
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const eventLine = chunk.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
      const eventName = eventLine?.slice("event:".length).trim();
      if (!dataLine || eventName === "ready") continue;
      if (eventName === "closed") {
        throw new AccountApiError("一起听房间已关闭", {
          code: 5505,
          status: 410,
          retryable: false
        });
      }
      const payload = JSON.parse(dataLine.slice("data:".length).trim()) as ListenRoomEvent;
      onEvent(payload);
    }
  }
}

export async function getMusicUnblockEntitlement(): Promise<MusicUnblockEntitlement> {
  return fetchAccount<MusicUnblockEntitlement>("/api/account/music/unblock/entitlement", {
    method: "GET"
  });
}

export async function redeemMusicUnblockInvite(inviteCode: string): Promise<MusicUnblockEntitlement> {
  return fetchAccount<MusicUnblockEntitlement>("/api/account/music/unblock/redeem", {
    method: "POST",
    body: { inviteCode }
  });
}

export async function logoutAccount(): Promise<void> {
  await fetchAccount<{ ok: true }>("/api/account/auth/logout", {
    method: "POST",
    retryOnUnauthorized: false
  });
  useAuthStore.getState().setGuest();
}

export async function logoutAllAccountSessions(): Promise<void> {
  await fetchAccount<{ ok: true }>("/api/account/auth/logout-all", {
    method: "POST"
  });
  useAuthStore.getState().setGuest();
}

export async function changeAccountPassword(input: ChangePasswordInput): Promise<void> {
  await fetchAccount<{ ok: true }>("/api/account/auth/change-password", {
    method: "POST",
    body: input
  });
}

export async function updateAccountProfile(input: UpdateProfileInput): Promise<AuthPayload["user"]> {
  const user = await fetchAccount<AuthPayload["user"]>("/api/account/profile", {
    method: "PATCH",
    body: input
  });
  useAuthStore.getState().updateUser(user);
  return user;
}

export async function getLibrarySnapshot(): Promise<LibrarySnapshot> {
  return fetchAccount<LibrarySnapshot>("/api/account/library/snapshot", {
    method: "GET"
  });
}

export async function putLibrarySnapshot(snapshot: {
  revision: number;
  favorites: Record<string, Track>;
  recent: Track[];
  importedPlaylists: Record<string, ImportedPlaylist>;
}): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>("/api/account/library/snapshot", {
    method: "PUT",
    body: snapshot
  });
}

export async function getLibraryChanges(sinceRevision: number): Promise<LibraryChangesResult> {
  return fetchAccount<LibraryChangesResult>(`/api/account/library/changes?sinceRevision=${Math.max(0, sinceRevision)}`, {
    method: "GET"
  });
}

export async function addFavoriteTrack(track: Track): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>("/api/account/library/favorites", {
    method: "POST",
    body: { track }
  });
}

export async function removeFavoriteTrack(trackId: string): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>(`/api/account/library/favorites/${encodeURIComponent(trackId)}`, {
    method: "DELETE"
  });
}

export async function addRecentTrack(track: Track): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>("/api/account/library/recent", {
    method: "POST",
    body: { track }
  });
}

export async function upsertImportedPlaylistCloud(playlist: ImportedPlaylist): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>(`/api/account/library/imported-playlists/${encodeURIComponent(playlist.id)}`, {
    method: "PUT",
    body: { playlist }
  });
}

export async function removeImportedPlaylistCloud(playlistId: string): Promise<LibraryRevisionResult> {
  return fetchAccount<LibraryRevisionResult>(`/api/account/library/imported-playlists/${encodeURIComponent(playlistId)}`, {
    method: "DELETE"
  });
}

export async function detectAccountServiceEnabled(): Promise<boolean> {
  try {
    await fetchAccount<AuthTokenData>("/api/account/auth/refresh", {
      method: "POST",
      retryOnUnauthorized: false
    });
    return true;
  } catch (error) {
    if (error instanceof AccountApiError && error.code === 5401) {
      return false;
    }
    return true;
  }
}
