import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";

const adapter = new NeteaseLikeAdapter({
  baseUrl: "https://music.internal.test",
  apiKey: "abc123",
  timeoutMs: 3000,
  retries: 0,
  pathSearch: "/search",
  pathTrackDetail: "/song/detail",
  pathPlayUrl: "/song/url/v1",
  pathLyric: "/lyric",
  pathPlaylist: "/playlist/detail"
});

describe("NeteaseLikeAdapter mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps search result to Track list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            songCount: 1,
            songs: [
              {
                id: 1001,
                name: "Test Song",
                ar: [{ id: 11, name: "Singer A" }],
                al: { id: 22, name: "Album X", picUrl: "cover.png" },
                dt: 240000
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await adapter.searchTracks({ keyword: "test", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("1001");
    expect(result.items[0].artists[0].name).toBe("Singer A");
    expect(result.items[0].album?.coverUrl).toBe("cover.png");
  });

  it("maps lyric response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          lrc: { lyric: "[00:01.00]hello\n[00:02.00]world" }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const lyric = await adapter.getTrackLyric("44");
    expect(lyric.trackId).toBe("44");
    expect(lyric.lines).toHaveLength(2);
    expect(lyric.lines[1].text).toBe("world");
  });
});
