"use client";

import type {
  AlbumDetail,
  ApiResult,
  ArtistDetail,
  DiscoverData,
  DownloadSource,
  PagedResult,
  Playlist,
  PlaySource,
  SceneData,
  SearchAssist,
  SongInsight,
  ToplistItem,
  Track,
  TrackLyric
} from "@/src/types/music";

async function readResult<T>(response: Response): Promise<T> {
  let payload: ApiResult<T> | null = null;
  try {
    payload = (await response.json()) as ApiResult<T>;
  } catch {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  }

  if ("data" in payload) {
    return payload.data;
  }
  throw new Error(payload.message || "接口返回异常");
}

export async function searchMusic(keyword: string, page = 1, pageSize = 20): Promise<PagedResult<Track>> {
  const response = await fetch(`/api/music/search?q=${encodeURIComponent(keyword)}&page=${page}&pageSize=${pageSize}`, {
    method: "GET"
  });
  return readResult<PagedResult<Track>>(response);
}

export async function getTrackPlaySource(trackId: string): Promise<PlaySource> {
  const response = await fetch(`/api/music/track/${trackId}/play-url`, {
    method: "GET"
  });
  return readResult<PlaySource>(response);
}

export async function getTrackLyric(trackId: string): Promise<TrackLyric> {
  const response = await fetch(`/api/music/track/${trackId}/lyric`, {
    method: "GET"
  });
  return readResult<TrackLyric>(response);
}

export async function getTrackDetail(trackId: string): Promise<Track> {
  const response = await fetch(`/api/music/track/${trackId}`, {
    method: "GET"
  });
  return readResult<Track>(response);
}

export async function getPlaylistDetail(playlistId: string): Promise<Playlist> {
  const response = await fetch(`/api/music/playlist/${playlistId}`, {
    method: "GET"
  });
  return readResult<Playlist>(response);
}

export async function getDiscoverHome(): Promise<DiscoverData> {
  const response = await fetch("/api/music/discover/home", {
    method: "GET"
  });
  return readResult<DiscoverData>(response);
}

export async function getSearchAssist(keyword = ""): Promise<SearchAssist> {
  const response = await fetch(`/api/music/discover/search-assist?q=${encodeURIComponent(keyword)}`, {
    method: "GET"
  });
  return readResult<SearchAssist>(response);
}

export async function getToplist(): Promise<ToplistItem[]> {
  const response = await fetch("/api/music/toplist", {
    method: "GET"
  });
  return readResult<ToplistItem[]>(response);
}

export async function getToplistDetail(toplistId: string): Promise<Playlist> {
  const response = await fetch(`/api/music/toplist/${toplistId}`, {
    method: "GET"
  });
  return readResult<Playlist>(response);
}

export async function getAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const response = await fetch(`/api/music/album/${albumId}`, {
    method: "GET"
  });
  return readResult<AlbumDetail>(response);
}

export async function getArtistDetail(artistId: string): Promise<ArtistDetail> {
  const response = await fetch(`/api/music/artist/${artistId}`, {
    method: "GET"
  });
  return readResult<ArtistDetail>(response);
}

export async function getTrackInsight(trackId: string): Promise<SongInsight> {
  const response = await fetch(`/api/music/track/${trackId}/insight`, {
    method: "GET"
  });
  return readResult<SongInsight>(response);
}

export async function getTrackDownloadUrl(trackId: string, level?: string): Promise<DownloadSource> {
  const query = level ? `?level=${encodeURIComponent(level)}` : "";
  const response = await fetch(`/api/music/track/${trackId}/download-url${query}`, {
    method: "GET"
  });
  return readResult<DownloadSource>(response);
}

export async function getSatiScene(tag?: string): Promise<SceneData> {
  const query = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  const response = await fetch(`/api/music/scene/sati${query}`, {
    method: "GET"
  });
  return readResult<SceneData>(response);
}

export async function getSportScene(bpm = 130): Promise<SceneData> {
  const response = await fetch(`/api/music/scene/sport?bpm=${Math.round(bpm)}`, {
    method: "GET"
  });
  return readResult<SceneData>(response);
}
