import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchArtists: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  searchArtists: mocks.searchArtists
}));

import { GET } from "@/app/api/music/search/artists/route";

describe("GET /api/music/search/artists", () => {
  beforeEach(() => {
    mocks.searchArtists.mockClear();
  });

  it("returns 400 when query is missing", async () => {
    const request = new Request("http://localhost:3000/api/music/search/artists");
    const response = await GET(request);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe(4001);
  });

  it("returns success payload with query", async () => {
    const request = new Request("http://localhost:3000/api/music/search/artists?q=gem");
    const response = await GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(Array.isArray(payload.data.items)).toBe(true);
  });

  it("keeps the artist endpoint capped per request", async () => {
    const request = new Request("http://localhost:3000/api/music/search/artists?q=gem&page=3&pageSize=100");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.searchArtists).toHaveBeenCalledWith({
      keyword: "gem",
      page: 3,
      pageSize: 50
    });
  });
});
