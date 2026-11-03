import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/src/lib/music/service", () => ({ getTrackComments: vi.fn(async (trackId, query) => ({ trackId, sort: query.sort, items: [], total: 0, hasMore: false, nextCursor: null })) }));
import * as route from "@/app/api/music/track/[id]/comments/route";
import { getTrackComments } from "@/src/lib/music/service";
import { AppError } from "@/src/lib/errors";

describe("GET track comments", () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (search = "", id = "123") => route.GET(new Request(`http://localhost/api/music/track/${id}/comments${search}`), { params: Promise.resolve({ id }) });
  it("exposes only GET and defaults to hot/20", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ trackId: "123", sort: "hot", items: [] });
    expect(getTrackComments).toHaveBeenCalledWith("123", { sort: "hot", limit: 20 });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(method in route).toBe(false);
  });
  it("rejects invalid IDs, parameters and mismatched cursors before contacting upstream", async () => {
    for (const search of ["?sort=bad", "?limit=100", "?cursor=broken"]) expect((await get(search)).status).toBe(400);
    expect((await get("", "not-numeric")).status).toBe(400);
    expect(getTrackComments).not.toHaveBeenCalled();
  });
  it("preserves the retry hint when upstream is cooling down", async () => {
    vi.mocked(getTrackComments).mockRejectedValueOnce(new AppError("cooling", { code: 2002, status: 503, retryable: true, retryAfterSeconds: 60 }));
    const response = await get();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()).retryable).toBe(true);
  });
});
