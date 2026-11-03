import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { decodeCommentCursor, normalizeTrackComments, parseTrackCommentQuery } from "@/src/lib/music/comments";
import { NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";
import { MusicRequestCoordinator } from "@/src/lib/music/request-coordinator";

const query = { sort: "time" as const, limit: 2 };
const raw = (cursor = "900", sortType = 3) => ({ code: 200, data: {
  totalCount: 20, hasMore: true, sortType, cursor, comments: [{ commentId: 123, content: "<b>plain text</b>", time: 1000, likedCount: 4,
    user: { userId: 1, nickname: "Author", avatarUrl: "https://example.test/a.jpg", email: "private@example.test" },
    beReplied: [{ beRepliedCommentId: 2, content: null, user: { userId: 2, nickname: "Deleted", avatarUrl: "javascript:alert(1)" } }],
    cookie: "secret", richContent: "<script>bad()</script>" }]
} });
const createAdapter = () => new NeteaseLikeAdapter({ baseUrl: "https://upstream.example.test", timeoutMs: 50, retries: 0,
  requestCoordinator: new MusicRequestCoordinator({ minIntervalMs: 0 }) });

describe("read-only music comments", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("normalizes only public text/author/reference fields and binds an opaque cursor", () => {
    const page = normalizeTrackComments("186016", query, 1, raw());
    expect(page.items[0]).toMatchObject({ id: "123", content: "<b>plain text</b>", likedCount: 4 });
    expect(page.items[0].replies[0]).toMatchObject({ content: null, author: { id: "2" } });
    expect(page.items[0].replies[0].author.avatarUrl).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain("secret");
    expect(JSON.stringify(page)).not.toContain("private@example.test");
    expect(decodeCommentCursor("186016", { ...query, cursor: page.nextCursor! })).toEqual({ pageNo: 2, cursor: "900" });
    expect(() => decodeCommentCursor("different", { ...query, cursor: page.nextCursor! })).toThrow();
    expect(() => decodeCommentCursor("186016", { ...query, sort: "hot", cursor: page.nextCursor! })).toThrow();
    expect(() => decodeCommentCursor("186016", { ...query, limit: 3, cursor: page.nextCursor! })).toThrow();
  });

  it("validates pagination and does not invent empty data for malformed/upstream failures", () => {
    for (const search of ["sort=recommended", "limit=0", "limit=51", "limit=1.5", "cursor="]) {
      expect(() => parseTrackCommentQuery(new URLSearchParams(search))).toThrow();
    }
    expect(() => decodeCommentCursor("123", { ...query, cursor: "invalid" })).toThrow();
    expect(() => normalizeTrackComments("123", query, 1, { code: 301 })).toThrow();
    expect(() => normalizeTrackComments("123", query, 1, { code: 200, data: {} })).toThrow();
    expect(() => normalizeTrackComments("123", query, 1, raw("900", 99))).toThrow();
    const empty = raw(); empty.data.comments = []; empty.data.hasMore = false;
    expect(normalizeTrackComments("123", query, 1, empty)).toMatchObject({ items: [], hasMore: false, nextCursor: null });
    const first = normalizeTrackComments("123", query, 1, raw());
    expect(() => normalizeTrackComments("123", { ...query, cursor: first.nextCursor! }, 2, raw())).toThrow("did not advance");
  });

  it("maps hot/time pagination to the fixed read endpoint, merges concurrent requests and caches reads", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(raw()), { headers: { "content-type": "application/json" } }));
    const adapter = createAdapter();
    const [first] = await Promise.all([adapter.getTrackComments("123", query), adapter.getTrackComments("123", query)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await adapter.getTrackComments("123", query);
    expect(fetch).toHaveBeenCalledTimes(1);
    const firstUrl = new URL(String(fetch.mock.calls[0][0]));
    expect(firstUrl.pathname).toBe("/comment/new");
    expect(Object.fromEntries(firstUrl.searchParams)).toMatchObject({ id: "123", type: "0", sortType: "3", pageSize: "2", pageNo: "1" });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(raw("800")), { headers: { "content-type": "application/json" } }));
    await adapter.getTrackComments("123", { ...query, cursor: first.nextCursor! });
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get("cursor")).toBe("900");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(raw("hot#2", 2)), { headers: { "content-type": "application/json" } }));
    const hot = await adapter.getTrackComments("123", { ...query, sort: "hot" });
    expect(decodeCommentCursor("123", { ...query, sort: "hot", cursor: hot.nextCursor! })).toEqual({ pageNo: 2 });
  });

  it("propagates upstream cooldown without retries and does not return cached success on failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: 429 }), { headers: { "content-type": "application/json", "retry-after": "90" } }));
    const adapter = createAdapter();
    await expect(adapter.getTrackComments("123", query)).rejects.toMatchObject({ code: 2002, status: 503, retryAfterSeconds: 90 });
    await expect(adapter.getTrackComments("123", query)).rejects.toMatchObject({ code: 2002 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates malformed payloads and network timeouts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    }));
    await expect(createAdapter().getTrackComments("123", query)).rejects.toMatchObject({ code: 2004, status: 504 });
  });
});
