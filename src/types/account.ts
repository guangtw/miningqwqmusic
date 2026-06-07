import type { ImportedPlaylist, Track } from "@/src/types/music";

export type AccountUser = {
  id: string;
  email: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  avatarFallbackText?: string;
  avatarFallbackBg?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AuthStatus = "guest" | "authenticating" | "authenticated" | "error";

export type SyncState = "idle" | "syncing" | "failed" | "success";

export type AuthTokenData = {
  accessToken: string;
  user?: AccountUser;
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

export type ListenPlaybackState = {
  queue: Track[];
  currentIndex: number;
  currentTimeMs: number;
  isPlaying: boolean;
  mode: "sequence" | "loop-one" | "shuffle";
  updatedAt: string;
};

export type ListenRoomMemberSummary = {
  user: AccountUser;
  role: "host" | "member";
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
};

export type ListenRoomSummary = {
  id: string;
  inviteCode: string;
  hostUserId: string;
  status: "open" | "closed" | "expired";
  version: number;
  playbackState: ListenPlaybackState;
  members: ListenRoomMemberSummary[];
  lastActor?: AccountUser | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ListenRoomEvent = {
  version: number;
  type: string;
  payload: ListenPlaybackState | Record<string, unknown> | null;
  actor: AccountUser;
  createdAt: string;
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
