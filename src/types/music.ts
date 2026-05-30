export type Artist = {
  id: string;
  name: string;
  coverUrl?: string;
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

export type PlaylistResolveResult = {
  playlistId: string;
  resolvedUrl?: string;
};

export type ImportedPlaylist = {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
  sourceUrl: string;
  importedAt: number;
  updatedAt: number;
};

export type PlayQualityLevel =
  | "standard"
  | "higher"
  | "exhigh"
  | "lossless"
  | "hires"
  | "jyeffect"
  | "sky"
  | "dolby"
  | "jymaster";

export type PlayUnblockMode = "auto" | "force_on" | "force_off";

export type PlaySourceRequestOptions = {
  level?: PlayQualityLevel;
  unblockMode?: PlayUnblockMode;
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
  translatedLines?: LyricLine[];
  translatedRaw?: string;
  karaokeLines?: LyricLine[];
  karaokeRaw?: string;
};

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type DiscoverItemType =
  | "track"
  | "playlist"
  | "album"
  | "artist"
  | "toplist"
  | "banner"
  | "scene";

export type DiscoverItem = {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  type: DiscoverItemType;
  targetId?: string;
  linkUrl?: string;
};

export type DiscoverBlock = {
  id: string;
  title: string;
  items: DiscoverItem[];
};

export type SearchAssist = {
  defaultKeyword?: string;
  hotKeywords: string[];
  suggestions: string[];
};

export type DiscoverData = {
  blocks: DiscoverBlock[];
  searchAssist: SearchAssist;
};

export type ToplistItem = {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  updateFrequency?: string;
  tracksPreview: Track[];
};

export type AlbumDetail = {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  publishTime?: number;
  artists: Artist[];
  tracks: Track[];
};

export type ArtistDetail = {
  id: string;
  name: string;
  coverUrl?: string;
  briefDesc?: string;
  topTracks: Track[];
};

export type ArtistSearchItem = {
  id: string;
  name: string;
  coverUrl?: string;
  musicSize?: number;
  albumSize?: number;
};

export type SongCreator = {
  name: string;
  role?: string;
};

export type SongInsight = {
  trackId: string;
  playable?: boolean;
  creators: SongCreator[];
  wikiSummary?: string;
  chorusStartMs?: number;
  alternatives: Track[];
};

export type DownloadSource = {
  trackId: string;
  level: string;
  url: string;
  bitrate?: number;
  size?: number;
  format?: string;
  ttlSeconds?: number;
};

export type SceneTag = {
  id: string;
  name: string;
};

export type SceneResource = {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  trackId?: string;
  bpm?: number;
  tag?: string;
};

export type SceneData = {
  tags: SceneTag[];
  resources: SceneResource[];
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
