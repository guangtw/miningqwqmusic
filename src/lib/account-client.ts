import { useAuthStore } from "@/src/store/auth-store";
import type {
  ApiFailure,
  ApiResult,
  AuthPayload,
  AuthTokenData,
  ChangePasswordInput,
  LibraryChangesResult,
  LibraryRevisionResult,
  LibrarySnapshot,
  LoginInput,
  RegisterInput
} from "@/src/types/account";
import type { ImportedPlaylist, Track } from "@/src/types/music";

type RequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  authorization?: string | null;
  retryOnUnauthorized?: boolean;
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

export async function tryRefreshAccessToken(): Promise<boolean> {
  try {
    const data = await fetchAccount<AuthTokenData>("/api/account/auth/refresh", {
      method: "POST",
      retryOnUnauthorized: false
    });
    useAuthStore.getState().updateAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
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