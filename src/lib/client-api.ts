"use client";

import type { ApiResult, PagedResult, PlaySource, Track, TrackLyric } from "@/src/types/music";

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
