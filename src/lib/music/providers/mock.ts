import type { MusicSourceAdapter, TrackSearchInput } from "@/src/lib/music/adapter";
import { parseLyric } from "@/src/lib/lyrics";
import type { PagedResult, Playlist, PlaySource, Track, TrackLyric } from "@/src/types/music";

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

  async getTrackDetail(trackId: string): Promise<Track> {
    return MOCK_TRACKS.find((track) => track.id === trackId) ?? MOCK_TRACKS[0];
  }

  async getPlaySource(trackId: string): Promise<PlaySource> {
    return {
      trackId,
      url: MOCK_AUDIO_URL,
      bitrate: 320000,
      ttlSeconds: 60
    };
  }

  async getTrackLyric(trackId: string): Promise<TrackLyric> {
    return {
      trackId,
      raw: MOCK_LYRIC,
      lines: parseLyric(MOCK_LYRIC)
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
}

export function createMockMusicAdapter() {
  return new MockMusicAdapter();
}
