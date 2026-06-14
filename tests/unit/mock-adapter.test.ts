import { describe, expect, it } from "vitest";
import { createMockMusicAdapter } from "@/src/lib/music/providers/mock";

describe("MockMusicAdapter", () => {
  it("returns deterministic search results", async () => {
    const adapter = createMockMusicAdapter();
    const result = await adapter.searchTracks({ keyword: "neon", page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.items[0].name.toLowerCase()).toContain("neon");
  });

  it("returns playable source and lyric", async () => {
    const adapter = createMockMusicAdapter();
    const source = await adapter.getPlaySource("mock-1");
    const lyric = await adapter.getTrackLyric("mock-1");

    expect(source.url.length).toBeGreaterThan(0);
    expect(source.preview).toBe(false);
    expect(source.resolvedVia).toBe("primary");
    expect(source.ttlSeconds).toBe(60);
    expect(lyric.lines.length).toBeGreaterThan(0);
  });
});
