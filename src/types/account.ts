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

export type MusicUnblockEntitlement = {
  enabled: boolean;
  redeemedAt?: string;
  inviteLabel?: string | null;
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

export type UpdateProfileInput = {
  nickname: string;
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

export type FriendRelationStatus = "self" | "friend" | "incoming_pending" | "outgoing_pending" | "none";

export type FriendSearchResult = {
  user: AccountUser;
  relationStatus: FriendRelationStatus;
};

export type FriendSummary = {
  user: AccountUser;
  since: string;
};

export type FriendRequestSummary = {
  id: string;
  requester: AccountUser;
  addressee: AccountUser;
  status: "pending" | "accepted" | "rejected" | "canceled";
  direction: "incoming" | "outgoing";
  createdAt: string;
  updatedAt: string;
  respondedAt?: string | null;
};

export type FriendRequestsResult = {
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
};

export type ListenRoomInviteSummary = {
  id: string;
  roomId: string;
  inviteCode: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  inviter: AccountUser;
  invitee: AccountUser;
  roomStatus: ListenRoomSummary["status"];
  memberCount: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string | null;
};

export type AcceptListenInviteResult = {
  invite: ListenRoomInviteSummary;
  room: ListenRoomSummary;
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
