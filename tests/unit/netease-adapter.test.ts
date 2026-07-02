import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNeteaseLikeAdapterFromEnv, NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";

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

  it("maps artist search result to ArtistSearchItem list", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        result: {
          artistCount: 1,
          artists: [
            {
              id: 7763,
              name: "G.E.M.邓紫棋",
              picUrl: "artist.png",
              musicSize: 419,
              albumSize: 61
            }
          ]
        }
      })
    );

    const result = await adapter.searchArtists({ keyword: "邓紫棋", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "7763",
      name: "G.E.M.邓紫棋",
      coverUrl: "artist.png",
      musicSize: 419,
      albumSize: 61
    });
  });

  it("maps playlist search result to Playlist list", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        result: {
          playlistCount: 1,
          playlists: [
            {
              id: 9001,
              name: "深夜循环",
              coverImgUrl: "playlist.png",
              description: "适合凌晨的歌单"
            }
          ]
        }
      })
    );

    const result = await adapter.searchPlaylists({ keyword: "深夜", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "9001",
      name: "深夜循环",
      coverUrl: "playlist.png",
      description: "适合凌晨的歌单",
      tracks: []
    });
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

  it("uses safer unblock source defaults when env does not specify any source", async () => {
    const previousBaseUrl = process.env.MUSIC_SOURCE_BASE_URL;
    const previousSources = process.env.MUSIC_SOURCE_UNBLOCK_SOURCES;
    const previousSource = process.env.MUSIC_SOURCE_UNBLOCK_SOURCE;

    process.env.MUSIC_SOURCE_BASE_URL = "https://music.internal.test";
    delete process.env.MUSIC_SOURCE_UNBLOCK_SOURCES;
    delete process.env.MUSIC_SOURCE_UNBLOCK_SOURCE;

    const adapter = createNeteaseLikeAdapterFromEnv();
    expect((adapter as unknown as { config: { unblockSources: string[] } }).config.unblockSources).toEqual([
      "unm",
      "msls",
      "qijieya"
    ]);

    if (previousBaseUrl === undefined) {
      delete process.env.MUSIC_SOURCE_BASE_URL;
    } else {
      process.env.MUSIC_SOURCE_BASE_URL = previousBaseUrl;
    }
    if (previousSources === undefined) {
      delete process.env.MUSIC_SOURCE_UNBLOCK_SOURCES;
    } else {
      process.env.MUSIC_SOURCE_UNBLOCK_SOURCES = previousSources;
    }
    if (previousSource === undefined) {
      delete process.env.MUSIC_SOURCE_UNBLOCK_SOURCE;
    } else {
      process.env.MUSIC_SOURCE_UNBLOCK_SOURCE = previousSource;
    }
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
    expect(result.preview).toBe(false);
    expect(result.resolvedVia).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/song/url/v1");
  });

  it("prefers expi for play source ttl and ignores track duration time", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          {
            url: "https://cdn.test/full.mp3",
            time: 245000,
            expi: 1200
          }
        ]
      })
    );

    const source = await adapter.getPlaySource("108485");
    expect(source.url).toBe("https://cdn.test/full.mp3");
    expect(source.ttlSeconds).toBe(1200);
  });

  it("tries match without source first and then fallback sources", async () => {
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-kuwo.mp3", time: 250000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-kuwo.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const forcedPrimaryUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const unblockFirstUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    const unblockSecondUrl = new URL(String(fetchMock.mock.calls[3]?.[0]));
    expect(forcedPrimaryUrl.pathname).toContain("/song/url/v1");
    expect(forcedPrimaryUrl.searchParams.get("unblock")).toBe("true");
    expect(unblockFirstUrl.searchParams.get("source")).toBeNull();
    expect(unblockSecondUrl.searchParams.get("source")).toBe("kuwo");
  });

  it("attempts unblock when default source url is empty", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo", "kugou"]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 108485, url: null, code: 200 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/unblock-kuwo.mp3", time: 198000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/unblock-kuwo.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/song/url/v1");
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("unblock")).toBe("true");
  });

  it("attempts unblock when default source has restriction signal without preview time", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["migu"]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 200,
        data: [{ url: "https://cdn.test/restricted.mp3", code: 404, time: 220000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/unblock-migu.mp3", time: 220000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/unblock-migu.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps attempting unblock in force_on mode when primary source is still preview", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo"],
      vipPreviewMaxMs: 60000
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-force-on.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-force-on.mp3", time: 220000 }]
      })
    );

    const result = await adapter.getPlaySource("108485", { unblockMode: "force_on" });
    expect(result.url).toBe("https://cdn.test/full-force-on.mp3");
    expect(result.preview).toBe(false);
    expect(result.resolvedVia).toBe("unblock");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const primaryUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(primaryUrl.searchParams.get("unblock")).toBe("true");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/song/url/match");
  });

  it("retries /song/url/v1 with unblock=true before falling back to match", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["unm"],
      vipPreviewMaxMs: 60000
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-auto.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-v1-forced.mp3", time: 220000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-v1-forced.mp3");
    expect(result.preview).toBe(false);
    expect(result.resolvedVia).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(firstUrl.pathname).toContain("/song/url/v1");
    expect(firstUrl.searchParams.get("unblock")).toBeNull();
    expect(secondUrl.pathname).toContain("/song/url/v1");
    expect(secondUrl.searchParams.get("unblock")).toBe("true");
  });

  it("falls back to match only after forced /song/url/v1 is still restricted", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["unm"],
      vipPreviewMaxMs: 60000
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-auto.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-forced.mp3", time: 30000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 200,
        data: "https://cdn.test/full-from-unm.flac"
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-from-unm.flac");
    expect(result.preview).toBe(false);
    expect(result.resolvedVia).toBe("unblock");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const forcedPrimaryUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const matchUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(forcedPrimaryUrl.pathname).toContain("/song/url/v1");
    expect(forcedPrimaryUrl.searchParams.get("unblock")).toBe("true");
    expect(matchUrl.pathname).toContain("/song/url/match");
  });

  it.each([
    {
      name: "freeTrialInfo",
      primary: {
        data: [{ url: "https://cdn.test/restricted-free-trial-info.mp3", time: 220000, freeTrialInfo: { start: 0 } }]
      }
    },
    {
      name: "freeTrialPrivilege",
      primary: {
        data: [
          {
            url: "https://cdn.test/restricted-free-trial-privilege.mp3",
            time: 220000,
            freeTrialPrivilege: { cannotListenReason: 1 }
          }
        ]
      }
    },
    {
      name: "freeTimeTrialPrivilege",
      primary: {
        data: [
          {
            url: "https://cdn.test/restricted-free-time-trial.mp3",
            time: 220000,
            freeTimeTrialPrivilege: { remainTime: 30, type: 1 }
          }
        ]
      }
    },
    {
      name: "restriction message",
      primary: {
        data: [{ url: "https://cdn.test/restricted-message.mp3", time: 220000, message: "仅可试听片段" }]
      }
    }
  ])("attempts unblock when primary source contains $name restriction signal", async ({ primary }) => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo"]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(jsonResponse(primary));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-after-restriction.mp3", time: 230000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-after-restriction.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/song/url/v1");
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("unblock")).toBe("true");
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/preview-default.mp3");
    expect(result.preview).toBe(true);
    expect(result.restrictionReason).toBe("vip_preview");
    expect(result.resolvedVia).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("prefers the least restricted candidate when all unblock attempts remain limited", async () => {
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/preview-unblock.mp3", time: 45000 }]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/restricted-no-preview.mp3", time: 220000, freeTrialPrivilege: { playReason: "vip" } }]
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/restricted-no-preview.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("parses song url match when data is a url string", async () => {
    const adapter = createAdapter({
      pathPlayUrlUnblock: "/song/url/match",
      unblockSources: ["kuwo"],
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
        code: 200,
        data: "https://cdn.test/full-from-string.flac"
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-from-string.flac");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to source loop when match without source fails", async () => {
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, data: [] }, 500));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://cdn.test/full-from-kugou.mp3", time: 240000 }]
      })
    );

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full-from-kugou.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const forcedPrimaryUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const noSourceUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    const kuwoUrl = new URL(String(fetchMock.mock.calls[3]?.[0]));
    const kugouUrl = new URL(String(fetchMock.mock.calls[4]?.[0]));
    expect(forcedPrimaryUrl.pathname).toContain("/song/url/v1");
    expect(forcedPrimaryUrl.searchParams.get("unblock")).toBe("true");
    expect(noSourceUrl.searchParams.get("source")).toBeNull();
    expect(kuwoUrl.searchParams.get("source")).toBe("kuwo");
    expect(kugouUrl.searchParams.get("source")).toBe("kugou");
  });

  it("maps banner targetType to executable discover item type with external link fallback", async () => {
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/search/hot/detail")) {
        return jsonResponse({ data: [] });
      }
      if (url.includes("/search/default")) {
        return jsonResponse({ data: { realkeyword: "晴天" } });
      }
      if (url.includes("/search/suggest/pc")) {
        return jsonResponse({ data: { suggests: [] } });
      }
      if (url.includes("/banner")) {
        return jsonResponse({
          banners: [
            {
              targetId: 11,
              targetType: 1,
              typeTitle: "单曲",
              copywriter: "track",
              imageUrl: "track.png"
            },
            {
              targetId: 22,
              targetType: 1000,
              typeTitle: "歌单",
              copywriter: "playlist",
              imageUrl: "playlist.png"
            },
            {
              targetId: 0,
              targetType: 3000,
              typeTitle: "活动",
              copywriter: "external",
              imageUrl: "external.png",
              url: "https://example.com/activity"
            }
          ]
        });
      }
      if (url.includes("/personalized")) {
        return jsonResponse({ result: [] });
      }
      if (url.includes("/toplist/detail")) {
        return jsonResponse({ list: [] });
      }
      if (url.includes("/top/playlist/highquality")) {
        return jsonResponse({ playlists: [] });
      }
      return jsonResponse({});
    });

    const discover = await adapter.getDiscoverData();
    const bannerBlock = discover.blocks.find((block) => block.id === "discover-banner");
    expect(bannerBlock?.items).toHaveLength(3);
    expect(bannerBlock?.items[0]).toMatchObject({
      type: "track",
      targetId: "11"
    });
    expect(bannerBlock?.items[1]).toMatchObject({
      type: "playlist",
      targetId: "22"
    });
    expect(bannerBlock?.items[2]).toMatchObject({
      type: "banner",
      linkUrl: "https://example.com/activity"
    });
  });
});
