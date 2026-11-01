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

const breakers = new Map<keyof MusicSourceAdapter, CircuitBreaker>();
function breakerFor(operation: keyof MusicSourceAdapter) {
  let breaker = breakers.get(operation);
  if (!breaker) { breaker = new CircuitBreaker({ failureThreshold: 3, coolDownMs: 7000 }); breakers.set(operation, breaker); }
  return breaker;
}
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
    return await breakerFor("searchTracks").execute(() => getAdapter().searchTracks(input));
  } catch (error) {
    const fallbackToMock = envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false);
    if (!fallbackToMock) throw error;

    return createMockMusicAdapter().searchTracks(input);
  }
}

export async function searchArtists(input: ArtistSearchInput): Promise<PagedResult<ArtistSearchItem>> {
  try {
    return await breakerFor("searchArtists").execute(() => getAdapter().searchArtists(input));
  } catch (error) {
    const fallbackToMock = envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false);
    if (!fallbackToMock) throw error;

    return createMockMusicAdapter().searchArtists(input);
  }
}

export async function searchPlaylists(input: TrackSearchInput): Promise<PagedResult<Playlist>> {
  try {
    return await breakerFor("searchPlaylists").execute(() => getAdapter().searchPlaylists(input));
  } catch (error) {
    const fallbackToMock = envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false);
    if (!fallbackToMock) throw error;

    return createMockMusicAdapter().searchPlaylists(input);
  }
}

export async function getTrack(trackId: string): Promise<Track> {
  try {
    return await breakerFor("getTrackDetail").execute(() => getAdapter().getTrackDetail(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getTrackDetail(trackId);
  }
}

export async function getTrackQualityAvailability(trackId: string): Promise<TrackQualityAvailability> {
  try {
    return await breakerFor("getTrackQualityAvailability").execute(() => getAdapter().getTrackQualityAvailability(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getTrackQualityAvailability(trackId);
  }
}

export function getCachedTrackQualityAvailability(trackId: string): TrackQualityAvailability | undefined {
  return getAdapter().getCachedTrackQualityAvailability?.(trackId);
}

export async function getPlaySource(trackId: string, options?: PlaySourceRequestOptions): Promise<PlaySource> {
  try {
    return await breakerFor("getPlaySource").execute(() => getAdapter().getPlaySource(trackId, options));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getPlaySource(trackId, options);
  }
}

export async function getTrackLyric(trackId: string): Promise<TrackLyric> {
  try {
    return await breakerFor("getTrackLyric").execute(() => getAdapter().getTrackLyric(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getTrackLyric(trackId);
  }
}

export async function getPlaylist(playlistId: string): Promise<Playlist> {
  try {
    return await breakerFor("getPlaylist").execute(() => getAdapter().getPlaylist(playlistId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getPlaylist(playlistId);
  }
}

export async function getSearchAssist(keyword: string): Promise<SearchAssist> {
  try {
    return await breakerFor("getSearchAssist").execute(() => getAdapter().getSearchAssist(keyword));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getSearchAssist();
  }
}

export async function getDiscoverData(): Promise<DiscoverData> {
  try {
    return await breakerFor("getDiscoverData").execute(() => getAdapter().getDiscoverData());
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getDiscoverData();
  }
}

export async function getToplist(): Promise<ToplistItem[]> {
  try {
    return await breakerFor("getToplist").execute(() => getAdapter().getToplist());
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getToplist();
  }
}

export async function getAlbumDetail(albumId: string): Promise<AlbumDetail> {
  try {
    return await breakerFor("getAlbumDetail").execute(() => getAdapter().getAlbumDetail(albumId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getAlbumDetail(albumId);
  }
}

export async function getArtistDetail(artistId: string): Promise<ArtistDetail> {
  try {
    return await breakerFor("getArtistDetail").execute(() => getAdapter().getArtistDetail(artistId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getArtistDetail(artistId);
  }
}

export async function getTrackInsight(trackId: string): Promise<SongInsight> {
  try {
    return await breakerFor("getTrackInsight").execute(() => getAdapter().getTrackInsight(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getTrackInsight(trackId);
  }
}

export async function getDownloadSource(trackId: string, level?: string): Promise<DownloadSource> {
  try {
    return await breakerFor("getDownloadSource").execute(() => getAdapter().getDownloadSource(trackId, level));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getDownloadSource(trackId, level);
  }
}

export async function getSatiScene(tag?: string): Promise<SceneData> {
  try {
    return await breakerFor("getSatiScene").execute(() => getAdapter().getSatiScene(tag));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getSatiScene();
  }
}

export async function getSportScene(bpm: number): Promise<SceneData> {
  try {
    return await breakerFor("getSportScene").execute(() => getAdapter().getSportScene(bpm));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    return createMockMusicAdapter().getSportScene(bpm);
  }
}
