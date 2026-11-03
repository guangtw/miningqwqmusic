import type { ImportedPlaylist, Track } from "./music";

export type SharedAlbum = { id: string; name: string; coverUrl?: string; artists: { id: string; name: string }[]; trackCount?: number };
export type SharedPlaylist = { id: string; name: string; coverUrl?: string; description?: string; trackCount?: number };
export type SendDirectMessageInput =
  | { clientMessageId: string; kind?: "text"; text: string }
  | { clientMessageId: string; kind: "track"; text?: string; resource: Track }
  | { clientMessageId: string; kind: "album"; text?: string; resource: SharedAlbum }
  | { clientMessageId: string; kind: "playlist"; text?: string; resource: SharedPlaylist; playlistId?: never }
  | { clientMessageId: string; kind: "playlist"; text?: string; playlistId: string; resource?: never };
export type ListenMessageStatus = "pending" | "accepted" | "rejected" | "canceled" | "expired" | "unavailable";
export type ListenInvitationCard = {
  inviteId: string; roomId: string; inviterUserId: string; inviteeUserId: string;
  status: ListenMessageStatus; expiresAt: string; respondedAt: string | null;
  currentTrack?: Track;
};
export type DirectMessageContent =
  | { version: 1; kind: "track"; caption?: string; track: Track }
  | { version: 1; kind: "album"; caption?: string; album: SharedAlbum }
  | { version: 1; kind: "playlist"; caption?: string; source: "netease" | "echo_snapshot"; playlist: SharedPlaylist; hasSnapshot: boolean }
  | { version: 1; kind: "listen_invite"; invitation: ListenInvitationCard };
export type MessageKind = "text" | DirectMessageContent["kind"];
export type SharedMessageResource = { kind: "track"; track: Track } | { kind: "album"; album: SharedAlbum }
  | { kind: "playlist"; source: "netease" | "echo_snapshot"; playlist: SharedPlaylist & { tracks?: Track[] } };
export type MarkMessagesReadInput = { throughMessageId: string };
export type ReorderPlaylistInput = { expectedRevision: number; trackIds: string[] };
export type MessagePageQuery = { before?: number; after?: number; limit?: number };
export type ConversationPageQuery = { cursor?: string; limit?: number };
export type AccountEventQuery = { after?: string; limit?: number };

export type MessagePeer = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  avatarFallbackText: string;
  avatarFallbackBg: string;
};
export type SendPolicy = {
  relationship: "friend" | "stranger";
  hasMutualMessages: boolean;
  canSend: boolean;
  remainingBeforeReply: number | null;
  reason: "stranger_limit" | null;
};
export type DirectMessageDto = {
  id: string;
  conversationId: string;
  sequence: number;
  senderUserId: string;
  clientMessageId: string;
  text: string;
  createdAt: string;
  /** Optional only for cached v1 messages/events; new server responses always include these. */
  kind?: MessageKind;
  content?: DirectMessageContent | null;
  updatedAt?: string;
};
export type DirectConversationDto = {
  id: string | null;
  peer: MessagePeer;
  lastMessage: DirectMessageDto | null;
  unreadCount: number;
  lastReadSequence: number;
  peerLastReadSequence: number;
  sendPolicy: SendPolicy;
};
export type ConversationPage = { items: DirectConversationDto[]; nextCursor: string | null };
export type MessagePage = {
  items: DirectMessageDto[];
  hasMore: boolean;
  nextBefore: number | null;
  nextAfter: number | null;
};
export type MessageSendResult = { message: DirectMessageDto; conversation: DirectConversationDto };
export type ReadResult = { conversationId: string; lastReadSequence: number; unreadCount: number };
export type AccountEventPayloads = {
  "message.created": { message: DirectMessageDto };
  "message.updated": { message: DirectMessageDto };
  "message.read": { conversationId: string; userId: string; lastReadSequence: number };
  "playlist.changed": { playlistId: string | null; revision: number };
};
export type AccountEventDto = { [T in keyof AccountEventPayloads]: {
  id: string; type: T; payload: AccountEventPayloads[T]; createdAt: string;
} }[keyof AccountEventPayloads];
export type AccountEventPage = { items: AccountEventDto[]; nextCursor: string; hasMore: boolean };
export type PlaylistRecordsResult = {
  revision: number;
  updatedAt: string;
  records: Record<string, ImportedPlaylist>;
  removedRecordIds: string[];
};
