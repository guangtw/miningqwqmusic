import { AppError } from "@/src/lib/errors";
import { fetchWithRetry } from "@/src/lib/http";
import { parseLyric } from "@/src/lib/lyrics";
import type { ArtistSearchInput, MusicSourceAdapter, TrackSearchInput } from "@/src/lib/music/adapter";
import type {
  AlbumDetail,
  ArtistSearchItem,
  ArtistDetail,
  DiscoverBlock,
  DiscoverData,
  DiscoverItemType,
  DownloadSource,
  PagedResult,
  Playlist,
  PlaySource,
  PlayQualityLevel,
  PlaySourceRequestOptions,
  PlayUnblockMode,
  SceneData,
  SceneResource,
  SearchAssist,
  SongCreator,
  SongInsight,
  ToplistItem,
  TrackQualityAvailability,
  Track,
  TrackLyric
} from "@/src/types/music";
import { PLAY_QUALITY_LEVELS, resolvePlayableQualityFallback, sortPlayQualityLevels, toPlayQualityLevel } from "@/src/lib/play-quality";

type NeteaseArtist = {
  id: number | string;
  name: string;
  img1v1Url?: string;
  picUrl?: string;
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
  h?: Record<string, unknown> | null;
  m?: Record<string, unknown> | null;
  l?: Record<string, unknown> | null;
  sq?: Record<string, unknown> | null;
  hr?: Record<string, unknown> | null;
  mark?: number;
};

type NeteaseSongQualityDetail = {
  songId?: number | string;
  h?: Record<string, unknown> | null;
  m?: Record<string, unknown> | null;
  l?: Record<string, unknown> | null;
  sq?: Record<string, unknown> | null;
  hr?: Record<string, unknown> | null;
  db?: Record<string, unknown> | null;
  jm?: Record<string, unknown> | null;
  je?: Record<string, unknown> | null;
  sk?: Record<string, unknown> | null;
  sks?: Array<Record<string, unknown>> | null;
};

type AdapterConfig = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  retries: number;
  playLevel: string;
  downloadLevel: string;
  vipPreviewMaxMs: number;
  lyricPreferNew: boolean;
  enableDiscover: boolean;
  enableScene: boolean;
  pathPlayUrlUnblock?: string;
  unblockSource?: string;
  unblockSources?: string[];
  pathSearch: string;
  pathTrackDetail: string;
  pathPlayUrl: string;
  pathLyric: string;
  pathLyricNew: string;
  pathPlaylist: string;
  pathSearchHotDetail: string;
  pathSearchDefault: string;
  pathSearchSuggestPc: string;
  pathBanner: string;
  pathPersonalized: string;
  pathToplistDetail: string;
  pathTopPlaylistHighquality: string;
  pathToplist: string;
  pathAlbum: string;
  pathAlbumDetail: string;
  pathArtistDetail: string;
  pathArtistTopSong: string;
  pathCheckMusic: string;
  pathSongCreators: string;
  pathSongWikiSummary: string;
  pathSongChorus: string;
  pathSongCopyrightRcmd: string;
  pathSongDownloadUrl: string;
  pathSongMusicDetail: string;
  pathSatiTagList: string;
  pathSatiResourceList: string;
  pathRadioSportGet: string;
};

type PlayData = {
  id?: number;
  url?: string | null;
  br?: number;
  size?: number;
  code?: number;
  time?: number;
  expi?: number;
  expiresAt?: string;
  level?: string | null;
  type?: string | null;
  message?: string | null;
  msg?: string | null;
  freeTrialInfo?: Record<string, unknown> | null;
  freeTrialPrivilege?: Record<string, unknown> | null;
  freeTimeTrialPrivilege?: Record<string, unknown> | null;
};

type PlayCandidate = {
  raw: unknown;
  data: PlayData;
  resolvedVia: "primary" | "unblock";
};

type AudioUrlProbe = {
  contentLength?: number;
  contentType?: string;
  ok: boolean;
};

type AnyRecord = Record<string, unknown>;

function asObject(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function hasQualityPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length > 0 && (asNumber(record.br) !== undefined || asNumber(record.size) !== undefined || asNumber(record.sr) !== undefined);
}

function asIdString(value: unknown): string | undefined {
  const stringValue = asString(value);
  if (stringValue !== undefined) return stringValue;
  const numericValue = asNumber(value);
  if (numericValue !== undefined) return String(numericValue);
  return undefined;
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
}

const DEFAULT_UNBLOCK_SOURCES = ["unm", "msls", "qijieya"];

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function trimEndSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function mapBannerTargetTypeToDiscoverType(targetType: number | undefined): DiscoverItemType {
  if (targetType === 1) return "track";
  if (targetType === 10) return "album";
  if (targetType === 100) return "artist";
  if (targetType === 1000) return "playlist";
  return "banner";
}

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
    name: artist.name,
    coverUrl: artist.img1v1Url ?? artist.picUrl
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

function toTrackFromLoose(rawSong: unknown): Track {
  const song = asObject(rawSong);
  const artistsLoose = asArray<AnyRecord>(song.ar ?? song.artists);
  const artists = artistsLoose.map((artist) => ({
    id: String(artist.id ?? ""),
    name: String(artist.name ?? "未知歌手"),
    coverUrl: asString(artist.img1v1Url) ?? asString(artist.picUrl)
  }));

  const albumLoose = asObject(song.al ?? song.album);
  const coverUrl =
    asString(albumLoose.picUrl) ??
    asString(albumLoose.pic) ??
    asString(albumLoose.coverImgUrl) ??
    asString(albumLoose.blurPicUrl) ??
    asString(song.picUrl) ??
    asString(song.coverImgUrl);

  return {
    id: String(song.id ?? ""),
    name: String(song.name ?? "未知歌曲"),
    artists,
    album:
      albumLoose.id || albumLoose.name
        ? {
            id: String(albumLoose.id ?? ""),
            name: String(albumLoose.name ?? "未知专辑"),
            coverUrl
          }
        : undefined,
    durationMs: asNumber(song.dt) ?? asNumber(song.duration) ?? 0,
    coverUrl
  };
}

export class NeteaseLikeAdapter implements MusicSourceAdapter {
  private readonly config: AdapterConfig;

  constructor(config: Partial<AdapterConfig> & Pick<AdapterConfig, "baseUrl" | "timeoutMs" | "retries">) {
    this.config = {
      baseUrl: trimEndSlash(config.baseUrl),
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      playLevel: config.playLevel ?? "standard",
      downloadLevel: config.downloadLevel ?? "exhigh",
      vipPreviewMaxMs: config.vipPreviewMaxMs ?? 60000,
      lyricPreferNew: config.lyricPreferNew ?? true,
      enableDiscover: config.enableDiscover ?? true,
      enableScene: config.enableScene ?? true,
      pathPlayUrlUnblock: config.pathPlayUrlUnblock,
      unblockSource: config.unblockSource,
      unblockSources: config.unblockSources ?? [],
      pathSearch: config.pathSearch ?? "/search",
      pathTrackDetail: config.pathTrackDetail ?? "/song/detail",
      pathPlayUrl: config.pathPlayUrl ?? "/song/url/v1",
      pathLyric: config.pathLyric ?? "/lyric",
      pathLyricNew: config.pathLyricNew ?? "/lyric/new",
      pathPlaylist: config.pathPlaylist ?? "/playlist/detail",
      pathSearchHotDetail: config.pathSearchHotDetail ?? "/search/hot/detail",
      pathSearchDefault: config.pathSearchDefault ?? "/search/default",
      pathSearchSuggestPc: config.pathSearchSuggestPc ?? "/search/suggest/pc",
      pathBanner: config.pathBanner ?? "/banner",
      pathPersonalized: config.pathPersonalized ?? "/personalized",
      pathToplistDetail: config.pathToplistDetail ?? "/toplist/detail",
      pathTopPlaylistHighquality: config.pathTopPlaylistHighquality ?? "/top/playlist/highquality",
      pathToplist: config.pathToplist ?? "/toplist",
      pathAlbum: config.pathAlbum ?? "/album",
      pathAlbumDetail: config.pathAlbumDetail ?? "/album/detail",
      pathArtistDetail: config.pathArtistDetail ?? "/artist/detail",
      pathArtistTopSong: config.pathArtistTopSong ?? "/artist/top/song",
      pathCheckMusic: config.pathCheckMusic ?? "/check/music",
      pathSongCreators: config.pathSongCreators ?? "/song/creators",
      pathSongWikiSummary: config.pathSongWikiSummary ?? "/song/wiki/summary",
      pathSongChorus: config.pathSongChorus ?? "/song/chorus",
      pathSongCopyrightRcmd: config.pathSongCopyrightRcmd ?? "/song/copyright/rcmd",
      pathSongDownloadUrl: config.pathSongDownloadUrl ?? "/song/download/url/v1",
      pathSongMusicDetail: config.pathSongMusicDetail ?? "/song/music/detail",
      pathSatiTagList: config.pathSatiTagList ?? "/sati/tag/list",
      pathSatiResourceList: config.pathSatiResourceList ?? "/sati/resource/list",
      pathRadioSportGet: config.pathRadioSportGet ?? "/radio/sport/get"
    };
  }

  private async request<T>(path: string, query: Record<string, string | number | boolean>) {
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

  private async requestSafe<T>(path: string, query: Record<string, string | number | boolean>): Promise<T | null> {
    try {
      return await this.request<T>(path, query);
    } catch {
      return null;
    }
  }

  private extractPlayData(raw: unknown): PlayData | null {
    const payload = asObject(raw);
    const pickFromCandidate = (value: unknown): PlayData | null => {
      if (typeof value === "string" && value.trim()) {
        return { url: value.trim() };
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) {
            return { url: item.trim() };
          }
          const entry = asObject(item) as PlayData;
          if (Object.keys(entry).length) {
            return entry;
          }
        }
        return null;
      }
      if (value && typeof value === "object") {
        return value as PlayData;
      }
      return null;
    };

    const topData = pickFromCandidate(payload.data);
    if (topData) return topData;

    const nestedResultData = pickFromCandidate(asObject(payload.result).data);
    if (nestedResultData) return nestedResultData;

    if (typeof payload.url === "string") {
      return {
        url: payload.url,
        br: asNumber(payload.br),
        time: asNumber(payload.time),
        expi: asNumber(payload.expi)
      };
    }
    return null;
  }

  private isVipPreview(data: PlayData): boolean {
    return Boolean(data.time && data.time > 0 && data.time <= this.config.vipPreviewMaxMs);
  }

  private hasPlayableUrl(data: PlayData | null | undefined): data is PlayData & { url: string } {
    return Boolean(asString(data?.url));
  }

  private hasTopLevelRestrictionSignal(raw: unknown): boolean {
    const payload = asObject(raw);
    const topLevelCode = asNumber(payload.code);
    if (typeof topLevelCode === "number" && topLevelCode !== 200) {
      return true;
    }
    const topLevelMessage = (asString(payload.message) ?? asString(payload.msg) ?? "").toLowerCase();
    return Boolean(topLevelMessage && /(trial|preview|vip|copyright|无版权|试听|付费)/i.test(topLevelMessage));
  }

  private hasTrialRestrictionSignal(data: PlayData | null | undefined): boolean {
    if (!data) return false;
    if (typeof data.code === "number" && data.code !== 200) return true;

    const freeTrialInfo = asObject(data.freeTrialInfo);
    if (Object.keys(freeTrialInfo).length) return true;

    const freeTrialPrivilege = asObject(data.freeTrialPrivilege);
    if (
      freeTrialPrivilege.resConsumable === true ||
      freeTrialPrivilege.userConsumable === true ||
      freeTrialPrivilege.cannotListenReason != null ||
      freeTrialPrivilege.playReason != null
    ) {
      return true;
    }

    const freeTimeTrialPrivilege = asObject(data.freeTimeTrialPrivilege);
    const remainTime = asNumber(freeTimeTrialPrivilege.remainTime) ?? 0;
    const trialType = asNumber(freeTimeTrialPrivilege.type) ?? 0;
    if (remainTime > 0 || trialType > 0) {
      return true;
    }

    const restrictionMessage = (asString(data.message) ?? asString(data.msg) ?? "").toLowerCase();
    return Boolean(restrictionMessage && /(trial|preview|vip|copyright|无版权|试听|付费)/i.test(restrictionMessage));
  }

  private isRestrictedPlaySource(raw: unknown, data: PlayData | null): boolean {
    if (!this.hasPlayableUrl(data)) return true;
    if (this.isVipPreview(data)) return true;
    if (this.hasTrialRestrictionSignal(data)) return true;
    return this.hasTopLevelRestrictionSignal(raw);
  }

  private getPlaySourceRank(raw: unknown, data: PlayData | null): number {
    if (!this.hasPlayableUrl(data)) return 0;

    let rank = 1;
    if (!this.isVipPreview(data)) rank += 2;
    if (!this.hasTrialRestrictionSignal(data)) rank += 1;
    if (!this.hasTopLevelRestrictionSignal(raw)) rank += 1;
    return rank;
  }

  private pickBetterPlayCandidate(
    current: PlayCandidate | null,
    candidate: PlayCandidate | null
  ): PlayCandidate | null {
    if (!candidate) return current;
    if (!current) return candidate;

    const currentRank = this.getPlaySourceRank(current.raw, current.data);
    const candidateRank = this.getPlaySourceRank(candidate.raw, candidate.data);
    return candidateRank > currentRank ? candidate : current;
  }

  private shouldAttemptUnblock(raw: unknown, data: PlayData | null): boolean {
    return this.isRestrictedPlaySource(raw, data);
  }

  private resolvePlayLevel(options?: PlaySourceRequestOptions): string {
    return options?.level ?? this.config.playLevel;
  }

  private resolvePlayUnblockMode(options?: PlaySourceRequestOptions): PlayUnblockMode {
    return options?.unblockMode ?? "auto";
  }

  private shouldRetryPrimaryWithForcedUnblock(unblockMode: PlayUnblockMode, raw: unknown, data: PlayData | null): boolean {
    if (unblockMode === "force_off" || unblockMode === "force_on") {
      return false;
    }
    return this.shouldAttemptUnblock(raw, data);
  }

  private buildPrimaryPlayQuery(trackId: string, level: string, unblockMode: PlayUnblockMode): Record<string, string | number | boolean> {
    if (unblockMode === "force_on") {
      return {
        id: trackId,
        level,
        unblock: true
      };
    }
    if (unblockMode === "force_off") {
      return {
        id: trackId,
        level,
        unblock: false
      };
    }
    return {
      id: trackId,
      level
    };
  }

  private debugUnblockTrace(trackId: string, stage: string, extra?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== "development") return;
    const details = extra ? ` ${JSON.stringify(extra)}` : "";
    console.info(`[music-unblock] track=${trackId} stage=${stage}${details}`);
  }

  private getRestrictionReason(raw: unknown, data: PlayData | null | undefined): string | undefined {
    if (!data || !this.hasPlayableUrl(data)) return "missing_url";
    if (this.isVipPreview(data)) return "vip_preview";
    if (this.hasTrialRestrictionSignal(data)) return "trial_restriction";
    if (this.hasTopLevelRestrictionSignal(raw)) return "upstream_restriction";
    return undefined;
  }

  private toPlaySource(trackId: string, raw: unknown, data: PlayData, resolvedVia: "primary" | "unblock"): PlaySource {
    const preview = this.isVipPreview(data);
    return {
      trackId,
      url: data.url ?? "",
      preview,
      level: toPlayQualityLevel(data.level),
      bitrate: data.br,
      restrictionReason: this.getRestrictionReason(raw, data),
      resolvedVia,
      ttlSeconds: data.expi ? Math.max(10, Math.floor(data.expi)) : undefined,
      expiresAt: data.expiresAt
    };
  }

  private async getTrackDurationMs(trackId: string): Promise<number | undefined> {
    const raw = await this.requestSafe<{ songs?: NeteaseSong[] }>(this.config.pathTrackDetail, { ids: trackId });
    return raw?.songs?.[0]?.dt ?? raw?.songs?.[0]?.duration;
  }

  private async probeAudioUrl(url: string): Promise<AudioUrlProbe | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) return null;
      return {
        ok: true,
        contentLength: asNumber(response.headers.get("content-length")),
        contentType: asString(response.headers.get("content-type"))
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private getMinimumExpectedContentLength(durationMs: number, bitrate?: number): number {
    const seconds = Math.max(1, Math.floor(durationMs / 1000));
    const bitrateFloor = bitrate && bitrate > 0
      ? Math.max(48000, Math.floor(bitrate * 0.4))
      : 48000;
    return Math.floor((seconds * bitrateFloor) / 8);
  }

  private isProbeConsistentWithTrackLength(
    probe: AudioUrlProbe,
    trackDurationMs: number | undefined,
    data: PlayData
  ): boolean {
    if (!probe.ok) return false;
    if (!probe.contentType || !probe.contentType.toLowerCase().startsWith("audio/")) {
      return false;
    }

    const expectedDurationMs = trackDurationMs ?? (data.time && data.time > this.config.vipPreviewMaxMs ? data.time : undefined);
    if (!expectedDurationMs || expectedDurationMs <= this.config.vipPreviewMaxMs) {
      return true;
    }

    if (!probe.contentLength) return false;
    return probe.contentLength >= this.getMinimumExpectedContentLength(expectedDurationMs, data.br);
  }

  private async verifyCandidateUrl(
    trackId: string,
    label: string,
    trackDurationMs: number | undefined,
    data: PlayData
  ): Promise<boolean> {
    const url = asString(data.url);
    if (!url) return false;

    const probe = await this.probeAudioUrl(url);
    const valid = this.isProbeConsistentWithTrackLength(probe ?? { ok: false }, trackDurationMs, data);
    this.debugUnblockTrace(trackId, `${label}-probe`, {
      valid,
      contentLength: probe?.contentLength,
      contentType: probe?.contentType,
      trackDurationMs
    });
    return valid;
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

  async searchArtists(input: ArtistSearchInput): Promise<PagedResult<ArtistSearchItem>> {
    const offset = (input.page - 1) * input.pageSize;
    const raw = await this.request<{
      result?: { artists?: Array<{ id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; musicSize?: number; albumSize?: number }>; artistCount?: number };
    }>(this.config.pathSearch, {
      keywords: input.keyword,
      type: 100,
      limit: input.pageSize,
      offset
    });
    const artists = raw.result?.artists ?? [];
    return {
      items: artists.map((artist) => ({
        id: String(artist.id ?? ""),
        name: artist.name ?? "未知歌手",
        coverUrl: artist.picUrl ?? artist.img1v1Url,
        musicSize: asNumber(artist.musicSize),
        albumSize: asNumber(artist.albumSize)
      })),
      page: input.page,
      pageSize: input.pageSize,
      total: raw.result?.artistCount ?? artists.length
    };
  }

  async searchPlaylists(input: TrackSearchInput): Promise<PagedResult<Playlist>> {
    const offset = (input.page - 1) * input.pageSize;
    const raw = await this.request<{
      result?: {
        playlists?: Array<{ id?: number | string; name?: string; coverImgUrl?: string; picUrl?: string; description?: string }>;
        playlistCount?: number;
      };
    }>(this.config.pathSearch, {
      keywords: input.keyword,
      type: 1000,
      limit: input.pageSize,
      offset
    });
    const playlists = raw.result?.playlists ?? [];
    return {
      items: playlists.map((playlist) => ({
        id: String(playlist.id ?? ""),
        name: playlist.name ?? "未知歌单",
        coverUrl: playlist.coverImgUrl ?? playlist.picUrl,
        description: asString(playlist.description),
        tracks: []
      })),
      page: input.page,
      pageSize: input.pageSize,
      total: raw.result?.playlistCount ?? playlists.length
    };
  }

  async getTrackDetail(trackId: string): Promise<Track> {
    const raw = await this.request<{ songs?: NeteaseSong[] }>(this.config.pathTrackDetail, { ids: trackId });
    const song = raw.songs?.[0];
    if (!song) {
      throw new AppError("Track not found", { code: 3001, status: 404, retryable: false });
    }
    return toTrack(song);
  }

  async getTrackQualityAvailability(trackId: string): Promise<TrackQualityAvailability> {
    const [detailRaw, qualityRaw] = await Promise.all([
      this.request<{ songs?: NeteaseSong[] }>(this.config.pathTrackDetail, { ids: trackId }),
      this.request<{ data?: NeteaseSongQualityDetail }>(this.config.pathSongMusicDetail, { id: trackId })
    ]);

    const detailSong = detailRaw.songs?.[0];
    const qualityDetail = qualityRaw.data;

    if (!detailSong && !qualityDetail) {
      throw new AppError("Track not found", { code: 3001, status: 404, retryable: false });
    }

    const availableLevels = sortPlayQualityLevels(
      PLAY_QUALITY_LEVELS.filter((level) => {
        if (level === "standard") return hasQualityPayload(detailSong?.l) || hasQualityPayload(qualityDetail?.l);
        if (level === "higher") return hasQualityPayload(detailSong?.m) || hasQualityPayload(qualityDetail?.m);
        if (level === "exhigh") return hasQualityPayload(detailSong?.h) || hasQualityPayload(qualityDetail?.h);
        if (level === "lossless") return hasQualityPayload(detailSong?.sq) || hasQualityPayload(qualityDetail?.sq);
        if (level === "hires") return hasQualityPayload(detailSong?.hr) || hasQualityPayload(qualityDetail?.hr);
        if (level === "jyeffect") return hasQualityPayload(qualityDetail?.je);
        if (level === "sky") return hasQualityPayload(qualityDetail?.sk) || Boolean(qualityDetail?.sks?.length);
        if (level === "dolby") return hasQualityPayload(qualityDetail?.db);
        if (level === "jymaster") return hasQualityPayload(qualityDetail?.jm);
        return false;
      })
    );

    const fallbackMap: TrackQualityAvailability["fallbackMap"] = {};
    for (const level of PLAY_QUALITY_LEVELS) {
      const fallback = resolvePlayableQualityFallback(level, availableLevels);
      if (fallback) {
        fallbackMap[level] = fallback;
      }
    }

    return {
      trackId,
      availableLevels,
      fallbackMap
    };
  }

  async getPlaySource(trackId: string, options?: PlaySourceRequestOptions): Promise<PlaySource> {
    const level = this.resolvePlayLevel(options);
    const unblockMode = this.resolvePlayUnblockMode(options);
    let trackDurationMsPromise: Promise<number | undefined> | null = null;
    const ensureTrackDurationMs = () => {
      trackDurationMsPromise ??= this.getTrackDurationMs(trackId);
      return trackDurationMsPromise;
    };
    const raw = await this.request<AnyRecord>(this.config.pathPlayUrl, this.buildPrimaryPlayQuery(trackId, level, unblockMode));
    const data = this.extractPlayData(raw);
    const primaryRestricted = this.isRestrictedPlaySource(raw, data);
    const unblockPath = this.config.pathPlayUrlUnblock;
    const shouldTryUnblock = unblockMode === "force_off" ? false : this.shouldAttemptUnblock(raw, data);
    this.debugUnblockTrace(trackId, "v1", {
      level,
      unblockMode,
      hasUrl: this.hasPlayableUrl(data),
      preview: Boolean(data && this.isVipPreview(data)),
      restricted: primaryRestricted,
      shouldTryUnblock
    });

    let bestCandidate: PlayCandidate | null = this.hasPlayableUrl(data)
      ? { raw, data, resolvedVia: "primary" }
      : null;

    if (this.shouldRetryPrimaryWithForcedUnblock(unblockMode, raw, data)) {
      const forcedPrimaryRaw = await this.requestSafe<AnyRecord>(
        this.config.pathPlayUrl,
        this.buildPrimaryPlayQuery(trackId, level, "force_on")
      );
      if (forcedPrimaryRaw) {
        const forcedPrimaryData = this.extractPlayData(forcedPrimaryRaw);
        const forcedPrimaryRestricted = this.isRestrictedPlaySource(forcedPrimaryRaw, forcedPrimaryData);
        this.debugUnblockTrace(trackId, "v1-force-on", {
          level,
          hasUrl: this.hasPlayableUrl(forcedPrimaryData),
          preview: Boolean(forcedPrimaryData && this.isVipPreview(forcedPrimaryData)),
          restricted: forcedPrimaryRestricted
        });
        if (this.hasPlayableUrl(forcedPrimaryData)) {
          bestCandidate = this.pickBetterPlayCandidate(bestCandidate, {
            raw: forcedPrimaryRaw,
            data: forcedPrimaryData,
            resolvedVia: "primary"
          });
          if (
            !forcedPrimaryRestricted &&
            (await this.verifyCandidateUrl(trackId, "v1-force-on", await ensureTrackDurationMs(), forcedPrimaryData))
          ) {
            return this.toPlaySource(trackId, forcedPrimaryRaw, forcedPrimaryData, "primary");
          }
        }
      } else {
        this.debugUnblockTrace(trackId, "v1-force-on-error");
      }
    }

    if (!unblockPath || !shouldTryUnblock) {
      if (bestCandidate) {
        if (
          !this.isRestrictedPlaySource(bestCandidate.raw, bestCandidate.data) &&
          (await this.verifyCandidateUrl(trackId, "primary", await ensureTrackDurationMs(), bestCandidate.data))
        ) {
          return this.toPlaySource(trackId, bestCandidate.raw, bestCandidate.data, bestCandidate.resolvedVia);
        }
        return this.toPlaySource(trackId, bestCandidate.raw, bestCandidate.data, bestCandidate.resolvedVia);
      }
      throw new AppError("Play source unavailable", { code: 3002, status: 404, retryable: true });
    }

    const fallbackSources = this.config.unblockSources?.length
      ? this.config.unblockSources
      : this.config.unblockSource
        ? [this.config.unblockSource]
        : [];
    const sourceCandidates = ["", ...fallbackSources];

    for (const source of sourceCandidates) {
      try {
        const unblockRaw = await this.requestSafe<AnyRecord>(unblockPath, {
          id: trackId,
          level,
          ...(source ? { source } : {})
        });
        if (!unblockRaw) {
          this.debugUnblockTrace(trackId, source ? "match-source-empty-response" : "match-no-source-empty-response", { source });
          continue;
        }
        const unblockData = this.extractPlayData(unblockRaw);
        if (!this.hasPlayableUrl(unblockData)) {
          this.debugUnblockTrace(trackId, source ? "match-source-no-url" : "match-no-source-no-url", { source });
          continue;
        }
        const unblockRestricted = this.isRestrictedPlaySource(unblockRaw, unblockData);
        this.debugUnblockTrace(trackId, source ? "match-source-hit" : "match-no-source-hit", {
          source: source || "none",
          preview: this.isVipPreview(unblockData),
          restricted: unblockRestricted
        });
        bestCandidate = this.pickBetterPlayCandidate(bestCandidate, {
          raw: unblockRaw,
          data: unblockData,
          resolvedVia: "unblock"
        });
        if (
          !unblockRestricted &&
          (await this.verifyCandidateUrl(
            trackId,
            source ? `match-${source}` : "match-default",
            await ensureTrackDurationMs(),
            unblockData
          ))
        ) {
          return this.toPlaySource(trackId, unblockRaw, unblockData, "unblock");
        }
      } catch {
        // 当前解灰 source 不可用时自动尝试下一个 source。
        this.debugUnblockTrace(trackId, source ? "match-source-error" : "match-no-source-error", { source });
      }
    }

    if (bestCandidate) {
      if (
        !this.isRestrictedPlaySource(bestCandidate.raw, bestCandidate.data) &&
        (await this.verifyCandidateUrl(trackId, "best-candidate", await ensureTrackDurationMs(), bestCandidate.data))
      ) {
        return this.toPlaySource(trackId, bestCandidate.raw, bestCandidate.data, bestCandidate.resolvedVia);
      }
      return this.toPlaySource(trackId, bestCandidate.raw, bestCandidate.data, bestCandidate.resolvedVia);
    }

    throw new AppError("Play source unavailable", { code: 3002, status: 404, retryable: true });
  }

  async getTrackLyric(trackId: string): Promise<TrackLyric> {
    const primaryPath = this.config.lyricPreferNew ? this.config.pathLyricNew : this.config.pathLyric;
    const fallbackPath = this.config.lyricPreferNew ? this.config.pathLyric : this.config.pathLyricNew;
    let raw = await this.requestSafe<AnyRecord>(primaryPath, { id: trackId });
    if (!raw) {
      raw = await this.requestSafe<AnyRecord>(fallbackPath, { id: trackId });
    }

    const lrc = asObject(raw?.lrc);
    const tlyric = asObject(raw?.tlyric);
    const klyric = asObject(raw?.romalrc);
    const base = asString(lrc.lyric) ?? "";
    const translated = asString(tlyric.lyric) ?? "";
    const karaoke = asString(klyric.lyric) ?? "";

    return {
      trackId,
      raw: base,
      lines: parseLyric(base),
      translatedRaw: translated || undefined,
      translatedLines: translated ? parseLyric(translated) : undefined,
      karaokeRaw: karaoke || undefined,
      karaokeLines: karaoke ? parseLyric(karaoke) : undefined
    };
  }

  async getPlaylist(playlistId: string): Promise<Playlist> {
    const raw = await this.request<{ playlist?: AnyRecord }>(this.config.pathPlaylist, { id: playlistId });
    const playlist = raw.playlist;
    if (!playlist) {
      throw new AppError("Playlist not found", { code: 3003, status: 404, retryable: false });
    }

    const tracks = asArray<NeteaseSong>(playlist.tracks).map(toTrack);
    return {
      id: String(playlist.id ?? playlistId),
      name: String(playlist.name ?? "未知歌单"),
      description: asString(playlist.description),
      coverUrl: asString(playlist.coverImgUrl),
      tracks
    };
  }

  async getSearchAssist(keyword: string): Promise<SearchAssist> {
    const [defaultRaw, hotRaw, suggestRaw] = await Promise.all([
      this.requestSafe<AnyRecord>(this.config.pathSearchDefault, {}),
      this.requestSafe<AnyRecord>(this.config.pathSearchHotDetail, {}),
      keyword.trim()
        ? this.requestSafe<AnyRecord>(this.config.pathSearchSuggestPc, { keyword: keyword.trim() })
        : Promise.resolve(null)
    ]);

    const defaultKeyword =
      asString(asObject(defaultRaw?.data).realkeyword) ??
      asString(asObject(defaultRaw?.data).showKeyword) ??
      asString(asObject(asObject(defaultRaw?.data).styleKeyword).keyWord);

    const hotKeywords = asArray<AnyRecord>(hotRaw?.data)
      .map((item) => asString(item.searchWord))
      .filter((item): item is string => Boolean(item))
      .slice(0, 12);

    const suggestKeywords = (() => {
      const suggestData = asObject(suggestRaw?.data);
      const fromSuggests = asArray<AnyRecord>(suggestData.suggests)
        .map((item) => asString(item.keyword) ?? asString(item.text))
        .filter((item): item is string => Boolean(item));
      const fromRecs = asArray<AnyRecord>(suggestData.recs)
        .map((item) => asString(item.keyword) ?? asString(item.text))
        .filter((item): item is string => Boolean(item));
      const merged = [...fromSuggests, ...fromRecs];
      return Array.from(new Set(merged)).slice(0, 10);
    })();

    return {
      defaultKeyword,
      hotKeywords,
      suggestions: suggestKeywords
    };
  }

  async getDiscoverData(): Promise<DiscoverData> {
    if (!this.config.enableDiscover) {
      return { blocks: [], searchAssist: { defaultKeyword: undefined, hotKeywords: [], suggestions: [] } };
    }

    const [assist, bannerRaw, personalizedRaw, toplistRaw, highQualityRaw] = await Promise.all([
      this.getSearchAssist(""),
      this.requestSafe<AnyRecord>(this.config.pathBanner, {}),
      this.requestSafe<AnyRecord>(this.config.pathPersonalized, { limit: 8 }),
      this.requestSafe<AnyRecord>(this.config.pathToplistDetail, {}),
      this.requestSafe<AnyRecord>(this.config.pathTopPlaylistHighquality, { limit: 8 })
    ]);

    const blocks: DiscoverBlock[] = [];

    const banners = asArray<AnyRecord>(bannerRaw?.banners)
      .map((item, index) => {
        const targetType = asNumber(item.targetType);
        const mappedType = mapBannerTargetTypeToDiscoverType(targetType);
        const targetId = asIdString(item.targetId) ?? asIdString(item.encodeId);
        const linkUrl = asString(item.url);
        return {
          id: String(item.targetId ?? item.encodeId ?? `banner-${index}`),
          title: asString(item.typeTitle) ?? "推荐内容",
          subtitle: asString(item.copywriter) ?? asString(item.typeTitle) ?? "精选内容推荐",
          coverUrl: asString(item.imageUrl) ?? asString(item.pic),
          type: mappedType,
          targetId,
          linkUrl: mappedType === "banner" ? linkUrl : undefined
        };
      })
      .slice(0, 8);
    if (banners.length) {
      blocks.push({ id: "discover-banner", title: "推荐内容", items: banners });
    }

    const personalized = asArray<AnyRecord>(personalizedRaw?.result)
      .map((item) => ({
        id: String(item.id ?? ""),
        title: asString(item.name) ?? "推荐歌单",
        subtitle: asString(item.copywriter),
        coverUrl: asString(item.picUrl),
        type: "playlist" as const,
        targetId: String(item.id ?? "")
      }))
      .slice(0, 12);
    if (personalized.length) {
      blocks.push({ id: "discover-personalized", title: "推荐歌单", items: personalized });
    }

    const topListEntries = asArray<AnyRecord>(toplistRaw?.list)
      .map((item) => ({
        id: String(item.id ?? ""),
        title: asString(item.name) ?? "榜单",
        subtitle: asString(item.updateFrequency) ?? asString(item.description),
        coverUrl: asString(item.coverImgUrl),
        type: "toplist" as const,
        targetId: String(item.id ?? "")
      }))
      .slice(0, 10);
    if (topListEntries.length) {
      blocks.push({ id: "discover-toplist", title: "热门榜单", items: topListEntries });
    }

    const highQualityEntries = asArray<AnyRecord>(highQualityRaw?.playlists)
      .map((item) => ({
        id: String(item.id ?? ""),
        title: asString(item.name) ?? "精品歌单",
        subtitle: asString(item.description),
        coverUrl: asString(item.coverImgUrl),
        type: "playlist" as const,
        targetId: String(item.id ?? "")
      }))
      .slice(0, 12);
    if (highQualityEntries.length) {
      blocks.push({ id: "discover-highquality", title: "精品歌单", items: highQualityEntries });
    }

    return {
      blocks,
      searchAssist: assist
    };
  }

  async getToplist(): Promise<ToplistItem[]> {
    const raw = await this.request<AnyRecord>(this.config.pathToplist, {});
    const items = asArray<AnyRecord>(raw.list);
    return items.map((item) => {
      const previewTracks = asArray<AnyRecord>(item.tracks).slice(0, 3).map((track, index) => ({
        id: String(track.id ?? `${item.id}-preview-${index}`),
        name: asString(track.first) ?? asString(track.name) ?? "未知歌曲",
        artists: [
          {
            id: "",
            name: asString(track.second) ?? "未知歌手"
          }
        ],
        durationMs: asNumber(track.dt) ?? 0
      }));
      return {
        id: String(item.id ?? ""),
        name: asString(item.name) ?? "未知榜单",
        description: asString(item.description),
        coverUrl: asString(item.coverImgUrl),
        updateFrequency: asString(item.updateFrequency),
        tracksPreview: previewTracks
      };
    });
  }

  async getAlbumDetail(albumId: string): Promise<AlbumDetail> {
    const raw = await this.request<AnyRecord>(this.config.pathAlbum, { id: albumId });
    const albumRaw = asObject(raw.album);
    const songs = asArray<NeteaseSong>(raw.songs);
    const artists = asArray<NeteaseArtist>(albumRaw.artists).map((artist) => ({
      id: String(artist.id),
      name: artist.name,
      coverUrl: artist.img1v1Url ?? artist.picUrl
    }));

    return {
      id: String(albumRaw.id ?? albumId),
      name: String(albumRaw.name ?? "未知专辑"),
      description: asString(albumRaw.description),
      coverUrl: asString(albumRaw.picUrl) ?? asString(albumRaw.blurPicUrl),
      publishTime: asNumber(albumRaw.publishTime),
      artists,
      tracks: songs.map(toTrack)
    };
  }

  async getArtistDetail(artistId: string): Promise<ArtistDetail> {
    const [detailRaw, topSongRaw] = await Promise.all([
      this.requestSafe<AnyRecord>(this.config.pathArtistDetail, { id: artistId }),
      this.requestSafe<AnyRecord>(this.config.pathArtistTopSong, { id: artistId })
    ]);

    const artistRoot = asObject(detailRaw?.data);
    const artist = asObject(artistRoot.artist);
    const topSongs = asArray<NeteaseSong>(topSongRaw?.songs);

    return {
      id: String(artist.id ?? artistId),
      name: asString(artist.name) ?? "未知歌手",
      coverUrl: asString(artist.cover) ?? asString(artist.avatar) ?? asString(artist.picUrl),
      briefDesc: asString(artist.briefDesc),
      topTracks: topSongs.map(toTrack)
    };
  }

  async getTrackInsight(trackId: string): Promise<SongInsight> {
    const [playableRaw, creatorsRaw, wikiRaw, chorusRaw, alternativesRaw] = await Promise.all([
      this.requestSafe<AnyRecord>(this.config.pathCheckMusic, { id: trackId }),
      this.requestSafe<AnyRecord>(this.config.pathSongCreators, { id: trackId }),
      this.requestSafe<AnyRecord>(this.config.pathSongWikiSummary, { id: trackId }),
      this.requestSafe<AnyRecord>(this.config.pathSongChorus, { id: trackId }),
      this.requestSafe<AnyRecord>(this.config.pathSongCopyrightRcmd, { songid: trackId })
    ]);

    const creatorRoles = asArray<AnyRecord>(asObject(creatorsRaw?.data).songCreatorsRoleVos);
    const creators: SongCreator[] = [];
    creatorRoles.forEach((roleItem) => {
      const roleName = asString(roleItem.roleName);
      asArray<AnyRecord>(roleItem.creatorMetaVOS).forEach((creator) => {
        const name = asString(creator.artistName);
        if (name) creators.push({ name, role: roleName });
      });
    });

    const chorusCandidates = asArray<AnyRecord>(chorusRaw?.chorus).concat(asArray<AnyRecord>(chorusRaw?.data));
    const chorusStartMs = asNumber(chorusCandidates[0]?.startTime);
    const wikiBlocks = asArray<AnyRecord>(asObject(wikiRaw?.data).blocks);
    const wikiSummary = wikiBlocks
      .flatMap((block) => asArray<AnyRecord>(block.creatives))
      .flatMap((creative) => asArray<AnyRecord>(creative.resources))
      .map((resource) => asString(asObject(resource.uiElement).mainTitle ? asObject(asObject(resource.uiElement).mainTitle).title : undefined))
      .find((text) => Boolean(text));

    const alternativesRoot = asObject(alternativesRaw?.data);
    const altSong = alternativesRoot.originSong ? [alternativesRoot.originSong] : [];
    const alternatives = altSong.map(toTrackFromLoose);

    return {
      trackId,
      playable: playableRaw ? Boolean(playableRaw.success) : undefined,
      creators,
      wikiSummary,
      chorusStartMs,
      alternatives
    };
  }

  async getDownloadSource(trackId: string, level?: string): Promise<DownloadSource> {
    const targetLevel = level ?? this.config.downloadLevel;
    const raw = await this.request<AnyRecord>(this.config.pathSongDownloadUrl, {
      id: trackId,
      level: targetLevel
    });
    const data = asObject(raw.data);
    const url = asString(data.url);
    if (!url) {
      throw new AppError("Download source unavailable", { code: 3011, status: 404, retryable: true });
    }

    return {
      trackId,
      level: asString(data.level) ?? targetLevel,
      url,
      bitrate: asNumber(data.br),
      size: asNumber(data.size),
      format: asString(data.type),
      ttlSeconds: asNumber(data.expi)
    };
  }

  async getSatiScene(tag?: string): Promise<SceneData> {
    if (!this.config.enableScene) {
      return { tags: [], resources: [] };
    }

    const tagRaw = await this.requestSafe<AnyRecord>(this.config.pathSatiTagList, {});
    const tags = asArray<AnyRecord>(tagRaw?.data).map((item) => ({
      id: String(item.tag ?? item.id ?? ""),
      name: asString(item.tagDesc) ?? asString(item.text) ?? asString(item.tag) ?? "未知标签"
    }));

    const selectedTag = tag ?? tags[0]?.id ?? "RCMD";
    const resourcesRaw = await this.requestSafe<AnyRecord>(this.config.pathSatiResourceList, { tag: selectedTag });
    const resources = asArray<AnyRecord>(resourcesRaw?.data).map(
      (item): SceneResource => ({
        id: String(item.id ?? item.trackId ?? ""),
        title: asString(item.name) ?? "未知声音",
        subtitle: asString(item.category),
        coverUrl: asString(item.pic),
        trackId: item.trackId ? String(item.trackId) : undefined,
        tag: asString(item.category)
      })
    );

    return { tags, resources };
  }

  async getSportScene(bpm: number): Promise<SceneData> {
    if (!this.config.enableScene) {
      return { tags: [], resources: [] };
    }

    const raw = await this.requestSafe<AnyRecord>(this.config.pathRadioSportGet, { bpm: Math.max(30, bpm) });
    const tracks = asArray<AnyRecord>(raw?.data);
    const resources = tracks.map(
      (item): SceneResource => ({
        id: String(item.id ?? item.trackId ?? ""),
        title: asString(item.name) ?? "跑步漫游歌曲",
        subtitle: asArray<AnyRecord>(item.ar)
          .map((artist) => asString(artist.name))
          .filter((artist): artist is string => Boolean(artist))
          .join(" / "),
        coverUrl: asString(asObject(item.al).picUrl),
        trackId: item.id ? String(item.id) : undefined,
        bpm
      })
    );
    return {
      tags: [{ id: "sport", name: `跑步漫游 · ${bpm} BPM` }],
      resources
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

  const envEnabled = (key: string, fallback = false) => {
    const value = process.env[key];
    if (!value) return fallback;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  };

  const unblockSources = parseCsvList(process.env.MUSIC_SOURCE_UNBLOCK_SOURCES);
  const unblockSourceLegacy = process.env.MUSIC_SOURCE_UNBLOCK_SOURCE ?? "";
  const resolvedUnblockSources = unblockSources.length
    ? unblockSources
    : parseCsvList(unblockSourceLegacy).length
      ? parseCsvList(unblockSourceLegacy)
      : DEFAULT_UNBLOCK_SOURCES;

  return new NeteaseLikeAdapter({
    baseUrl,
    apiKey: apiKey || undefined,
    timeoutMs: Number(process.env.MUSIC_SOURCE_TIMEOUT_MS ?? "6000"),
    retries: Number(process.env.MUSIC_SOURCE_RETRY_TIMES ?? "2"),
    playLevel: process.env.MUSIC_SOURCE_PLAY_LEVEL ?? "standard",
    downloadLevel: process.env.MUSIC_SOURCE_DOWNLOAD_LEVEL ?? "exhigh",
    vipPreviewMaxMs: Number(process.env.MUSIC_SOURCE_VIP_PREVIEW_MAX_MS ?? "60000"),
    lyricPreferNew: envEnabled("MUSIC_SOURCE_LYRIC_PREFER_NEW", true),
    enableDiscover: envEnabled("MUSIC_SOURCE_ENABLE_DISCOVER", true),
    enableScene: envEnabled("MUSIC_SOURCE_ENABLE_SCENE", true),
    pathPlayUrlUnblock: process.env.MUSIC_SOURCE_PATH_PLAY_URL_UNBLOCK ?? "/song/url/match",
    unblockSource: unblockSourceLegacy,
    unblockSources: resolvedUnblockSources,
    pathSearch: process.env.MUSIC_SOURCE_PATH_SEARCH ?? "/search",
    pathTrackDetail: process.env.MUSIC_SOURCE_PATH_TRACK_DETAIL ?? "/song/detail",
    pathPlayUrl: process.env.MUSIC_SOURCE_PATH_PLAY_URL ?? "/song/url/v1",
    pathLyric: process.env.MUSIC_SOURCE_PATH_LYRIC ?? "/lyric",
    pathLyricNew: process.env.MUSIC_SOURCE_PATH_LYRIC_NEW ?? "/lyric/new",
    pathPlaylist: process.env.MUSIC_SOURCE_PATH_PLAYLIST ?? "/playlist/detail",
    pathSearchHotDetail: process.env.MUSIC_SOURCE_PATH_SEARCH_HOT_DETAIL ?? "/search/hot/detail",
    pathSearchDefault: process.env.MUSIC_SOURCE_PATH_SEARCH_DEFAULT ?? "/search/default",
    pathSearchSuggestPc: process.env.MUSIC_SOURCE_PATH_SEARCH_SUGGEST_PC ?? "/search/suggest/pc",
    pathBanner: process.env.MUSIC_SOURCE_PATH_BANNER ?? "/banner",
    pathPersonalized: process.env.MUSIC_SOURCE_PATH_PERSONALIZED ?? "/personalized",
    pathToplistDetail: process.env.MUSIC_SOURCE_PATH_TOPLIST_DETAIL ?? "/toplist/detail",
    pathTopPlaylistHighquality: process.env.MUSIC_SOURCE_PATH_TOP_PLAYLIST_HIGHQUALITY ?? "/top/playlist/highquality",
    pathToplist: process.env.MUSIC_SOURCE_PATH_TOPLIST ?? "/toplist",
    pathAlbum: process.env.MUSIC_SOURCE_PATH_ALBUM ?? "/album",
    pathAlbumDetail: process.env.MUSIC_SOURCE_PATH_ALBUM_DETAIL ?? "/album/detail",
    pathArtistDetail: process.env.MUSIC_SOURCE_PATH_ARTIST_DETAIL ?? "/artist/detail",
    pathArtistTopSong: process.env.MUSIC_SOURCE_PATH_ARTIST_TOP_SONG ?? "/artist/top/song",
    pathCheckMusic: process.env.MUSIC_SOURCE_PATH_CHECK_MUSIC ?? "/check/music",
    pathSongCreators: process.env.MUSIC_SOURCE_PATH_SONG_CREATORS ?? "/song/creators",
    pathSongWikiSummary: process.env.MUSIC_SOURCE_PATH_SONG_WIKI_SUMMARY ?? "/song/wiki/summary",
    pathSongChorus: process.env.MUSIC_SOURCE_PATH_SONG_CHORUS ?? "/song/chorus",
    pathSongCopyrightRcmd: process.env.MUSIC_SOURCE_PATH_SONG_COPYRIGHT_RCMD ?? "/song/copyright/rcmd",
    pathSongDownloadUrl: process.env.MUSIC_SOURCE_PATH_SONG_DOWNLOAD_URL ?? "/song/download/url/v1",
    pathSongMusicDetail: process.env.MUSIC_SOURCE_PATH_SONG_MUSIC_DETAIL ?? "/song/music/detail",
    pathSatiTagList: process.env.MUSIC_SOURCE_PATH_SATI_TAG_LIST ?? "/sati/tag/list",
    pathSatiResourceList: process.env.MUSIC_SOURCE_PATH_SATI_RESOURCE_LIST ?? "/sati/resource/list",
    pathRadioSportGet: process.env.MUSIC_SOURCE_PATH_RADIO_SPORT_GET ?? "/radio/sport/get"
  });
}
