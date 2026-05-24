import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/music/service", () => ({
  searchArtists: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0
  }))
}));

import { GET } from "@/app/api/music/search/artists/route";

describe("GET /api/music/search/artists", () => {
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
});
