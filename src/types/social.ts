import type { ImportedPlaylist } from "./music";

export type SendDirectMessageInput = { clientMessageId: string; text: string };
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
