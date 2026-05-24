import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";

function createAdapter(overrides?: ConstructorParameters<typeof NeteaseLikeAdapter>[0]) {
  return new NeteaseLikeAdapter({
    baseUrl: "https://music.internal.test",
    apiKey: "abc123",
    timeoutMs: 3000,
    retries: 0,
    pathSearch: "/search",
    pathTrackDetail: "/song/detail",
    pathPlayUrl: "/song/url/v1",
    pathLyric: "/lyric",
    pathPlaylist: "/playlist/detail",
    ...overrides
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("NeteaseLikeAdapter mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps search result to Track list", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
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
      })
    );

    const result = await adapter.searchTracks({ keyword: "test", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("1001");
    expect(result.items[0].artists[0].name).toBe("Singer A");
    expect(result.items[0].album?.coverUrl).toBe("cover.png");
  });

  it("maps lyric response", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        lrc: { lyric: "[00:01.00]hello\n[00:02.00]world" }
      })
    );

    const lyric = await adapter.getTrackLyric("44");
    expect(lyric.trackId).toBe("44");
    expect(lyric.lines).toHaveLength(2);
    expect(lyric.lines[1].text).toBe("world");
  });

  it("does not call unblock endpoint when default play source is not preview", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo", "kugou", "migu"]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ url: "https://cdn.test/full.mp3", time: 210000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/song/url/v1");
  });

  it("tries multiple unblock sources and returns first non-preview source", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo", "kugou", "migu"],
      vipPreviewMaxMs: 60000
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-kugou.mp3", time: 250000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-kugou.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const unblockFirstUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const unblockSecondUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(unblockFirstUrl.searchParams.get("source")).toBe("kuwo");
    expect(unblockSecondUrl.searchParams.get("source")).toBe("kugou");
  });

  it("falls back to default preview source when all unblock attempts fail", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo", "kugou"],
      vipPreviewMaxMs: 60000
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-default.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: null, time: 200000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-kugou.mp3", time: 25000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/preview-default.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
