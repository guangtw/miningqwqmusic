export type Artist = {
  id: string;
  name: string;
};

export type Album = {
  id: string;
  name: string;
  coverUrl?: string;
};

export type Track = {
  id: string;
  name: string;
  artists: Artist[];
  album?: Album;
  durationMs: number;
  coverUrl?: string;
};

export type Playlist = {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
};

export type PlaySource = {
  trackId: string;
  url: string;
  bitrate?: number;
  expiresAt?: string;
  ttlSeconds?: number;
};

export type LyricLine = {
  timeMs: number;
  text: string;
};

export type TrackLyric = {
  trackId: string;
  lines: LyricLine[];
  raw?: string;
};

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type ApiSuccess<T> = {
  code: 0;
  data: T;
  message: string;
  traceId: string;
};

export type ApiFailure = {
  code: number;
  message: string;
  traceId: string;
  retryable: boolean;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type PlaybackMode = "sequence" | "loop-one" | "shuffle";
