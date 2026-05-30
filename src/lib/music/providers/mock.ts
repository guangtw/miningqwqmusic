import type { ArtistSearchInput, MusicSourceAdapter, TrackSearchInput } from "@/src/lib/music/adapter";
import { parseLyric } from "@/src/lib/lyrics";
import type {
  AlbumDetail,
  ArtistSearchItem,
  ArtistDetail,
  DiscoverData,
  DownloadSource,
  PagedResult,
  Playlist,
  PlaySource,
  PlaySourceRequestOptions,
  SceneData,
  SearchAssist,
  SongInsight,
  ToplistItem,
  Track,
  TrackLyric
} from "@/src/types/music";

const MOCK_TRACKS: Track[] = [
  {
    id: "mock-1",
    name: "Neon Skyline",
    artists: [{ id: "mock-a1", name: "Aurora Unit" }],
    album: { id: "mock-alb-1", name: "City Echo", coverUrl: "https://picsum.photos/seed/mock1/420/420" },
    coverUrl: "https://picsum.photos/seed/mock1/420/420",
    durationMs: 218000
  },
  {
    id: "mock-2",
    name: "Signal in Rain",
    artists: [{ id: "mock-a2", name: "Blue Harbor" }],
    album: { id: "mock-alb-2", name: "Afterlight", coverUrl: "https://picsum.photos/seed/mock2/420/420" },
    coverUrl: "https://picsum.photos/seed/mock2/420/420",
    durationMs: 196000
  },
  {
    id: "mock-3",
    name: "Soft Voltage",
    artists: [{ id: "mock-a3", name: "Paper Engine" }],
    album: { id: "mock-alb-3", name: "Horizon Tape", coverUrl: "https://picsum.photos/seed/mock3/420/420" },
    coverUrl: "https://picsum.photos/seed/mock3/420/420",
    durationMs: 241000
  },
  {
    id: "mock-4",
    name: "Quiet Orbit",
    artists: [{ id: "mock-a4", name: "Night Folder" }],
    album: { id: "mock-alb-4", name: "Satellite Room", coverUrl: "https://picsum.photos/seed/mock4/420/420" },
    coverUrl: "https://picsum.photos/seed/mock4/420/420",
    durationMs: 205000
  }
];

const MOCK_AUDIO_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

const MOCK_LYRIC = `[00:00.00]欢迎使用 Mock 音乐源
[00:08.00]你的私有 API 未接入时可先验证播放器能力
[00:18.00]支持进度、切歌、续签逻辑与歌词高亮
[00:30.00]等私有服务就绪后只需切回真实 provider
[00:42.00]MiningQwQ Music`;

export class MockMusicAdapter implements MusicSourceAdapter {
  async searchTracks(input: TrackSearchInput): Promise<PagedResult<Track>> {
    const q = input.keyword.trim().toLowerCase();
    const filtered = !q
      ? MOCK_TRACKS
      : MOCK_TRACKS.filter((track) => {
          const hay = `${track.name} ${track.artists.map((a) => a.name).join(" ")} ${track.album?.name ?? ""}`.toLowerCase();
          return hay.includes(q);
        });

    const start = (input.page - 1) * input.pageSize;
    const items = filtered.slice(start, start + input.pageSize);
    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total: filtered.length
    };
  }

  async searchArtists(input: ArtistSearchInput): Promise<PagedResult<ArtistSearchItem>> {
    const q = input.keyword.trim().toLowerCase();
    const artistMap = new Map<string, ArtistSearchItem>();
    MOCK_TRACKS.forEach((track) => {
      track.artists.forEach((artist) => {
        if (!artistMap.has(artist.id)) {
          artistMap.set(artist.id, {
            id: artist.id,
            name: artist.name,
            coverUrl: artist.coverUrl,
            musicSize: 1,
            albumSize: 1
          });
        } else {
          const previous = artistMap.get(artist.id);
          artistMap.set(artist.id, {
            ...(previous as ArtistSearchItem),
            musicSize: (previous?.musicSize ?? 0) + 1
          });
        }
      });
    });

    const artists = Array.from(artistMap.values());
    const filtered = !q ? artists : artists.filter((artist) => artist.name.toLowerCase().includes(q));
    const start = (input.page - 1) * input.pageSize;
    return {
      items: filtered.slice(start, start + input.pageSize),
      page: input.page,
      pageSize: input.pageSize,
      total: filtered.length
    };
  }

  async getTrackDetail(trackId: string): Promise<Track> {
    return MOCK_TRACKS.find((track) => track.id === trackId) ?? MOCK_TRACKS[0];
  }

  async getPlaySource(trackId: string, options?: PlaySourceRequestOptions): Promise<PlaySource> {
    const level = options?.level ?? "standard";
    const bitrateByLevel: Record<string, number> = {
      standard: 128000,
      higher: 192000,
      exhigh: 320000,
      lossless: 999000,
      hires: 1000000,
      jyeffect: 640000,
      sky: 640000,
      dolby: 640000,
      jymaster: 1200000
    };
    return {
      trackId,
      url: MOCK_AUDIO_URL,
      bitrate: bitrateByLevel[level] ?? 320000,
      ttlSeconds: 60
    };
  }

  async getTrackLyric(trackId: string): Promise<TrackLyric> {
    return {
      trackId,
      raw: MOCK_LYRIC,
      lines: parseLyric(MOCK_LYRIC),
      translatedRaw: MOCK_LYRIC,
      translatedLines: parseLyric(MOCK_LYRIC)
    };
  }

  async getPlaylist(playlistId: string): Promise<Playlist> {
    return {
      id: playlistId,
      name: "Mock Daily Mix",
      description: "用于本地开发和 UI 联调的示例歌单。",
      coverUrl: MOCK_TRACKS[0].coverUrl,
      tracks: MOCK_TRACKS
    };
  }

  async getSearchAssist(): Promise<SearchAssist> {
    return {
      defaultKeyword: "林俊杰",
      hotKeywords: ["修炼爱情", "江南", "曹操", "可惜没如果", "不为谁而作的歌"],
      suggestions: ["林俊杰", "修炼爱情", "江南"]
    };
  }

  async getDiscoverData(): Promise<DiscoverData> {
    return {
      searchAssist: await this.getSearchAssist(),
      blocks: [
        {
          id: "mock-banner",
          title: "推荐内容",
          items: MOCK_TRACKS.slice(0, 3).map((track) => ({
            id: `banner-${track.id}`,
            title: track.name,
            subtitle: "Mock Banner",
            coverUrl: track.coverUrl,
            type: "banner",
            targetId: track.id
          }))
        },
        {
          id: "mock-playlist",
          title: "推荐歌单",
          items: MOCK_TRACKS.map((track) => ({
            id: `playlist-${track.id}`,
            title: track.name,
            subtitle: track.artists.map((item) => item.name).join(" / "),
            coverUrl: track.coverUrl,
            type: "playlist",
            targetId: track.id
          }))
        }
      ]
    };
  }

  async getToplist(): Promise<ToplistItem[]> {
    return [
      {
        id: "mock-top-1",
        name: "Mock 热门榜",
        description: "本地联调示例榜单",
        coverUrl: MOCK_TRACKS[0].coverUrl,
        updateFrequency: "每日更新",
        tracksPreview: MOCK_TRACKS.slice(0, 3)
      }
    ];
  }

  async getAlbumDetail(albumId: string): Promise<AlbumDetail> {
    return {
      id: albumId,
      name: "Mock Album",
      description: "用于联调的专辑详情",
      coverUrl: MOCK_TRACKS[0].coverUrl,
      publishTime: Date.now(),
      artists: MOCK_TRACKS[0].artists,
      tracks: MOCK_TRACKS
    };
  }

  async getArtistDetail(artistId: string): Promise<ArtistDetail> {
    return {
      id: artistId,
      name: "Mock Artist",
      coverUrl: MOCK_TRACKS[0].coverUrl,
      briefDesc: "用于联调的歌手详情信息。",
      topTracks: MOCK_TRACKS
    };
  }

  async getTrackInsight(trackId: string): Promise<SongInsight> {
    return {
      trackId,
      playable: true,
      creators: [{ name: "Mock Creator", role: "作曲" }],
      wikiSummary: "这是一首用于联调的示例歌曲。",
      chorusStartMs: 30000,
      alternatives: []
    };
  }

  async getDownloadSource(trackId: string, level = "exhigh"): Promise<DownloadSource> {
    return {
      trackId,
      level,
      url: MOCK_AUDIO_URL,
      bitrate: 320000,
      format: "mp3",
      ttlSeconds: 60
    };
  }

  async getSatiScene(): Promise<SceneData> {
    return {
      tags: [
        { id: "sleep", name: "助眠" },
        { id: "relax", name: "解压" }
      ],
      resources: MOCK_TRACKS.map((track, index) => ({
        id: `scene-${index + 1}`,
        title: track.name,
        subtitle: "Mock 场景资源",
        coverUrl: track.coverUrl,
        trackId: track.id,
        tag: "sleep"
      }))
    };
  }

  async getSportScene(bpm: number): Promise<SceneData> {
    return {
      tags: [{ id: "sport", name: `跑步漫游 · ${bpm} BPM` }],
      resources: MOCK_TRACKS.map((track, index) => ({
        id: `sport-${index + 1}`,
        title: track.name,
        subtitle: "Mock 跑步漫游",
        coverUrl: track.coverUrl,
        trackId: track.id,
        bpm
      }))
    };
  }
}

export function createMockMusicAdapter() {
  return new MockMusicAdapter();
}
