import { AppError } from "@/src/lib/errors";
import { fetchWithRetry } from "@/src/lib/http";
import { parseLyric } from "@/src/lib/lyrics";
import type { MusicSourceAdapter, TrackSearchInput } from "@/src/lib/music/adapter";
import type { PagedResult, Playlist, PlaySource, Track, TrackLyric } from "@/src/types/music";

type NeteaseArtist = {
  id: number | string;
  name: string;
};

type NeteaseAlbum = {
  id: number | string;
  name: string;
  picUrl?: string;
  pic?: string;
  coverImgUrl?: string;
  blurPicUrl?: string;
};

type NeteaseSong = {
  id: number | string;
  name: string;
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  al?: NeteaseAlbum;
  album?: NeteaseAlbum;
  picUrl?: string;
  coverImgUrl?: string;
  dt?: number;
  duration?: number;
};

type AdapterConfig = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  retries: number;
  playLevel: string;
  vipPreviewMaxMs: number;
  pathPlayUrlUnblock?: string;
  unblockSource?: string;
  pathSearch: string;
  pathTrackDetail: string;
  pathPlayUrl: string;
  pathLyric: string;
  pathPlaylist: string;
};

function resolveCoverUrl(song: NeteaseSong, albumRaw?: NeteaseAlbum): string | undefined {
  return (
    albumRaw?.picUrl ??
    albumRaw?.pic ??
    albumRaw?.coverImgUrl ??
    albumRaw?.blurPicUrl ??
    song.picUrl ??
    song.coverImgUrl
  );
}

function toTrack(song: NeteaseSong): Track {
  const artists = (song.ar ?? song.artists ?? []).map((artist) => ({
    id: String(artist.id),
    name: artist.name
  }));
  const albumRaw = song.al ?? song.album;
  const coverUrl = resolveCoverUrl(song, albumRaw);
  const album = albumRaw
    ? {
        id: String(albumRaw.id),
        name: albumRaw.name,
        coverUrl
      }
    : undefined;
  return {
    id: String(song.id),
    name: song.name,
    artists,
    album,
    durationMs: song.dt ?? song.duration ?? 0,
    coverUrl
  };
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function trimEndSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export class NeteaseLikeAdapter implements MusicSourceAdapter {
  private readonly config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = {
      ...config,
      baseUrl: trimEndSlash(config.baseUrl)
    };
  }

  private async request<T>(path: string, query: Record<string, string | number>) {
    const url = new URL(`${this.config.baseUrl}${normalizePath(path)}`);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
    return fetchWithRetry<T>(
      url.toString(),
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {})
        }
      },
      {
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries
      }
    );
  }

  private toPlaySource(
    trackId: string,
    data: { id?: number; url?: string; br?: number; time?: number; expi?: number; expiresAt?: string }
  ): PlaySource {
    return {
      trackId,
      url: data.url ?? "",
      bitrate: data.br,
      ttlSeconds: data.time
        ? Math.max(10, Math.floor(data.time / 1000))
        : data.expi
          ? Math.max(10, Math.floor(data.expi))
          : undefined,
      expiresAt: data.expiresAt
    };
  }

  private extractPlayData(raw: unknown): { id?: number; url?: string; br?: number; time?: number; expi?: number; expiresAt?: string } | null {
    if (!raw || typeof raw !== "object") return null;
    const payload = raw as { data?: unknown; url?: unknown };
    if (Array.isArray(payload.data)) {
      const first = payload.data[0];
      return first && typeof first === "object" ? (first as { id?: number; url?: string; br?: number; time?: number; expi?: number; expiresAt?: string }) : null;
    }
    if (typeof payload.data === "string") {
      return { url: payload.data };
    }
    if (payload.data && typeof payload.data === "object" && typeof (payload.data as { url?: unknown }).url === "string") {
      return payload.data as { id?: number; url?: string; br?: number; time?: number; expi?: number; expiresAt?: string };
    }
    if (typeof payload.url === "string") {
      return { url: payload.url };
    }
    return null;
  }

  async searchTracks(input: TrackSearchInput): Promise<PagedResult<Track>> {
    const offset = (input.page - 1) * input.pageSize;
    const raw = await this.request<{ result?: { songs?: NeteaseSong[]; songCount?: number } }>(
      this.config.pathSearch,
      {
        keywords: input.keyword,
        limit: input.pageSize,
        offset
      }
    );

    const songs = raw.result?.songs ?? [];
    return {
      items: songs.map(toTrack),
      page: input.page,
      pageSize: input.pageSize,
      total: raw.result?.songCount ?? songs.length
    };
  }

  async getTrackDetail(trackId: string): Promise<Track> {
    const raw = await this.request<{ songs?: NeteaseSong[] }>(this.config.pathTrackDetail, {
      ids: trackId
    });
    const song = raw.songs?.[0];
    if (!song) {
      throw new AppError("Track not found", { code: 3001, status: 404, retryable: false });
    }
    return toTrack(song);
  }

  async getPlaySource(trackId: string): Promise<PlaySource> {
    const raw = await this.request<{ data?: unknown; url?: string }>(
      this.config.pathPlayUrl,
      {
        id: trackId,
        level: this.config.playLevel
      }
    );
    const data = this.extractPlayData(raw);
    if (!data?.url) {
      throw new AppError("Play source unavailable", { code: 3002, status: 404, retryable: true });
    }

    const isVipPreview = Boolean(data.time && data.time > 0 && data.time <= this.config.vipPreviewMaxMs);
    if (!isVipPreview || !this.config.pathPlayUrlUnblock) {
      return this.toPlaySource(trackId, data);
    }

    try {
      const unblockRaw = await this.request<{ data?: unknown; url?: string }>(
        this.config.pathPlayUrlUnblock,
        {
          id: trackId,
          level: this.config.playLevel,
          ...(this.config.unblockSource ? { source: this.config.unblockSource } : {})
        }
      );
      const unblockData = this.extractPlayData(unblockRaw);
      if (unblockData?.url) {
        const isStillPreview = Boolean(unblockData.time && unblockData.time > 0 && unblockData.time <= this.config.vipPreviewMaxMs);
        if (!isStillPreview) {
          return this.toPlaySource(trackId, unblockData);
        }
      }
    } catch {
      // 解灰接口失败时保留默认链接，避免播放直接失败。
    }

    return this.toPlaySource(trackId, data);
  }

  async getTrackLyric(trackId: string): Promise<TrackLyric> {
    const raw = await this.request<{ lrc?: { lyric?: string } }>(this.config.pathLyric, {
      id: trackId
    });
    const lyric = raw.lrc?.lyric ?? "";
    return {
      trackId,
      raw: lyric,
      lines: parseLyric(lyric)
    };
  }

  async getPlaylist(playlistId: string): Promise<Playlist> {
    const raw = await this.request<{
      playlist?: { id: number; name: string; description?: string; coverImgUrl?: string; tracks?: NeteaseSong[] };
    }>(this.config.pathPlaylist, {
      id: playlistId
    });

    const playlist = raw.playlist;
    if (!playlist) {
      throw new AppError("Playlist not found", { code: 3003, status: 404, retryable: false });
    }

    return {
      id: String(playlist.id),
      name: playlist.name,
      description: playlist.description,
      coverUrl: playlist.coverImgUrl,
      tracks: (playlist.tracks ?? []).map(toTrack)
    };
  }
}

export function createNeteaseLikeAdapterFromEnv() {
  const baseUrl = process.env.MUSIC_SOURCE_BASE_URL ?? "";
  const apiKey = process.env.MUSIC_SOURCE_API_KEY ?? "";

  if (!baseUrl) {
    throw new AppError("Missing MUSIC_SOURCE_BASE_URL", {
      code: 2007,
      status: 500,
      retryable: false
    });
  }

  return new NeteaseLikeAdapter({
    baseUrl,
    apiKey: apiKey || undefined,
    timeoutMs: Number(process.env.MUSIC_SOURCE_TIMEOUT_MS ?? "6000"),
    retries: Number(process.env.MUSIC_SOURCE_RETRY_TIMES ?? "2"),
    playLevel: process.env.MUSIC_SOURCE_PLAY_LEVEL ?? "standard",
    vipPreviewMaxMs: Number(process.env.MUSIC_SOURCE_VIP_PREVIEW_MAX_MS ?? "60000"),
    pathPlayUrlUnblock: process.env.MUSIC_SOURCE_PATH_PLAY_URL_UNBLOCK ?? "",
    unblockSource: process.env.MUSIC_SOURCE_UNBLOCK_SOURCE ?? "",
    pathSearch: process.env.MUSIC_SOURCE_PATH_SEARCH ?? "/search",
    pathTrackDetail: process.env.MUSIC_SOURCE_PATH_TRACK_DETAIL ?? "/song/detail",
    pathPlayUrl: process.env.MUSIC_SOURCE_PATH_PLAY_URL ?? "/song/url/v1",
    pathLyric: process.env.MUSIC_SOURCE_PATH_LYRIC ?? "/lyric",
    pathPlaylist: process.env.MUSIC_SOURCE_PATH_PLAYLIST ?? "/playlist/detail"
  });
}
