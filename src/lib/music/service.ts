import { CircuitBreaker } from "@/src/lib/circuit-breaker";
import { AppError } from "@/src/lib/errors";
import type { ArtistSearchInput } from "@/src/lib/music/adapter";
import type { MusicSourceAdapter } from "@/src/lib/music/adapter";
import type { TrackSearchInput } from "@/src/lib/music/adapter";
import { createMockMusicAdapter } from "@/src/lib/music/providers/mock";
import { createNeteaseLikeAdapterFromEnv } from "@/src/lib/music/providers/netease-like";
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
  TrackQualityAvailability,
  Track,
  TrackLyric
} from "@/src/types/music";

const breaker = new CircuitBreaker({ failureThreshold: 3, coolDownMs: 7000 });
let adapter: MusicSourceAdapter | null = null;

function envEnabled(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getAdapter() {
  if (!adapter) {
    const forceMock = envEnabled("MUSIC_SOURCE_MOCK_ENABLED", false);
    const hasBaseUrl = Boolean(process.env.MUSIC_SOURCE_BASE_URL);

    if (forceMock) {
      adapter = createMockMusicAdapter();
    } else if (!hasBaseUrl) {
      throw new AppError("Missing MUSIC_SOURCE_BASE_URL", {
        code: 2007,
        status: 500,
        retryable: false
      });
    } else {
      adapter = createNeteaseLikeAdapterFromEnv();
    }
  }
  return adapter;
}

export async function searchTracks(input: TrackSearchInput): Promise<PagedResult<Track>> {
  try {
    return await breaker.execute(() => getAdapter().searchTracks(input));
  } catch (error) {
    const fallbackToMock = envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false);
    if (!fallbackToMock) throw error;

    adapter = createMockMusicAdapter();
    return adapter.searchTracks(input);
  }
}

export async function searchArtists(input: ArtistSearchInput): Promise<PagedResult<ArtistSearchItem>> {
  try {
    return await breaker.execute(() => getAdapter().searchArtists(input));
  } catch (error) {
    const fallbackToMock = envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false);
    if (!fallbackToMock) throw error;

    adapter = createMockMusicAdapter();
    return adapter.searchArtists(input);
  }
}

export async function getTrack(trackId: string): Promise<Track> {
  try {
    return await breaker.execute(() => getAdapter().getTrackDetail(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getTrackDetail(trackId);
  }
}

export async function getTrackQualityAvailability(trackId: string): Promise<TrackQualityAvailability> {
  try {
    return await breaker.execute(() => getAdapter().getTrackQualityAvailability(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getTrackQualityAvailability(trackId);
  }
}

export async function getPlaySource(trackId: string, options?: PlaySourceRequestOptions): Promise<PlaySource> {
  try {
    return await breaker.execute(() => getAdapter().getPlaySource(trackId, options));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getPlaySource(trackId, options);
  }
}

export async function getTrackLyric(trackId: string): Promise<TrackLyric> {
  try {
    return await breaker.execute(() => getAdapter().getTrackLyric(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getTrackLyric(trackId);
  }
}

export async function getPlaylist(playlistId: string): Promise<Playlist> {
  try {
    return await breaker.execute(() => getAdapter().getPlaylist(playlistId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getPlaylist(playlistId);
  }
}

export async function getSearchAssist(keyword: string): Promise<SearchAssist> {
  try {
    return await breaker.execute(() => getAdapter().getSearchAssist(keyword));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getSearchAssist(keyword);
  }
}

export async function getDiscoverData(): Promise<DiscoverData> {
  try {
    return await breaker.execute(() => getAdapter().getDiscoverData());
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getDiscoverData();
  }
}

export async function getToplist(): Promise<ToplistItem[]> {
  try {
    return await breaker.execute(() => getAdapter().getToplist());
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getToplist();
  }
}

export async function getAlbumDetail(albumId: string): Promise<AlbumDetail> {
  try {
    return await breaker.execute(() => getAdapter().getAlbumDetail(albumId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getAlbumDetail(albumId);
  }
}

export async function getArtistDetail(artistId: string): Promise<ArtistDetail> {
  try {
    return await breaker.execute(() => getAdapter().getArtistDetail(artistId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getArtistDetail(artistId);
  }
}

export async function getTrackInsight(trackId: string): Promise<SongInsight> {
  try {
    return await breaker.execute(() => getAdapter().getTrackInsight(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getTrackInsight(trackId);
  }
}

export async function getDownloadSource(trackId: string, level?: string): Promise<DownloadSource> {
  try {
    return await breaker.execute(() => getAdapter().getDownloadSource(trackId, level));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getDownloadSource(trackId, level);
  }
}

export async function getSatiScene(tag?: string): Promise<SceneData> {
  try {
    return await breaker.execute(() => getAdapter().getSatiScene(tag));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getSatiScene(tag);
  }
}

export async function getSportScene(bpm: number): Promise<SceneData> {
  try {
    return await breaker.execute(() => getAdapter().getSportScene(bpm));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getSportScene(bpm);
  }
}
