import { CircuitBreaker } from "@/src/lib/circuit-breaker";
import { AppError } from "@/src/lib/errors";
import type { MusicSourceAdapter } from "@/src/lib/music/adapter";
import type { TrackSearchInput } from "@/src/lib/music/adapter";
import { createMockMusicAdapter } from "@/src/lib/music/providers/mock";
import { createNeteaseLikeAdapterFromEnv } from "@/src/lib/music/providers/netease-like";
import type { PagedResult, Playlist, PlaySource, Track, TrackLyric } from "@/src/types/music";

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

export async function getTrack(trackId: string): Promise<Track> {
  try {
    return await breaker.execute(() => getAdapter().getTrackDetail(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getTrackDetail(trackId);
  }
}

export async function getPlaySource(trackId: string): Promise<PlaySource> {
  try {
    return await breaker.execute(() => getAdapter().getPlaySource(trackId));
  } catch (error) {
    if (!envEnabled("MUSIC_SOURCE_MOCK_FALLBACK", false)) throw error;
    adapter = createMockMusicAdapter();
    return adapter.getPlaySource(trackId);
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
