import type { ImportedPlaylist, Track } from "@/src/types/music";

export type AccountUser = {
  id: string;
  email: string;
  nickname?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AuthStatus = "guest" | "authenticating" | "authenticated" | "error";

export type SyncState = "idle" | "syncing" | "failed" | "success";

export type AuthTokenData = {
  accessToken: string;
};

export type AuthPayload = AuthTokenData & {
  user: AccountUser;
};

export type RegisterInput = {
  email: string;
  password: string;
  nickname?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type ChangePasswordInput = {
  oldPassword: string;
  newPassword: string;
};

export type LibrarySnapshot = {
  revision: number;
  favorites: Record<string, Track>;
  recent: Track[];
  importedPlaylists: Record<string, ImportedPlaylist>;
  updatedAt: string;
};

export type LibraryChangesResult = {
  fromRevision: number;
  toRevision: number;
  hasChanges: boolean;
  changes?: Array<Record<string, unknown>>;
  snapshot?: LibrarySnapshot;
};

export type LibraryRevisionResult = {
  revision: number;
  updatedAt: string;
};

export type ApiSuccess<T> = {
  code: 0;
  data: T;
  message: string;
  traceId: string;
};

export type ApiFailure = {
  code: number;
  message: string;
  traceId: string;
  retryable: boolean;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;