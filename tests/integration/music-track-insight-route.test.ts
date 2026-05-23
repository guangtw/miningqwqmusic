import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/music/service", () => ({
  getTrackInsight: vi.fn(async (trackId: string) => ({
    trackId,
    playable: true,
    creators: [{ name: "测试创作者", role: "作曲" }],
    wikiSummary: "测试百科",
    chorusStartMs: 32000,
    alternatives: []
  }))
}));

import { GET } from "@/app/api/music/track/[id]/insight/route";

describe("GET /api/music/track/:id/insight", () => {
  it("returns insight payload", async () => {
    const response = await GET(new Request("http://localhost:3000/api/music/track/1001/insight"), {
      params: Promise.resolve({ id: "1001" })
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(payload.data.trackId).toBe("1001");
    expect(payload.data.creators[0].name).toBe("测试创作者");
  });
});

