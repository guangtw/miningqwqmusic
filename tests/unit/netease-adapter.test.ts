import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNeteaseLikeAdapterFromEnv, NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";
import { MusicRequestCoordinator } from "@/src/lib/music/request-coordinator";

const inspection = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/music/audio-inspection", () => ({ inspectAudio: inspection }));

function createAdapter(overrides?: Partial<ConstructorParameters<typeof NeteaseLikeAdapter>[0]>) {
  return new NeteaseLikeAdapter({
    baseUrl: "https://music.internal.test",
    apiKey: "abc123",
    timeoutMs: 3000,
    retries: 0,
    requestCoordinator: new MusicRequestCoordinator({ minIntervalMs: 0 }),
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

function headResponse(contentLength = 3_000_000, contentType = "audio/mpeg") {
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Length": String(contentLength),
      "Content-Type": contentType
    }
  });
}

function headResponseWithoutLength(contentType = "audio/mpeg") {
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": contentType
    }
  });
}

function trackDetailResponse(trackId = "108485", durationMs = 240000) {
  return jsonResponse({
    songs: [
      {
        id: Number(trackId),
        name: "Test Song",
        ar: [{ id: 11, name: "Singer A" }],
        al: { id: 22, name: "Album X" },
        dt: durationMs
      }
    ]
  });
}

function mockPlaySourceFetch(
  responses: Response[],
  options?: {
    trackId?: string;
    trackDurationMs?: number;
    headResponses?: Response[];
  }
) {
  const trackId = options?.trackId ?? "108485";
  const trackDurationMs = options?.trackDurationMs ?? 240000;
  const responseQueue = [...responses];
  const headQueue = [...(options?.headResponses ?? [headResponse()])];

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "HEAD") {
      return headQueue.shift() ?? headResponse();
    }
    if (url.includes("/song/detail")) {
      return trackDetailResponse(trackId, trackDurationMs);
    }
    const next = responseQueue.shift();
    if (!next) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return next;
  });
}

describe("NeteaseLikeAdapter mapping", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.restoreAllMocks();
    inspection.mockReset();
    inspection.mockResolvedValue({ ok: true, durationMs: 240000, title: "Test Song", artists: ["Singer A"] });
  });

  it("shares the complete same-track resolution, including duration and audio probes", async () => {
    const adapter = createAdapter();
    const fetchMock = mockPlaySourceFetch([jsonResponse({ data: [{ url: "https://cdn.test/full.mp3", time: 210000 }] })]);
    const sources = await Promise.all(Array.from({ length: 10 }, () => adapter.getPlaySource("108485", { unblockMode: "force_off" })));
    expect(sources).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a different provider after a source rate limit without retrying that source", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] }),
      jsonResponse({ code: 429 }, 429),
      jsonResponse({ data: [{ url: "https://cdn.test/healthy.mp3", time: 240000 }] })
    ]);
    await expect(adapter.getPlaySource("108485", { unblockMode: "force_on" })).resolves.toMatchObject({ url: "https://cdn.test/healthy.mp3" });
    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname === "/song/url/match");
    expect(requests.map(url => url.searchParams.get("source"))).toEqual(["unm", "msls"]);
  });

  it("keeps guest and authorized play requests separate and never retains completed URLs", async () => {
    const adapter = createAdapter();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input));
      return jsonResponse({ data: [{ url: `https://cdn.test/${url.searchParams.get("unblock")}.mp3`, time: 30000 }] });
    });
    const [guest, authorized] = await Promise.all([
      adapter.getPlaySource("1", { unblockMode: "force_off" }),
      adapter.getPlaySource("1", { unblockMode: "force_on" })
    ]);
    expect(guest.url).toContain("false.mp3");
    expect(authorized.url).toContain("false.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await adapter.getPlaySource("1", { unblockMode: "force_on" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a hanging primary provider without disabling search or another provider", async () => {
    vi.useFakeTimers();
    const adapter = createAdapter({ timeoutMs: 200, pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "HEAD") return headResponse();
      if (url.pathname === "/song/detail") return trackDetailResponse();
      if (url.pathname === "/search") return jsonResponse({ result: { songCount: 0, songs: [] } });
      if (url.pathname === "/song/url/match" && url.searchParams.get("source") === "unm") {
        return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true }));
      }
      if (url.pathname === "/song/url/v1") return jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] });
      if (url.searchParams.get("source") === "msls") return jsonResponse({ data: [{ url: "https://cdn.test/healthy.mp3", time: 240000 }] });
      throw new Error("Unexpected request");
    });
    const play = adapter.getPlaySource("108485", { unblockMode: "force_on" });
    await vi.advanceTimersByTimeAsync(201);
    await expect(play).resolves.toMatchObject({ url: "https://cdn.test/healthy.mp3", preview: false });
    await expect(adapter.searchTracks({ keyword: "test", page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 0 });
    const matches = fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/song/url/match");
    expect(matches).toHaveLength(2);
    expect(matches.map(([url]) => new URL(String(url)).searchParams.get("source"))).toEqual(["unm", "msls"]);
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
              al: { id: 22, name: "Album X", picUrl: "https://p1.music.126.net/cover.png" },
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
    expect(result.items[0].album?.coverUrl).toBe("https://p1.music.126.net/cover.png");
  });

  it("enriches missing search covers via batch song detail", async () => {
    const adapter = createAdapter();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/search")) {
        return jsonResponse({
          result: {
            songCount: 1,
            songs: [
              {
                id: 2002,
                name: "No Cover Song",
                ar: [{ id: 1, name: "Artist" }],
                al: { id: 9, name: "Album Without Pic" },
                dt: 180000
              }
            ]
          }
        });
      }
      if (url.includes("/song/detail") || url.includes("ids=")) {
        return jsonResponse({
          songs: [
            {
              id: 2002,
              name: "No Cover Song",
              ar: [{ id: 1, name: "Artist" }],
              al: { id: 9, name: "Album Without Pic", picUrl: "https://p1.music.126.net/enriched.png" },
              dt: 180000
            }
          ]
        });
      }
      return jsonResponse({});
    });

    const result = await adapter.searchTracks({ keyword: "x", page: 1, pageSize: 20 });
    expect(result.items[0].coverUrl).toBe("https://p1.music.126.net/enriched.png");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
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
    const fetchMock = mockPlaySourceFetch([
      jsonResponse({
        data: [{ url: "https://cdn.test/full.mp3", time: 210000 }]
      })
    ]);

    const result = await adapter.getPlaySource("108485");
    expect(result.url).toBe("https://cdn.test/full.mp3");
    expect(result.preview).toBe(false);
    expect(result.resolvedVia).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/song/url/v1");
  });

  it("prefers expi for play source ttl and ignores track duration time", async () => {
    const adapter = createAdapter();
    mockPlaySourceFetch([
      jsonResponse({
        data: [
          {
            url: "https://cdn.test/full.mp3",
            time: 245000,
            expi: 1200
          }
        ]
      })
    ]);

    const source = await adapter.getPlaySource("108485");
    expect(source.url).toBe("https://cdn.test/full.mp3");
    expect(source.ttlSeconds).toBe(1200);
  });

  it.each(["auto", "force_on", "force_off"] as const)("tries the original recording first in %s mode", async unblockMode => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = mockPlaySourceFetch([jsonResponse({ data: [{ id: 108485, url: "https://cdn.test/original.mp3", time: 240000 }] })]);
    await expect(adapter.getPlaySource("108485", { unblockMode })).resolves.toMatchObject({ url: "https://cdn.test/original.mp3", resolvedVia: "primary" });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("unblock")).toBe("false");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/song/url/match"))).toBe(false);
    expect(inspection).not.toHaveBeenCalled();
  });

  it.each([
    { name: "30 second preview", primary: { data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] } },
    { name: "45 second preview", primary: { data: [{ url: "https://cdn.test/preview.mp3", time: 45000 }] } },
    { name: "empty URL", primary: { data: [{ url: null }] } },
    { name: "trial metadata", primary: { data: [{ url: "https://cdn.test/preview.mp3", time: 240000, freeTrialInfo: { start: 0, end: 30 } }] } },
    { name: "trial privilege", primary: { data: [{ url: "https://cdn.test/preview.mp3", freeTrialPrivilege: { cannotListenReason: 1 } }] } },
    { name: "time trial privilege", primary: { data: [{ url: "https://cdn.test/preview.mp3", freeTimeTrialPrivilege: { remainTime: 30, type: 1 } }] } },
    { name: "restriction message", primary: { data: [{ url: "https://cdn.test/preview.mp3", message: "仅可试听片段" }] } }
  ])("still resolves a full verified source after $name", async ({ primary }) => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["msls"] });
    const fetchMock = mockPlaySourceFetch([jsonResponse(primary), jsonResponse({ code: 200, data: "https://cdn.test/full.mp3" })]);
    await expect(adapter.getPlaySource("108485", { unblockMode: "force_on" })).resolves.toMatchObject({ url: "https://cdn.test/full.mp3", preview: false, resolvedVia: "unblock" });
    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname === "/song/url/match");
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("source")).toBe("msls");
  });

  it.each([
    { name: "another singer", audio: { durationMs: 240000, title: "Test Song", artists: ["Singer B"] } },
    { name: "a cover", audio: { durationMs: 240000, title: "Test Song (cover Singer A)", artists: ["Singer B"] } },
    { name: "accompaniment", audio: { durationMs: 240000, title: "Test Song（伴奏）", artists: ["Singer A"] } },
    { name: "live recording", audio: { durationMs: 240000, title: "Test Song (Live)", artists: ["Singer A"] } },
    { name: "a different length", audio: { durationMs: 180000, title: "Test Song", artists: ["Singer A"] } },
    { name: "a disguised preview", audio: { durationMs: 30000, title: "Test Song", artists: ["Singer A"] } },
    { name: "unknown duration", audio: { title: "Test Song", artists: ["Singer A"] } },
    { name: "unidentified cross-platform audio", audio: { durationMs: 240000 } },
    { name: "mismatched native file", audio: { nativeNetease: true, durationMs: 180000 } }
  ])("skips $name and continues to the next provider", async ({ audio }) => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] }),
      // A requested ID and reported full time must not override the actual file.
      jsonResponse({ data: [{ id: 108485, url: "https://cdn.test/wrong.mp3", time: 240000 }] }),
      jsonResponse({ data: "https://cdn.test/correct.mp3" })
    ]);
    inspection.mockResolvedValueOnce({ ok: true, ...audio });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ url: "https://cdn.test/correct.mp3", preview: false });
    expect(inspection.mock.calls.map(([url]) => url)).toEqual(["https://cdn.test/wrong.mp3", "https://cdn.test/correct.mp3"]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/song/url/match"))).toHaveLength(2);
  });

  it("preserves untagged original NetEase full audio from an ID-based unblock provider", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["msls"] });
    mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30040, freeTrialInfo: { start: 0, end: 30 } }] }),
      jsonResponse({ data: "https://m701.music.126.net/full.mp3" })
    ], { trackDurationMs: 225013 });
    inspection.mockResolvedValueOnce({ ok: true, nativeNetease: true, durationMs: 225044.9 });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ url: "https://m701.music.126.net/full.mp3", preview: false, resolvedVia: "unblock" });
  });

  it("keeps the original preview if every alternate is a different recording", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm"] });
    mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] }),
      jsonResponse({ data: "https://cdn.test/other.mp3" })
    ]);
    inspection.mockResolvedValueOnce({ ok: true, durationMs: 240000, title: "Test Song", artists: ["Other Singer"] });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ url: "https://cdn.test/preview.mp3", preview: true, resolvedVia: "primary" });
  });

  it("does not call alternate providers for guests even when the original is a preview", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm"] });
    const fetchMock = mockPlaySourceFetch([jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] })]);
    await expect(adapter.getPlaySource("108485", { unblockMode: "force_off" })).resolves.toMatchObject({ preview: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inspection).not.toHaveBeenCalled();
  });

  it("continues to another provider after an inspection timeout", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] }),
      jsonResponse({ data: "https://cdn.test/timeout.mp3" }),
      jsonResponse({ data: "https://cdn.test/healthy.mp3" })
    ]);
    inspection.mockResolvedValueOnce({ ok: false });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ url: "https://cdn.test/healthy.mp3" });
  });

  it("keeps native full audio when HEAD length is unknown", async () => {
    const adapter = createAdapter();
    mockPlaySourceFetch([jsonResponse({ data: [{ url: "https://cdn.test/original.mp3", time: 240000 }] })], { headResponses: [headResponseWithoutLength()] });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ url: "https://cdn.test/original.mp3", preview: false });
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
