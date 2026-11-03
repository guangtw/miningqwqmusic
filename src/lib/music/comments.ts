import { AppError } from "@/src/lib/errors";
import type { TrackCommentAuthor, TrackCommentPage, TrackCommentQuery, TrackComment } from "@/src/types/music";

const invalid = () => new AppError("Invalid comment parameters or cursor", { code: 4001, status: 400 });
export function parseTrackCommentQuery(params: URLSearchParams): TrackCommentQuery {
  const sort = params.get("sort") ?? "hot";
  const rawLimit = params.get("limit") ?? "20";
  const limit = Number(rawLimit);
  if (!["hot", "time"].includes(sort) || !/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid();
  const cursor = params.get("cursor") ?? undefined;
  if (cursor !== undefined && (!cursor || cursor.length > 2048)) throw invalid();
  return { sort: sort as TrackCommentQuery["sort"], limit, ...(cursor ? { cursor } : {}) };
}

export function decodeCommentCursor(trackId: string, query: TrackCommentQuery): { pageNo: number; cursor?: string } {
  if (!/^\d{1,20}$/.test(trackId)) throw invalid();
  if (!query.cursor) return { pageNo: 1 };
  try {
    const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (value.v !== 1 || value.trackId !== trackId || value.sort !== query.sort || value.limit !== query.limit ||
      !Number.isSafeInteger(value.pageNo) || value.pageNo < 2 || value.pageNo > 1000000 ||
      (query.sort === "time" && (typeof value.cursor !== "string" || !/^\d{1,20}$/.test(value.cursor)))) throw invalid();
    return { pageNo: value.pageNo, ...(query.sort === "time" ? { cursor: value.cursor } : {}) };
  } catch { throw invalid(); }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function id(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function nonnegative(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0; }
function author(value: unknown): TrackCommentAuthor {
  const user = object(value);
  const avatarUrl = text(user.avatarUrl);
  return { id: id(user.userId), nickname: text(user.nickname), ...(/^https?:\/\//i.test(avatarUrl) ? { avatarUrl } : {}) };
}

export function normalizeTrackComments(trackId: string, query: TrackCommentQuery, pageNo: number, raw: unknown): TrackCommentPage {
  const payload = object(raw);
  const data = object(payload.data);
  if (Number(payload.code) !== 200 || !Array.isArray(data.comments) || typeof data.hasMore !== "boolean" ||
    typeof data.totalCount !== "number" || data.totalCount < 0 || !Number.isFinite(data.totalCount) ||
    (data.sortType !== undefined && data.sortType !== (query.sort === "hot" ? 2 : 3))) {
    throw new AppError("Upstream returned an invalid comments response", { code: 2006, status: 502 });
  }
  const items: TrackComment[] = data.comments.map(value => {
    const row = object(value);
    const commentId = id(row.commentId);
    if (!commentId) throw new AppError("Upstream comment ID missing", { code: 2006, status: 502 });
    return { id: commentId, author: author(row.user), content: text(row.content),
      time: nonnegative(row.time), likedCount: nonnegative(row.likedCount),
      replies: Array.isArray(row.beReplied) ? row.beReplied.map(value => {
        const reply = object(value);
        return { id: id(reply.beRepliedCommentId), author: author(reply.user),
          content: typeof reply.content === "string" ? reply.content : null };
      }) : [] };
  });
  const upstreamCursor = id(data.cursor);
  // An invalid/non-advancing time cursor must not cause an infinite pagination loop.
  const previous = query.cursor ? decodeCommentCursor(trackId, query).cursor : undefined;
  const hasMore = data.hasMore && items.length > 0;
  if (hasMore && query.sort === "time" && (!upstreamCursor || !/^\d{1,20}$/.test(upstreamCursor) || upstreamCursor === previous)) {
    throw new AppError("Upstream comments cursor did not advance", { code: 2006, status: 502 });
  }
  return { trackId, sort: query.sort, items, total: data.totalCount, hasMore,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ v: 1, trackId, sort: query.sort, limit: query.limit, pageNo: pageNo + 1,
      ...(query.sort === "time" ? { cursor: upstreamCursor } : {}) })).toString("base64url") : null };
}
