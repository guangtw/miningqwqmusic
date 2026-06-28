import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchTracks: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  searchTracks: mocks.searchTracks
}));

import { GET } from "@/app/api/music/search/route";

describe("GET /api/music/search", () => {
  beforeEach(() => {
    mocks.searchTracks.mockClear();
  });

  it("returns 400 when query is missing", async () => {
    const request = new Request("http://localhost:3000/api/music/search");
    const response = await GET(request);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe(4001);
  });

  it("returns success payload with query", async () => {
    const request = new Request("http://localhost:3000/api/music/search?q=hello");
    const response = await GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(Array.isArray(payload.data.items)).toBe(true);
  });

  it("keeps a per-request cap even when the UI asks for more", async () => {
    const request = new Request("http://localhost:3000/api/music/search?q=hello&page=2&pageSize=100");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.searchTracks).toHaveBeenCalledWith({
      keyword: "hello",
      page: 2,
      pageSize: 50
    });
  });
});
