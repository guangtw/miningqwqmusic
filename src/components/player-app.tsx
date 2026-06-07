"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AccountApiError,
  addFavoriteTrack,
  addRecentTrack,
  createListenRoom,
  deleteAccountAvatar,
  detectAccountServiceEnabled,
  getLibraryChanges,
  getLibrarySnapshot,
  getListenRoom,
  loadCurrentAccountUser,
  loginAccount,
  logoutAccount,
  heartbeatListenRoom,
  joinListenRoom,
  leaveListenRoom,
  openListenRoomStream,
  registerAccount,
  removeFavoriteTrack,
  removeImportedPlaylistCloud,
  sendListenRoomState,
  tryRefreshAccessTokenDetailed,
  uploadAccountAvatar,
  upsertImportedPlaylistCloud
} from "@/src/lib/account-client";
import {
  getAlbumDetail,
  getArtistDetail,
  getDiscoverHome,
  getPlaylistDetail,
  resolvePlaylistInput,
  getSatiScene,
  searchArtists,
  getSearchAssist,
  getSportScene,
  getTrackDetail,
  getTrackDownloadUrl,
  getTrackInsight,
  getToplistDetail,
  searchMusic
} from "@/src/lib/client-api";
import { computeHomeGridPlan } from "@/src/lib/home-grid";
import { extractPlaylistId } from "@/src/lib/playlist-import";
import { beginPaletteTransition, deriveDetailForegroundTone, finishPaletteTransition, type DetailForegroundTone } from "@/src/lib/detail-palette-transition";
import { resolveDiscoverAction } from "@/src/lib/discover-action";
import { locateCurrentLyricIndex } from "@/src/lib/lyrics";
import {
  canOpenPlayerDetail,
  countItemsWithinRows,
  heroActionLabel,
  nextVolumeAfterMuteToggle,
  shouldTogglePlaybackBySpace
} from "@/src/lib/player-ui";
import { nextTheme, readThemePreference, resolveInitialTheme, writeThemePreference } from "@/src/lib/theme-preference";
import { useAuthStore } from "@/src/store/auth-store";
import { useListenTogetherStore } from "@/src/store/listen-together-store";
import { getCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import { usePlayerController } from "@/src/hooks/use-player-controller";
import { UserAvatar } from "@/src/components/user-avatar";
import type { AuthStatus, ListenPlaybackState, SyncState } from "@/src/types/account";
import type {
  ArtistDetail,
  ArtistSearchItem,
  DiscoverData,
  DiscoverItem,
  ImportedPlaylist,
  PlaybackMode,
  PlayQualityLevel,
  PlayUnblockMode,
  Playlist,
  SceneData,
  SongInsight,
  Track
} from "@/src/types/music";

type NavTab = "home" | "search" | "library";
type SearchStatus = "idle" | "loading" | "success" | "empty" | "error";
type SearchMode = "track" | "artist";
type LibraryView = "library-favorites" | "library-recent" | "library-playlists";
type HomePlaylistView = "featured" | "more";
type DetailViewTab = "lyric" | "meta";
type DetailLyricMode = "origin" | "translated" | "karaoke";
type DetailModalPhase = "closed" | "opening" | "open" | "closing";
type DetailOpenInteraction = "pointer" | "keyboard";
type PlaylistPanelPhase = "closed" | "opening" | "open" | "closing";
type DetailPalette = {
  bgA: string;
  bgB: string;
  glow: string;
};
type AppTheme = "dark" | "light";
type HomePlaylistPanelState = {
  id: string;
  sourceType: "playlist" | "toplist" | "imported" | "queue";
  title: string;
  subtitle?: string;
  coverUrl?: string;
  tracks: Track[];
  loading: boolean;
  error: string | null;
};
type LibraryContentTransitionPhase = "idle" | "leaving" | "entering";
type HistoryGuardLayer = "detail" | "playlist" | "tab";
type HistoryGuardState = {
  __mqmGuard?: {
    layer: HistoryGuardLayer;
    tab: NavTab;
    at: number;
  };
};
type AuthFormMode = "login" | "register";

const DETAIL_ANIMATION_MS = 360;
const PLAYLIST_PANEL_ANIMATION_MS = 260;
const PALETTE_TRANSITION_MS = 960;
const LOCATED_PANEL_TRACK_HIGHLIGHT_MS = 1400;
const LIBRARY_CONTENT_LEAVE_MS = 140;
const LIBRARY_CONTENT_ENTER_MS = 220;
const ACCOUNT_SYNC_DEBOUNCE_MS = 180;
const ACCOUNT_PULL_POLLING_MS = 30_000;
const ACCOUNT_PULL_THROTTLE_MS = 1_800;
const ACCOUNT_PULL_RETRY_BLOCK_MS = 4_000;
const SEARCH_ASSIST_MAX_ITEMS = 20;
const SEARCH_ASSIST_MAX_ROWS = 2;
const HOME_GRID_GAP = 12;
const HOME_CHANNEL_MIN_CARD_WIDTH = 196;
const HOME_PLAYLIST_MIN_CARD_WIDTH = 152;
const HOME_EVENT_MIN_CARD_WIDTH = 152;
const THEME_DETAIL_FALLBACK_PALETTE: DetailPalette = {
  bgA: "rgb(26, 33, 42)",
  bgB: "rgb(11, 15, 22)",
  glow: "rgba(82, 108, 138, 0.24)"
};

const NEUTRAL_DETAIL_PALETTE: DetailPalette = {
  bgA: "rgb(31, 35, 45)",
  bgB: "rgb(14, 16, 22)",
  glow: "var(--detail-fallback-glow)"
};

const DARK_DETAIL_FOREGROUND = deriveDetailForegroundTone({ red: 28, green: 36, blue: 52 });

const DEFAULT_COVER_URL = "/assets/default-cover.svg";
const PLAY_QUALITY_OPTIONS: Array<{ value: PlayQualityLevel; label: string }> = [
  { value: "standard", label: "standard" },
  { value: "higher", label: "higher" },
  { value: "exhigh", label: "exhigh" },
  { value: "lossless", label: "lossless" },
  { value: "hires", label: "hires" },
  { value: "jyeffect", label: "jyeffect" },
  { value: "sky", label: "sky" },
  { value: "dolby", label: "dolby" },
  { value: "jymaster", label: "jymaster" }
];
const PLAY_UNBLOCK_MODE_OPTIONS: Array<{ value: PlayUnblockMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "force_on", label: "强制开启" },
  { value: "force_off", label: "强制关闭" }
];

function readHistoryGuardState(): HistoryGuardState["__mqmGuard"] | undefined {
  if (typeof window === "undefined") return undefined;
  const state = window.history.state as HistoryGuardState | null;
  return state?.__mqmGuard;
}

function pushHistoryGuardState(layer: HistoryGuardLayer, tab: NavTab): void {
  if (typeof window === "undefined") return;
  const currentGuard = readHistoryGuardState();
  if (currentGuard?.layer === layer && currentGuard.tab === tab) {
    return;
  }
  const currentState = (window.history.state ?? {}) as HistoryGuardState;
  const nextState: HistoryGuardState = {
    ...currentState,
    __mqmGuard: {
      layer,
      tab,
      at: Date.now()
    }
  };
  window.history.pushState(nextState, "");
}

function pickTrackCover(track?: Track | null): string | undefined {
  if (!track) return undefined;
  return track.coverUrl ?? track.album?.coverUrl;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minute = Math.floor(totalSeconds / 60);
  const second = totalSeconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function visibleSubtitle(text: string | undefined, fallback: string): string {
  if (!text) return fallback;
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function syncStateLabel(state: SyncState): string {
  if (state === "syncing") return "同步中";
  if (state === "failed") return "同步失败";
  if (state === "success") return "已同步";
  return "本地模式";
}

function authStatusLabel(status: AuthStatus): string {
  if (status === "authenticated") return "已登录";
  if (status === "authenticating") return "连接中";
  if (status === "error") return "连接异常";
  return "游客模式";
}

function resolveAuthRefreshIssue(
  error: AccountApiError | undefined,
  mode: "auto" | "manual"
): string {
  if (!error) {
    return mode === "auto" ? "暂时无法恢复登录状态，已切换到游客模式。" : "暂时无法连接登录服务，请稍后重试。";
  }

  if (error.status === 401 && error.code === 5203) {
    return mode === "auto" ? "登录状态已失效，已切换到游客模式。" : "登录状态已失效，请重新登录。";
  }

  if (error.status === 403 && error.code === 5207) {
    return "登录请求来源校验失败，请联系管理员检查域名配置。";
  }

  if (error.status === 429) {
    return "操作过于频繁，请稍后再试。";
  }

  if (error.code === 5403 || error.status >= 500) {
    return mode === "auto" ? "登录服务暂时不可用，已切换到游客模式。" : "登录服务暂时不可用，请稍后重试。";
  }

  return mode === "auto" ? "自动登录未完成，请手动登录。" : "账号连接失败，请稍后重试。";
}

function hasStrongPassword(value: string): boolean {
  return value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function resolveAuthFormError(error: unknown, mode: AuthFormMode): string {
  if (error instanceof AccountApiError) {
    if (error.status === 401 && error.code === 5202) {
      return "邮箱或密码不正确，请重新输入。";
    }
    if (error.status === 409 && error.code === 5201) {
      return "该邮箱已注册，请直接登录。";
    }
    if (error.status === 400 && error.code === 5101) {
      return mode === "register"
        ? "请检查注册信息：密码需至少 10 位，并包含大小写字母、数字和符号。"
        : "请检查输入信息后重试。";
    }
    if (error.status === 429) {
      return "尝试次数过多，请稍后再试。";
    }
    if (error.status === 403 && error.code === 5207) {
      return "当前访问环境异常，请稍后再试。";
    }
    if (error.status >= 500 || error.code === 5403) {
      return "服务暂时繁忙，请稍后再试。";
    }
  }

  return mode === "register" ? "注册暂时失败，请稍后重试。" : "登录暂时失败，请稍后重试。";
}

function resolveSyncNotice(error: unknown): string {
  if (error instanceof AccountApiError) {
    if (error.code === 5101 || (error.status === 400 && error.code === 5101)) {
      return "同步内容字段过多，请稍后重试或联系管理员提升同步字段上限。";
    }
    if (error.code === 5102 || error.status === 413) {
      return "同步内容过大，请稍后重试或联系管理员提升同步请求体上限。";
    }
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再同步。";
    }
    if (error.status === 429) {
      return "同步请求过于频繁，请稍后再试。";
    }
    if (error.status >= 500 || error.code === 5403) {
      return "云同步暂时不可用，请稍后重试。";
    }
  }
  return "云同步失败，请稍后重试。";
}

function sanitizeArtistForCloud(artist: unknown): { id: string; name: string; coverUrl?: string } | null {
  if (!artist || typeof artist !== "object") return null;
  const raw = artist as { id?: unknown; name?: unknown; coverUrl?: unknown };
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  const coverUrl = typeof raw.coverUrl === "string" ? raw.coverUrl.trim() : "";
  return coverUrl ? { id, name, coverUrl } : { id, name };
}

function sanitizeTrackForCloud(track: unknown): Track | null {
  if (!track || typeof track !== "object") return null;
  const raw = track as {
    id?: unknown;
    name?: unknown;
    artists?: unknown;
    album?: unknown;
    durationMs?: unknown;
    coverUrl?: unknown;
  };
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;

  const artists = Array.isArray(raw.artists)
    ? raw.artists
        .map((item) => sanitizeArtistForCloud(item))
        .filter((item): item is NonNullable<ReturnType<typeof sanitizeArtistForCloud>> => Boolean(item))
    : [];

  const durationNumber = typeof raw.durationMs === "number" ? raw.durationMs : Number(raw.durationMs);
  const durationMs = Number.isFinite(durationNumber) ? Math.max(0, Math.floor(durationNumber)) : 0;
  const coverUrl = typeof raw.coverUrl === "string" ? raw.coverUrl.trim() : "";

  let album: Track["album"];
  if (raw.album && typeof raw.album === "object") {
    const albumRaw = raw.album as { id?: unknown; name?: unknown; coverUrl?: unknown };
    const albumId = typeof albumRaw.id === "string" ? albumRaw.id.trim() : "";
    const albumName = typeof albumRaw.name === "string" ? albumRaw.name.trim() : "";
    if (albumId && albumName) {
      const albumCover = typeof albumRaw.coverUrl === "string" ? albumRaw.coverUrl.trim() : "";
      album = albumCover ? { id: albumId, name: albumName, coverUrl: albumCover } : { id: albumId, name: albumName };
    }
  }

  return {
    id,
    name,
    artists,
    durationMs,
    ...(album ? { album } : {}),
    ...(coverUrl ? { coverUrl } : {})
  };
}

function sanitizeImportedPlaylistForCloud(playlist: unknown): ImportedPlaylist | null {
  if (!playlist || typeof playlist !== "object") return null;
  const raw = playlist as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    coverUrl?: unknown;
    tracks?: unknown;
    sourceUrl?: unknown;
    importedAt?: unknown;
    updatedAt?: unknown;
  };
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const sourceUrl = typeof raw.sourceUrl === "string" ? raw.sourceUrl.trim() : "";
  if (!id || !name || !sourceUrl) return null;

  const description = typeof raw.description === "string" ? raw.description : undefined;
  const coverUrl = typeof raw.coverUrl === "string" ? raw.coverUrl.trim() : "";
  const importedAtNumber = typeof raw.importedAt === "number" ? raw.importedAt : Number(raw.importedAt);
  const updatedAtNumber = typeof raw.updatedAt === "number" ? raw.updatedAt : Number(raw.updatedAt);
  const now = Date.now();
  const importedAt = Number.isFinite(importedAtNumber) ? Math.max(0, Math.floor(importedAtNumber)) : now;
  const updatedAt = Number.isFinite(updatedAtNumber) ? Math.max(0, Math.floor(updatedAtNumber)) : now;
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.map((track) => sanitizeTrackForCloud(track)).filter((track): track is Track => Boolean(track))
    : [];

  return {
    id,
    name,
    ...(description !== undefined ? { description } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    tracks,
    sourceUrl,
    importedAt,
    updatedAt
  };
}

type LibrarySyncSnapshot = {
  favorites: Record<string, Track>;
  recent: Track[];
  importedPlaylists: Record<string, ImportedPlaylist>;
};

type LibrarySyncDelta = {
  favoriteAdded: Track[];
  favoriteRemoved: string[];
  shouldPushRecent: boolean;
  nextRecentHead: Track | null;
  importedChanged: ImportedPlaylist[];
  importedRemoved: string[];
};

function hasImportedPlaylistChanged(previous: ImportedPlaylist | undefined, next: ImportedPlaylist): boolean {
  if (!previous) return true;
  return (
    previous.updatedAt !== next.updatedAt ||
    previous.name !== next.name ||
    previous.description !== next.description ||
    previous.tracks.length !== next.tracks.length
  );
}

function computeLibrarySyncDelta(previous: LibrarySyncSnapshot, next: LibrarySyncSnapshot): LibrarySyncDelta {
  const favoriteAdded = Object.values(next.favorites).filter((item) => !previous.favorites[item.id]);
  const favoriteRemoved = Object.keys(previous.favorites).filter((trackId) => !next.favorites[trackId]);
  const previousRecentHead = previous.recent[0]?.id ?? null;
  const nextRecentHead = next.recent[0] ?? null;
  const shouldPushRecent = Boolean(nextRecentHead && nextRecentHead.id !== previousRecentHead);
  const importedChanged = Object.values(next.importedPlaylists).filter((playlist) =>
    hasImportedPlaylistChanged(previous.importedPlaylists[playlist.id], playlist)
  );
  const importedRemoved = Object.keys(previous.importedPlaylists).filter((playlistId) => !next.importedPlaylists[playlistId]);
  return {
    favoriteAdded,
    favoriteRemoved,
    shouldPushRecent,
    nextRecentHead,
    importedChanged,
    importedRemoved
  };
}

function hasPendingLibrarySync(delta: LibrarySyncDelta): boolean {
  return (
    delta.favoriteAdded.length > 0 ||
    delta.favoriteRemoved.length > 0 ||
    delta.shouldPushRecent ||
    delta.importedChanged.length > 0 ||
    delta.importedRemoved.length > 0
  );
}

function toTrackFallbackItem(track: Track, prefix: string): DiscoverItem {
  return {
    id: `${prefix}-${track.id}`,
    title: track.name,
    subtitle: track.artists.map((item) => item.name).join(" / ") || "未知歌手",
    coverUrl: track.coverUrl ?? track.album?.coverUrl,
    type: "track",
    targetId: track.id
  };
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5.5v13l10-6.5L7 5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="2.2" height="14" fill="currentColor" />
      <path d="M18 5.5v13L8.2 12 18 5.5z" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="16.8" y="5" width="2.2" height="14" fill="currentColor" />
      <path d="M6 5.5v13l9.8-6.5L6 5.5z" fill="currentColor" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6.5" r="1.6" fill="currentColor" />
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="6" cy="17.5" r="1.6" fill="currentColor" />
      <rect x="9.2" y="5.5" width="10.8" height="2" rx="1" fill="currentColor" />
      <rect x="9.2" y="11" width="10.8" height="2" rx="1" fill="currentColor" />
      <rect x="9.2" y="16.5" width="10.8" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <path
          d="M12 20.5c-3.9-2.4-8.3-5.6-8.3-10.3C3.7 7 5.9 5 8.6 5c1.8 0 2.9.7 3.4 1.6.5-.9 1.6-1.6 3.4-1.6 2.7 0 4.9 2 4.9 5.2 0 4.7-4.4 7.9-8.3 10.3z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M12 20.5l-.6-.4c-3.8-2.3-8-5.5-8-9.9C3.4 6.8 5.8 4.7 8.6 4.7c1.7 0 2.9.6 3.4 1.5.5-.9 1.7-1.5 3.4-1.5 2.8 0 5.2 2.1 5.2 5.5 0 4.4-4.2 7.6-8 9.9l-.6.4zm-3.4-14.1c-2.1 0-3.4 1.6-3.4 3.8 0 3.4 3.5 6 6.8 8.1 3.3-2.1 6.8-4.7 6.8-8.1 0-2.2-1.3-3.8-3.4-3.8-1.4 0-2.1.6-2.6 1.6L12 9.1 11.2 8c-.5-1-1.2-1.6-2.6-1.6z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h4.2L13 5.8v12.4l-4.8-3.7H4v-5z" fill="currentColor" />
      <path d="M16.3 9.2l1.5 1.5 1.5-1.5 1.1 1.1-1.5 1.5 1.5 1.5-1.1 1.1-1.5-1.5-1.5 1.5-1.1-1.1 1.5-1.5-1.5-1.5 1.1-1.1z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h4.2L13 5.8v12.4l-4.8-3.7H4v-5z" fill="currentColor" />
      <path d="M15.2 9.1c1.1.8 1.8 2 1.8 3.4s-.7 2.6-1.8 3.4l.9 1.2c1.5-1.1 2.4-2.8 2.4-4.6s-.9-3.5-2.4-4.6l-.9 1.2z" fill="currentColor" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10l-2-2 1.2-1.2L20.3 8l-4.1 4.2L15 11l2-2H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5zm10 10H7l2 2-1.2 1.2L3.7 16l4.1-4.2L9 13l-2 2h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5z" fill="currentColor" />
    </svg>
  );
}

function RepeatOneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10l-2-2 1.2-1.2L20.3 8l-4.1 4.2L15 11l2-2H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5zm10 10H7l2 2-1.2 1.2L3.7 16l4.1-4.2L9 13l-2 2h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5z" fill="currentColor" />
      <path d="M12.8 9h1.5v6h-1.5v-4.2l-1 .8-.9-1.1L12.8 9z" fill="currentColor" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.4 7.2c4.9 0 6.5 1.2 8.6 4.8 2.1 3.6 3.7 4.8 8.2 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.4 16.8c4.9 0 6.5-1.2 8.6-4.8 2.1-3.6 3.7-4.8 8.2-4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 4.8 21 7.2 18 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 14.4 21 16.8 18 19.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M19.2 15.8a8.6 8.6 0 1 1-10.9-11 6.7 6.7 0 0 0 10.9 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9.8 12 15l6-5.2-1.3-1.5-4.7 4-4.7-4L6 9.8z" fill="currentColor" />
    </svg>
  );
}

function PlayingIndicator({ active }: { active: boolean }) {
  return (
    <span className={`playing-indicator ${active ? "is-playing" : "is-paused"}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function MarqueeText({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const check = () => {
      if (!trackRef.current || !measureRef.current) return;
      setOverflowing(measureRef.current.scrollWidth - trackRef.current.clientWidth > 4);
    };
    check();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && trackRef.current) {
      observer = new ResizeObserver(check);
      observer.observe(trackRef.current);
    }
    window.addEventListener("resize", check);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [text]);

  return (
    <span className={`marquee-text ${overflowing ? "is-overflow" : ""} ${className ?? ""}`.trim()}>
      <span className="marquee-track" ref={trackRef}>
        <span className="marquee-content" ref={measureRef}>
          {text}
        </span>
        {overflowing ? (
          <>
            <span className="marquee-gap" aria-hidden="true">
              {"\u00A0\u00A0\u00A0\u00A0"}
            </span>
            <span className="marquee-content clone" aria-hidden="true">
              {text}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function clampColor(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function IconButton({
  ariaLabel,
  title,
  active,
  disabled,
  className,
  onClick,
  children
}: {
  ariaLabel: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      className={`icon-btn ${active ? "active" : ""} ${className ?? ""}`.trim()}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

const MODE_META: Record<PlaybackMode, { label: string; icon: ReactNode }> = {
  // 保持底层状态不变，仅映射为用户可理解的中文和图标
  sequence: { label: "顺序播放", icon: <RepeatIcon /> },
  "loop-one": { label: "单曲循环", icon: <RepeatOneIcon /> },
  shuffle: { label: "随机播放", icon: <ShuffleIcon /> }
};

const LIBRARY_VIEW_OPTIONS: Array<{ value: LibraryView; label: string }> = [
  { value: "library-favorites", label: "收藏" },
  { value: "library-recent", label: "最近" },
  { value: "library-playlists", label: "我的" }
];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function focusFirstInteractive(root: HTMLElement | null): void {
  const [first] = getFocusableElements(root);
  first?.focus();
}

function trapTabWithin(root: HTMLElement | null, event: ReactKeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusable = getFocusableElements(root);
  if (!focusable.length) {
    event.preventDefault();
    root?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root?.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function TrackRow({
  track,
  liked,
  currentTrackId,
  isPlaying,
  onPlay,
  onToggleFavorite
}: {
  track: Track;
  liked: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
}) {
  const isCurrent = currentTrackId === track.id;
  const isPlayingCurrent = isCurrent && isPlaying;
  return (
    <article className={`spotify-track-row ${isCurrent ? "current" : ""}`.trim()}>
      <div className="spotify-track-main">
        <h3>{track.name}</h3>
        <p>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</p>
      </div>
      <p className="spotify-track-album">{track.album?.name ?? "未知专辑"}</p>
      <p className="spotify-track-duration">{formatMs(track.durationMs)}</p>
      <div className="spotify-track-actions">
        {isCurrent ? <PlayingIndicator active={isPlayingCurrent} /> : null}
        <IconButton ariaLabel="播放歌曲" title="播放歌曲" onClick={() => onPlay(track)}>
          <PlayIcon />
        </IconButton>
        <IconButton
          ariaLabel={liked ? "取消收藏" : "收藏歌曲"}
          title={liked ? "取消收藏" : "收藏歌曲"}
          active={liked}
          onClick={() => onToggleFavorite(track)}
        >
          <HeartIcon filled={liked} />
        </IconButton>
      </div>
    </article>
  );
}

function ArtistSearchRow({
  artist,
  onOpen
}: {
  artist: ArtistSearchItem;
  onOpen: (artist: ArtistSearchItem) => void;
}) {
  return (
    <button
      type="button"
      className="artist-search-row"
      onClick={() => onOpen(artist)}
    >
      <div className="artist-search-cover" style={{ backgroundImage: `url(${artist.coverUrl ?? DEFAULT_COVER_URL})` }} />
      <div className="artist-search-main">
        <h3>{artist.name}</h3>
        <p>
          {typeof artist.musicSize === "number" ? `${artist.musicSize} 首单曲` : "歌曲数未知"}
          {" · "}
          {typeof artist.albumSize === "number" ? `${artist.albumSize} 张专辑` : "专辑数未知"}
        </p>
      </div>
      <span className="artist-search-entry">查看详情</span>
    </button>
  );
}

export function PlayerApp() {
  const player = usePlayerStore();
  const controller = usePlayerController();
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const authSyncState = useAuthStore((state) => state.lastSyncState);
  const authErrorMessage = useAuthStore((state) => state.errorMessage);
  const setAuthAuthenticating = useAuthStore((state) => state.setAuthenticating);
  const setAuthAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setAuthGuest = useAuthStore((state) => state.setGuest);
  const setAuthError = useAuthStore((state) => state.setError);
  const setAuthSyncState = useAuthStore((state) => state.setSyncState);
  const listenRoom = useListenTogetherStore((state) => state.room);
  const listenConnectionState = useListenTogetherStore((state) => state.connectionState);
  const listenMessage = useListenTogetherStore((state) => state.message);
  const setListenRoom = useListenTogetherStore((state) => state.setRoom);
  const setListenConnectionState = useListenTogetherStore((state) => state.setConnectionState);
  const setListenMessage = useListenTogetherStore((state) => state.setMessage);
  const setListenApplyingRemote = useListenTogetherStore((state) => state.setApplyingRemote);
  const leaveListenLocal = useListenTogetherStore((state) => state.leaveLocal);

  const shellRef = useRef<HTMLElement>(null);
  const playerDockRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [libraryView, setLibraryView] = useState<LibraryView>("library-favorites");
  const [detailPhase, setDetailPhase] = useState<DetailModalPhase>("closed");
  const [detailTab, setDetailTab] = useState<DetailViewTab>("lyric");
  const [detailLyricMode, setDetailLyricMode] = useState<DetailLyricMode>("origin");
  const [currentPalette, setCurrentPalette] = useState<DetailPalette>(NEUTRAL_DETAIL_PALETTE);
  const [previousPalette, setPreviousPalette] = useState<DetailPalette | null>(null);
  const [isPaletteTransitioning, setIsPaletteTransitioning] = useState(false);
  const [detailForeground, setDetailForeground] = useState<DetailForegroundTone>(DARK_DETAIL_FOREGROUND);
  const [theme, setTheme] = useState<AppTheme>("dark");
  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("track");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [trackResult, setTrackResult] = useState<Track[]>([]);
  const [artistResult, setArtistResult] = useState<ArtistSearchItem[]>([]);
  const [searchArtistDetail, setSearchArtistDetail] = useState<ArtistDetail | null>(null);
  const [searchArtistDetailLoading, setSearchArtistDetailLoading] = useState(false);
  const [searchArtistDetailError, setSearchArtistDetailError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [discoverData, setDiscoverData] = useState<DiscoverData | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [homePlaylistPanel, setHomePlaylistPanel] = useState<HomePlaylistPanelState | null>(null);
  const [homePlaylistPhase, setHomePlaylistPhase] = useState<PlaylistPanelPhase>("closed");
  const [pendingQueueOpenAfterDetail, setPendingQueueOpenAfterDetail] = useState(false);
  const [homePlaylistView, setHomePlaylistView] = useState<HomePlaylistView>("featured");
  const [playlistSummaryExpanded, setPlaylistSummaryExpanded] = useState(false);
  const [playlistSummaryOverflowing, setPlaylistSummaryOverflowing] = useState(false);
  const [searchAssist, setSearchAssist] = useState<{ hotKeywords: string[]; suggestions: string[]; defaultKeyword?: string } | null>(null);
  const [visibleHotAssistCount, setVisibleHotAssistCount] = useState(SEARCH_ASSIST_MAX_ITEMS);
  const [visibleSuggestAssistCount, setVisibleSuggestAssistCount] = useState(SEARCH_ASSIST_MAX_ITEMS);
  const [trackInsight, setTrackInsight] = useState<SongInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [importPlaylistInput, setImportPlaylistInput] = useState("");
  const [importPlaylistState, setImportPlaylistState] = useState<{
    loading: boolean;
    message: string | null;
    error: string | null;
  }>({
    loading: false,
    message: null,
    error: null
  });
  const [channelGridWidth, setChannelGridWidth] = useState(0);
  const [playlistGridWidth, setPlaylistGridWidth] = useState(0);
  const [eventGridWidth, setEventGridWidth] = useState(0);
  const [downloadState, setDownloadState] = useState<{
    loading: boolean;
    level: string;
    message: string | null;
  }>({
    loading: false,
    level: "exhigh",
    message: null
  });
  const [sceneSati, setSceneSati] = useState<SceneData | null>(null);
  const [sceneSport, setSceneSport] = useState<SceneData | null>(null);
  const [isMobileUi, setIsMobileUi] = useState(false);
  const [isAccountEnabled, setIsAccountEnabled] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [authFormMode, setAuthFormMode] = useState<AuthFormMode>("login");
  const [authFormState, setAuthFormState] = useState({
    email: "",
    password: "",
    nickname: ""
  });
  const [authFormSubmitting, setAuthFormSubmitting] = useState(false);
  const [authFormError, setAuthFormError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authRefreshIssue, setAuthRefreshIssue] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [listenPanelOpen, setListenPanelOpen] = useState(false);
  const [listenInviteInput, setListenInviteInput] = useState("");
  const [listenBusy, setListenBusy] = useState(false);
  const [locatedPanelTrackId, setLocatedPanelTrackId] = useState<string | null>(null);
  const [displayedLibraryView, setDisplayedLibraryView] = useState<LibraryView>("library-favorites");
  const [libraryContentTransitionPhase, setLibraryContentTransitionPhase] = useState<LibraryContentTransitionPhase>("idle");
  const [librarySegmentedThumb, setLibrarySegmentedThumb] = useState<{ x: number; width: number; ready: boolean }>({
    x: 0,
    width: 0,
    ready: false
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importPlaylistInputRef = useRef<HTMLInputElement>(null);
  const accountDialogPanelRef = useRef<HTMLFormElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const detailScreenRef = useRef<HTMLElement>(null);
  const homePlaylistDrawerRef = useRef<HTMLElement>(null);
  const accountDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const playlistReturnFocusRef = useRef<HTMLElement | null>(null);
  const librarySegmentedRef = useRef<HTMLDivElement>(null);
  const displayedLibraryViewRef = useRef<LibraryView>("library-favorites");
  const libraryContentTransitionTokenRef = useRef(0);
  const libraryContentTransitionTimerRef = useRef<number | null>(null);
  const previousVolumeRef = useRef(0.8);
  const detailCloseTimerRef = useRef<number | null>(null);
  const detailOpenFrameRef = useRef<number | null>(null);
  const detailOpenSecondFrameRef = useRef<number | null>(null);
  const detailOpenInteractionRef = useRef<DetailOpenInteraction>("pointer");
  const paletteTransitionTimerRef = useRef<number | null>(null);
  const homePlaylistCloseTimerRef = useRef<number | null>(null);
  const homePlaylistRequestIdRef = useRef(0);
  const pendingArtworkRef = useRef<Set<string>>(new Set());
  const popstateHandlingRef = useRef(false);
  const activeTabRef = useRef<NavTab>("home");
  const detailPhaseRef = useRef<DetailModalPhase>("closed");
  const homePlaylistPhaseRef = useRef<PlaylistPanelPhase>("closed");
  const [dockPortalTarget, setDockPortalTarget] = useState<HTMLElement | null>(null);
  const [playlistPortalTarget, setPlaylistPortalTarget] = useState<HTMLElement | null>(null);
  const homeChannelGridRef = useRef<HTMLElement>(null);
  const homePlaylistGridRef = useRef<HTMLDivElement>(null);
  const homeEventGridRef = useRef<HTMLDivElement>(null);
  const hotAssistRowRef = useRef<HTMLDivElement>(null);
  const suggestAssistRowRef = useRef<HTMLDivElement>(null);
  const playlistSummaryRef = useRef<HTMLParagraphElement>(null);
  const homePlaylistListRef = useRef<HTMLDivElement>(null);
  const panelTrackRowRefsRef = useRef<Map<number, HTMLElement>>(new Map());
  const [artworkByTrackId, setArtworkByTrackId] = useState<Record<string, string>>({});
  const lyricAutoScrollRafRef = useRef<number | null>(null);
  const lyricAutoScrollTimerRef = useRef<number | null>(null);
  const lyricLastModeRef = useRef<DetailLyricMode>("origin");
  const lyricLastTrackIdRef = useRef<string | null>(null);
  const lyricLastAutoIndexRef = useRef<number>(-1);
  const lyricLastDetailTabRef = useRef<DetailViewTab>("lyric");
  const lyricLineRefsRef = useRef<Map<number, HTMLParagraphElement>>(new Map());
  const lyricUserScrollLockUntilRef = useRef(0);
  const lyricUserLockTimerRef = useRef<number | null>(null);
  const locatedPanelTrackTimerRef = useRef<number | null>(null);
  const currentPaletteRef = useRef<DetailPalette>(NEUTRAL_DETAIL_PALETTE);
  const snapshotApplyingRef = useRef(false);
  const syncBaselineRef = useRef<{
    favorites: Record<string, Track>;
    recent: Track[];
    importedPlaylists: Record<string, ImportedPlaylist>;
  }>({
    favorites: player.favorites,
    recent: player.recent,
    importedPlaylists: player.importedPlaylists
  });
  const syncTimerRef = useRef<number | null>(null);
  const syncPollTimerRef = useRef<number | null>(null);
  const cloudRevisionRef = useRef(0);
  const pullInFlightRef = useRef(false);
  const pendingPullReasonRef = useRef<string | null>(null);
  const lastPullTriggeredAtRef = useRef(0);
  const pullRetryBlockedUntilRef = useRef(0);
  const authBootstrapDoneRef = useRef(false);
  const syncReadyRef = useRef(false);
  const listenStreamAbortRef = useRef<AbortController | null>(null);
  const listenApplyingRemoteRef = useRef(false);
  const listenLastPublishedRef = useRef("");

  const queueTrack = useMemo(() => getCurrentTrack(player), [player]);
  const currentTrack = controller.currentTrack ?? queueTrack;
  const currentTrackId = currentTrack?.id ?? null;
  const currentTrackName = currentTrack?.name ?? null;
  const favoriteSet = player.favorites;
  const modeMeta = MODE_META[player.mode];
  const hotAssistCandidates = useMemo(() => searchAssist?.hotKeywords.slice(0, SEARCH_ASSIST_MAX_ITEMS) ?? [], [searchAssist]);
  const suggestAssistCandidates = useMemo(() => searchAssist?.suggestions.slice(0, SEARCH_ASSIST_MAX_ITEMS) ?? [], [searchAssist]);
  const homePlaylistSubtitle = useMemo(() => {
    if (!homePlaylistPanel) return "";
    return visibleSubtitle(
      homePlaylistPanel.subtitle,
      homePlaylistPanel.sourceType === "queue"
        ? "点击歌曲即可切换播放。"
        : isMobileUi
          ? "点击歌曲即可立即切换并播放。"
          : "点击歌曲开始播放，或先加入播放队列。"
    );
  }, [homePlaylistPanel, isMobileUi]);
  const playingTrackIndexInPanel = useMemo(() => {
    if (!homePlaylistPanel?.tracks.length || !currentTrackId) return -1;
    return homePlaylistPanel.tracks.findIndex((track) => track.id === currentTrackId);
  }, [homePlaylistPanel?.tracks, currentTrackId]);
  const canLocatePlayingTrack = playingTrackIndexInPanel >= 0;
  const locatePlayingTrackButtonTitle = useMemo(() => {
    if (!currentTrackId) return "当前没有正在播放歌曲";
    if (!homePlaylistPanel?.tracks.length) return "当前列表暂无歌曲";
    if (!canLocatePlayingTrack) return "当前播放歌曲不在此列表中";
    return "定位到正在播放歌曲";
  }, [canLocatePlayingTrack, currentTrackId, homePlaylistPanel?.tracks.length]);
  const currentCoverUrl = useMemo(
    () => (currentTrack ? artworkByTrackId[currentTrack.id] ?? pickTrackCover(currentTrack) ?? DEFAULT_COVER_URL : null),
    [artworkByTrackId, currentTrack]
  );

  const captureListenPlaybackState = useCallback((): ListenPlaybackState => {
    return {
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTimeMs: Math.max(0, Math.floor(player.currentTimeMs)),
      isPlaying: player.isPlaying,
      mode: player.mode,
      updatedAt: new Date().toISOString()
    };
  }, [player.currentIndex, player.currentTimeMs, player.isPlaying, player.mode, player.queue]);

  const applyListenPlaybackState = useCallback(
    (state: ListenPlaybackState) => {
      listenApplyingRemoteRef.current = true;
      setListenApplyingRemote(true);
      player.setQueue(state.queue, state.currentIndex);
      player.setPlaybackMode(state.mode);
      player.setPlaying(state.isPlaying);
      if (Math.abs(player.currentTimeMs - state.currentTimeMs) > 1200) {
        player.setCurrentTimeMs(state.currentTimeMs);
        window.setTimeout(() => controller.seekTo(state.currentTimeMs), 0);
      }
      window.setTimeout(() => {
        listenApplyingRemoteRef.current = false;
        setListenApplyingRemote(false);
      }, 350);
    },
    [controller, player, setListenApplyingRemote]
  );

  const handleCreateListenRoom = useCallback(async () => {
    if (authStatus !== "authenticated") {
      setListenPanelOpen(true);
      setListenMessage("请先登录后再使用一起听。");
      return;
    }
    setListenBusy(true);
    setListenMessage(null);
    try {
      const room = await createListenRoom(captureListenPlaybackState());
      setListenRoom(room);
      setListenConnectionState("connected");
      setListenPanelOpen(true);
    } catch (error) {
      setListenMessage(error instanceof Error ? error.message : "创建一起听房间失败。");
      setListenConnectionState("error");
    } finally {
      setListenBusy(false);
    }
  }, [authStatus, captureListenPlaybackState, setListenConnectionState, setListenMessage, setListenRoom]);

  const handleJoinListenRoom = useCallback(async () => {
    if (authStatus !== "authenticated") {
      setListenMessage("请先登录后再加入一起听。");
      return;
    }
    const inviteCode = listenInviteInput.trim();
    if (!inviteCode) {
      setListenMessage("请输入邀请码。");
      return;
    }
    setListenBusy(true);
    setListenMessage(null);
    try {
      const room = await joinListenRoom(inviteCode);
      setListenRoom(room);
      setListenConnectionState("connected");
      applyListenPlaybackState(room.playbackState);
      setListenInviteInput("");
    } catch (error) {
      setListenMessage(error instanceof Error ? error.message : "加入一起听失败。");
      setListenConnectionState("error");
    } finally {
      setListenBusy(false);
    }
  }, [applyListenPlaybackState, authStatus, listenInviteInput, setListenConnectionState, setListenMessage, setListenRoom]);

  const handleLeaveListenRoom = useCallback(async () => {
    const roomId = listenRoom?.id;
    listenStreamAbortRef.current?.abort();
    if (roomId) {
      try {
        await leaveListenRoom(roomId);
      } catch {
        // Local leave should still clear the room if the server is already gone.
      }
    }
    leaveListenLocal();
  }, [leaveListenLocal, listenRoom?.id]);

  const handleCopyListenInvite = useCallback(async () => {
    if (!listenRoom) return;
    try {
      await navigator.clipboard.writeText(listenRoom.inviteCode);
      setListenMessage("邀请码已复制。");
    } catch {
      setListenMessage(`邀请码：${listenRoom.inviteCode}`);
    }
  }, [listenRoom, setListenMessage]);

  const handleAvatarFileChange = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setAvatarUploading(true);
    setAuthNotice(null);
    try {
      await uploadAccountAvatar(file);
      setAuthNotice("头像已更新。");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "头像上传失败。");
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  }, []);

  const handleDeleteAvatar = useCallback(async () => {
    setAvatarUploading(true);
    setAuthNotice(null);
    try {
      await deleteAccountAvatar();
      setAuthNotice("已恢复默认头像。");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "头像移除失败。");
    } finally {
      setAvatarUploading(false);
    }
  }, []);

  const resolveTrackCover = (track?: Track | null): string => {
    if (!track) return DEFAULT_COVER_URL;
    return artworkByTrackId[track.id] ?? pickTrackCover(track) ?? DEFAULT_COVER_URL;
  };

  const applyCloudSnapshot = useCallback(
    (snapshot: {
      favorites: Record<string, Track>;
      recent: Track[];
      importedPlaylists: Record<string, ImportedPlaylist>;
    }) => {
      snapshotApplyingRef.current = true;
      player.replaceLibraryState({
        favorites: snapshot.favorites ?? {},
        recent: snapshot.recent ?? [],
        importedPlaylists: snapshot.importedPlaylists ?? {}
      });
      syncBaselineRef.current = {
        favorites: snapshot.favorites ?? {},
        recent: snapshot.recent ?? [],
        importedPlaylists: snapshot.importedPlaylists ?? {}
      };
      window.setTimeout(() => {
        snapshotApplyingRef.current = false;
      }, 0);
    },
    [player]
  );

  const captureCurrentLibrarySnapshot = useCallback<() => LibrarySyncSnapshot>(
    () => ({
      favorites: player.favorites,
      recent: player.recent,
      importedPlaylists: player.importedPlaylists
    }),
    [player.favorites, player.importedPlaylists, player.recent]
  );

  const pushLocalChanges = useCallback(
    async (options?: { syncState?: boolean; silentSuccess?: boolean }) => {
      if (!isAccountEnabled || authStatus !== "authenticated" || !syncReadyRef.current || snapshotApplyingRef.current || !player.hasHydrated) {
        return { pushed: false, failed: false };
      }

      const previous = syncBaselineRef.current;
      const next = captureCurrentLibrarySnapshot();
      const delta = computeLibrarySyncDelta(previous, next);
      if (!hasPendingLibrarySync(delta)) {
        return { pushed: false, failed: false };
      }

      if (options?.syncState !== false) {
        setAuthSyncState("syncing");
      }

      let maxRevision = cloudRevisionRef.current;
      let skippedInvalidPlaylists = 0;

      try {
        for (const track of delta.favoriteAdded) {
          const payload = sanitizeTrackForCloud(track);
          if (!payload) continue;
          const result = await addFavoriteTrack(payload);
          maxRevision = Math.max(maxRevision, result.revision);
        }
        for (const trackId of delta.favoriteRemoved) {
          const result = await removeFavoriteTrack(trackId);
          maxRevision = Math.max(maxRevision, result.revision);
        }
        if (delta.shouldPushRecent && delta.nextRecentHead) {
          const payload = sanitizeTrackForCloud(delta.nextRecentHead);
          if (payload) {
            const result = await addRecentTrack(payload);
            maxRevision = Math.max(maxRevision, result.revision);
          }
        }
        for (const playlist of delta.importedChanged) {
          const payload = sanitizeImportedPlaylistForCloud(playlist);
          if (!payload) {
            skippedInvalidPlaylists += 1;
            continue;
          }
          const result = await upsertImportedPlaylistCloud(payload);
          maxRevision = Math.max(maxRevision, result.revision);
        }
        for (const playlistId of delta.importedRemoved) {
          const result = await removeImportedPlaylistCloud(playlistId);
          maxRevision = Math.max(maxRevision, result.revision);
        }

        syncBaselineRef.current = next;
        cloudRevisionRef.current = Math.max(cloudRevisionRef.current, maxRevision);
        pullRetryBlockedUntilRef.current = 0;

        if (!options?.silentSuccess) {
          setAuthSyncState("success");
        }
        if (skippedInvalidPlaylists > 0) {
          setAuthNotice(`发现 ${skippedInvalidPlaylists} 个歌单数据不完整，已跳过云同步。`);
        }
        return { pushed: true, failed: false };
      } catch (error) {
        setAuthSyncState("failed");
        setAuthNotice(resolveSyncNotice(error));
        pullRetryBlockedUntilRef.current = Date.now() + ACCOUNT_PULL_RETRY_BLOCK_MS;
        return { pushed: false, failed: true };
      }
    },
    [authStatus, captureCurrentLibrarySnapshot, isAccountEnabled, player.hasHydrated, setAuthSyncState]
  );

  const triggerCloudPull = useCallback(
    async (reason: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      if (!isAccountEnabled || authStatus !== "authenticated" || !syncReadyRef.current || !player.hasHydrated) {
        return;
      }
      const now = Date.now();
      if (!force && now < pullRetryBlockedUntilRef.current) {
        return;
      }
      if (pullInFlightRef.current) {
        pendingPullReasonRef.current = reason;
        return;
      }
      if (!force && now - lastPullTriggeredAtRef.current < ACCOUNT_PULL_THROTTLE_MS) {
        return;
      }

      lastPullTriggeredAtRef.current = now;
      pullInFlightRef.current = true;
      setAuthSyncState("syncing");

      try {
        const localDelta = computeLibrarySyncDelta(syncBaselineRef.current, captureCurrentLibrarySnapshot());
        if (hasPendingLibrarySync(localDelta)) {
          const pushResult = await pushLocalChanges({ syncState: false, silentSuccess: true });
          if (pushResult.failed) return;
        }

        const sinceRevision = Math.max(0, cloudRevisionRef.current);
        const changes = await getLibraryChanges(sinceRevision);
        if (typeof changes.toRevision === "number") {
          cloudRevisionRef.current = Math.max(cloudRevisionRef.current, changes.toRevision);
        }
        if (!changes.hasChanges) {
          setAuthSyncState("success");
          pullRetryBlockedUntilRef.current = 0;
          return;
        }

        const snapshot = await getLibrarySnapshot();
        applyCloudSnapshot({
          favorites: snapshot.favorites ?? {},
          recent: snapshot.recent ?? [],
          importedPlaylists: snapshot.importedPlaylists ?? {}
        });
        cloudRevisionRef.current = Math.max(cloudRevisionRef.current, snapshot.revision ?? 0);
        setAuthSyncState("success");
        pullRetryBlockedUntilRef.current = 0;
      } catch (error) {
        setAuthSyncState("failed");
        setAuthNotice(resolveSyncNotice(error));
        pullRetryBlockedUntilRef.current = Date.now() + ACCOUNT_PULL_RETRY_BLOCK_MS;
      } finally {
        pullInFlightRef.current = false;
        const pendingReason = pendingPullReasonRef.current;
        pendingPullReasonRef.current = null;
        if (pendingReason) {
          window.setTimeout(() => {
            void triggerCloudPull(pendingReason, { force: true });
          }, 0);
        }
      }
    },
    [applyCloudSnapshot, authStatus, captureCurrentLibrarySnapshot, isAccountEnabled, player.hasHydrated, pushLocalChanges, setAuthSyncState]
  );

  const syncAfterLogin = useCallback(async () => {
    syncReadyRef.current = false;
    setAuthSyncState("syncing");
    try {
      const snapshot = await getLibrarySnapshot();
      applyCloudSnapshot({
        favorites: snapshot.favorites ?? {},
        recent: snapshot.recent ?? [],
        importedPlaylists: snapshot.importedPlaylists ?? {}
      });
      cloudRevisionRef.current = Math.max(0, snapshot.revision ?? 0);
      setAuthSyncState("success");
      setAuthRefreshIssue(null);
    } catch (error) {
      setAuthSyncState("failed");
      setAuthNotice(resolveSyncNotice(error));
    } finally {
      syncReadyRef.current = true;
    }
  }, [applyCloudSnapshot, setAuthSyncState]);

  const resetCloudSyncSession = useCallback(() => {
    syncReadyRef.current = false;
    cloudRevisionRef.current = 0;
    pullInFlightRef.current = false;
    pendingPullReasonRef.current = null;
    lastPullTriggeredAtRef.current = 0;
    pullRetryBlockedUntilRef.current = 0;
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (syncPollTimerRef.current) {
      window.clearInterval(syncPollTimerRef.current);
      syncPollTimerRef.current = null;
    }
  }, []);

  const closeAccountDialog = useCallback(() => {
    setAccountDialogOpen(false);
    setAuthFormError(null);
    window.setTimeout(() => {
      accountDialogReturnFocusRef.current?.focus();
      accountDialogReturnFocusRef.current = null;
    }, 0);
  }, []);

  const openLoginDialog = useCallback(() => {
    const activeElement = document.activeElement;
    accountDialogReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setAuthFormMode("login");
    setAuthFormError(null);
    setAccountDialogOpen(true);
  }, []);

  const openRegisterDialog = useCallback(() => {
    const activeElement = document.activeElement;
    accountDialogReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setAuthFormMode("register");
    setAuthFormError(null);
    setAccountDialogOpen(true);
  }, []);

  const submitAuthForm = useCallback(async () => {
    const email = authFormState.email.trim();
    const password = authFormState.password;
    const nickname = authFormState.nickname.trim();
    if (!email || !password) {
      setAuthFormError("请输入邮箱和密码。");
      return;
    }
    if (authFormMode === "register" && !hasStrongPassword(password)) {
      setAuthFormError("请设置更安全的密码：至少 10 位，且包含大小写字母、数字和符号。");
      return;
    }

    setAuthFormSubmitting(true);
    setAuthFormError(null);
    setAuthAuthenticating();
    syncReadyRef.current = false;
    try {
      if (authFormMode === "register") {
        await registerAccount({
          email,
          password,
          nickname: nickname || undefined
        });
      } else {
        await loginAccount({
          email,
          password
        });
      }
      const me = await loadCurrentAccountUser();
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        throw new Error("AUTH_TOKEN_MISSING");
      }
      setAuthAuthenticated(me, token);
      setAuthRefreshIssue(null);
      await syncAfterLogin();
      closeAccountDialog();
    } catch (error) {
      const message = resolveAuthFormError(error, authFormMode);
      setAuthError(message);
      setAuthFormError(message);
    } finally {
      setAuthFormSubmitting(false);
    }
  }, [authFormMode, authFormState, closeAccountDialog, setAuthAuthenticated, setAuthAuthenticating, setAuthError, syncAfterLogin]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutAccount();
      setAuthNotice("已退出登录，已切换到本地游客模式。");
      setAuthRefreshIssue(null);
      setAuthGuest();
      setAuthSyncState("idle");
      resetCloudSyncSession();
    } catch {
      setAuthNotice("退出失败，请稍后重试。");
    }
  }, [resetCloudSyncSession, setAuthGuest, setAuthSyncState]);

  const handleAuthRefreshRetry = useCallback(async () => {
    if (!isAccountEnabled) return;
    setAuthAuthenticating();
    setAuthRefreshIssue(null);
    const refreshResult = await tryRefreshAccessTokenDetailed();
    if (!refreshResult.ok) {
      resetCloudSyncSession();
      setAuthGuest();
      setAuthRefreshIssue(resolveAuthRefreshIssue(refreshResult.error, "manual"));
      return;
    }

    try {
      const me = await loadCurrentAccountUser();
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        resetCloudSyncSession();
        setAuthGuest();
        setAuthRefreshIssue("登录状态异常，请重新登录。");
        return;
      }
      setAuthAuthenticated(me, token);
      await syncAfterLogin();
    } catch {
      resetCloudSyncSession();
      setAuthGuest();
      setAuthRefreshIssue("账号信息加载失败，请稍后重试。");
    }
  }, [isAccountEnabled, resetCloudSyncSession, setAuthAuthenticated, setAuthAuthenticating, setAuthGuest, syncAfterLogin]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    displayedLibraryViewRef.current = displayedLibraryView;
  }, [displayedLibraryView]);

  useEffect(() => {
    currentPaletteRef.current = currentPalette;
  }, [currentPalette]);

  useEffect(() => {
    const storedTheme = readThemePreference(window.localStorage);
    const initialTheme = resolveInitialTheme(storedTheme, "dark");
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeThemePreference(theme, window.localStorage);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 899px), (pointer: coarse), (hover: none)");
    const update = () => setIsMobileUi(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => {
      mediaQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const enabled = await detectAccountServiceEnabled();
      if (!active) return;
      setIsAccountEnabled(enabled);
      if (!enabled) {
        resetCloudSyncSession();
        setAuthGuest();
        setAuthRefreshIssue(null);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [resetCloudSyncSession, setAuthGuest]);

  useEffect(() => {
    if (!isAccountEnabled || authBootstrapDoneRef.current) return;
    authBootstrapDoneRef.current = true;
    let active = true;
    const bootstrap = async () => {
      setAuthAuthenticating();
      setAuthRefreshIssue(null);
      const refreshResult = await tryRefreshAccessTokenDetailed();
      if (!active) return;
      if (!refreshResult.ok) {
        resetCloudSyncSession();
        setAuthGuest();
        setAuthRefreshIssue(resolveAuthRefreshIssue(refreshResult.error, "auto"));
        return;
      }
      try {
        const me = await loadCurrentAccountUser();
        if (!active) return;
        const token = useAuthStore.getState().accessToken;
        if (!token) {
          resetCloudSyncSession();
          setAuthGuest();
          setAuthRefreshIssue("登录状态异常，请重新登录。");
          return;
        }
        setAuthAuthenticated(me, token);
        await syncAfterLogin();
      } catch {
        if (!active) return;
        resetCloudSyncSession();
        setAuthGuest();
        setAuthRefreshIssue("账号信息加载失败，请稍后重试。");
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [isAccountEnabled, resetCloudSyncSession, setAuthAuthenticated, setAuthAuthenticating, setAuthGuest, syncAfterLogin]);

  useEffect(() => {
    if (activeTab !== "library") return;
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;
    void triggerCloudPull("enter-library", { force: true });
  }, [activeTab, authStatus, isAccountEnabled, player.hasHydrated, triggerCloudPull]);

  useEffect(() => {
    if (activeTab !== "library") return;
    if (libraryView !== "library-recent" && libraryView !== "library-playlists") return;
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;
    void triggerCloudPull(`library-view:${libraryView}`, { force: true });
  }, [activeTab, authStatus, isAccountEnabled, libraryView, player.hasHydrated, triggerCloudPull]);

  useEffect(() => {
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;

    const onFocus = () => {
      void triggerCloudPull("window-focus", { force: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void triggerCloudPull("tab-visible", { force: true });
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authStatus, isAccountEnabled, player.hasHydrated, triggerCloudPull]);

  useEffect(() => {
    if (syncPollTimerRef.current) {
      window.clearInterval(syncPollTimerRef.current);
      syncPollTimerRef.current = null;
    }
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;

    syncPollTimerRef.current = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void triggerCloudPull("polling");
    }, ACCOUNT_PULL_POLLING_MS);

    return () => {
      if (syncPollTimerRef.current) {
        window.clearInterval(syncPollTimerRef.current);
        syncPollTimerRef.current = null;
      }
    };
  }, [authStatus, isAccountEnabled, player.hasHydrated, triggerCloudPull]);

  useEffect(() => {
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!syncReadyRef.current) return;
    if (snapshotApplyingRef.current) return;
    if (!player.hasHydrated) return;

    const delta = computeLibrarySyncDelta(syncBaselineRef.current, captureCurrentLibrarySnapshot());
    if (!hasPendingLibrarySync(delta)) {
      return;
    }

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const result = await pushLocalChanges();
        if (result.pushed && !result.failed) {
          void triggerCloudPull("after-local-push", { force: true });
        }
      })();
    }, ACCOUNT_SYNC_DEBOUNCE_MS);

    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [
    authStatus,
    captureCurrentLibrarySnapshot,
    isAccountEnabled,
    player.favorites,
    player.hasHydrated,
    player.importedPlaylists,
    player.recent,
    pushLocalChanges,
    triggerCloudPull
  ]);

  useLayoutEffect(() => {
    const root = librarySegmentedRef.current;
    if (!root) return;

    const updateThumb = () => {
      const rootRect = root.getBoundingClientRect();
      if (rootRect.width <= 0 || root.offsetParent === null) return;
      const activeIndex = LIBRARY_VIEW_OPTIONS.findIndex((item) => item.value === libraryView);
      if (activeIndex < 0) return;
      const slotCount = LIBRARY_VIEW_OPTIONS.length;
      if (!slotCount) return;
      const slotWidth = rootRect.width / slotCount;
      if (slotWidth <= 0) return;

      const activeButton = root.querySelector<HTMLButtonElement>(`button[data-library-view="${libraryView}"]`);
      const labelNode = activeButton?.querySelector<HTMLSpanElement>(".library-segmented-pill-label");
      const labelWidth = labelNode?.getBoundingClientRect().width ?? slotWidth * 0.7;
      const computedStyle = window.getComputedStyle(root);
      const thumbInsetRaw = Number.parseFloat(computedStyle.getPropertyValue("--lib-seg-inset"));
      const thumbInset = Number.isFinite(thumbInsetRaw) ? thumbInsetRaw : 4;
      const horizontalTextPadding = 28;
      const maxThumbWidth = Math.max(1, slotWidth - thumbInset * 2);
      const preferredWidth = Math.max(1, Math.min(maxThumbWidth, labelWidth + horizontalTextPadding));
      const centeredX = slotWidth * activeIndex + slotWidth / 2 - preferredWidth / 2;
      const minX = thumbInset;
      const maxX = Math.max(minX, rootRect.width - preferredWidth - thumbInset);
      const nextX = Math.round(Math.min(maxX, Math.max(minX, centeredX)));
      const nextWidth = Math.round(preferredWidth);

      setLibrarySegmentedThumb((previous) => {
        if (previous.ready && previous.x === nextX && previous.width === nextWidth) {
          return previous;
        }
        return {
          x: nextX,
          width: nextWidth,
          ready: true
        };
      });
    };

    const rafId = window.requestAnimationFrame(updateThumb);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateThumb) : null;
    if (observer) {
      observer.observe(root);
      LIBRARY_VIEW_OPTIONS.forEach((option) => {
        const button = root.querySelector<HTMLButtonElement>(`button[data-library-view="${option.value}"]`);
        if (button) observer.observe(button);
      });
    }

    window.addEventListener("resize", updateThumb);
    window.addEventListener("orientationchange", updateThumb);
    window.visualViewport?.addEventListener("resize", updateThumb);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener("resize", updateThumb);
      window.removeEventListener("orientationchange", updateThumb);
      window.visualViewport?.removeEventListener("resize", updateThumb);
    };
  }, [libraryView, isMobileUi]);

  useEffect(() => {
    if (libraryContentTransitionTimerRef.current) {
      window.clearTimeout(libraryContentTransitionTimerRef.current);
      libraryContentTransitionTimerRef.current = null;
    }

    if (activeTab !== "library") {
      libraryContentTransitionTokenRef.current += 1;
      displayedLibraryViewRef.current = libraryView;
      setDisplayedLibraryView(libraryView);
      setLibraryContentTransitionPhase("idle");
      return;
    }

    if (displayedLibraryViewRef.current === libraryView) {
      setLibraryContentTransitionPhase("idle");
      return;
    }

    const token = libraryContentTransitionTokenRef.current + 1;
    libraryContentTransitionTokenRef.current = token;
    setLibraryContentTransitionPhase("leaving");

    libraryContentTransitionTimerRef.current = window.setTimeout(() => {
      if (libraryContentTransitionTokenRef.current !== token) return;
      displayedLibraryViewRef.current = libraryView;
      setDisplayedLibraryView(libraryView);
      setLibraryContentTransitionPhase("entering");
      libraryContentTransitionTimerRef.current = window.setTimeout(() => {
        if (libraryContentTransitionTokenRef.current !== token) return;
        setLibraryContentTransitionPhase("idle");
        libraryContentTransitionTimerRef.current = null;
      }, LIBRARY_CONTENT_ENTER_MS);
    }, LIBRARY_CONTENT_LEAVE_MS);
  }, [activeTab, libraryView]);

  useEffect(() => {
    detailPhaseRef.current = detailPhase;
  }, [detailPhase]);

  useEffect(() => {
    homePlaylistPhaseRef.current = homePlaylistPhase;
  }, [homePlaylistPhase]);

  useEffect(() => {
    let active = true;
    getDiscoverHome()
      .then((data) => {
        if (!active) return;
        setDiscoverData(data);
        setDiscoverError(null);
        setSearchAssist(data.searchAssist);
      })
      .catch((error) => {
        if (!active) return;
        setDiscoverError(error instanceof Error ? error.message : "发现页加载失败");
        getSearchAssist("")
          .then((assist) => {
            if (!active) return;
            setSearchAssist(assist);
          })
          .catch(() => undefined);
      });

    getSatiScene()
      .then((data) => {
        if (!active) return;
        setSceneSati(data);
      })
      .catch(() => {
        if (!active) return;
        setSceneSati(null);
      });

    getSportScene(130)
      .then((data) => {
        if (!active) return;
        setSceneSport(data);
      })
      .catch(() => {
        if (!active) return;
        setSceneSport(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) return;
    let active = true;
    const timer = window.setTimeout(() => {
      getSearchAssist(q)
        .then((assist) => {
          if (!active) return;
          setSearchAssist(assist);
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  useEffect(() => {
    setVisibleHotAssistCount(hotAssistCandidates.length);
  }, [hotAssistCandidates.length]);

  useEffect(() => {
    setVisibleSuggestAssistCount(suggestAssistCandidates.length);
  }, [suggestAssistCandidates.length]);

  useEffect(() => {
    const resetVisibleCounts = () => {
      setVisibleHotAssistCount(hotAssistCandidates.length);
      setVisibleSuggestAssistCount(suggestAssistCandidates.length);
    };
    window.addEventListener("resize", resetVisibleCounts);
    return () => {
      window.removeEventListener("resize", resetVisibleCounts);
    };
  }, [hotAssistCandidates.length, suggestAssistCandidates.length]);

  useEffect(() => {
    const measureVisibleCount = (container: HTMLDivElement | null) => {
      if (!container) return 0;
      const buttons = Array.from(container.querySelectorAll("button"));
      if (!buttons.length) return 0;
      const offsetTops = buttons.map((button) => button.offsetTop);
      return countItemsWithinRows(offsetTops, SEARCH_ASSIST_MAX_ROWS);
    };

    const rafId = window.requestAnimationFrame(() => {
      const nextHotVisibleCount = measureVisibleCount(hotAssistRowRef.current);
      if (nextHotVisibleCount > 0 && nextHotVisibleCount < visibleHotAssistCount) {
        setVisibleHotAssistCount(nextHotVisibleCount);
      }

      const nextSuggestVisibleCount = measureVisibleCount(suggestAssistRowRef.current);
      if (nextSuggestVisibleCount > 0 && nextSuggestVisibleCount < visibleSuggestAssistCount) {
        setVisibleSuggestAssistCount(nextSuggestVisibleCount);
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [hotAssistCandidates.length, suggestAssistCandidates.length, visibleHotAssistCount, visibleSuggestAssistCount]);

  useEffect(() => {
    setDetailLyricMode("origin");
    lyricLastTrackIdRef.current = null;
    lyricLastModeRef.current = "origin";
    lyricLastAutoIndexRef.current = -1;
  }, [currentTrack?.id]);

  useEffect(() => {
    if (detailTab === "lyric") return;
    lyricLastDetailTabRef.current = detailTab;
  }, [detailTab]);

  useEffect(() => {
    if (!currentTrackId) {
      setTrackInsight(null);
      return;
    }
    let active = true;
    setInsightLoading(true);
    getTrackInsight(currentTrackId)
      .then((data) => {
        if (!active) return;
        setTrackInsight(data);
      })
      .catch(() => {
        if (!active) return;
        setTrackInsight(null);
      })
      .finally(() => {
        if (active) setInsightLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentTrackId]);

  useEffect(() => {
    if (!isMobileUi) return;
    if (player.volume < 0.999) {
      previousVolumeRef.current = player.volume > 0 ? player.volume : previousVolumeRef.current;
      player.setVolume(1);
    }
  }, [isMobileUi, player]);

  const closeHomePlaylistPanelDirectly = useCallback(() => {
    if (homePlaylistCloseTimerRef.current) {
      window.clearTimeout(homePlaylistCloseTimerRef.current);
      homePlaylistCloseTimerRef.current = null;
    }
    setHomePlaylistPhase("closed");
    setHomePlaylistPanel(null);
    playlistReturnFocusRef.current = null;
  }, []);

  const openHomePlaylistPanelWithAnimation = useCallback(() => {
    const activeElement = document.activeElement;
    playlistReturnFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
    if (homePlaylistCloseTimerRef.current) {
      window.clearTimeout(homePlaylistCloseTimerRef.current);
      homePlaylistCloseTimerRef.current = null;
    }
    const currentPhase = homePlaylistPhaseRef.current;
    if (currentPhase === "open" || currentPhase === "opening") {
      return;
    }
    setHomePlaylistPhase("opening");
    window.requestAnimationFrame(() => {
      setHomePlaylistPhase("open");
    });
  }, []);

  const closeHomePlaylistPanelWithAnimation = useCallback(() => {
    const currentPhase = homePlaylistPhaseRef.current;
    if (currentPhase === "closed" || currentPhase === "closing") {
      return;
    }
    if (homePlaylistCloseTimerRef.current) {
      window.clearTimeout(homePlaylistCloseTimerRef.current);
    }
    setHomePlaylistPhase("closing");
    homePlaylistCloseTimerRef.current = window.setTimeout(() => {
      setHomePlaylistPhase("closed");
      setHomePlaylistPanel(null);
      homePlaylistCloseTimerRef.current = null;
      playlistReturnFocusRef.current?.focus();
      playlistReturnFocusRef.current = null;
    }, PLAYLIST_PANEL_ANIMATION_MS);
  }, []);

  const closeHomePlaylistPanel = useCallback(() => {
    const guard = readHistoryGuardState();
    if (!popstateHandlingRef.current && guard?.layer === "playlist") {
      window.history.back();
      return;
    }
    closeHomePlaylistPanelWithAnimation();
  }, [closeHomePlaylistPanelWithAnimation]);

  const restoreHomeTab = useCallback(() => {
    setActiveTab("home");
    setLibraryView("library-favorites");
  }, []);

  const goTab = (tab: NavTab, nextLibraryView?: LibraryView) => {
    const previousTab = activeTabRef.current;
    if (!popstateHandlingRef.current && tab !== "home" && previousTab !== tab) {
      pushHistoryGuardState("tab", tab);
    }
    setActiveTab(tab);
    if (tab !== "home") {
      closeHomePlaylistPanelDirectly();
      setHomePlaylistView("featured");
    }
    if (tab === "library" && nextLibraryView) {
      setLibraryView(nextLibraryView);
    }
    if (tab === "search") {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  };

  const openPlaylistPanel = async (item: DiscoverItem, sourceType: "playlist" | "toplist") => {
    const targetId = item.targetId;
    if (!targetId) {
      setSearchError("该推荐项暂时不可用，请稍后重试。");
      return;
    }
    const requestId = ++homePlaylistRequestIdRef.current;
    const panelVisible = homePlaylistPhaseRef.current !== "closed";
    if (!popstateHandlingRef.current && !panelVisible) {
      pushHistoryGuardState("playlist", activeTabRef.current);
    }
    setHomePlaylistPanel({
      id: targetId,
      sourceType,
      title: item.title,
      subtitle: item.subtitle,
      coverUrl: item.coverUrl,
      tracks: [],
      loading: true,
      error: null
    });
    openHomePlaylistPanelWithAnimation();

    try {
      const data: Playlist =
        sourceType === "toplist" ? await getToplistDetail(targetId) : await getPlaylistDetail(targetId);
      if (requestId !== homePlaylistRequestIdRef.current) return;
      setHomePlaylistPanel({
        id: targetId,
        sourceType,
        title: data.name || item.title,
        subtitle: data.description ?? item.subtitle,
        coverUrl: data.coverUrl ?? item.coverUrl,
        tracks: data.tracks,
        loading: false,
        error: null
      });
    } catch (error) {
      if (requestId !== homePlaylistRequestIdRef.current) return;
      setHomePlaylistPanel((previous) => {
        if (!previous || previous.id !== targetId) return previous;
        return {
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "歌单加载失败，请稍后重试。"
        };
      });
    }
  };

  const openImportedPlaylistPanel = (playlist: ImportedPlaylist) => {
    const panelVisible = homePlaylistPhaseRef.current !== "closed";
    if (!popstateHandlingRef.current && !panelVisible) {
      pushHistoryGuardState("playlist", activeTabRef.current);
    }
    setHomePlaylistPanel({
      id: playlist.id,
      sourceType: "imported",
      title: playlist.name,
      subtitle: playlist.description,
      coverUrl: playlist.coverUrl,
      tracks: playlist.tracks,
      loading: false,
      error: null
    });
    openHomePlaylistPanelWithAnimation();
  };

  const openQueuePanel = useCallback(() => {
    const panelVisible = homePlaylistPhaseRef.current !== "closed";
    if (!popstateHandlingRef.current && !panelVisible) {
      pushHistoryGuardState("playlist", activeTabRef.current);
    }
    setHomePlaylistPanel({
      id: "queue-panel",
      sourceType: "queue",
      title: "播放队列",
      subtitle: player.queue.length ? `共 ${player.queue.length} 首` : "当前播放队列为空",
      coverUrl: currentCoverUrl ?? DEFAULT_COVER_URL,
      tracks: player.queue,
      loading: false,
      error: null
    });
    openHomePlaylistPanelWithAnimation();
  }, [player.queue, currentCoverUrl, openHomePlaylistPanelWithAnimation]);

  const importPlaylistFromInput = async () => {
    const raw = importPlaylistInput.trim();
    if (!raw) {
      setImportPlaylistState((previous) => ({
        ...previous,
        message: null,
        error: "请输入网易云歌单链接或歌单 ID。"
      }));
      return;
    }

    setImportPlaylistState({
      loading: true,
      message: null,
      error: null
    });
    try {
      let playlistId = extractPlaylistId(raw);
      if (!playlistId) {
        const resolved = await resolvePlaylistInput(raw);
        playlistId = resolved.playlistId;
      }
      if (!playlistId) {
        throw new Error("未识别到歌单 ID，请检查链接格式。");
      }
      const data = await getPlaylistDetail(playlistId);
      const now = Date.now();
      const existing = player.importedPlaylists[playlistId];
      player.upsertImportedPlaylist({
        id: data.id || playlistId,
        name: data.name || `歌单 ${playlistId}`,
        description: data.description,
        coverUrl: data.coverUrl,
        tracks: data.tracks,
        sourceUrl: raw,
        importedAt: existing?.importedAt ?? now,
        updatedAt: now
      });
      setImportPlaylistState({
        loading: false,
        message: existing ? `已更新歌单：${data.name}` : `已导入歌单：${data.name}`,
        error: null
      });
      setImportPlaylistInput("");
    } catch (error) {
      setImportPlaylistState({
        loading: false,
        message: null,
        error: error instanceof Error ? error.message : "导入歌单失败，请稍后重试。"
      });
    }
  };

  const runSearch = async (nextKeyword: string, mode: SearchMode) => {
    const q = nextKeyword.trim();
    if (!q) {
      setSearchStatus("error");
      setTrackResult([]);
      setArtistResult([]);
      setSearchArtistDetail(null);
      setSearchArtistDetailError(null);
      setSearchError("请输入关键词后再搜索。");
      return;
    }

    setSearchStatus("loading");
    setSearchArtistDetail(null);
    setSearchArtistDetailError(null);
    setSearchError(null);
    try {
      if (mode === "artist") {
        const data = await searchArtists(q, 1, 20);
        setArtistResult(data.items);
        setTrackResult([]);
        setSearchStatus(data.items.length === 0 ? "empty" : "success");
      } else {
        const data = await searchMusic(q, 1, 20);
        setTrackResult(data.items);
        setArtistResult([]);
        setSearchStatus(data.items.length === 0 ? "empty" : "success");
      }
    } catch (error) {
      setTrackResult([]);
      setArtistResult([]);
      setSearchStatus("error");
      setSearchError(error instanceof Error ? error.message : "网络异常，搜索失败，请稍后重试。");
    }
  };

  const doSearch = async () => {
    await runSearch(keyword, searchMode);
  };

  const applyKeywordAndSearch = (nextKeyword: string) => {
    const normalized = nextKeyword.trim();
    if (!normalized) return;
    setKeyword(normalized);
    window.setTimeout(() => {
      void runSearch(normalized, searchMode);
    }, 0);
  };

  const openSearchArtistDetail = async (artist: ArtistSearchItem) => {
    setSearchArtistDetail(null);
    setSearchArtistDetailLoading(true);
    setSearchArtistDetailError(null);
    try {
      const detail = await getArtistDetail(artist.id);
      setSearchArtistDetail(detail);
    } catch (error) {
      setSearchArtistDetailError(error instanceof Error ? error.message : "歌手详情加载失败，请稍后重试。");
    } finally {
      setSearchArtistDetailLoading(false);
    }
  };

  const playArtistTopTracks = (artistDetail: ArtistDetail) => {
    if (!artistDetail.topTracks.length) return;
    player.setQueue(artistDetail.topTracks, 0);
    player.setPlaying(true);
  };

  const addArtistTopTracksToQueue = (artistDetail: ArtistDetail) => {
    artistDetail.topTracks.forEach((track) => player.addToQueue(track));
  };

  const switchSearchMode = (nextMode: SearchMode) => {
    if (nextMode === searchMode) return;
    setSearchMode(nextMode);
    setSearchArtistDetail(null);
    setSearchArtistDetailError(null);
    setSearchArtistDetailLoading(false);
    if (!keyword.trim()) {
      setSearchStatus("idle");
      setTrackResult([]);
      setArtistResult([]);
      setSearchError(null);
      return;
    }
    void runSearch(keyword, nextMode);
  };

  const tryPlaySceneTrack = async (trackId?: string) => {
    if (!trackId) return;
    try {
      const detail = await getTrackDetail(trackId);
      player.playTrackNow(detail);
      player.setPlaying(true);
    } catch {
      // 场景资源不可播时保持静默，避免打断主页面操作。
    }
  };

  const handleDiscoverItem = async (item: DiscoverItem) => {
    const action = resolveDiscoverAction(item);
    if (action.type === "unsupported") {
      setDiscoverError("该推荐项暂时不可用，请稍后重试。");
      return;
    }

    try {
      if (action.type === "open-external") {
        const opened = window.open(action.url, "_blank", "noopener,noreferrer");
        if (!opened) {
          setDiscoverError(`浏览器阻止了新窗口，请复制链接打开：${action.url}`);
        }
        return;
      }

      if (action.type === "play-track") {
        await tryPlaySceneTrack(action.targetId);
        return;
      }

      if (action.type === "open-playlist") {
        await openPlaylistPanel(item, action.sourceType);
        return;
      }

      if (action.type === "open-album") {
        const album = await getAlbumDetail(action.targetId);
        if (!album.tracks.length) return;
        player.setQueue(album.tracks, 0);
        player.setPlaying(true);
        return;
      }

      if (action.type === "open-artist") {
        const artist = await getArtistDetail(action.targetId);
        if (!artist.topTracks.length) return;
        player.setQueue(artist.topTracks, 0);
        player.setPlaying(true);
        return;
      }
    } catch {
      setDiscoverError("该推荐项暂时不可用，请稍后重试。");
    }
  };

  const playHomePlaylistAll = () => {
    if (!homePlaylistPanel?.tracks.length) return;
    player.setQueue(homePlaylistPanel.tracks, 0);
    player.setPlaying(true);
  };

  const playHomePlaylistTrackAt = (trackIndex: number) => {
    if (!homePlaylistPanel?.tracks.length) return;
    const safeIndex = Math.min(Math.max(trackIndex, 0), homePlaylistPanel.tracks.length - 1);
    player.setQueue(homePlaylistPanel.tracks, safeIndex);
    player.setPlaying(true);
  };

  const addHomePlaylistToQueue = () => {
    if (!homePlaylistPanel?.tracks.length) return;
    homePlaylistPanel.tracks.forEach((track) => player.addToQueue(track));
  };

  const locatePlayingTrackInPanel = useCallback(() => {
    if (!canLocatePlayingTrack || !homePlaylistPanel?.tracks.length) return;
    const index = playingTrackIndexInPanel;
    const container = homePlaylistListRef.current;
    const targetRow =
      panelTrackRowRefsRef.current.get(index) ??
      container?.querySelector<HTMLElement>(`[data-panel-track-index="${index}"]`) ??
      null;
    if (!(targetRow instanceof HTMLElement)) return;
    targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    const targetTrack = homePlaylistPanel.tracks[index];
    if (!targetTrack) return;
    setLocatedPanelTrackId(targetTrack.id);
    if (locatedPanelTrackTimerRef.current) {
      window.clearTimeout(locatedPanelTrackTimerRef.current);
    }
    locatedPanelTrackTimerRef.current = window.setTimeout(() => {
      setLocatedPanelTrackId(null);
      locatedPanelTrackTimerRef.current = null;
    }, LOCATED_PANEL_TRACK_HIGHLIGHT_MS);
  }, [canLocatePlayingTrack, homePlaylistPanel?.tracks, playingTrackIndexInPanel]);

  const handleDownloadTrack = async () => {
    if (!currentTrack) return;
    setDownloadState((previous) => ({ ...previous, loading: true, message: null }));
    try {
      const preferred = downloadState.level;
      const fallbackLevels = ["standard", "exhigh", "lossless", "hires"].filter((level) => level !== preferred);
      const levelsToTry = [preferred, ...fallbackLevels];
      let source = null as Awaited<ReturnType<typeof getTrackDownloadUrl>> | null;
      for (const level of levelsToTry) {
        try {
          source = await getTrackDownloadUrl(currentTrack.id, level);
          break;
        } catch {
          source = null;
        }
      }
      if (!source) {
        throw new Error("当前歌曲没有可用下载链路");
      }
      const opened = window.open(source.url, "_blank", "noopener,noreferrer");
      setDownloadState((previous) => ({
        ...previous,
        loading: false,
        message: opened ? `已获取 ${source.level} 音质下载链接` : `已获取 ${source.level} 音质下载链接，请复制打开：${source.url}`
      }));
    } catch (error) {
      setDownloadState((previous) => ({
        ...previous,
        loading: false,
        message: error instanceof Error ? error.message : "下载链接获取失败"
      }));
    }
  };

  const toggleMute = () => {
    if (isMobileUi) return;
    const next = nextVolumeAfterMuteToggle(player.volume, previousVolumeRef.current);
    previousVolumeRef.current = next.previousVolume;
    player.setVolume(next.volume);
  };

  const toggleTheme = useCallback(() => {
    setTheme((previous) => nextTheme(previous));
  }, []);

  const isMuted = player.volume <= 0;
  const hasTrack = Boolean(currentTrack ?? queueTrack);
  const canOpenDetail = canOpenPlayerDetail(hasTrack);
  const controlDisabled = player.queue.length === 0;
  const isDetailMounted = detailPhase !== "closed";
  const progressPercent =
    player.durationMs > 0 ? Math.min(100, Math.max(0, (player.currentTimeMs / player.durationMs) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, player.volume * 100));
  const activeDetailLyricLines = useMemo(() => {
    if (isMobileUi) {
      return controller.lyricLines;
    }
    if (detailLyricMode === "translated" && controller.lyricTranslatedLines.length) {
      return controller.lyricTranslatedLines;
    }
    if (detailLyricMode === "karaoke" && controller.lyricKaraokeLines.length) {
      return controller.lyricKaraokeLines;
    }
    return controller.lyricLines;
  }, [controller.lyricKaraokeLines, controller.lyricLines, controller.lyricTranslatedLines, detailLyricMode, isMobileUi]);
  const activeDetailLyricIndex = useMemo(
    () => locateCurrentLyricIndex(activeDetailLyricLines, player.currentTimeMs),
    [activeDetailLyricLines, player.currentTimeMs]
  );
  const detailLyricRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lyricLineRefsRef.current.clear();
  }, [activeDetailLyricLines, detailLyricMode, currentTrack?.id]);
  const homeSeedTracks = useMemo(() => {
    const map = new Map<string, Track>();
    const candidates = [
      currentTrack ?? queueTrack,
      ...player.recent,
      ...Object.values(player.favorites),
      ...player.queue
    ].filter(Boolean) as Track[];
    for (const item of candidates) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }, [currentTrack, queueTrack, player.recent, player.favorites, player.queue]);
  const importedPlaylists = useMemo(
    () => Object.values(player.importedPlaylists).sort((a, b) => b.updatedAt - a.updatedAt),
    [player.importedPlaylists]
  );
  const discoverBlocks = useMemo(() => {
    const blockMap = new Map<string, DiscoverItem[]>();
    discoverData?.blocks.forEach((block) => {
      blockMap.set(block.id, block.items);
    });
    return blockMap;
  }, [discoverData]);
  const homeChannelItems = useMemo(() => {
    const primary = discoverBlocks.get("discover-banner") ?? [];
    const fallback = homeSeedTracks.map((track) => toTrackFallbackItem(track, "channel-fallback"));
    const merged = [...primary];
    for (const item of fallback) {
      if (!merged.some((exist) => exist.id === item.id || exist.targetId === item.targetId)) {
        merged.push(item);
      }
    }
    return merged;
  }, [discoverBlocks, homeSeedTracks]);
  const homePlaylistItems = useMemo(() => {
    const primary = discoverBlocks.get("discover-personalized") ?? [];
    const highQuality = discoverBlocks.get("discover-highquality") ?? [];
    const fallback = homeSeedTracks.map((track) => toTrackFallbackItem(track, "playlist-fallback"));
    const merged = [...primary, ...highQuality];
    for (const item of fallback) {
      if (!merged.some((exist) => exist.id === item.id || exist.targetId === item.targetId)) {
        merged.push(item);
      }
    }
    return merged;
  }, [discoverBlocks, homeSeedTracks]);
  const homeEventItems = useMemo(() => {
    const toplist = discoverBlocks.get("discover-toplist") ?? [];
    const scene = [...(sceneSati?.resources ?? []), ...(sceneSport?.resources ?? [])]
      .filter((item) => item.trackId)
      .map(
        (item, index): DiscoverItem => ({
          id: `scene-resource-${item.id || index}`,
          title: item.title,
          subtitle: item.subtitle,
          coverUrl: item.coverUrl,
          type: "scene",
          targetId: item.trackId
        })
      );
    const merged = [...toplist];
    for (const item of scene) {
      if (!merged.some((exist) => exist.id === item.id || exist.targetId === item.targetId)) {
        merged.push(item);
      }
    }
    return merged;
  }, [discoverBlocks, sceneSati, sceneSport]);

  const homeChannelPlan = useMemo(
    () => computeHomeGridPlan(channelGridWidth, homeChannelItems.length, HOME_CHANNEL_MIN_CARD_WIDTH, HOME_GRID_GAP),
    [channelGridWidth, homeChannelItems.length]
  );
  const homePlaylistPlan = useMemo(
    () => computeHomeGridPlan(playlistGridWidth, homePlaylistItems.length, HOME_PLAYLIST_MIN_CARD_WIDTH, HOME_GRID_GAP),
    [playlistGridWidth, homePlaylistItems.length]
  );
  const homeEventPlan = useMemo(
    () => computeHomeGridPlan(eventGridWidth, homeEventItems.length, HOME_EVENT_MIN_CARD_WIDTH, HOME_GRID_GAP),
    [eventGridWidth, homeEventItems.length]
  );
  const visibleChannelItems = useMemo(() => homeChannelItems.slice(0, homeChannelPlan.count), [homeChannelItems, homeChannelPlan.count]);
  const visiblePlaylistItems = useMemo(() => homePlaylistItems.slice(0, homePlaylistPlan.count), [homePlaylistItems, homePlaylistPlan.count]);
  const visibleEventItems = useMemo(() => homeEventItems.slice(0, homeEventPlan.count), [homeEventItems, homeEventPlan.count]);

  useEffect(() => {
    const sourceTracks = [
      ...homeSeedTracks,
      ...trackResult,
      ...player.queue,
      ...player.recent,
      ...Object.values(player.favorites),
      ...(currentTrack ? [currentTrack] : [])
    ];
    const unique = new Map<string, Track>();
    sourceTracks.forEach((track) => {
      if (!track || unique.has(track.id)) return;
      unique.set(track.id, track);
    });

    unique.forEach((track) => {
      const directCover = pickTrackCover(track);
      if (directCover) {
        setArtworkByTrackId((previous) => {
          if (previous[track.id] === directCover) return previous;
          return { ...previous, [track.id]: directCover };
        });
        return;
      }

      if (pendingArtworkRef.current.has(track.id) || artworkByTrackId[track.id]) {
        return;
      }

      pendingArtworkRef.current.add(track.id);
      getTrackDetail(track.id)
        .then((detailTrack) => {
          const detailCover = pickTrackCover(detailTrack) ?? DEFAULT_COVER_URL;
          setArtworkByTrackId((previous) => ({ ...previous, [track.id]: detailCover }));
        })
        .catch(() => {
          setArtworkByTrackId((previous) => ({ ...previous, [track.id]: DEFAULT_COVER_URL }));
        })
        .finally(() => {
          pendingArtworkRef.current.delete(track.id);
        });
    });
  }, [homeSeedTracks, trackResult, player.queue, player.recent, player.favorites, currentTrack, artworkByTrackId]);

  const finishDetailClose = useCallback(() => {
    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    const returnFocusElement = detailReturnFocusRef.current;
    detailReturnFocusRef.current = null;
    setDetailPhase("closed");
    if (returnFocusElement?.isConnected) {
      returnFocusElement.focus({ preventScroll: true });
    }
  }, []);

  const closeDetailWithAnimation = useCallback(() => {
    if (detailPhaseRef.current === "closed" || detailPhaseRef.current === "closing") {
      return;
    }
    if (detailOpenFrameRef.current) {
      window.cancelAnimationFrame(detailOpenFrameRef.current);
      detailOpenFrameRef.current = null;
    }
    if (detailOpenSecondFrameRef.current) {
      window.cancelAnimationFrame(detailOpenSecondFrameRef.current);
      detailOpenSecondFrameRef.current = null;
    }
    setDetailPhase("closing");
    detailCloseTimerRef.current = window.setTimeout(() => {
      finishDetailClose();
    }, DETAIL_ANIMATION_MS + 80);
  }, [finishDetailClose]);

  useEffect(() => {
    if (detailPhase !== "closing") return;
    const detailScreen = detailScreenRef.current;
    if (!detailScreen) return;
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== detailScreen || event.propertyName !== "transform") return;
      finishDetailClose();
    };
    detailScreen.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      detailScreen.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [detailPhase, finishDetailClose]);

  const openDetail = (returnFocusElement?: HTMLElement | null, interaction: DetailOpenInteraction = "pointer") => {
    if (!canOpenDetail) {
      return;
    }
    if (detailPhase === "open" || detailPhase === "opening") {
      return;
    }
    const activeElement = document.activeElement;
    detailReturnFocusRef.current =
      returnFocusElement ?? (activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null);
    detailOpenInteractionRef.current = interaction;
    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    if (detailOpenFrameRef.current) {
      window.cancelAnimationFrame(detailOpenFrameRef.current);
      detailOpenFrameRef.current = null;
    }
    if (detailOpenSecondFrameRef.current) {
      window.cancelAnimationFrame(detailOpenSecondFrameRef.current);
      detailOpenSecondFrameRef.current = null;
    }
    if (!popstateHandlingRef.current) {
      pushHistoryGuardState("detail", activeTabRef.current);
    }
    setDetailPhase("opening");
    detailOpenFrameRef.current = window.requestAnimationFrame(() => {
      detailOpenFrameRef.current = null;
      detailOpenSecondFrameRef.current = window.requestAnimationFrame(() => {
        detailOpenSecondFrameRef.current = null;
        setDetailPhase("open");
      });
    });
  };

  useEffect(() => {
    if (detailPhase !== "open") return;
    const focusFrameId = window.requestAnimationFrame(() => {
      detailScreenRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrameId);
  }, [detailPhase]);

  const closeDetail = useCallback(() => {
    const guard = readHistoryGuardState();
    if (!popstateHandlingRef.current && guard?.layer === "detail") {
      window.history.back();
    } else {
      closeDetailWithAnimation();
    }
  }, [closeDetailWithAnimation]);

  const openQueuePanelFromDetail = () => {
    detailReturnFocusRef.current = null;
    setPendingQueueOpenAfterDetail(true);
    closeDetail();
  };

  useEffect(() => {
    const handlePopState = () => {
      popstateHandlingRef.current = true;
      const currentDetailPhase = detailPhaseRef.current;
      const detailOpen = currentDetailPhase === "open" || currentDetailPhase === "opening";

      if (detailOpen) {
        closeDetailWithAnimation();
      } else if (homePlaylistPanel) {
        closeHomePlaylistPanel();
      } else if (activeTabRef.current !== "home") {
        restoreHomeTab();
      }

      window.setTimeout(() => {
        popstateHandlingRef.current = false;
      }, 0);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [homePlaylistPanel, closeDetailWithAnimation, closeHomePlaylistPanel, restoreHomeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        shouldTogglePlaybackBySpace({
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          target: event.target
        })
      ) {
        if (controlDisabled) return;
        event.preventDefault();
        player.togglePlay();
        return;
      }

      if (event.key !== "Escape") return;
      if (accountDialogOpen) {
        closeAccountDialog();
        return;
      }
      const currentDetailPhase = detailPhaseRef.current;
      const detailOpen = currentDetailPhase === "open" || currentDetailPhase === "opening";
      if (detailOpen) {
        closeDetail();
        return;
      }
      if (homePlaylistPanel) {
        closeHomePlaylistPanel();
        return;
      }
      if (activeTabRef.current !== "home") {
        restoreHomeTab();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountDialogOpen, homePlaylistPanel, closeAccountDialog, closeDetail, closeHomePlaylistPanel, restoreHomeTab, controlDisabled, player]);

  useEffect(() => {
    if (!accountDialogOpen) return;
    window.setTimeout(() => {
      focusFirstInteractive(accountDialogPanelRef.current);
    }, 0);
  }, [accountDialogOpen]);

  useEffect(() => {
    if (homePlaylistPhase !== "open") return;
    focusFirstInteractive(homePlaylistDrawerRef.current);
  }, [homePlaylistPhase, homePlaylistPanel?.id]);

  useEffect(() => {
    let createdNode: HTMLElement | null = null;
    const existingNode = document.getElementById("player-dock-root");
    if (existingNode) {
      setDockPortalTarget(existingNode);
      return;
    }
    createdNode = document.createElement("div");
    createdNode.id = "player-dock-root";
    document.body.appendChild(createdNode);
    setDockPortalTarget(createdNode);
    return () => {
      if (createdNode && createdNode.parentNode) {
        createdNode.parentNode.removeChild(createdNode);
      }
    };
  }, []);

  useEffect(() => {
    setPlaylistPortalTarget(document.body);
  }, []);

  useEffect(() => {
    const channelNode = homeChannelGridRef.current;
    const playlistNode = homePlaylistGridRef.current;
    const eventNode = homeEventGridRef.current;
    if (!channelNode && !playlistNode && !eventNode) return;

    const update = () => {
      if (channelNode) {
        setChannelGridWidth(Math.ceil(channelNode.getBoundingClientRect().width));
      }
      if (playlistNode) {
        setPlaylistGridWidth(Math.ceil(playlistNode.getBoundingClientRect().width));
      }
      if (eventNode) {
        setEventGridWidth(Math.ceil(eventNode.getBoundingClientRect().width));
      }
    };

    update();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (resizeObserver) {
      if (channelNode) resizeObserver.observe(channelNode);
      if (playlistNode) resizeObserver.observe(playlistNode);
      if (eventNode) resizeObserver.observe(eventNode);
    }
    window.addEventListener("resize", update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeTab, homePlaylistView, isDetailMounted]);

  useEffect(() => {
    if (!playerDockRef.current) return;
    const root = document.documentElement;
    const updateDockHeight = () => {
      if (!playerDockRef.current) return;
      const nextHeight = Math.ceil(playerDockRef.current.getBoundingClientRect().height);
      if (nextHeight > 0) {
        root.style.setProperty("--player-bar-height-actual", `${nextHeight}px`);
      }
    };

    updateDockHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateDockHeight);
      resizeObserver.observe(playerDockRef.current);
    }

    window.addEventListener("resize", updateDockHeight);
    window.addEventListener("orientationchange", updateDockHeight);
    window.visualViewport?.addEventListener("resize", updateDockHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateDockHeight);
      window.removeEventListener("orientationchange", updateDockHeight);
      window.visualViewport?.removeEventListener("resize", updateDockHeight);
    };
  }, [dockPortalTarget]);

  useEffect(() => {
    const root = document.documentElement;
    const updateViewportBottomOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        root.style.setProperty("--viewport-bottom-offset", "0px");
        return;
      }
      const layoutHeight = window.innerHeight;
      const visibleBottom = viewport.offsetTop + viewport.height;
      const occludedBottom = Math.max(0, Math.ceil(layoutHeight - visibleBottom));
      root.style.setProperty("--viewport-bottom-offset", `${occludedBottom}px`);
    };

    updateViewportBottomOffset();
    window.addEventListener("resize", updateViewportBottomOffset);
    window.addEventListener("orientationchange", updateViewportBottomOffset);
    window.visualViewport?.addEventListener("resize", updateViewportBottomOffset);
    window.visualViewport?.addEventListener("scroll", updateViewportBottomOffset);

    return () => {
      window.removeEventListener("resize", updateViewportBottomOffset);
      window.removeEventListener("orientationchange", updateViewportBottomOffset);
      window.visualViewport?.removeEventListener("resize", updateViewportBottomOffset);
      window.visualViewport?.removeEventListener("scroll", updateViewportBottomOffset);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (detailCloseTimerRef.current) {
        window.clearTimeout(detailCloseTimerRef.current);
      }
      if (detailOpenFrameRef.current) {
        window.cancelAnimationFrame(detailOpenFrameRef.current);
      }
      if (detailOpenSecondFrameRef.current) {
        window.cancelAnimationFrame(detailOpenSecondFrameRef.current);
      }
      if (paletteTransitionTimerRef.current) {
        window.clearTimeout(paletteTransitionTimerRef.current);
      }
      if (homePlaylistCloseTimerRef.current) {
        window.clearTimeout(homePlaylistCloseTimerRef.current);
      }
      if (lyricAutoScrollRafRef.current) {
        window.cancelAnimationFrame(lyricAutoScrollRafRef.current);
      }
      if (lyricAutoScrollTimerRef.current) {
        window.clearTimeout(lyricAutoScrollTimerRef.current);
      }
      if (lyricUserLockTimerRef.current) {
        window.clearTimeout(lyricUserLockTimerRef.current);
      }
      if (locatedPanelTrackTimerRef.current) {
        window.clearTimeout(locatedPanelTrackTimerRef.current);
      }
      if (libraryContentTransitionTimerRef.current) {
        window.clearTimeout(libraryContentTransitionTimerRef.current);
      }
      listenStreamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    listenStreamAbortRef.current?.abort();
    const abortController = new AbortController();
    listenStreamAbortRef.current = abortController;
    setListenConnectionState("connecting");
    const sinceVersion = useListenTogetherStore.getState().room?.version ?? 0;

    void openListenRoomStream(
      roomId,
      sinceVersion,
      (event) => {
        const currentRoom = useListenTogetherStore.getState().room;
        if (!currentRoom || currentRoom.id !== roomId || event.version <= currentRoom.version) return;
        if (event.type === "member") {
          void getListenRoom(roomId)
            .then((room) => {
              setListenRoom(room);
              setListenConnectionState("connected");
            })
            .catch(() => setListenConnectionState("reconnecting"));
          return;
        }
        if (event.payload && typeof event.payload === "object" && "queue" in event.payload) {
          const playbackState = event.payload as ListenPlaybackState;
          setListenRoom({
            ...currentRoom,
            version: event.version,
            playbackState,
            lastActor: event.actor,
            updatedAt: event.createdAt
          });
          setListenConnectionState("connected");
          if (event.actor.id !== authUser?.id) {
            applyListenPlaybackState(playbackState);
            setListenMessage(`由 ${event.actor.nickname || event.actor.email} 更新播放`);
          }
        }
      },
      abortController.signal
    ).catch((error) => {
      if (abortController.signal.aborted) return;
      setListenConnectionState("reconnecting");
      setListenMessage(error instanceof Error ? error.message : "一起听连接中断，正在等待重连。");
    });

    return () => {
      abortController.abort();
    };
  }, [
    applyListenPlaybackState,
    authStatus,
    authUser?.id,
    listenRoom?.id,
    setListenConnectionState,
    setListenMessage,
    setListenRoom
  ]);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    const timerId = window.setInterval(() => {
      void heartbeatListenRoom(roomId)
        .then((room) => setListenRoom(room))
        .catch(() => setListenConnectionState("reconnecting"));
    }, 20_000);
    return () => window.clearInterval(timerId);
  }, [authStatus, listenRoom?.id, setListenConnectionState, setListenRoom]);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    if (listenApplyingRemoteRef.current) return;
    const ids = player.queue.map((track) => track.id).join(",");
    const progressBucket = Math.floor(player.currentTimeMs / 5000);
    const signature = JSON.stringify({
      ids,
      index: player.currentIndex,
      playing: player.isPlaying,
      mode: player.mode,
      progressBucket
    });
    if (signature === listenLastPublishedRef.current) return;
    listenLastPublishedRef.current = signature;
    void sendListenRoomState(roomId, "playback", captureListenPlaybackState())
      .then((room) => {
        setListenRoom(room);
        setListenConnectionState("connected");
      })
      .catch(() => setListenConnectionState("reconnecting"));
  }, [
    authStatus,
    captureListenPlaybackState,
    listenRoom?.id,
    player.currentIndex,
    player.currentTimeMs,
    player.isPlaying,
    player.mode,
    player.queue,
    setListenConnectionState,
    setListenRoom
  ]);

  const markLyricUserInteraction = useCallback(() => {
    lyricUserScrollLockUntilRef.current = Date.now() + 1800;
    if (lyricUserLockTimerRef.current) {
      window.clearTimeout(lyricUserLockTimerRef.current);
    }
    lyricUserLockTimerRef.current = window.setTimeout(() => {
      lyricUserScrollLockUntilRef.current = 0;
      lyricUserLockTimerRef.current = null;
    }, 1900);
  }, []);

  const bindLyricLineRef = useCallback(
    (index: number) => (node: HTMLParagraphElement | null) => {
      if (node) {
        lyricLineRefsRef.current.set(index, node);
      } else {
        lyricLineRefsRef.current.delete(index);
      }
    },
    []
  );

  const bindPanelTrackRowRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      if (node) {
        panelTrackRowRefsRef.current.set(index, node);
      } else {
        panelTrackRowRefsRef.current.delete(index);
      }
    },
    []
  );

  useEffect(() => {
    panelTrackRowRefsRef.current.clear();
    setLocatedPanelTrackId(null);
    if (locatedPanelTrackTimerRef.current) {
      window.clearTimeout(locatedPanelTrackTimerRef.current);
      locatedPanelTrackTimerRef.current = null;
    }
  }, [homePlaylistPanel?.id, homePlaylistPhase]);

  useEffect(() => {
    if (!isDetailMounted || detailTab !== "lyric") return;
    const container = detailLyricRef.current;
    if (!container) return;
    const onWheel = () => markLyricUserInteraction();
    const onTouchStart = () => markLyricUserInteraction();
    const onPointerDown = () => markLyricUserInteraction();
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("pointerdown", onPointerDown);
    };
  }, [detailTab, isDetailMounted, markLyricUserInteraction]);

  const scrollActiveLyric = useCallback(
    (behavior: ScrollBehavior) => {
      if (!isDetailMounted || detailTab !== "lyric" || !detailLyricRef.current) return;
      if (Date.now() < lyricUserScrollLockUntilRef.current) return;
      const container = detailLyricRef.current;
      const active = lyricLineRefsRef.current.get(activeDetailLyricIndex);
      if (!(active instanceof HTMLElement)) return;
      const centeredTop = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2;
      const maxTop = Math.max(container.scrollHeight - container.clientHeight, 0);
      const nextTop = Math.max(0, Math.min(centeredTop, maxTop));
      if (Math.abs(container.scrollTop - nextTop) < 1) return;
      container.scrollTo({ top: nextTop, behavior });
      if (lyricAutoScrollTimerRef.current) {
        window.clearTimeout(lyricAutoScrollTimerRef.current);
      }
      lyricAutoScrollTimerRef.current = window.setTimeout(() => {
        lyricAutoScrollTimerRef.current = null;
      }, behavior === "smooth" ? 340 : 80);
    },
    [activeDetailLyricIndex, detailTab, isDetailMounted]
  );

  const scheduleLyricAutoScroll = useCallback(
    (behavior: ScrollBehavior) => {
      if (lyricAutoScrollRafRef.current) {
        window.cancelAnimationFrame(lyricAutoScrollRafRef.current);
      }
      lyricAutoScrollRafRef.current = window.requestAnimationFrame(() => {
        lyricAutoScrollRafRef.current = null;
        scrollActiveLyric(behavior);
      });
    },
    [scrollActiveLyric]
  );

  useEffect(() => {
    if (!isDetailMounted || detailTab !== "lyric") return;
    if (activeDetailLyricIndex < 0) return;
    const trackChanged = lyricLastTrackIdRef.current !== (currentTrack?.id ?? null);
    const modeChanged = lyricLastModeRef.current !== detailLyricMode;
    const tabChanged = lyricLastDetailTabRef.current !== "lyric";
    const shouldAlignNow = trackChanged || modeChanged || tabChanged || detailPhase === "opening";
    if (!shouldAlignNow) return;
    lyricLastTrackIdRef.current = currentTrack?.id ?? null;
    lyricLastModeRef.current = detailLyricMode;
    lyricLastDetailTabRef.current = "lyric";
    lyricLastAutoIndexRef.current = activeDetailLyricIndex;
    scheduleLyricAutoScroll("auto");
  }, [
    activeDetailLyricIndex,
    activeDetailLyricLines.length,
    currentTrack?.id,
    detailLyricMode,
    detailPhase,
    detailTab,
    isDetailMounted,
    scheduleLyricAutoScroll
  ]);

  useEffect(() => {
    if (!isDetailMounted || detailTab !== "lyric") return;
    if (activeDetailLyricIndex < 0) return;
    if (lyricLastAutoIndexRef.current === activeDetailLyricIndex) return;
    lyricLastAutoIndexRef.current = activeDetailLyricIndex;
    scheduleLyricAutoScroll("smooth");
  }, [activeDetailLyricIndex, detailTab, isDetailMounted, scheduleLyricAutoScroll]);

  useEffect(() => {
    const shouldLockBody = isDetailMounted || Boolean(homePlaylistPanel);
    if (!shouldLockBody) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isDetailMounted, homePlaylistPanel]);

  useEffect(() => {
    if (!pendingQueueOpenAfterDetail || detailPhase !== "closed") return;
    openQueuePanel();
    setPendingQueueOpenAfterDetail(false);
  }, [pendingQueueOpenAfterDetail, detailPhase, openQueuePanel]);

  useEffect(() => {
    setHomePlaylistPanel((previous) => {
      if (!previous || previous.sourceType !== "queue") return previous;
      return {
        ...previous,
        subtitle: player.queue.length ? `共 ${player.queue.length} 首` : "当前播放队列为空",
        coverUrl: currentCoverUrl ?? DEFAULT_COVER_URL,
        tracks: player.queue
      };
    });
  }, [player.queue, currentCoverUrl]);

  useEffect(() => {
    setPlaylistSummaryExpanded(false);
    setPlaylistSummaryOverflowing(false);
  }, [homePlaylistPanel?.id, homePlaylistPanel?.sourceType]);

  useEffect(() => {
    if (homePlaylistPhase !== "closed") return;
    setPlaylistSummaryExpanded(false);
  }, [homePlaylistPhase]);

  useEffect(() => {
    if (!homePlaylistPanel || homePlaylistPanel.sourceType === "queue") {
      setPlaylistSummaryOverflowing(false);
      return;
    }
    if (playlistSummaryExpanded || !playlistSummaryRef.current) return;
    const element = playlistSummaryRef.current;
    const measure = () => {
      setPlaylistSummaryOverflowing(element.scrollHeight - element.clientHeight > 2);
    };
    const rafId = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measure);
    };
  }, [homePlaylistPanel, homePlaylistPhase, homePlaylistSubtitle, playlistSummaryExpanded]);

  useEffect(() => {
    const applyNextPalette = (nextPalette: DetailPalette, nextForeground: DetailForegroundTone) => {
      const nextState = beginPaletteTransition(currentPaletteRef.current, nextPalette);
      currentPaletteRef.current = nextState.currentPalette;
      setCurrentPalette(nextState.currentPalette);
      setPreviousPalette(nextState.previousPalette);
      setIsPaletteTransitioning(nextState.isTransitioning);
      setDetailForeground(nextForeground);
      if (paletteTransitionTimerRef.current) {
        window.clearTimeout(paletteTransitionTimerRef.current);
      }
      if (!nextState.isTransitioning) return;
      paletteTransitionTimerRef.current = window.setTimeout(() => {
        const finished = finishPaletteTransition({
          currentPalette: currentPaletteRef.current,
          previousPalette: nextState.previousPalette,
          isTransitioning: true
        });
        setPreviousPalette(finished.previousPalette);
        setIsPaletteTransitioning(finished.isTransitioning);
        paletteTransitionTimerRef.current = null;
      }, PALETTE_TRANSITION_MS);
    };

    if (!currentTrackId) {
      applyNextPalette(NEUTRAL_DETAIL_PALETTE, DARK_DETAIL_FOREGROUND);
      return;
    }

    if (!currentCoverUrl || currentCoverUrl === DEFAULT_COVER_URL) {
      applyNextPalette(THEME_DETAIL_FALLBACK_PALETTE, DARK_DETAIL_FOREGROUND);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.src = currentCoverUrl;

    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          applyNextPalette(THEME_DETAIL_FALLBACK_PALETTE, DARK_DETAIL_FOREGROUND);
          return;
        }
        canvas.width = 32;
        canvas.height = 32;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;

        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < imageData.length; index += 4) {
          const alpha = imageData[index + 3];
          if (alpha < 40) continue;
          red += imageData[index];
          green += imageData[index + 1];
          blue += imageData[index + 2];
          count += 1;
        }
        if (!count) {
          applyNextPalette(THEME_DETAIL_FALLBACK_PALETTE, DARK_DETAIL_FOREGROUND);
          return;
        }
        const avgR = red / count;
        const avgG = green / count;
        const avgB = blue / count;

        // Always keep detail screen in a dark visual language; cover color only adds subtle tint.
        const tintR = Math.min(avgR, 176);
        const tintG = Math.min(avgG, 176);
        const tintB = Math.min(avgB, 176);
        const bgA = `rgb(${clampColor(tintR * 0.34 + 16)}, ${clampColor(tintG * 0.32 + 15)}, ${clampColor(tintB * 0.34 + 18)})`;
        const bgB = `rgb(${clampColor(tintR * 0.16 + 6)}, ${clampColor(tintG * 0.14 + 6)}, ${clampColor(tintB * 0.16 + 8)})`;
        const glow = `rgba(${clampColor(tintR)}, ${clampColor(tintG)}, ${clampColor(tintB)}, 0.2)`;
        applyNextPalette({ bgA, bgB, glow }, DARK_DETAIL_FOREGROUND);
      } catch {
        applyNextPalette(THEME_DETAIL_FALLBACK_PALETTE, DARK_DETAIL_FOREGROUND);
      }
    };

    image.onerror = () => {
      if (!cancelled) {
        applyNextPalette(THEME_DETAIL_FALLBACK_PALETTE, DARK_DETAIL_FOREGROUND);
      }
    };

    return () => {
      cancelled = true;
    };
  }, [currentTrackId, currentTrackName, currentCoverUrl]);

  const listenPanelContent = (
    <>
      <div className="listen-card-head">
        <span>一起听</span>
        <small>{listenRoom ? `${listenRoom.members.length} 人在线房间` : listenConnectionState === "error" ? "连接异常" : "多人同步播放"}</small>
      </div>
      {listenPanelOpen ? (
        <div className="listen-panel">
          {listenRoom ? (
            <>
              <div className="listen-room-code">
                <strong>{listenRoom.inviteCode}</strong>
                <button type="button" onClick={() => void handleCopyListenInvite()}>
                  复制
                </button>
              </div>
              <div className="listen-member-row">
                {listenRoom.members.slice(0, 6).map((member) => (
                  <UserAvatar key={member.user.id} user={member.user} size="sm" className={member.online ? "online" : ""} />
                ))}
                {listenRoom.members.length > 6 ? <span className="listen-member-more">+{listenRoom.members.length - 6}</span> : null}
              </div>
              <p className="listen-status">
                {listenConnectionState === "connected" ? "已同步" : listenConnectionState === "reconnecting" ? "重连中" : "连接中"}
                {listenRoom.lastActor ? ` · 由 ${listenRoom.lastActor.nickname || listenRoom.lastActor.email} 更新` : ""}
              </p>
              <button type="button" className="ghost listen-wide-btn" onClick={() => void handleLeaveListenRoom()} disabled={listenBusy}>
                离开房间
              </button>
            </>
          ) : (
            <>
              <button type="button" className="listen-wide-btn" onClick={() => void handleCreateListenRoom()} disabled={listenBusy || authStatus !== "authenticated"}>
                创建一起听
              </button>
              <div className="listen-join-row">
                <input
                  value={listenInviteInput}
                  placeholder="输入邀请码"
                  onChange={(event) => setListenInviteInput(event.target.value.toUpperCase())}
                />
                <button type="button" onClick={() => void handleJoinListenRoom()} disabled={listenBusy || authStatus !== "authenticated"}>
                  加入
                </button>
              </div>
              {authStatus !== "authenticated" ? <p className="listen-status">登录后可使用一起听。</p> : null}
            </>
          )}
          {listenMessage ? <p className="listen-status warning">{listenMessage}</p> : null}
        </div>
      ) : (
        <button type="button" className="listen-wide-btn" onClick={() => setListenPanelOpen(true)}>
          {listenRoom ? "查看房间" : "开始一起听"}
        </button>
      )}
    </>
  );

  const playerDock = (
    <footer
      ref={playerDockRef}
      className={`spotify-player-bar ${canOpenDetail ? "clickable" : "empty"}`.trim()}
      data-disabled={!canOpenDetail}
      onClick={(event) => {
        if (canOpenDetail) {
          openDetail(event.currentTarget, event.detail === 0 ? "keyboard" : "pointer");
        }
      }}
    >
      <div className="spotify-player-left">
        <p className="player-title">{currentTrack?.name ?? ""}</p>
        <p className="player-subtitle">{currentTrack?.artists.map((item) => item.name).join(" / ") ?? ""}</p>
      </div>

      <div className="spotify-player-center">
        <div className="spotify-player-controls">
          <IconButton ariaLabel="一起听" title="一起听" onClick={() => setListenPanelOpen((previous) => !previous)} className={listenRoom ? "active" : "ghost"}>
            <span className="icon-text">听</span>
          </IconButton>
          <IconButton ariaLabel="打开播放队列" title="打开播放队列" onClick={openQueuePanel} className="ghost">
            <QueueIcon />
          </IconButton>
          <IconButton ariaLabel="上一首" title="上一首" disabled={controlDisabled} onClick={() => player.previousTrackByUser()} className="ghost">
            <PreviousIcon />
          </IconButton>
          <IconButton
            ariaLabel={player.isPlaying ? "暂停" : "播放"}
            title={player.isPlaying ? "暂停" : "播放"}
            className="play-main"
            disabled={controlDisabled}
            onClick={() => player.togglePlay()}
          >
            {controller.loadingSource ? <Spinner /> : player.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrackByUser()} className="ghost">
            <NextIcon />
          </IconButton>
          <IconButton ariaLabel={modeMeta.label} title={modeMeta.label} disabled={controlDisabled} onClick={() => player.nextMode()} className="ghost">
            {modeMeta.icon}
          </IconButton>
        </div>
        <div className="spotify-progress-row">
          <span>{formatMs(player.currentTimeMs)}</span>
          <input
            className="range-slider range-progress"
            type="range"
            min={0}
            max={Math.max(player.durationMs, 1)}
            value={Math.min(player.currentTimeMs, Math.max(player.durationMs, 1))}
            style={{
              background: `linear-gradient(90deg, var(--brand) 0%, var(--brand) ${progressPercent}%, rgba(255,255,255,0.22) ${progressPercent}%, rgba(255,255,255,0.22) 100%)`
            }}
            onChange={(event) => controller.seekTo(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <span>{formatMs(player.durationMs)}</span>
        </div>
      </div>

      {!isMobileUi ? (
        <div className="spotify-player-right">
          <IconButton ariaLabel={isMuted ? "取消静音" : "静音"} title={isMuted ? "取消静音" : "静音"} onClick={toggleMute} className={isMuted ? "warn" : "ghost"}>
            <VolumeIcon muted={isMuted} />
          </IconButton>
          <input
            className="range-slider range-volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume}
            style={{
              background: `linear-gradient(90deg, var(--brand) 0%, var(--brand-strong) ${volumePercent}%, rgba(255,255,255,0.22) ${volumePercent}%, rgba(255,255,255,0.22) 100%)`
            }}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <span>{Math.round(player.volume * 100)}%</span>
        </div>
      ) : null}
    </footer>
  );

  const themeSwitchControl = (
    <button
      type="button"
      className={`theme-switch ${theme === "light" ? "is-light" : "is-dark"}`.trim()}
      aria-label={theme === "dark" ? "切换到明亮主题" : "切换到暗色主题"}
      aria-pressed={theme === "light"}
      onClick={toggleTheme}
    >
      <span className="theme-switch-icon sun" aria-hidden="true">
        <SunIcon />
      </span>
      <span className="theme-switch-icon moon" aria-hidden="true">
        <MoonIcon />
      </span>
      <span className="theme-switch-thumb" aria-hidden="true">
        <span className="theme-switch-thumb-icon">{theme === "light" ? <SunIcon /> : <MoonIcon />}</span>
      </span>
    </button>
  );

  const accountDisplayName = authUser?.nickname?.trim() || authUser?.email || "游客";
  const hasAuthRefreshIssue = Boolean(authRefreshIssue && authStatus !== "authenticated");
  const accountStateText = hasAuthRefreshIssue ? "连接异常" : authStatus === "authenticated" ? syncStateLabel(authSyncState) : authStatusLabel(authStatus);
  const showMainNowPlaying = isMobileUi && activeTab === "search";

  const librarySegmentedPillStyle = {
    "--lib-seg-thumb-x": `${librarySegmentedThumb.x}px`,
    "--lib-seg-thumb-w": `${librarySegmentedThumb.width}px`,
    "--lib-seg-count": LIBRARY_VIEW_OPTIONS.length
  } as CSSProperties;

  const nowPlayingMergedPanel = (
    <section className={`now-playing-merged glass-surface ${isMobileUi ? "compact-mobile" : ""}`.trim()}>
      <div className="now-playing-merged-main">
        {!isMobileUi ? (
          <div className="now-playing-merged-cover">
            <div className={`vinyl spinning ${player.isPlaying ? "" : "paused"}`.trim()}>
              <div
                className="vinyl-cover"
                role="img"
                aria-label={currentTrack?.name ?? "默认封套"}
                style={{ backgroundImage: `url(${resolveTrackCover(currentTrack)})` }}
              />
            </div>
          </div>
        ) : null}
        <div className="now-playing-merged-meta">
          <h3>{currentTrack?.name ?? "还没有播放任何歌曲"}</h3>
          <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先搜索并播放歌曲"}</p>
          {!isMobileUi ? (
            <div className="now-state-row">
              <span className={`status-pill ${player.isPlaying ? "live" : ""}`}>{player.isPlaying ? "播放中" : "已暂停"}</span>
              <span className="status-pill">{modeMeta.label}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="now-playing-merged-actions">
        <div className="spotify-player-controls compact">
          <IconButton ariaLabel="一起听" title="一起听" onClick={() => setListenPanelOpen((previous) => !previous)} className={listenRoom ? "active" : "ghost"}>
            <span className="icon-text">听</span>
          </IconButton>
          {!isMobileUi ? (
            <IconButton
              ariaLabel={modeMeta.label}
              title={modeMeta.label}
              disabled={controlDisabled}
              onClick={() => player.nextMode()}
              className="ghost"
            >
              {modeMeta.icon}
            </IconButton>
          ) : null}
          <IconButton
            ariaLabel={player.isPlaying ? "暂停" : "播放"}
            title={player.isPlaying ? "暂停" : "播放"}
            className="play-main"
            disabled={controlDisabled}
            onClick={() => player.togglePlay()}
          >
            {controller.loadingSource ? <Spinner /> : player.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          {!isMobileUi ? (
            <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrackByUser()} className="ghost">
              <NextIcon />
            </IconButton>
          ) : null}
        </div>
        {canOpenDetail ? (
          <button className="now-playing-merged-detail-btn" onClick={(event) => openDetail(event.currentTarget, event.detail === 0 ? "keyboard" : "pointer")}>
            展开详情
          </button>
        ) : (
          <button className="now-playing-merged-detail-btn empty-cta" onClick={() => goTab("search")}>
            去搜索音乐
          </button>
        )}
      </div>
    </section>
  );

  return (
    <main ref={shellRef} className="spotify-shell">
      <audio ref={controller.audioRef} preload="auto" />
      {listenPanelOpen && (isMobileUi || !isAccountEnabled) ? (
        <section className="listen-floating-panel" aria-label="一起听房间">
          {listenPanelContent}
        </section>
      ) : null}

      <section className="spotify-layout">
        <aside className="spotify-sidebar">
          <div className="spotify-logo">MiningQwQ Music</div>
          <div className="spotify-nav-row">
            <nav className="spotify-nav">
              <button
                className={activeTab === "home" ? "active" : ""}
                onClick={() => {
                  setHomePlaylistView("featured");
                  goTab("home");
                }}
              >
                主页
              </button>
              <button className={activeTab === "search" ? "active" : ""} onClick={() => goTab("search")}>
                搜索
              </button>
              <button className={activeTab === "library" ? "active" : ""} onClick={() => goTab("library", "library-favorites")}>
                你的音乐库
              </button>
            </nav>
            {isMobileUi ? (
              <div className="sidebar-mobile-tools">
                {isAccountEnabled ? (
                  <button
                    type="button"
                    className="sidebar-mobile-account-toggle sidebar-mobile-account-btn"
                    onClick={() => {
                      if (authStatus === "authenticated") {
                        void handleLogout();
                        return;
                      }
                      openLoginDialog();
                    }}
                  >
                    {authStatus === "authenticated" ? (
                      <>
                        <UserAvatar user={authUser} size="sm" />
                        <span>退出登录</span>
                      </>
                    ) : (
                      "登录同步"
                    )}
                  </button>
                ) : null}
                <div className="theme-switch-mobile compact">{themeSwitchControl}</div>
              </div>
            ) : null}
          </div>
          {isMobileUi && hasAuthRefreshIssue ? (
            <div className="account-refresh-warning mobile-inline">
              <p>{authRefreshIssue}</p>
              <button type="button" onClick={() => void handleAuthRefreshRetry()}>
                重试连接
              </button>
            </div>
          ) : null}

          <section className="spotify-collections">
            <h3>我的音乐</h3>
            <div className="sidebar-entry-list">
              <button
                className={`sidebar-entry ${activeTab === "library" && libraryView === "library-favorites" ? "active" : ""}`.trim()}
                onClick={() => goTab("library", "library-favorites")}
              >
                <span>收藏歌曲</span>
                <small>{Object.keys(player.favorites).length} 首</small>
                <em>›</em>
              </button>
              <button
                className={`sidebar-entry ${activeTab === "library" && libraryView === "library-recent" ? "active" : ""}`.trim()}
                onClick={() => goTab("library", "library-recent")}
              >
                <span>最近播放</span>
                <small>{player.recent.length} 首</small>
                <em>›</em>
              </button>
              <button
                className={`sidebar-entry ${activeTab === "library" && libraryView === "library-playlists" ? "active" : ""}`.trim()}
                onClick={() => goTab("library", "library-playlists")}
              >
                <span>我的歌单</span>
                <small>{importedPlaylists.length} 个</small>
                <em>›</em>
              </button>
            </div>
            {isAccountEnabled ? (
              <div className="account-switch-card">
                <span>账号同步</span>
                <div className="account-switch-body">
                  <UserAvatar user={authUser} size="md" />
                  <div className="account-switch-meta">
                    <strong>{accountDisplayName}</strong>
                    <small>{accountStateText}</small>
                  </div>
                  {authStatus === "authenticated" ? (
                    <div className="account-switch-actions">
                      <input
                        ref={avatarInputRef}
                        className="account-avatar-input"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(event) => void handleAvatarFileChange(event.target.files?.[0])}
                      />
                      <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                        {avatarUploading ? "上传中" : "头像"}
                      </button>
                      {authUser?.avatarUrl ? (
                        <button type="button" className="ghost" onClick={() => void handleDeleteAvatar()} disabled={avatarUploading}>
                          移除
                        </button>
                      ) : null}
                      <button type="button" className="ghost" onClick={() => void handleLogout()}>
                        退出
                      </button>
                    </div>
                  ) : (
                    <div className="account-switch-actions">
                      <button
                        type="button"
                        onClick={openLoginDialog}
                      >
                        登录同步
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={openRegisterDialog}
                      >
                        注册
                      </button>
                    </div>
                  )}
                </div>
                {authNotice ? <p className="account-switch-tip">{authNotice}</p> : null}
                {authErrorMessage ? <p className="account-switch-tip error">{authErrorMessage}</p> : null}
                {hasAuthRefreshIssue ? (
                  <div className="account-refresh-warning">
                    <p>{authRefreshIssue}</p>
                    <button type="button" onClick={() => void handleAuthRefreshRetry()}>
                      重试连接
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {isAccountEnabled ? (
              <div className="listen-card">
                {listenPanelContent}
              </div>
            ) : null}
            {!isMobileUi ? (
              <div className="theme-switch-card">
                <span>网页主题</span>
                {themeSwitchControl}
              </div>
            ) : null}
          </section>
        </aside>

        <section className={`spotify-main tab-${activeTab} ${showMainNowPlaying ? "has-now-playing" : ""}`.trim()}>
          {showMainNowPlaying ? nowPlayingMergedPanel : null}

          {activeTab === "home" ? (
            <>
              <header className={`home-toolbar ${isMobileUi ? "mobile-priority" : ""}`.trim()}>
                <div className="home-toolbar-main">
                  <h1>发现音乐</h1>
                  <p>精选内容与你的播放偏好</p>
                </div>
                <div className={`home-toolbar-actions ${isMobileUi ? "mobile-cta" : ""}`.trim()}>
                  <button className="primary" onClick={() => goTab("search")}>搜索音乐</button>
                  <button onClick={() => goTab("library")}>我的音乐库</button>
                </div>
              </header>
              {isMobileUi ? nowPlayingMergedPanel : null}

              {homePlaylistView === "featured" ? (
                <>
                  <section
                    ref={homeChannelGridRef}
                    className="home-channel-row"
                    style={{ "--home-grid-columns": homeChannelPlan.columns } as CSSProperties}
                  >
                    {visibleChannelItems.map((item, index) => (
                      <button
                        key={`discover-channel-${item.id}-${index}`}
                        className="home-channel-card"
                        onClick={() => {
                          void handleDiscoverItem(item);
                        }}
                      >
                        <div className="home-channel-cover" style={{ backgroundImage: `url(${item.coverUrl ?? DEFAULT_COVER_URL})` }} />
                        <span className="home-channel-tag">推荐频道</span>
                        <h3>{item.title}</h3>
                        <p>{visibleSubtitle(item.subtitle, "精选内容推荐")}</p>
                      </button>
                    ))}
                    {!visibleChannelItems.length ? (
                      <article className="home-channel-card placeholder">
                        <span className="home-channel-tag">今日推荐</span>
                        <h3>还没有播放任何歌曲</h3>
                        <p>去搜索页选择喜欢的歌曲，马上开始播放</p>
                        <button
                          className="home-channel-cta"
                          onClick={() => {
                            if (hasTrack) {
                              player.togglePlay();
                            } else {
                              goTab("search");
                            }
                          }}
                        >
                          {heroActionLabel(hasTrack, player.isPlaying)}
                        </button>
                      </article>
                    ) : null}
                  </section>

                  <section className="home-playlist-section">
                    <div className="home-section-head">
                      <h2>推荐歌单</h2>
                      <button onClick={() => setHomePlaylistView("more")}>查看更多</button>
                    </div>
                    <div
                      ref={homePlaylistGridRef}
                      className="home-playlist-grid"
                      style={{ "--home-grid-columns": homePlaylistPlan.columns } as CSSProperties}
                    >
                      {visiblePlaylistItems.map((item, index) => (
                        <button
                          key={`playlist-discover-${item.id}-${index}`}
                          className="home-playlist-card"
                          onClick={() => {
                            void handleDiscoverItem(item);
                          }}
                        >
                          <div className="home-playlist-cover" style={{ backgroundImage: `url(${item.coverUrl ?? DEFAULT_COVER_URL})` }} />
                          <h3>{item.title}</h3>
                          <p>{visibleSubtitle(item.subtitle, "推荐歌单")}</p>
                        </button>
                      ))}
                      {!visiblePlaylistItems.length ? (
                        <p className="spotify-empty">还没有可推荐内容，先去搜索并播放一首歌吧。</p>
                      ) : null}
                    </div>
                  </section>

                  <section className="home-event-section">
                    <div className="home-section-head">
                      <h2>精选活动</h2>
                    </div>
                    <div
                      ref={homeEventGridRef}
                      className="home-event-grid"
                      style={{ "--home-grid-columns": homeEventPlan.columns } as CSSProperties}
                    >
                      {visibleEventItems.map((item, index) => (
                        <button
                          key={`event-${item.id}-${index}`}
                          className="home-playlist-card home-event-card-square"
                          onClick={() => {
                            void handleDiscoverItem(item);
                          }}
                        >
                          <div className="home-playlist-cover" style={{ backgroundImage: `url(${item.coverUrl ?? DEFAULT_COVER_URL})` }} />
                          <h3>{item.title}</h3>
                          <p>{visibleSubtitle(item.subtitle, "精选活动")}</p>
                        </button>
                      ))}
                      {!visibleEventItems.length ? (
                        <p className="spotify-empty">暂无精选活动，稍后再来看看。</p>
                      ) : null}
                    </div>
                    {discoverError ? <p className="error error-inline">{discoverError}</p> : null}
                  </section>
                </>
              ) : (
                <section className="home-playlist-section home-playlist-more-section">
                  <div className="home-section-head">
                    <h2>更多推荐歌单</h2>
                    <button onClick={() => setHomePlaylistView("featured")}>返回首页推荐</button>
                  </div>
                  <div
                    ref={homePlaylistGridRef}
                    className="home-playlist-grid"
                    style={{ "--home-grid-columns": Math.max(1, homePlaylistPlan.columns) } as CSSProperties}
                  >
                    {homePlaylistItems.map((item, index) => (
                      <button
                        key={`playlist-more-${item.id}-${index}`}
                        className="home-playlist-card"
                        onClick={() => {
                          void handleDiscoverItem(item);
                        }}
                      >
                        <div className="home-playlist-cover" style={{ backgroundImage: `url(${item.coverUrl ?? DEFAULT_COVER_URL})` }} />
                        <h3>{item.title}</h3>
                        <p>{visibleSubtitle(item.subtitle, "推荐歌单")}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

            </>
          ) : null}

          {activeTab === "search" ? (
            <section className="spotify-results glass-surface search-results-shell">
              <div className="search-sticky-head">
                <div className="spotify-section-title">
                  <h2>搜索音乐</h2>
                  <span>支持歌曲、歌手、专辑关键词</span>
                </div>

                <form
                  className="spotify-search-panel"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void doSearch();
                  }}
                >
                  <input
                    ref={searchInputRef}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder={
                      searchAssist?.defaultKeyword ? `试试：${searchAssist.defaultKeyword}` : "例如：林俊杰、修炼爱情"
                    }
                  />
                  <button type="submit" disabled={searchStatus === "loading"}>
                    {searchStatus === "loading" ? (
                      <>
                        <Spinner />
                        搜索中
                      </>
                    ) : (
                      "搜索"
                    )}
                  </button>
                </form>
                <div className={`search-mode-switch mode-${searchMode}`} role="tablist" aria-label="搜索类型切换">
                  <span className="search-mode-switch-thumb" aria-hidden="true" />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={searchMode === "track"}
                    className={searchMode === "track" ? "active" : ""}
                    onClick={() => switchSearchMode("track")}
                  >
                    单曲
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={searchMode === "artist"}
                    className={searchMode === "artist" ? "active" : ""}
                    onClick={() => switchSearchMode("artist")}
                  >
                    歌手
                  </button>
                </div>
                {searchAssist ? (
                  <div className="search-assist-block">
                    {searchAssist.hotKeywords.length ? (
                      <div className="search-assist-row">
                        <span>热搜</span>
                        <div ref={hotAssistRowRef}>
                          {hotAssistCandidates.slice(0, visibleHotAssistCount).map((hot) => (
                            <button
                              key={`hot-${hot}`}
                              type="button"
                              onClick={() => applyKeywordAndSearch(hot)}
                            >
                              {hot}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {searchAssist.suggestions.length ? (
                      <div className="search-assist-row">
                        <span>联想</span>
                        <div ref={suggestAssistRowRef}>
                          {suggestAssistCandidates.slice(0, visibleSuggestAssistCount).map((suggestion) => (
                            <button
                              key={`suggest-${suggestion}`}
                              type="button"
                              onClick={() => applyKeywordAndSearch(suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="search-results-body">
                {searchMode === "track" ? (
                  <>
                    <div className="spotify-track-table-head">
                      <span>歌曲</span>
                      <span>专辑</span>
                      <span className="align-right">时长</span>
                      <span className="align-center">操作</span>
                    </div>
                    <div className="spotify-track-list">
                      {searchStatus === "loading"
                        ? Array.from({ length: 5 }).map((_, index) => (
                            <div key={`skeleton-track-${index}`} className="track-skeleton-row" aria-hidden="true">
                              <div />
                              <div />
                              <div />
                              <div />
                            </div>
                          ))
                        : null}

                      {trackResult.map((track) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          liked={Boolean(favoriteSet[track.id])}
                          currentTrackId={currentTrackId}
                          isPlaying={player.isPlaying}
                          onPlay={(item) => {
                            player.playTrackNow(item);
                            player.setPlaying(true);
                          }}
                          onToggleFavorite={(item) => player.toggleFavorite(item)}
                        />
                      ))}

                      {searchStatus === "idle" ? <p className="spotify-empty">输入关键词开始搜索，例如“林俊杰”或“修炼爱情”。</p> : null}
                      {searchStatus === "empty" ? <p className="spotify-empty">没有找到匹配结果，换个关键词试试。</p> : null}
                      {searchStatus === "error" ? <p className="error error-inline">{searchError}</p> : null}
                    </div>
                  </>
                ) : (
                  <div className="spotify-track-list">
                    {searchArtistDetail ? (
                      <section className="artist-detail-panel">
                      <header className="artist-detail-head">
                        <button
                          type="button"
                          className="meta-action-btn"
                          onClick={() => {
                            setSearchArtistDetail(null);
                            setSearchArtistDetailError(null);
                            setSearchArtistDetailLoading(false);
                          }}
                        >
                          返回歌手列表
                        </button>
                        <div className="artist-detail-profile">
                          <div
                            className="artist-detail-cover"
                            style={{ backgroundImage: `url(${searchArtistDetail.coverUrl ?? DEFAULT_COVER_URL})` }}
                          />
                          <div>
                            <h3>{searchArtistDetail.name}</h3>
                            <p>{searchArtistDetail.briefDesc ? searchArtistDetail.briefDesc.slice(0, 120) : "暂无歌手简介"}</p>
                          </div>
                        </div>
                        <div className="artist-detail-actions">
                          <button type="button" className="meta-action-btn" onClick={() => playArtistTopTracks(searchArtistDetail)}>
                            播放热门单曲
                          </button>
                          <button type="button" className="meta-action-btn" onClick={() => addArtistTopTracksToQueue(searchArtistDetail)}>
                            加入队列
                          </button>
                        </div>
                      </header>
                      <div className="spotify-track-table-head">
                        <span>歌曲</span>
                        <span>专辑</span>
                        <span className="align-right">时长</span>
                        <span className="align-center">操作</span>
                      </div>
                      <div className="spotify-track-list">
                        {searchArtistDetail.topTracks.map((track) => (
                          <TrackRow
                            key={`artist-track-${track.id}`}
                            track={track}
                            liked={Boolean(favoriteSet[track.id])}
                            currentTrackId={currentTrackId}
                            isPlaying={player.isPlaying}
                            onPlay={(item) => {
                              player.playTrackNow(item);
                              player.setPlaying(true);
                            }}
                            onToggleFavorite={(item) => player.toggleFavorite(item)}
                          />
                        ))}
                        {!searchArtistDetail.topTracks.length ? <p className="spotify-empty">该歌手暂无可播放热门单曲。</p> : null}
                      </div>
                    </section>
                  ) : (
                    <>
                      {searchStatus === "loading"
                        ? Array.from({ length: 5 }).map((_, index) => (
                            <div key={`skeleton-artist-${index}`} className="artist-search-skeleton-row" aria-hidden="true">
                              <div />
                              <div />
                              <div />
                            </div>
                          ))
                        : null}
                      {artistResult.map((artist) => (
                        <ArtistSearchRow key={artist.id} artist={artist} onOpen={(item) => void openSearchArtistDetail(item)} />
                      ))}
                      {searchStatus === "idle" ? <p className="spotify-empty">输入关键词开始搜索歌手，例如“邓紫棋”。</p> : null}
                      {searchStatus === "empty" ? <p className="spotify-empty">没有找到匹配歌手，换个关键词试试。</p> : null}
                      {searchStatus === "error" ? <p className="error error-inline">{searchError}</p> : null}
                      {searchArtistDetailLoading ? <p className="spotify-empty">歌手详情加载中...</p> : null}
                      {searchArtistDetailError ? <p className="error error-inline">{searchArtistDetailError}</p> : null}
                    </>
                    )}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "library" ? (
            <section className="spotify-results glass-surface library-hub">
              <header className="library-hub-head">
                <div>
                  <h2>你的音乐库</h2>
                </div>
                <div
                  className={`library-segmented-pill ${librarySegmentedThumb.ready ? "ready" : ""}`.trim()}
                  ref={librarySegmentedRef}
                  style={librarySegmentedPillStyle}
                  role="tablist"
                  aria-label="音乐库分类切换"
                >
                  <span className="library-segmented-pill-thumb" aria-hidden="true" />
                  {LIBRARY_VIEW_OPTIONS.map((option) => {
                    const active = libraryView === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`library-segmented-pill-btn ${active ? "active" : ""}`.trim()}
                        data-library-view={option.value}
                        role="tab"
                        aria-selected={active}
                        onClick={() => setLibraryView(option.value)}
                      >
                        <span className="library-segmented-pill-label">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </header>

              <div className={`library-content-switcher phase-${libraryContentTransitionPhase}`.trim()}>
                {displayedLibraryView === "library-favorites" ? (
                  <section className="library-list-block">
                    <div className="library-list-head">
                      <h3>收藏歌曲</h3>
                      <span>{Object.keys(player.favorites).length} 首</span>
                    </div>
                    <div className="spotify-track-list library-track-list">
                      {Object.values(player.favorites).map((track) => (
                        <TrackRow
                          key={`fav-${track.id}`}
                          track={track}
                          liked={Boolean(favoriteSet[track.id])}
                          currentTrackId={currentTrackId}
                          isPlaying={player.isPlaying}
                          onPlay={(item) => {
                            player.playTrackNow(item);
                            player.setPlaying(true);
                          }}
                          onToggleFavorite={(item) => player.toggleFavorite(item)}
                        />
                      ))}
                      {Object.keys(player.favorites).length === 0 ? <p className="spotify-empty">你还没有收藏歌曲。</p> : null}
                    </div>
                  </section>
                ) : null}

                {displayedLibraryView === "library-recent" ? (
                  <section className="library-list-block">
                    <div className="library-list-head">
                      <h3>最近播放</h3>
                      <span>{player.recent.length} 首</span>
                    </div>
                    <div className="spotify-track-list library-track-list">
                      {player.recent.map((track) => (
                        <TrackRow
                          key={`recent-${track.id}`}
                          track={track}
                          liked={Boolean(favoriteSet[track.id])}
                          currentTrackId={currentTrackId}
                          isPlaying={player.isPlaying}
                          onPlay={(item) => {
                            player.playTrackNow(item);
                            player.setPlaying(true);
                          }}
                          onToggleFavorite={(item) => player.toggleFavorite(item)}
                        />
                      ))}
                      {player.recent.length === 0 ? <p className="spotify-empty">你还没有播放记录。</p> : null}
                    </div>
                  </section>
                ) : null}

                {displayedLibraryView === "library-playlists" ? (
                  <section className="library-list-block">
                    <div className="library-list-head">
                      <h3>我的歌单</h3>
                      <span>{importedPlaylists.length} 个</span>
                    </div>
                    <div className="library-import-row">
                      <input
                        ref={importPlaylistInputRef}
                        value={importPlaylistInput}
                        onChange={(event) => setImportPlaylistInput(event.target.value)}
                        placeholder="粘贴网易云歌单链接、分享文案或歌单 ID"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void importPlaylistFromInput();
                          }
                        }}
                      />
                      <button type="button" disabled={importPlaylistState.loading} onClick={() => void importPlaylistFromInput()}>
                        {importPlaylistState.loading ? "导入中..." : "导入歌单"}
                      </button>
                    </div>
                    {importPlaylistState.message ? <p className="library-import-message success">{importPlaylistState.message}</p> : null}
                    {importPlaylistState.error ? <p className="library-import-message error">{importPlaylistState.error}</p> : null}
                    <div className="library-imported-list">
                      {importedPlaylists.map((playlist) => (
                        <article className="library-imported-item" key={`imported-${playlist.id}`}>
                          <div className="library-imported-cover" style={{ backgroundImage: `url(${playlist.coverUrl ?? DEFAULT_COVER_URL})` }} />
                          <div className="library-imported-meta">
                            <h4>{playlist.name}</h4>
                            <p>{visibleSubtitle(playlist.description, "已导入歌单")}</p>
                            <small>{playlist.tracks.length} 首 · 更新于 {new Date(playlist.updatedAt).toLocaleString()}</small>
                          </div>
                          <div className="library-imported-actions">
                            <button type="button" onClick={() => openImportedPlaylistPanel(playlist)}>
                              打开
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!playlist.tracks.length) return;
                                player.setQueue(playlist.tracks, 0);
                                player.setPlaying(true);
                              }}
                            >
                              播放
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                if (!window.confirm(`确认删除歌单「${playlist.name}」吗？`)) return;
                                player.removeImportedPlaylist(playlist.id);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))}
                      {!importedPlaylists.length ? <p className="spotify-empty">还没有导入歌单，先粘贴一个网易云分享链接试试。</p> : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>

        <aside className="spotify-right">
          <section className={`spotify-now-card ${!isMobileUi ? "lite" : ""}`.trim()}>
            <h2>正在播放</h2>
            <div className="now-state-row">
              <span className={`status-pill ${player.isPlaying ? "live" : ""}`}>{player.isPlaying ? "播放中" : "已暂停"}</span>
              <span className="status-pill">{modeMeta.label}</span>
            </div>
            <div className="spotify-now-cover">
              <div className={`vinyl spinning ${player.isPlaying ? "" : "paused"}`.trim()}>
                <div
                  className="vinyl-cover"
                  role="img"
                  aria-label={currentTrack?.name ?? "默认封套"}
                  style={{ backgroundImage: `url(${resolveTrackCover(currentTrack)})` }}
                />
              </div>
            </div>
            {!isMobileUi ? (
              <p className="spotify-now-lite-tip">
                {currentTrack ? "歌曲详情已在中间播放卡展示" : "请先在搜索页选择歌曲开始播放"}
              </p>
            ) : (
              <>
                <h3>{currentTrack?.name ?? "还没有播放任何歌曲"}</h3>
                <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先在搜索页选择歌曲开始播放"}</p>
              </>
            )}
            {controller.loadingSource ? (
              <p className="status-line">
                <Spinner />
                正在加载播放链接...
              </p>
            ) : null}
            {controller.errorText ? <p className="error">{controller.errorText}</p> : null}
          </section>

          {hasTrack ? (
            <>
              <section className="spotify-panel">
                <h2>歌词</h2>
                <div className="spotify-lyric-box">
                  {!controller.lyricLines.length ? (
                    <p>暂无歌词或纯音乐</p>
                  ) : (
                    controller.lyricLines.map((line, index) => (
                      <p key={`${line.timeMs}-${index}`} className={index === controller.lyricIndex ? "active" : ""}>
                        {line.text}
                      </p>
                    ))
                  )}
                </div>
              </section>

              <section className="spotify-panel">
                <h2>播放队列</h2>
                <div className="spotify-queue-list">
                  {player.queue.map((track, index) => {
                    const playing = track.id === currentTrackId;
                    return (
                      <button
                        key={`${track.id}-${index}`}
                        className={`spotify-queue-item ${playing ? "active" : ""}`}
                        onClick={() => {
                          player.setQueue(player.queue, index);
                          player.setPlaying(true);
                        }}
                      >
                        <span className="spotify-queue-item-main">
                          <span>{track.name}</span>
                          {playing ? <PlayingIndicator active={player.isPlaying} /> : null}
                        </span>
                        <span>{track.artists.map((item) => item.name).join(" / ")}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
        </aside>
      </section>

      {dockPortalTarget ? createPortal(playerDock, dockPortalTarget) : playerDock}

      {playlistPortalTarget && homePlaylistPanel && homePlaylistPhase !== "closed"
        ? createPortal(
            <section
              className={`home-playlist-drawer-overlay phase-${homePlaylistPhase}`.trim()}
              role="dialog"
              aria-modal="true"
              aria-label={homePlaylistPanel.sourceType === "queue" ? "播放队列" : "歌单详情"}
            >
              <div className={`home-playlist-drawer-backdrop phase-${homePlaylistPhase}`.trim()} onClick={closeHomePlaylistPanel} />
              <aside
                ref={homePlaylistDrawerRef}
                className={`home-playlist-drawer phase-${homePlaylistPhase} source-${homePlaylistPanel.sourceType} ${
                  homePlaylistPanel.sourceType === "queue" && homePlaylistPanel.tracks.length < 5 ? "compact-list" : ""
                }`.trim()}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => trapTabWithin(homePlaylistDrawerRef.current, event)}
              >
                <header className="home-playlist-drawer-head">
                  <div className="home-playlist-drawer-cover" style={{ backgroundImage: `url(${homePlaylistPanel.coverUrl ?? DEFAULT_COVER_URL})` }} />
                  <div className="home-playlist-drawer-meta">
                    <span>
                      {homePlaylistPanel.sourceType === "queue"
                        ? "当前播放"
                        : homePlaylistPanel.sourceType === "toplist"
                        ? "热播榜单"
                        : homePlaylistPanel.sourceType === "imported"
                          ? "我的歌单"
                          : "推荐歌单"}
                    </span>
                    <h3>{homePlaylistPanel.title}</h3>
                    <div className={`home-playlist-summary ${playlistSummaryExpanded ? "expanded" : ""}`.trim()}>
                      <p ref={playlistSummaryRef}>{homePlaylistSubtitle}</p>
                    </div>
                    {playlistSummaryOverflowing ? (
                      <button
                        type="button"
                        className="home-playlist-summary-toggle"
                        onClick={() => setPlaylistSummaryExpanded((previous) => !previous)}
                      >
                        {playlistSummaryExpanded ? "收起" : "展开"}
                      </button>
                    ) : null}
                  </div>
                </header>

                <div className="home-playlist-drawer-actions">
                  {homePlaylistPanel.sourceType !== "queue" ? (
                    <>
                      <button type="button" onClick={playHomePlaylistAll} disabled={homePlaylistPanel.loading || !homePlaylistPanel.tracks.length}>
                        播放全部
                      </button>
                      {!isMobileUi ? (
                        <button type="button" onClick={addHomePlaylistToQueue} disabled={homePlaylistPanel.loading || !homePlaylistPanel.tracks.length}>
                          全部加入队列
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={locatePlayingTrackInPanel}
                    disabled={!canLocatePlayingTrack}
                    title={locatePlayingTrackButtonTitle}
                  >
                    定位正在播放
                  </button>
                  <button type="button" className="ghost" onClick={closeHomePlaylistPanel}>
                    关闭
                  </button>
                </div>

                <div className="home-playlist-drawer-list" ref={homePlaylistListRef}>
                  {homePlaylistPanel.loading ? (
                    <div className="home-playlist-skeleton-list" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div className="home-playlist-skeleton-row" key={`playlist-skeleton-${index}`}>
                          <div />
                          <div />
                          <div />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {homePlaylistPanel.error ? <p className="error error-inline">{homePlaylistPanel.error}</p> : null}
                  {!homePlaylistPanel.loading && !homePlaylistPanel.error && !homePlaylistPanel.tracks.length ? (
                    <p className="spotify-empty">{homePlaylistPanel.sourceType === "queue" ? "当前播放队列为空。" : "该歌单暂时没有可播放歌曲。"}</p>
                  ) : null}
                  {!homePlaylistPanel.loading && !homePlaylistPanel.error
                    ? homePlaylistPanel.tracks.map((track, index) => (
                        <article
                          className={`home-playlist-track-row ${track.id === currentTrackId ? "active" : ""} ${track.id === locatedPanelTrackId ? "located" : ""}`.trim()}
                          key={`panel-${track.id}-${index}`}
                          ref={bindPanelTrackRowRef(index)}
                          data-panel-track-index={index}
                        >
                          <div className="home-playlist-track-cover" style={{ backgroundImage: `url(${resolveTrackCover(track)})` }} />
                          <button
                            type="button"
                            className="home-playlist-track-play"
                            onClick={() => playHomePlaylistTrackAt(index)}
                          >
                            <span className="home-playlist-track-line">
                              <span>{`${index + 1}. ${track.name}`}</span>
                              {track.id === currentTrackId ? <PlayingIndicator active={player.isPlaying} /> : null}
                            </span>
                            <small>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</small>
                          </button>
                          {!isMobileUi && homePlaylistPanel.sourceType !== "queue" ? (
                            <button
                              type="button"
                              className="home-playlist-track-queue"
                              onClick={() => player.addToQueue(track, true)}
                            >
                              加入队列
                            </button>
                          ) : null}
                        </article>
                      ))
                    : null}
                </div>
              </aside>
            </section>,
            playlistPortalTarget
          )
        : null}

      {accountDialogOpen
        ? createPortal(
            <section className="account-dialog-overlay" role="dialog" aria-modal="true" aria-label="账号登录">
              <button type="button" className="account-dialog-backdrop" aria-label="关闭登录窗口" onClick={closeAccountDialog} />
              <form
                ref={accountDialogPanelRef}
                className={`account-dialog-panel ${isMobileUi ? "mobile" : "desktop"}`.trim()}
                tabIndex={-1}
                onKeyDown={(event) => trapTabWithin(accountDialogPanelRef.current, event)}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!authFormSubmitting) {
                    void submitAuthForm();
                  }
                }}
              >
                <header className="account-dialog-head">
                  <h3>{authFormMode === "login" ? "登录后可同步音乐库" : "创建账号并开启云同步"}</h3>
                  <button type="button" className="ghost" onClick={closeAccountDialog}>
                    关闭
                  </button>
                </header>
                <div className="account-dialog-tabs">
                  <button
                    type="button"
                    className={authFormMode === "login" ? "active" : ""}
                    disabled={authFormSubmitting}
                    onClick={() => {
                      setAuthFormMode("login");
                      setAuthFormError(null);
                    }}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className={authFormMode === "register" ? "active" : ""}
                    disabled={authFormSubmitting}
                    onClick={() => {
                      setAuthFormMode("register");
                      setAuthFormError(null);
                    }}
                  >
                    注册
                  </button>
                </div>
                <label className="account-form-label">
                  邮箱
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={authFormState.email}
                    disabled={authFormSubmitting}
                    onChange={(event) => setAuthFormState((previous) => ({ ...previous, email: event.target.value }))}
                  />
                </label>
                <label className="account-form-label">
                  密码
                  <input
                    type="password"
                    placeholder="至少 8 位"
                    value={authFormState.password}
                    disabled={authFormSubmitting}
                    onChange={(event) => setAuthFormState((previous) => ({ ...previous, password: event.target.value }))}
                  />
                </label>
                {authFormMode === "register" ? (
                  <label className="account-form-label">
                    昵称（可选）
                    <input
                      type="text"
                      placeholder="例如：MiningQwQ"
                      value={authFormState.nickname}
                      disabled={authFormSubmitting}
                      onChange={(event) => setAuthFormState((previous) => ({ ...previous, nickname: event.target.value }))}
                    />
                  </label>
                ) : null}
                {authFormError ? <p className="account-form-error">{authFormError}</p> : null}
                <button type="submit" className="account-form-submit" disabled={authFormSubmitting}>
                  {authFormSubmitting ? "处理中..." : authFormMode === "login" ? "登录并同步" : "注册并同步"}
                </button>
                <p className="account-form-note">未登录时继续本地保存；登录后自动开启云同步。</p>
              </form>
            </section>,
            document.body
          )
        : null}

      {isDetailMounted ? (
        <section className="player-detail-overlay" role="dialog" aria-modal="true" aria-label="播放详情">
          <div className={`player-detail-backdrop phase-${detailPhase}`.trim()} onClick={closeDetail} />
          <article
            ref={detailScreenRef}
            className={`player-detail-screen phase-${detailPhase}`.trim()}
            tabIndex={-1}
            onKeyDown={(event) => trapTabWithin(detailScreenRef.current, event)}
            style={
              {
                "--detail-cover": currentCoverUrl ? `url(${currentCoverUrl})` : "none",
                "--detail-bg-a": currentPalette.bgA,
                "--detail-bg-b": currentPalette.bgB,
                "--detail-glow": currentPalette.glow,
                "--detail-fg-main": detailForeground.main,
                "--detail-fg-sub": detailForeground.sub,
                "--detail-fg-soft": detailForeground.soft,
                "--detail-control-bg": detailForeground.controlBg,
                "--detail-control-border": detailForeground.controlBorder,
                "--detail-control-hover": detailForeground.controlHover,
                "--detail-control-active": detailForeground.controlActive,
                "--detail-overlay": detailForeground.overlay,
                "--detail-dock-bg": detailForeground.dockBg,
                "--detail-range-inactive": detailForeground.rangeInactive,
                "--detail-palette-transition-ms": `${PALETTE_TRANSITION_MS}ms`
              } as CSSProperties
            }
          >
            <div
              className={`detail-bg-layer current ${isPaletteTransitioning ? "transitioning" : ""}`.trim()}
              style={
                {
                  "--detail-layer-bg-a": currentPalette.bgA,
                  "--detail-layer-bg-b": currentPalette.bgB,
                  "--detail-layer-glow": currentPalette.glow
                } as CSSProperties
              }
            />
            {previousPalette ? (
              <div
                className={`detail-bg-layer previous ${isPaletteTransitioning ? "fading" : ""}`.trim()}
                style={
                  {
                    "--detail-layer-bg-a": previousPalette.bgA,
                    "--detail-layer-bg-b": previousPalette.bgB,
                    "--detail-layer-glow": previousPalette.glow
                  } as CSSProperties
                }
              />
            ) : null}
            <header className="detail-topbar">
              <button className="detail-collapse-btn" onClick={closeDetail} aria-label="收起播放器">
                <CollapseIcon />
              </button>
            </header>

            <div className="detail-stage">
              <section className="detail-stage-left">
                <div className="detail-turntable-wrap">
                  <div className={`detail-turntable spinning ${player.isPlaying ? "" : "paused"}`.trim()}>
                    <div className="detail-turntable-cover-mask">
                      <div className="detail-turntable-cover" style={{ backgroundImage: `url(${resolveTrackCover(currentTrack)})` }} />
                    </div>
                  </div>
                </div>
                <div className="detail-bottom-meta">
                  <h3>
                    <MarqueeText text={currentTrack?.name ?? "还没有播放任何歌曲"} />
                  </h3>
                  <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先在搜索页选择歌曲开始播放"}</p>
                </div>
                {!isMobileUi ? (
                  <div className="detail-tab-row">
                    <button className={detailTab === "lyric" ? "active" : ""} onClick={() => setDetailTab("lyric")}>
                      歌词
                    </button>
                    <button className={detailTab === "meta" ? "active" : ""} onClick={() => setDetailTab("meta")}>
                      歌曲信息
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="detail-stage-right">
                <div className="detail-title-block">
                  <h2>
                    <MarqueeText text={currentTrack?.name ?? "还没有播放任何歌曲"} />
                  </h2>
                  <p>
                    专辑：{currentTrack?.album?.name ?? "未知专辑"}　歌手：{currentTrack?.artists.map((item) => item.name).join(" / ") || "未知歌手"}
                  </p>
                </div>
                {isMobileUi ? (
                  <div className="detail-tab-row detail-tab-row-mobile">
                    <button className={detailTab === "lyric" ? "active" : ""} onClick={() => setDetailTab("lyric")} type="button">
                      歌词
                    </button>
                    <button className={detailTab === "meta" ? "active" : ""} onClick={() => setDetailTab("meta")} type="button">
                      歌曲信息
                    </button>
                  </div>
                ) : null}

                {detailTab === "meta" ? (
                  <div className="detail-meta-list">
                    <p>时长：{formatMs(currentTrack?.durationMs ?? 0)}</p>
                    {insightLoading ? <p>正在加载歌曲洞察...</p> : null}
                    {trackInsight?.creators.length ? (
                      <p>
                        创作者：
                        {isMobileUi
                          ? trackInsight.creators
                              .slice(0, 2)
                              .map((creator) => `${creator.name}${creator.role ? `（${creator.role}）` : ""}`)
                              .join(" / ")
                          : trackInsight.creators.map((creator) => `${creator.name}${creator.role ? `（${creator.role}）` : ""}`).join(" / ")}
                      </p>
                    ) : null}
                    {trackInsight?.wikiSummary ? (
                      <p>百科：{isMobileUi ? `${trackInsight.wikiSummary.slice(0, 56)}...` : trackInsight.wikiSummary}</p>
                    ) : null}
                    {trackInsight?.chorusStartMs ? (
                      <button
                        type="button"
                        className="meta-action-btn"
                        onClick={() => controller.seekTo(trackInsight.chorusStartMs ?? 0)}
                      >
                        跳转副歌（{formatMs(trackInsight.chorusStartMs)}）
                      </button>
                    ) : null}
                    {!isMobileUi ? (
                      <div className="download-row">
                        <label htmlFor="playback-level">播放音质</label>
                        <select
                          id="playback-level"
                          value={player.playQualityLevel}
                          onChange={(event) => player.setPlayQualityLevel(event.target.value as PlayQualityLevel)}
                        >
                          {PLAY_QUALITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <label htmlFor="playback-unblock">解灰模式</label>
                        <select
                          id="playback-unblock"
                          value={player.playUnblockMode}
                          onChange={(event) => player.setPlayUnblockMode(event.target.value as PlayUnblockMode)}
                        >
                          {PLAY_UNBLOCK_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {!isMobileUi ? (
                      <div className="download-row">
                        <label htmlFor="download-level">下载音质</label>
                        <select
                          id="download-level"
                          value={downloadState.level}
                          onChange={(event) =>
                            setDownloadState((previous) => ({
                              ...previous,
                              level: event.target.value
                            }))
                          }
                        >
                          <option value="standard">standard</option>
                          <option value="exhigh">exhigh</option>
                          <option value="lossless">lossless</option>
                          <option value="hires">hires</option>
                        </select>
                        <button
                          type="button"
                          className="meta-action-btn"
                          disabled={downloadState.loading || !currentTrack}
                          onClick={() => void handleDownloadTrack()}
                        >
                          {downloadState.loading ? "获取中..." : "获取下载链接"}
                        </button>
                      </div>
                    ) : null}
                    {isMobileUi ? (
                      <div className="download-row">
                        <label htmlFor="playback-level-mobile">播放音质</label>
                        <select
                          id="playback-level-mobile"
                          value={player.playQualityLevel}
                          onChange={(event) => player.setPlayQualityLevel(event.target.value as PlayQualityLevel)}
                        >
                          {PLAY_QUALITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <label htmlFor="playback-unblock-mobile">解灰模式</label>
                        <select
                          id="playback-unblock-mobile"
                          value={player.playUnblockMode}
                          onChange={(event) => player.setPlayUnblockMode(event.target.value as PlayUnblockMode)}
                        >
                          {PLAY_UNBLOCK_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {downloadState.message ? <p>{downloadState.message}</p> : null}
                  </div>
                ) : (
                  <div className="detail-lyric-shell">
                    {!isMobileUi ? (
                      <div className="detail-lyric-mode-row">
                        <button
                          className={detailLyricMode === "origin" ? "active" : ""}
                          onClick={() => setDetailLyricMode("origin")}
                          type="button"
                        >
                          原文
                        </button>
                        <button
                          className={detailLyricMode === "translated" ? "active" : ""}
                          onClick={() => setDetailLyricMode("translated")}
                          disabled={!controller.lyricTranslatedLines.length}
                          type="button"
                        >
                          翻译
                        </button>
                        <button
                          className={detailLyricMode === "karaoke" ? "active" : ""}
                          onClick={() => setDetailLyricMode("karaoke")}
                          disabled={!controller.lyricKaraokeLines.length}
                          type="button"
                        >
                          逐字
                        </button>
                      </div>
                    ) : null}
                    <div
                      className="detail-lyric-scroll polished"
                      ref={detailLyricRef}
                    >
                      {!activeDetailLyricLines.length ? (
                        <p className="detail-empty">暂无该版本歌词</p>
                      ) : (
                        <>
                          <div className="detail-lyric-spacer" aria-hidden="true" />
                          {activeDetailLyricLines.map((line, index) => (
                            <p
                              key={`${line.timeMs}-${index}`}
                              ref={bindLyricLineRef(index)}
                              className={`detail-lyric-line ${index === activeDetailLyricIndex ? "active" : ""}`}
                            >
                              {line.text}
                            </p>
                          ))}
                          <div className="detail-lyric-spacer" aria-hidden="true" />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <footer className="detail-dock">
              <div className="detail-progress-line">
                <input
                  className="range-slider range-progress"
                  type="range"
                  min={0}
                  max={Math.max(player.durationMs, 1)}
                  value={Math.min(player.currentTimeMs, Math.max(player.durationMs, 1))}
                  style={{
                    background: `linear-gradient(90deg, var(--detail-glow) 0%, var(--detail-glow) ${progressPercent}%, var(--detail-range-inactive) ${progressPercent}%, var(--detail-range-inactive) 100%)`
                  }}
                  onChange={(event) => controller.seekTo(Number(event.target.value))}
                />
              </div>

              <div className="detail-dock-row">
                {!isMobileUi ? (
                  <div className="detail-dock-song">
                    <b>
                      <MarqueeText text={currentTrack?.name ?? "未播放"} />
                    </b>
                    <span>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? ""}</span>
                  </div>
                ) : null}

                <div className="detail-dock-controls">
                  <IconButton ariaLabel="一起听" title="一起听" onClick={() => setListenPanelOpen((previous) => !previous)} className={listenRoom ? "active" : "ghost"}>
                    <span className="icon-text">听</span>
                  </IconButton>
                  <IconButton ariaLabel="打开播放队列" title="打开播放队列" onClick={openQueuePanelFromDetail} className="ghost">
                    <QueueIcon />
                  </IconButton>
                  <IconButton ariaLabel="上一首" title="上一首" disabled={controlDisabled} onClick={() => player.previousTrackByUser()} className="ghost">
                    <PreviousIcon />
                  </IconButton>
                  <IconButton
                    ariaLabel={player.isPlaying ? "暂停" : "播放"}
                    title={player.isPlaying ? "暂停" : "播放"}
                    className="play-main"
                    disabled={controlDisabled}
                    onClick={() => player.togglePlay()}
                  >
                    {controller.loadingSource ? <Spinner /> : player.isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </IconButton>
                  <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrackByUser()} className="ghost">
                    <NextIcon />
                  </IconButton>
                  <IconButton ariaLabel="循环" title="循环" onClick={() => player.nextMode()} className="ghost">
                    {modeMeta.icon}
                  </IconButton>
                </div>

                {!isMobileUi ? (
                  <div className="detail-dock-volume">
                    <IconButton
                      ariaLabel={isMuted ? "取消静音" : "静音"}
                      title={isMuted ? "取消静音" : "静音"}
                      onClick={toggleMute}
                      className={isMuted ? "warn" : "ghost"}
                    >
                      <VolumeIcon muted={isMuted} />
                    </IconButton>
                    <input
                      className="range-slider range-volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={player.volume}
                      style={{
                        background: `linear-gradient(90deg, var(--detail-glow) 0%, var(--detail-glow) ${volumePercent}%, var(--detail-range-inactive) ${volumePercent}%, var(--detail-range-inactive) 100%)`
                      }}
                      onChange={(event) => player.setVolume(Number(event.target.value))}
                    />
                  </div>
                ) : null}
              </div>
            </footer>
          </article>
        </section>
      ) : null}
    </main>
  );
}
