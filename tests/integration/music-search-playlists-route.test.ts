import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchPlaylists: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  searchPlaylists: mocks.searchPlaylists
}));

import { GET } from "@/app/api/music/search/playlists/route";

describe("GET /api/music/search/playlists", () => {
  beforeEach(() => {
    mocks.searchPlaylists.mockClear();
  });

  it("returns 400 when query is missing", async () => {
    const request = new Request("http://localhost:3000/api/music/search/playlists");
    const response = await GET(request);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe(4001);
  });

  it("returns playlist results while keeping the per-request cap", async () => {
    const request = new Request("http://localhost:3000/api/music/search/playlists?q=夜&page=4&pageSize=100");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.searchPlaylists).toHaveBeenCalledWith({
      keyword: "夜",
      page: 4,
      pageSize: 50
    });

    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(Array.isArray(payload.data.items)).toBe(true);
  });
});
