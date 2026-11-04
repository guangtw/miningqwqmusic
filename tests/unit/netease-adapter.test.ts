import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNeteaseLikeAdapterFromEnv, NeteaseLikeAdapter } from "@/src/lib/music/providers/netease-like";
import { MusicRequestCoordinator } from "@/src/lib/music/request-coordinator";

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

function headResponse(contentLength = 10_000_000, contentType = "audio/mpeg") {
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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shares the complete same-track resolution, including duration and audio probes", async () => {
    const adapter = createAdapter();
    const fetchMock = mockPlaySourceFetch([jsonResponse({ data: [{ url: "https://cdn.test/full.mp3", time: 240000 }] })]);
    const sources = await Promise.all(Array.from({ length: 10 }, () => adapter.getPlaySource("108485", { unblockMode: "force_off" })));
    expect(sources).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never falls through to other unblock sources after a rate limit", async () => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = mockPlaySourceFetch([
      jsonResponse({ data: [{ url: "https://cdn.test/preview.mp3", time: 30000 }] }),
      jsonResponse({ code: 429 }, 429)
    ]);
    await expect(adapter.getPlaySource("108485", { unblockMode: "force_on" })).rejects.toMatchObject({ code: 2002 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("scopes an unconfirmed limit and propagates a confirmed NetEase limit: %s", async confirmed => {
    vi.stubEnv("MUSIC_SOURCE_EGRESS_MANAGED", "1");
    const adapter = createAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("limited", { status: 429, headers: {
      "retry-after": "30", ...(confirmed ? { "x-echo-rate-limited": "netease" } : {})
    } })).mockResolvedValue(trackDetailResponse());
    await expect(adapter.searchTracks({ keyword: "first", page: 1, pageSize: 1 })).rejects.toMatchObject({ code: confirmed ? 2002 : 2010 });
    if (confirmed) await expect(adapter.getTrackDetail("108485")).rejects.toMatchObject({ code: 2002 });
    else await expect(adapter.getTrackDetail("108485")).resolves.toMatchObject({ id: "108485" });
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
    expect(authorized.url).toContain("true.mp3");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await adapter.getPlaySource("1", { unblockMode: "force_on" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it.each(["standard", "higher", "exhigh", "lossless", "hires", "jyeffect", "sky", "dolby", "jymaster"] as const)("keeps complete official audio even when the selected %s tier is unavailable", async level => {
    const adapter = createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm", "msls"] });
    const fetchMock = mockPlaySourceFetch([jsonResponse({ data: [{ id: 108485, url: "https://cdn.test/official.mp3", time: 240000, level: "exhigh", br: 320000, type: "mp3" }] })]);
    await expect(adapter.getPlaySource("108485", { level, unblockMode: "auto" })).resolves.toMatchObject({ url: "https://cdn.test/official.mp3", level: "exhigh", preview: false, resolvedVia: "primary" });
    const calls=fetchMock.mock.calls.map(([url])=>new URL(String(url)));
    expect(calls[0].searchParams.get("unblock")).toBe("false");
    expect(calls[0].searchParams.get("level")).toBe(level);
    expect(calls.some(url=>url.pathname==="/song/url/match")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([30000,45000,120000])("uses matching only after the official %i ms audio is confirmed shorter than the song", async time => {
    const adapter=createAdapter({ pathPlayUrlUnblock: "/song/url/match", unblockSources: ["unm"] });
    const fetchMock=mockPlaySourceFetch([
      jsonResponse({data:[{url:"https://cdn.test/clip.mp3",time,level:"exhigh"}]}),
      jsonResponse({data:[{url:"https://cdn.test/full.flac",time:240000,level:"lossless"}]})
    ]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/full.flac",preview:false,level:"lossless",resolvedVia:"unblock"});
    const calls=fetchMock.mock.calls.map(([url])=>new URL(String(url))).filter(url=>url.pathname!=="/song/detail"&&url.hostname==="music.internal.test");
    expect(calls.map(url=>url.pathname)).toEqual(["/song/url/v1","/song/url/match"]);
    expect(calls[0].searchParams.get("unblock")).toBe("false");
  });

  it.each([45000,60000,238000,240000])("does not mistake a complete short song or harmless duration rounding for a preview: %i", async time => {
    const duration=time<100000?time:240000;
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm"]});
    const fetchMock=mockPlaySourceFetch([jsonResponse({data:[{url:"https://cdn.test/full.mp3",time,level:"standard"}]})],{trackDurationMs:duration});
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({preview:false,resolvedVia:"primary"});
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes("/song/url/match"))).toBe(false);
  });

  it("does not unlock incomplete audio for an unauthorized listener", async()=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm"]});
    const fetchMock=mockPlaySourceFetch([jsonResponse({data:[{url:"https://cdn.test/preview.mp3",time:30000}]})]);
    await expect(adapter.getPlaySource("108485",{unblockMode:"force_off"})).resolves.toMatchObject({preview:true,resolvedVia:"primary"});
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes("/song/url/match"))).toBe(false);
  });

  it.each([
    {data:[{url:"https://cdn.test/full",level:"lossless"}]},
    {data:{url:"https://cdn.test/full",level:"lossless"}},
    {data:"https://cdn.test/full",level:"lossless"},
    {result:{data:"https://cdn.test/full",level:"lossless"}},
    {url:"https://cdn.test/full",level:"lossless"}
  ])("preserves actual quality in each supported upstream envelope",async payload=>{
    const adapter=createAdapter();
    mockPlaySourceFetch([jsonResponse(payload)]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({level:"lossless",preview:false});
  });

  it.each([
    {name:"trial info",primary:{url:"https://cdn.test/preview",time:240000,freeTrialInfo:{start:0,end:30}}},
    {name:"trial privilege",primary:{url:"https://cdn.test/preview",time:240000,freeTrialPrivilege:{cannotListenReason:1}}},
    {name:"time privilege",primary:{url:"https://cdn.test/preview",time:240000,freeTimeTrialPrivilege:{remainTime:30,type:1}}},
    {name:"empty URL",primary:{url:null}},
    {name:"upstream restriction",primary:{url:"https://cdn.test/preview",time:240000,message:"仅可试听片段"}}
  ])("recovers unavailable official audio: $name",async({primary})=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm"]});
    mockPlaySourceFetch([jsonResponse({data:[primary]}),jsonResponse({data:[{url:"https://cdn.test/full",time:240000,level:"exhigh"}]})]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/full",preview:false,resolvedVia:"unblock"});
  });

  it("tries at most two explicitly configured sources and keeps their order",async()=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm","msls","qijieya"]});
    const fetchMock=mockPlaySourceFetch([
      jsonResponse({data:[{url:"https://cdn.test/preview",time:30000}]}),
      jsonResponse({data:[]}),jsonResponse({data:[{url:"https://cdn.test/full",time:240000}]})
    ]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/full",preview:false});
    const calls=fetchMock.mock.calls.map(([url])=>new URL(String(url))).filter(url=>url.pathname==="/song/url/match");
    expect(calls.map(url=>url.searchParams.get("source"))).toEqual(["unm","msls"]);
  });

  it("retains the official preview when every replacement is also incomplete",async()=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm","msls"]});
    mockPlaySourceFetch([
      jsonResponse({data:[{url:"https://cdn.test/preview",time:30000}]}),
      jsonResponse({data:[{url:"https://cdn.test/other-clip",time:120000}]}),jsonResponse({data:[]})
    ]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/preview",preview:true});
  });

  it("rejects a file that claims full duration but has only preview-sized content",async()=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm"]});
    mockPlaySourceFetch([
      jsonResponse({data:[{url:"https://cdn.test/fake",time:240000,br:320000}]}),
      jsonResponse({data:[{url:"https://cdn.test/full",time:240000}]})
    ],{headResponses:[headResponse(481115),headResponse(9000000)]});
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/full",preview:false,resolvedVia:"unblock"});
  });

  it("keeps an official URL if its HEAD response cannot confirm length",async()=>{
    const adapter=createAdapter({pathPlayUrlUnblock:"/song/url/match",unblockSources:["unm"]});
    mockPlaySourceFetch([jsonResponse({data:[{url:"https://cdn.test/full",time:240000}]})],{headResponses:[headResponseWithoutLength()]});
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({url:"https://cdn.test/full",preview:false,resolvedVia:"primary"});
  });

  it("does not infer a selected special tier for a bare URL with no quality information",async()=>{
    const adapter=createAdapter();
    mockPlaySourceFetch([jsonResponse({data:"https://cdn.test/full"})]);
    const result=await adapter.getPlaySource("108485",{level:"jymaster"});
    expect(result.level).toBeUndefined();
  });

  it("reports a missing ordinary MP3 tier from its actual bitrate",async()=>{
    const adapter=createAdapter();
    mockPlaySourceFetch([jsonResponse({data:{url:"https://cdn.test/full",time:240000,type:"mp3",br:320000}})]);
    await expect(adapter.getPlaySource("108485",{level:"jymaster"})).resolves.toMatchObject({level:"exhigh"});
  });

  it("does not turn a duration-metadata outage into a failed official playback",async()=>{
    const adapter=createAdapter();
    const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
      const url=String(input);
      if(url.includes("/song/detail"))return jsonResponse({code:503},503);
      if(init?.method==="HEAD")return headResponse();
      return jsonResponse({data:[{url:"https://cdn.test/full",time:240000,level:"exhigh"}]});
    });
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({preview:false,level:"exhigh"});
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes("/song/url/match"))).toBe(false);
  });

  it("preserves URL expiration separately from media duration",async()=>{
    const adapter=createAdapter();
    mockPlaySourceFetch([jsonResponse({data:[{url:"https://cdn.test/full",time:240000,expi:1200}]})]);
    await expect(adapter.getPlaySource("108485")).resolves.toMatchObject({ttlSeconds:1200});
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
