import type { Track } from '@/src/types/music';

// Share the server's contracts; keep the upstream frontend's convenience helpers.
export type * from '@/src/types/music';
export type { AccountUser, AuthTokenData, AuthPayload, LibrarySnapshot, LibraryRevisionResult } from '@/src/types/account';

export const hasId = (id?: string | null): id is string => !!id && id !== '0';
export const coverOf = (t: Track) => t.coverUrl ?? t.album?.coverUrl;
