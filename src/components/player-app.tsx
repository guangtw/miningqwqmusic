"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import {
  overlayVariants,
  sheetMobileVariants,
  sheetVariants,
  withReducedMotion
} from "@/src/lib/motion-presets";
import {
  AccountApiError,
  acceptFriendRequest,
  acceptListenInvite,
  addFavoriteTrack,
  addRecentTrack,
  cancelFriendRequest,
  changeAccountPassword,
  createListenRoom,
  deleteFriend,
  deleteAccountAvatar,
  detectAccountServiceEnabled,
  getLibraryChanges,
  getLibrarySnapshot,
  getListenRoom,
  loadCurrentAccountUser,
  loginAccount,
  logoutAccount,
  heartbeatListenRoom,
  inviteFriendToListenRoom,
  joinListenRoom,
  leaveListenRoom,
  listFriendRequests,
  listFriends,
  listListenInvites,
  openListenRoomStream,
  registerAccount,
  rejectFriendRequest,
  rejectListenInvite,
  redeemMusicUnblockInvite,
  removeFavoriteTrack,
  removeImportedPlaylistCloud,
  searchFriends,
  sendFriendRequest,
  sendListenRoomState,
  tryRefreshAccessTokenDetailed,
  updateAccountProfile,
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
  getSearchAssist,
  getSportScene,
  getTrackDetail,
  getTrackDownloadUrl,
  getTrackInsight,
  getTrackQualityAvailability,
  getToplistDetail
} from "@/src/lib/client-api";
import { computeHomeGridPlan } from "@/src/lib/home-grid";
import { resolveCloudPullMode, shouldShowCloudSyncing, shouldSkipRecentCloudPull, type CloudPullOptions } from "@/src/lib/cloud-sync";
import { extractPlaylistId } from "@/src/lib/playlist-import";
import { beginPaletteTransition, deriveDetailForegroundTone, finishPaletteTransition, type DetailForegroundTone } from "@/src/lib/detail-palette-transition";
import { resolveDiscoverAction } from "@/src/lib/discover-action";
import { installDesktopHostBridge, requestDesktopHostAction, useDesktopHost } from "@/src/lib/desktop-host";
import { getSizedImageUrl } from "@/src/lib/image-url";
import { locateCurrentLyricIndex } from "@/src/lib/lyrics";
import { installShellChromeBridge, postShellChromeTokens } from "@/src/lib/shell-chrome";
import { getPlayQualityLabel, PLAY_QUALITY_LABELS } from "@/src/lib/play-quality";
import {
  canOpenPlayerDetail,
  nextVolumeAfterMuteToggle,
  shouldTogglePlaybackBySpace
} from "@/src/lib/player-ui";
import { nextTheme, readThemePreference, resolveInitialTheme, writeThemePreference } from "@/src/lib/theme-preference";
import { toUserFacingMessage } from "@/src/lib/user-facing-error";
import { useAuthStore } from "@/src/store/auth-store";
import { useFriendStore } from "@/src/store/friend-store";
import { useListenTogetherStore } from "@/src/store/listen-together-store";
import { getCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import { usePlayerController } from "@/src/hooks/use-player-controller";
import { useSearchPanel } from "@/src/hooks/use-search-panel";
import AnimatedList from "@/src/components/animated-list";
import { EditorialHome } from "@/src/components/immersive/editorial-home";
import { FloatingNav } from "@/src/components/immersive/floating-nav";
import { PlayerDock } from "@/src/components/immersive/player-dock";
import { SearchPanel } from "@/src/components/immersive/search-panel";
import { StageEmpty, StagePanelShell, StageSection } from "@/src/components/immersive/stage-panel";
import { TrackRow } from "@/src/components/track-row";
import { UserAvatar } from "@/src/components/user-avatar";
import type { AuthStatus, FriendRelationStatus, ListenPlaybackState, SyncState } from "@/src/types/account";
import type {
  DiscoverData,
  DiscoverItem,
  ImportedPlaylist,
  PlaybackMode,
  PlayQualityLevel,
  Playlist,
  SceneData,
  SongInsight,
  TrackQualityAvailability,
  Track
} from "@/src/types/music";

type NavTab = "home" | "search" | "library";
type LibraryView = "library-favorites" | "library-recent" | "library-playlists";
type HomePlaylistView = "featured" | "more";
type DetailViewTab = "lyric" | "meta";
type DetailLyricMode = "origin" | "translated" | "karaoke";
type DetailModalPhase = "closed" | "opening" | "open" | "closing";
type DetailOpenInteraction = "pointer" | "keyboard";
type DetailDockOrigin = { left: number; top: number; width: number; height: number };
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
type ListenStatePublishType = "playback" | "queue" | "seek" | "mode" | "progress";
type DesktopHostUserAction = "open-profile-folder" | "clear-web-cache" | "open-download-page" | "open-home-in-browser";
type AccountManagerTab = "profile" | "security" | "advanced" | "desktop";
type ListenDrawerTab = "room" | "friends" | "activity";
type ListenActivityTab = "listen-invites" | "friend-requests";

const DETAIL_ANIMATION_MS = 640;
const DETAIL_SHARED_START_HOLD_MS = 90;
const PLAYLIST_PANEL_ANIMATION_MS = 260;
const PALETTE_TRANSITION_MS = 960;
const LISTEN_HEARTBEAT_INTERVAL_MS = 45_000;
const LISTEN_PROGRESS_SYNC_INTERVAL_MS = 30_000;
const LOCATED_PANEL_TRACK_HIGHLIGHT_MS = 1400;
const LIBRARY_CONTENT_LEAVE_MS = 140;
const LIBRARY_CONTENT_ENTER_MS = 220;
const ACCOUNT_SYNC_DEBOUNCE_MS = 180;
const ACCOUNT_PULL_POLLING_MS = 120_000;
const ACCOUNT_PULL_THROTTLE_MS = 1_800;
const ACCOUNT_PULL_RETRY_BLOCK_MS = 4_000;
const ACCOUNT_RECENT_SYNC_SKIP_MS = 4_000;
const AUTH_RESUME_REFRESH_RETRIES = 2;
const AUTH_RESUME_REFRESH_BACKOFF_MS = 450;
const ARTWORK_DETAIL_FETCH_BATCH = 3;
const ARTWORK_DETAIL_FETCH_BATCH_SEARCH = 8;
const ARTWORK_SEARCH_TRACK_LIMIT = 40;
const FRIEND_SEARCH_DEBOUNCE_MS = 280;
const HOME_GRID_GAP = 20;
const HOME_GRID_MAX_COLUMNS = 6;
const HOME_CHANNEL_MIN_CARD_WIDTH = 196;
const HOME_PLAYLIST_MIN_CARD_WIDTH = 196;
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
const SMALL_COVER_WIDTHS = {
  homeCard: 240,
  importedPlaylist: 112,
  playlistRow: 88
} as const;
const PLAY_QUALITY_OPTIONS: Array<{ value: PlayQualityLevel; label: string }> = [
  { value: "standard", label: PLAY_QUALITY_LABELS.standard },
  { value: "higher", label: PLAY_QUALITY_LABELS.higher },
  { value: "exhigh", label: PLAY_QUALITY_LABELS.exhigh },
  { value: "lossless", label: PLAY_QUALITY_LABELS.lossless },
  { value: "hires", label: PLAY_QUALITY_LABELS.hires },
  { value: "jyeffect", label: PLAY_QUALITY_LABELS.jyeffect },
  { value: "sky", label: PLAY_QUALITY_LABELS.sky },
  { value: "dolby", label: PLAY_QUALITY_LABELS.dolby },
  { value: "jymaster", label: PLAY_QUALITY_LABELS.jymaster }
];
function desktopActionBusyLabel(action: DesktopHostUserAction | null): string | null {
  if (action === "open-profile-folder") return "正在打开缓存目录...";
  if (action === "clear-web-cache") return "正在清理网页缓存并重载...";
  if (action === "open-download-page") return "正在打开下载页...";
  if (action === "open-home-in-browser") return "正在打开网页版...";
  return null;
}

function friendRelationLabel(status: FriendRelationStatus): string {
  if (status === "friend") return "已是好友";
  if (status === "outgoing_pending") return "已发送";
  if (status === "incoming_pending") return "等待你处理";
  if (status === "self") return "自己";
  return "可添加";
}

function friendRelationActionLabel(status: FriendRelationStatus): string {
  if (status === "incoming_pending") return "同意";
  if (status === "outgoing_pending") return "已发送";
  if (status === "friend") return "已是好友";
  if (status === "self") return "自己";
  return "添加";
}

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
  const raw = track.coverUrl ?? track.album?.coverUrl;
  if (!raw || raw === DEFAULT_COVER_URL) return undefined;
  return raw;
}

function isRealCoverUrl(url?: string | null): url is string {
  return Boolean(url && url !== DEFAULT_COVER_URL);
}

function resolveSizedCover(url: string | undefined, width: number, height = width): string {
  return getSizedImageUrl(url, { width, height }) ?? DEFAULT_COVER_URL;
}

function toCoverBackgroundStyle(url: string | undefined, width: number, height = width): CSSProperties {
  return {
    backgroundImage: `url(${resolveSizedCover(url, width, height)})`
  };
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
  return "未同步";
}

function authStatusLabel(status: AuthStatus): string {
  if (status === "restoring") return "恢复连接中";
  if (status === "degraded") return "连接波动";
  if (status === "authenticated") return "已登录";
  if (status === "authenticating") return "连接中";
  if (status === "error") return "连接异常";
  return "未登录";
}

function resolveAuthRefreshIssue(
  error: AccountApiError | undefined,
  mode: "auto" | "manual"
): string {
  if (!error) {
    return mode === "auto" ? "暂时无法恢复登录状态，请手动重新登录。" : "暂时无法连接登录服务，请稍后重试。";
  }

  if (error.status === 401 && error.code === 5203) {
    return "登录状态已失效，请重新登录。";
  }

  if (error.status === 403 && error.code === 5207) {
    return "登录请求来源校验失败，请联系管理员检查域名配置。";
  }

  if (error.status === 429) {
    return "操作过于频繁，请稍后再试。";
  }

  if (error.code === 5403 || error.status >= 500) {
    return "登录服务暂时不可用，请稍后重试。";
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
      <path d="M8.2 5.8c0-.9.96-1.46 1.74-1.02l9.1 5.2c.8.46.8 1.58 0 2.04l-9.1 5.2c-.78.44-1.74-.12-1.74-1.02V5.8z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.2" y="5.2" width="4.2" height="13.6" rx="1.6" fill="currentColor" />
      <rect x="13.6" y="5.2" width="4.2" height="13.6" rx="1.6" fill="currentColor" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.8" y="5.4" width="2.6" height="13.2" rx="1.2" fill="currentColor" />
      <path d="M18.4 6.1c0-.72-.78-1.16-1.4-.8L8.6 10.6a.92.92 0 0 0 0 1.6l8.4 5.3c.62.36 1.4-.08 1.4-.8V6.1z" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="16.6" y="5.4" width="2.6" height="13.2" rx="1.2" fill="currentColor" />
      <path d="M5.6 6.1c0-.72.78-1.16 1.4-.8l8.4 5.3a.92.92 0 0 1 0 1.6l-8.4 5.3c-.62.36-1.4-.08-1.4-.8V6.1z" fill="currentColor" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.8" cy="6.5" r="1.85" fill="currentColor" />
      <circle cx="5.8" cy="12" r="1.85" fill="currentColor" />
      <circle cx="5.8" cy="17.5" r="1.85" fill="currentColor" />
      <rect x="9.4" y="5.2" width="10" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="9.4" y="10.7" width="10" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="9.4" y="16.2" width="10" height="2.6" rx="1.3" fill="currentColor" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.2 10.8 12 4.2l7.8 6.6v8.4a1.6 1.6 0 0 1-1.6 1.6h-4.1v-5.9H9.9v5.9H5.8a1.6 1.6 0 0 1-1.6-1.6v-8.4z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="6" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <path d="m15.3 15.3 4.1 4.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 5.2h9.8a2.2 2.2 0 0 1 2.2 2.2v11.4H7.2A2.2 2.2 0 0 1 5 16.6V5.2z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M8.2 9h5.6M8.2 12.6h5.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function ListenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 12.5a4 4 0 1 0-3 0A6 6 0 0 0 2 18v1.5h10V18a6 6 0 0 0-3.5-5.5Z" />
      <path d="M15 7.5a3 3 0 1 1 0 5.7M15.5 15.5c3.5.2 5.5 1.6 5.5 4" />
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

function ThemedSelect({
  buttonId,
  labelId,
  value,
  options,
  onChange,
  disabled = false,
  className
}: {
  buttonId: string;
  labelId: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0] ?? { value, label: value };

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`themed-select${className ? ` ${className}` : ""}${open ? " open" : ""}${disabled ? " disabled" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="themed-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${buttonId}`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((previous) => !previous);
        }}
      >
        <span>{selected.label}</span>
        <span className="themed-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="themed-select-menu" role="listbox" aria-labelledby={labelId}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className={`themed-select-option${option.value === value ? " active" : ""}`}
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlayerApp() {
  const player = usePlayerStore();
  const authStatus = useAuthStore((state) => state.status);
  const authAccessToken = useAuthStore((state) => state.accessToken);
  const authUser = useAuthStore((state) => state.user);
  const authPlaybackAuthorization = useAuthStore((state) => state.playbackAuthorization);
  const authSyncState = useAuthStore((state) => state.lastSyncState);
  const authErrorMessage = useAuthStore((state) => state.errorMessage);
  const setAuthRestoring = useAuthStore((state) => state.setRestoring);
  const setAuthAuthenticating = useAuthStore((state) => state.setAuthenticating);
  const setAuthDegraded = useAuthStore((state) => state.setDegraded);
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
  const friendList = useFriendStore((state) => state.friends);
  const friendRequests = useFriendStore((state) => state.requests);
  const listenInvites = useFriendStore((state) => state.invites);
  const friendSearchResults = useFriendStore((state) => state.searchResults);
  const friendLoading = useFriendStore((state) => state.loading);
  const friendMessage = useFriendStore((state) => state.message);
  const setFriendList = useFriendStore((state) => state.setFriends);
  const setFriendRequests = useFriendStore((state) => state.setRequests);
  const setListenInvites = useFriendStore((state) => state.setInvites);
  const setFriendSearchResults = useFriendStore((state) => state.setSearchResults);
  const setFriendLoading = useFriendStore((state) => state.setLoading);
  const setFriendMessage = useFriendStore((state) => state.setMessage);
  const resetFriendPanel = useFriendStore((state) => state.reset);
  const desktopHost = useDesktopHost();

  const shellRef = useRef<HTMLElement>(null);
  const playerDockRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const search = useSearchPanel({ active: activeTab === "search" });
  const [libraryView, setLibraryView] = useState<LibraryView>("library-favorites");
  const [detailPhase, setDetailPhase] = useState<DetailModalPhase>("closed");
  const [detailDockOrigin, setDetailDockOrigin] = useState<DetailDockOrigin | null>(null);
  const [detailTab, setDetailTab] = useState<DetailViewTab>("lyric");
  const [detailLyricMode, setDetailLyricMode] = useState<DetailLyricMode>("origin");
  const [currentPalette, setCurrentPalette] = useState<DetailPalette>(NEUTRAL_DETAIL_PALETTE);
  const [previousPalette, setPreviousPalette] = useState<DetailPalette | null>(null);
  const [isPaletteTransitioning, setIsPaletteTransitioning] = useState(false);
  const [detailForeground, setDetailForeground] = useState<DetailForegroundTone>(DARK_DETAIL_FOREGROUND);
  const [theme, setTheme] = useState<AppTheme>("dark");
  const [discoverData, setDiscoverData] = useState<DiscoverData | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [homePlaylistPanel, setHomePlaylistPanel] = useState<HomePlaylistPanelState | null>(null);
  const [homePlaylistPhase, setHomePlaylistPhase] = useState<PlaylistPanelPhase>("closed");
  const [pendingQueueOpenAfterDetail, setPendingQueueOpenAfterDetail] = useState(false);
  const [homePlaylistView, setHomePlaylistView] = useState<HomePlaylistView>("featured");
  const [playlistSummaryExpanded, setPlaylistSummaryExpanded] = useState(false);
  const [playlistSummaryOverflowing, setPlaylistSummaryOverflowing] = useState(false);
  const [expandedPanelTrackId, setExpandedPanelTrackId] = useState<string | null>(null);
  const [expandedPanelTrackSourceId, setExpandedPanelTrackSourceId] = useState<string | null>(null);
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
  const [playlistGridWidth, setPlaylistGridWidth] = useState(0);
  const [downloadState, setDownloadState] = useState<{
    loading: boolean;
    level: string;
    message: string | null;
  }>({
    loading: false,
    level: "exhigh",
    message: null
  });
  const [trackQualityAvailability, setTrackQualityAvailability] = useState<TrackQualityAvailability | null>(null);
  const [trackQualityLoading, setTrackQualityLoading] = useState(false);
  const [sceneSati, setSceneSati] = useState<SceneData | null>(null);
  const [sceneSport, setSceneSport] = useState<SceneData | null>(null);
  const [isMobileUi, setIsMobileUi] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const [isAccountEnabled, setIsAccountEnabled] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [accountManagerPhase, setAccountManagerPhase] = useState<PlaylistPanelPhase>("closed");
  const [accountManagerTab, setAccountManagerTab] = useState<AccountManagerTab>("profile");
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
  const [profileNicknameInput, setProfileNicknameInput] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordFormState, setPasswordFormState] = useState({
    oldPassword: "",
    newPassword: ""
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [accountManagerMessage, setAccountManagerMessage] = useState<string | null>(null);
  const [accountManagerError, setAccountManagerError] = useState<string | null>(null);
  const [desktopActionState, setDesktopActionState] = useState<{
    action: DesktopHostUserAction | null;
    message: string | null;
    error: string | null;
  }>({
    action: null,
    message: null,
    error: null
  });
  const [musicUnblockLoading, setMusicUnblockLoading] = useState(false);
  const [musicUnblockInviteInput, setMusicUnblockInviteInput] = useState("");
  const [musicUnblockMessage, setMusicUnblockMessage] = useState<string | null>(null);
  const [musicUnblockError, setMusicUnblockError] = useState<string | null>(null);
  const [playbackResumeToken, setPlaybackResumeToken] = useState(0);
  const [listenPanelOpen, setListenPanelOpen] = useState(false);
  const [listenPanelPhase, setListenPanelPhase] = useState<PlaylistPanelPhase>("closed");
  const [listenDrawerTab, setListenDrawerTab] = useState<ListenDrawerTab>("room");
  const [listenActivityTab, setListenActivityTab] = useState<ListenActivityTab>("listen-invites");
  const [listenInviteInput, setListenInviteInput] = useState("");
  const [listenBusy, setListenBusy] = useState(false);
  const [listenReconnectToken, setListenReconnectToken] = useState(0);
  const [friendSearchInput, setFriendSearchInput] = useState("");
  const [friendActionBusyId, setFriendActionBusyId] = useState<string | null>(null);
  const [locatedPanelTrackId, setLocatedPanelTrackId] = useState<string | null>(null);
  const [displayedLibraryView, setDisplayedLibraryView] = useState<LibraryView>("library-favorites");
  const [libraryContentTransitionPhase, setLibraryContentTransitionPhase] = useState<LibraryContentTransitionPhase>("idle");
  const [librarySegmentedThumb, setLibrarySegmentedThumb] = useState<{ x: number; width: number; ready: boolean }>({
    x: 0,
    width: 0,
    ready: false
  });
  const importPlaylistInputRef = useRef<HTMLInputElement>(null);
  const accountDialogPanelRef = useRef<HTMLFormElement>(null);
  const accountManagerDrawerRef = useRef<HTMLElement>(null);
  const listenDrawerRef = useRef<HTMLElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const detailScreenRef = useRef<HTMLElement>(null);
  const homePlaylistDrawerRef = useRef<HTMLElement>(null);
  const accountDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const accountManagerReturnFocusRef = useRef<HTMLElement | null>(null);
  const listenPanelReturnFocusRef = useRef<HTMLElement | null>(null);
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
  const detailOpenTimerRef = useRef<number | null>(null);
  const detailOpenInteractionRef = useRef<DetailOpenInteraction>("pointer");
  const paletteTransitionTimerRef = useRef<number | null>(null);
  const homePlaylistCloseTimerRef = useRef<number | null>(null);
  const accountManagerCloseTimerRef = useRef<number | null>(null);
  const listenPanelCloseTimerRef = useRef<number | null>(null);
  const homePlaylistRequestIdRef = useRef(0);
  const pendingArtworkRef = useRef<Set<string>>(new Set());
  const failedArtworkRef = useRef<Set<string>>(new Set());
  const popstateHandlingRef = useRef(false);
  const activeTabRef = useRef<NavTab>("home");
  const detailPhaseRef = useRef<DetailModalPhase>("closed");
  const homePlaylistPhaseRef = useRef<PlaylistPanelPhase>("closed");
  const accountManagerPhaseRef = useRef<PlaylistPanelPhase>("closed");
  const listenPanelPhaseRef = useRef<PlaylistPanelPhase>("closed");
  const [dockPortalTarget, setDockPortalTarget] = useState<HTMLElement | null>(null);
  const [playlistPortalTarget, setPlaylistPortalTarget] = useState<HTMLElement | null>(null);
  const homePlaylistGridRef = useRef<HTMLDivElement>(null);
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
  const lyricLineRefsRef = useRef<Map<number, HTMLElement>>(new Map());
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
  const pendingPullReasonRef = useRef<{ reason: string } | null>(null);
  const lastPullTriggeredAtRef = useRef(0);
  const pullRetryBlockedUntilRef = useRef(0);
  const lastSuccessfulSyncAtRef = useRef(0);
  const authBootstrapDoneRef = useRef(false);
  const authRefreshPromiseRef = useRef<Promise<"authenticated" | "invalid_session" | "transient_failure"> | null>(null);
  const syncReadyRef = useRef(false);
  const listenStreamAbortRef = useRef<AbortController | null>(null);
  const listenReconnectTimerRef = useRef<number | null>(null);
  const listenReconnectAttemptRef = useRef(0);
  const listenApplyingRemoteRef = useRef(false);
  const listenLeavingRoomIdsRef = useRef<Set<string>>(new Set());
  const listenLastStrongPublishedRef = useRef("");
  const listenLastProgressPublishedAtRef = useRef(0);
  const friendSearchRequestIdRef = useRef(0);
  const playbackRefreshKey = `${authStatus}:${authUser?.id ?? "guest"}:${authPlaybackAuthorization?.enabled ? "enabled" : "disabled"}:${authPlaybackAuthorization?.version ?? 0}`;
  const effectivePlayQualityLevel = useMemo<PlayQualityLevel>(() => {
    if (!trackQualityAvailability?.fallbackMap) return player.playQualityLevel;
    return trackQualityAvailability.fallbackMap[player.playQualityLevel] ?? player.playQualityLevel;
  }, [player.playQualityLevel, trackQualityAvailability]);
  const controller = usePlayerController({
    effectivePlayQualityLevel,
    playbackRefreshKey,
    resumePlaybackToken: playbackResumeToken
  });

  const openListenPanel = useCallback(() => {
    const activeElement = document.activeElement;
    listenPanelReturnFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
    if (listenPanelCloseTimerRef.current) {
      window.clearTimeout(listenPanelCloseTimerRef.current);
      listenPanelCloseTimerRef.current = null;
    }
    setListenPanelOpen(true);
    const currentPhase = listenPanelPhaseRef.current;
    if (currentPhase === "open" || currentPhase === "opening") {
      return;
    }
    listenPanelPhaseRef.current = "opening";
    setListenPanelPhase("opening");
    window.requestAnimationFrame(() => {
      listenPanelPhaseRef.current = "open";
      setListenPanelPhase("open");
    });
  }, []);

  const closeListenPanel = useCallback(() => {
    const currentPhase = listenPanelPhaseRef.current;
    if (currentPhase === "closed" || currentPhase === "closing") {
      return;
    }
    if (listenPanelCloseTimerRef.current) {
      window.clearTimeout(listenPanelCloseTimerRef.current);
    }
    listenPanelPhaseRef.current = "closing";
    setListenPanelPhase("closing");
    listenPanelCloseTimerRef.current = window.setTimeout(() => {
      listenPanelPhaseRef.current = "closed";
      setListenPanelPhase("closed");
      setListenPanelOpen(false);
      listenPanelCloseTimerRef.current = null;
      listenPanelReturnFocusRef.current?.focus();
      listenPanelReturnFocusRef.current = null;
    }, PLAYLIST_PANEL_ANIMATION_MS);
  }, []);

  const queueTrack = useMemo(() => getCurrentTrack(player), [player]);
  const currentTrack = controller.currentTrack ?? queueTrack;
  const currentTrackId = currentTrack?.id ?? null;
  const currentTrackName = currentTrack?.name ?? null;
  const currentTrackAvailablePlayQualityOptions = useMemo(() => {
    const levels = trackQualityAvailability?.availableLevels;
    if (!levels?.length) return PLAY_QUALITY_OPTIONS;
    return PLAY_QUALITY_OPTIONS.filter((option) => levels.includes(option.value));
  }, [trackQualityAvailability]);
  const playQualityFallbackNotice = useMemo(() => {
    if (!currentTrack || !trackQualityAvailability?.availableLevels.length) return null;
    if (effectivePlayQualityLevel === player.playQualityLevel) return null;
    const currentLabel = getPlayQualityLabel(effectivePlayQualityLevel);
    const preferredLabel = getPlayQualityLabel(player.playQualityLevel);
    return `当前歌曲不支持 ${preferredLabel}，已自动按 ${currentLabel} 播放。`;
  }, [currentTrack, effectivePlayQualityLevel, player.playQualityLevel, trackQualityAvailability]);
  const favoriteSet = player.favorites;
  const modeMeta = MODE_META[player.mode];
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
  const activePanelTrackSourceId = useMemo(
    () => (homePlaylistPanel ? `${homePlaylistPanel.sourceType}:${homePlaylistPanel.id}` : null),
    [homePlaylistPanel]
  );
  const currentCoverUrl = useMemo(
    () => (currentTrack ? artworkByTrackId[currentTrack.id] ?? pickTrackCover(currentTrack) ?? DEFAULT_COVER_URL : null),
    [artworkByTrackId, currentTrack]
  );
  useEffect(() => {
    if (!currentTrackId) {
      setTrackQualityAvailability(null);
      setTrackQualityLoading(false);
      return;
    }

    let active = true;
    setTrackQualityLoading(true);
    getTrackQualityAvailability(currentTrackId, authAccessToken)
      .then((availability) => {
        if (!active) return;
        setTrackQualityAvailability(availability);
      })
      .catch(() => {
        if (!active) return;
        setTrackQualityAvailability(null);
      })
      .finally(() => {
        if (!active) return;
        setTrackQualityLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authAccessToken, currentTrackId, playbackRefreshKey]);

  const captureListenPlaybackState = useCallback((): ListenPlaybackState => {
    const playerState = usePlayerStore.getState();
    return {
      queue: playerState.queue,
      currentIndex: playerState.currentIndex,
      currentTimeMs: Math.max(0, Math.floor(playerState.currentTimeMs)),
      isPlaying: playerState.isPlaying,
      mode: playerState.mode,
      updatedAt: new Date().toISOString()
    };
  }, []);

  const listenStateSignature = useCallback((state: ListenPlaybackState, type: ListenStatePublishType): string => {
    return JSON.stringify({
      type,
      ids: state.queue.map((track) => track.id),
      index: state.currentIndex,
      playing: state.isPlaying,
      mode: state.mode,
      progressBucket: type === "progress" || type === "seek" ? Math.floor(state.currentTimeMs / 1000) : null
    });
  }, []);

  const publishListenState = useCallback(
    (
      type: ListenStatePublishType,
      options: {
        force?: boolean;
        minIntervalMs?: number;
        defer?: boolean;
      } = {}
    ) => {
      const run = () => {
        if (authStatus !== "authenticated") return;
        if (listenApplyingRemoteRef.current) return;
        const room = useListenTogetherStore.getState().room;
        if (!room || listenLeavingRoomIdsRef.current.has(room.id)) return;
        if (type === "progress" && room.hostUserId !== authUser?.id) return;
        const now = Date.now();
        if (type === "progress") {
          const intervalMs = options.minIntervalMs ?? LISTEN_PROGRESS_SYNC_INTERVAL_MS;
          if (now - listenLastProgressPublishedAtRef.current < intervalMs) return;
          const playerState = usePlayerStore.getState();
          if (!playerState.isPlaying) return;
          listenLastProgressPublishedAtRef.current = now;
        }
        const playbackState = captureListenPlaybackState();
        const signature = listenStateSignature(playbackState, type);
        if (!options.force && type !== "progress" && signature === listenLastStrongPublishedRef.current) return;
        if (type !== "progress") {
          listenLastStrongPublishedRef.current = signature;
        }
        void sendListenRoomState(room.id, type, playbackState)
          .then((nextRoom) => {
            const currentRoom = useListenTogetherStore.getState().room;
            if (!currentRoom || currentRoom.id !== room.id || listenLeavingRoomIdsRef.current.has(room.id)) return;
            setListenRoom(nextRoom);
            setListenConnectionState("connected");
          })
          .catch(() => {
            const currentRoom = useListenTogetherStore.getState().room;
            if (!currentRoom || currentRoom.id !== room.id || listenLeavingRoomIdsRef.current.has(room.id)) return;
            setListenConnectionState("reconnecting");
          });
      };
      if (options.defer) {
        window.setTimeout(run, 0);
        return;
      }
      run();
    },
    [authStatus, authUser?.id, captureListenPlaybackState, listenStateSignature, setListenConnectionState, setListenRoom]
  );

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

  const handleSeekTo = useCallback(
    (ms: number) => {
      controller.seekTo(ms);
      publishListenState("seek", {
        force: true,
        defer: true
      });
    },
    [controller, publishListenState]
  );

  const handleCreateListenRoom = useCallback(async () => {
    if (authStatus !== "authenticated") {
      openListenPanel();
      setListenMessage("请先登录后再使用一起听。");
      return;
    }
    setListenBusy(true);
    setListenMessage(null);
    try {
      const room = await createListenRoom(captureListenPlaybackState());
      listenLeavingRoomIdsRef.current.delete(room.id);
      if (listenReconnectTimerRef.current) {
        window.clearTimeout(listenReconnectTimerRef.current);
        listenReconnectTimerRef.current = null;
      }
      listenReconnectAttemptRef.current = 0;
      listenLastStrongPublishedRef.current = listenStateSignature(room.playbackState, "playback");
      listenLastProgressPublishedAtRef.current = 0;
      setListenRoom(room);
      setListenConnectionState("connected");
      openListenPanel();
    } catch (error) {
      setListenMessage(toUserFacingMessage(error, "创建一起听房间失败，请稍后重试"));
      setListenConnectionState("error");
    } finally {
      setListenBusy(false);
    }
  }, [authStatus, captureListenPlaybackState, listenStateSignature, openListenPanel, setListenConnectionState, setListenMessage, setListenRoom]);

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
      listenLeavingRoomIdsRef.current.delete(room.id);
      if (listenReconnectTimerRef.current) {
        window.clearTimeout(listenReconnectTimerRef.current);
        listenReconnectTimerRef.current = null;
      }
      listenReconnectAttemptRef.current = 0;
      listenLastStrongPublishedRef.current = listenStateSignature(room.playbackState, "playback");
      listenLastProgressPublishedAtRef.current = 0;
      setListenRoom(room);
      setListenConnectionState("connected");
      applyListenPlaybackState(room.playbackState);
      setListenInviteInput("");
    } catch (error) {
      setListenMessage(toUserFacingMessage(error, "加入一起听失败，请稍后重试"));
      setListenConnectionState("error");
    } finally {
      setListenBusy(false);
    }
  }, [applyListenPlaybackState, authStatus, listenInviteInput, listenStateSignature, setListenConnectionState, setListenMessage, setListenRoom]);

  const handleLeaveListenRoom = useCallback(async () => {
    const roomId = listenRoom?.id;
    listenStreamAbortRef.current?.abort();
    if (listenReconnectTimerRef.current) {
      window.clearTimeout(listenReconnectTimerRef.current);
      listenReconnectTimerRef.current = null;
    }
    listenReconnectAttemptRef.current = 0;
    if (!roomId) {
      leaveListenLocal();
      setListenMessage("已离开房间。");
      return;
    }
    listenLeavingRoomIdsRef.current.add(roomId);
    listenLastStrongPublishedRef.current = "";
    listenLastProgressPublishedAtRef.current = 0;
    leaveListenLocal();
    setListenMessage("已离开房间。");
    if (roomId) {
      try {
        await leaveListenRoom(roomId);
      } catch {
        const currentRoom = useListenTogetherStore.getState().room;
        if (!currentRoom || currentRoom.id === roomId) {
          setListenMessage("已在本地离开，服务器稍后同步。");
        }
      } finally {
        window.setTimeout(() => {
          listenLeavingRoomIdsRef.current.delete(roomId);
        }, 300_000);
      }
    }
  }, [leaveListenLocal, listenRoom?.id, setListenMessage]);

  const handleCopyListenInvite = useCallback(async () => {
    if (!listenRoom) return;
    try {
      await navigator.clipboard.writeText(listenRoom.inviteCode);
      setListenMessage("邀请码已复制。");
    } catch {
      setListenMessage(`邀请码：${listenRoom.inviteCode}`);
    }
  }, [listenRoom, setListenMessage]);

  const refreshFriendPanelData = useCallback(async () => {
    if (authStatus !== "authenticated") {
      resetFriendPanel();
      return;
    }
    setFriendLoading(true);
    try {
      const [friends, requests, invites] = await Promise.all([listFriends(), listFriendRequests(), listListenInvites()]);
      setFriendList(friends);
      setFriendRequests(requests);
      setListenInvites(invites);
    } catch (error) {
      setFriendMessage(toUserFacingMessage(error, "好友信息加载失败，请稍后重试"));
    } finally {
      setFriendLoading(false);
    }
  }, [authStatus, resetFriendPanel, setFriendList, setFriendLoading, setFriendMessage, setFriendRequests, setListenInvites]);

  const runFriendSearch = useCallback(async (rawQuery: string) => {
    if (authStatus !== "authenticated") {
      setFriendMessage("请先登录后再添加好友。");
      setFriendSearchResults([]);
      return;
    }
    const query = rawQuery.trim();
    if (!query) {
      setFriendSearchResults([]);
      setFriendMessage(null);
      return;
    }
    if (query.length < 2) {
      setFriendSearchResults([]);
      return;
    }
    const requestId = friendSearchRequestIdRef.current + 1;
    friendSearchRequestIdRef.current = requestId;
    setFriendLoading(true);
    setFriendMessage(null);
    try {
      const results = await searchFriends(query);
      if (friendSearchRequestIdRef.current !== requestId) return;
      setFriendSearchResults(results);
      if (!results.length) {
        setFriendMessage("没有找到匹配的用户，试试输入昵称片段或邮箱片段。");
      }
    } catch (error) {
      if (friendSearchRequestIdRef.current !== requestId) return;
      setFriendMessage(toUserFacingMessage(error, "搜索好友失败，请稍后重试"));
    } finally {
      if (friendSearchRequestIdRef.current === requestId) {
        setFriendLoading(false);
      }
    }
  }, [authStatus, setFriendLoading, setFriendMessage, setFriendSearchResults]);

  const handleFriendSearch = useCallback(async () => {
    await runFriendSearch(friendSearchInput);
  }, [friendSearchInput, runFriendSearch]);

  const handleSendFriendRequest = useCallback(
    async (userId: string) => {
      setFriendActionBusyId(userId);
      setFriendMessage(null);
      try {
        await sendFriendRequest(userId);
        setFriendMessage("好友请求已发送。");
        await refreshFriendPanelData();
        if (friendSearchInput.trim()) {
          await runFriendSearch(friendSearchInput);
        }
      } catch (error) {
        setFriendMessage(toUserFacingMessage(error, "发送好友请求失败，请稍后重试"));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [friendSearchInput, refreshFriendPanelData, runFriendSearch, setFriendMessage]
  );

  const handleRespondFriendRequest = useCallback(
    async (requestId: string, action: "accept" | "reject" | "cancel") => {
      setFriendActionBusyId(requestId);
      setFriendMessage(null);
      try {
        if (action === "accept") {
          await acceptFriendRequest(requestId);
          setFriendMessage("已添加好友。");
        } else if (action === "reject") {
          await rejectFriendRequest(requestId);
          setFriendMessage("已拒绝好友请求。");
        } else {
          await cancelFriendRequest(requestId);
          setFriendMessage("已取消好友请求。");
        }
        await refreshFriendPanelData();
      } catch (error) {
        setFriendMessage(toUserFacingMessage(error, "好友请求处理失败，请稍后重试"));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [refreshFriendPanelData, setFriendMessage]
  );

  const handleDeleteFriend = useCallback(
    async (friendUserId: string) => {
      setFriendActionBusyId(friendUserId);
      setFriendMessage(null);
      try {
        await deleteFriend(friendUserId);
        setFriendMessage("已删除好友。");
        await refreshFriendPanelData();
      } catch (error) {
        setFriendMessage(toUserFacingMessage(error, "删除好友失败，请稍后重试"));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [refreshFriendPanelData, setFriendMessage]
  );

  const handleInviteFriendToListen = useCallback(
    async (friendUserId: string) => {
      if (!listenRoom) {
        setFriendMessage("请先创建或加入一起听房间。");
        return;
      }
      setFriendActionBusyId(friendUserId);
      setFriendMessage(null);
      try {
        await inviteFriendToListenRoom(listenRoom.id, friendUserId);
        setFriendMessage("一起听邀请已发送。");
        await refreshFriendPanelData();
      } catch (error) {
        setFriendMessage(toUserFacingMessage(error, "邀请好友失败，请稍后重试"));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [listenRoom, refreshFriendPanelData, setFriendMessage]
  );

  const handleRespondListenInvite = useCallback(
    async (inviteId: string, action: "accept" | "reject") => {
      setFriendActionBusyId(inviteId);
      setFriendMessage(null);
      try {
        if (action === "accept") {
          const result = await acceptListenInvite(inviteId);
          listenLeavingRoomIdsRef.current.delete(result.room.id);
          listenLastStrongPublishedRef.current = listenStateSignature(result.room.playbackState, "playback");
          listenLastProgressPublishedAtRef.current = 0;
          setListenRoom(result.room);
          setListenConnectionState("connected");
          applyListenPlaybackState(result.room.playbackState);
          setFriendMessage("已加入好友的一起听。");
        } else {
          await rejectListenInvite(inviteId);
          setFriendMessage("已拒绝一起听邀请。");
        }
        await refreshFriendPanelData();
      } catch (error) {
        setFriendMessage(toUserFacingMessage(error, "处理一起听邀请失败，请稍后重试"));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [applyListenPlaybackState, listenStateSignature, refreshFriendPanelData, setFriendMessage, setListenConnectionState, setListenRoom]
  );

  const handleAvatarFileChange = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setAvatarUploading(true);
    setAuthNotice(null);
    try {
      await uploadAccountAvatar(file);
      setAuthNotice("头像已更新。");
    } catch (error) {
      setAuthNotice(toUserFacingMessage(error, "头像上传失败，请稍后重试"));
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
      setAuthNotice(toUserFacingMessage(error, "头像移除失败，请稍后重试"));
    } finally {
      setAvatarUploading(false);
    }
  }, []);

  const resolveTrackCover = (
    track?: Track | null,
    options?: {
      width?: number;
      height?: number;
      original?: boolean;
    }
  ): string => {
    if (!track) return DEFAULT_COVER_URL;
    // Prefer live track fields over a cached default so sticky vinyl never masks real art.
    const direct = pickTrackCover(track);
    const cached = artworkByTrackId[track.id];
    const coverUrl = direct ?? (isRealCoverUrl(cached) ? cached : undefined) ?? DEFAULT_COVER_URL;
    if (options?.original || !options?.width) {
      return coverUrl;
    }
    return resolveSizedCover(coverUrl, options.width, options.height ?? options.width);
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
        lastSuccessfulSyncAtRef.current = Date.now();

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
    async (reason: string, options?: CloudPullOptions) => {
      const force = options?.force ?? false;
      const mode = resolveCloudPullMode(options);
      if (!isAccountEnabled || authStatus !== "authenticated" || !syncReadyRef.current || !player.hasHydrated) {
        return;
      }
      const now = Date.now();
      if (!force && now < pullRetryBlockedUntilRef.current) {
        return;
      }
      if (pullInFlightRef.current) {
        pendingPullReasonRef.current = { reason };
        return;
      }
      if (!force && now - lastPullTriggeredAtRef.current < ACCOUNT_PULL_THROTTLE_MS) {
        return;
      }

      lastPullTriggeredAtRef.current = now;
      pullInFlightRef.current = true;
      if (shouldShowCloudSyncing(options)) {
        setAuthSyncState("syncing");
      }

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
          lastSuccessfulSyncAtRef.current = Date.now();
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
        lastSuccessfulSyncAtRef.current = Date.now();
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
            void triggerCloudPull(pendingReason.reason, { mode });
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
      lastSuccessfulSyncAtRef.current = Date.now();
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
    lastSuccessfulSyncAtRef.current = 0;
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

  const closeAccountManager = useCallback(() => {
    const currentPhase = accountManagerPhaseRef.current;
    if (currentPhase === "closed" || currentPhase === "closing") {
      return;
    }
    if (accountManagerCloseTimerRef.current) {
      window.clearTimeout(accountManagerCloseTimerRef.current);
    }
    accountManagerPhaseRef.current = "closing";
    setAccountManagerPhase("closing");
    accountManagerCloseTimerRef.current = window.setTimeout(() => {
      accountManagerPhaseRef.current = "closed";
      setAccountManagerPhase("closed");
      setAccountManagerOpen(false);
      setAccountManagerMessage(null);
      setAccountManagerError(null);
      setDesktopActionState({
        action: null,
        message: null,
        error: null
      });
      accountManagerCloseTimerRef.current = null;
      accountManagerReturnFocusRef.current?.focus();
      accountManagerReturnFocusRef.current = null;
    }, PLAYLIST_PANEL_ANIMATION_MS);
  }, []);

  const openAccountManagerWithAnimation = useCallback(() => {
    if (accountManagerCloseTimerRef.current) {
      window.clearTimeout(accountManagerCloseTimerRef.current);
      accountManagerCloseTimerRef.current = null;
    }
    setAccountManagerOpen(true);
    const currentPhase = accountManagerPhaseRef.current;
    if (currentPhase === "open" || currentPhase === "opening") {
      return;
    }
    accountManagerPhaseRef.current = "opening";
    setAccountManagerPhase("opening");
    window.requestAnimationFrame(() => {
      accountManagerPhaseRef.current = "open";
      setAccountManagerPhase("open");
    });
  }, []);

  const openAccountManagerPanel = useCallback((options?: { allowGuest?: boolean; initialTab?: AccountManagerTab }) => {
    const allowGuest = options?.allowGuest ?? false;
    if (authStatus !== "authenticated" && !allowGuest) {
      openLoginDialog();
      return;
    }
    const activeElement = document.activeElement;
    accountManagerReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setProfileNicknameInput(authUser?.nickname?.trim() || "");
    setPasswordFormState({ oldPassword: "", newPassword: "" });
    setAccountManagerMessage(null);
    setAccountManagerError(null);
    setDesktopActionState({
      action: null,
      message: null,
      error: null
    });
    setAccountManagerTab(
      options?.initialTab ?? (authStatus === "authenticated" ? "profile" : desktopHost.isDesktopHost && Boolean(desktopHost.context) && !isMobileUi ? "desktop" : "profile")
    );
    openAccountManagerWithAnimation();
  }, [authStatus, authUser?.nickname, desktopHost.context, desktopHost.isDesktopHost, isMobileUi, openAccountManagerWithAnimation, openLoginDialog]);

  const openAccountManager = useCallback(() => {
    // Guest on desktop: open the login dialog directly (settings still allow guest).
    if (authStatus !== "authenticated") {
      if (isAccountEnabled) {
        openLoginDialog();
      }
      return;
    }
    openAccountManagerPanel({
      allowGuest: false,
      initialTab: "profile"
    });
  }, [authStatus, isAccountEnabled, openAccountManagerPanel, openLoginDialog]);

  const openDesktopSettings = useCallback(() => {
    openAccountManagerPanel({
      allowGuest: true,
      initialTab: "desktop"
    });
  }, [openAccountManagerPanel]);

  const handleDesktopHostAction = useCallback(async (action: DesktopHostUserAction) => {
    setDesktopActionState({
      action,
      message: desktopActionBusyLabel(action),
      error: null
    });
    try {
      const result = await requestDesktopHostAction(action);
      setDesktopActionState({
        action: null,
        message: result.ok ? result.message ?? desktopActionBusyLabel(action) : null,
        error: result.ok ? null : result.message ?? "桌面客户端操作失败，请稍后重试。"
      });
    } catch (error) {
      setDesktopActionState({
        action: null,
        message: null,
        error: toUserFacingMessage(error, "桌面客户端操作失败，请稍后重试")
      });
    }
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
      await loadCurrentAccountUser();
      setAuthRefreshIssue(null);
      await syncAfterLogin();
      setAuthFormState({
        email: "",
        password: "",
        nickname: ""
      });
      closeAccountDialog();
    } catch (error) {
      const message = resolveAuthFormError(error, authFormMode);
      setAuthError(message);
      setAuthFormError(message);
    } finally {
      setAuthFormSubmitting(false);
    }
  }, [authFormMode, authFormState, closeAccountDialog, setAuthAuthenticating, setAuthError, syncAfterLogin]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutAccount();
      setAuthRefreshIssue(null);
      resetCloudSyncSession();
      setAuthGuest();
      setAuthSyncState("idle");
    } catch {
      setAuthNotice("退出失败，请稍后重试。");
    }
  }, [resetCloudSyncSession, setAuthGuest, setAuthSyncState]);

  const handleUpdateProfile = useCallback(async () => {
    const nickname = profileNicknameInput.trim();
    if (!nickname) {
      setAccountManagerError("请输入昵称。");
      return;
    }
    setProfileSaving(true);
    setAccountManagerMessage(null);
    setAccountManagerError(null);
    try {
      await updateAccountProfile({ nickname });
      setProfileNicknameInput(nickname);
      setAccountManagerMessage("昵称已更新。");
    } catch (error) {
      setAccountManagerError(toUserFacingMessage(error, "昵称更新失败，请稍后重试"));
    } finally {
      setProfileSaving(false);
    }
  }, [profileNicknameInput]);

  const handleChangePassword = useCallback(async () => {
    if (!passwordFormState.oldPassword || !passwordFormState.newPassword) {
      setAccountManagerError("请输入当前密码和新密码。");
      return;
    }
    if (!hasStrongPassword(passwordFormState.newPassword)) {
      setAccountManagerError("新密码至少 10 位，并包含大小写字母、数字和符号。");
      return;
    }
    setPasswordSaving(true);
    setAccountManagerMessage(null);
    setAccountManagerError(null);
    try {
      await changeAccountPassword(passwordFormState);
      setPasswordFormState({ oldPassword: "", newPassword: "" });
      setAccountManagerMessage("密码已更新。");
    } catch (error) {
      setAccountManagerError(toUserFacingMessage(error, "密码修改失败，请稍后重试"));
    } finally {
      setPasswordSaving(false);
    }
  }, [passwordFormState]);

  const restoreAuthenticatedSession = useCallback(
    async ({
      mode,
      transientRetries,
      phase,
      syncOnSuccess
    }: {
      mode: "auto" | "manual";
      transientRetries: number;
      phase: "restoring" | "authenticating";
      syncOnSuccess: boolean;
    }): Promise<"authenticated" | "invalid_session" | "transient_failure"> => {
      if (!isAccountEnabled) {
        return "transient_failure";
      }
      if (phase === "authenticating") {
        setAuthAuthenticating();
      } else {
        setAuthRestoring();
      }
      setAuthRefreshIssue(null);

      const existing = authRefreshPromiseRef.current;
      if (existing) {
        return existing;
      }

      const task = (async () => {
        for (let attempt = 0; attempt <= transientRetries; attempt += 1) {
          const refreshResult = await tryRefreshAccessTokenDetailed();
          if (!refreshResult.ok) {
            if (refreshResult.reason === "invalid_session") {
              resetCloudSyncSession();
              setAuthGuest();
              setAuthRefreshIssue(resolveAuthRefreshIssue(refreshResult.error, mode));
              return "invalid_session";
            }

            if (attempt < transientRetries) {
              await new Promise<void>((resolve) => {
                window.setTimeout(resolve, AUTH_RESUME_REFRESH_BACKOFF_MS * (attempt + 1));
              });
              continue;
            }

            setAuthDegraded(resolveAuthRefreshIssue(refreshResult.error, mode));
            setAuthRefreshIssue(resolveAuthRefreshIssue(refreshResult.error, mode));
            return "transient_failure";
          }

          try {
            await loadCurrentAccountUser();
            if (syncOnSuccess) {
              await syncAfterLogin();
            }
            setAuthRefreshIssue(null);
            return "authenticated";
          } catch (error) {
            if (error instanceof AccountApiError && error.status === 401) {
              resetCloudSyncSession();
              setAuthGuest();
              setAuthRefreshIssue("登录状态已失效，请重新登录。");
              return "invalid_session";
            }

            if (attempt < transientRetries) {
              await new Promise<void>((resolve) => {
                window.setTimeout(resolve, AUTH_RESUME_REFRESH_BACKOFF_MS * (attempt + 1));
              });
              continue;
            }

            setAuthDegraded("账号信息加载失败，请稍后重试。");
            setAuthRefreshIssue("账号信息加载失败，请稍后重试。");
            return "transient_failure";
          }
        }

        setAuthDegraded(mode === "manual" ? "暂时无法连接登录服务，请稍后重试。" : "暂时无法恢复登录状态，请稍后重试。");
        setAuthRefreshIssue(mode === "manual" ? "暂时无法连接登录服务，请稍后重试。" : "暂时无法恢复登录状态，请稍后重试。");
        return "transient_failure";
      })();

      authRefreshPromiseRef.current = task;
      try {
        return await task;
      } finally {
        authRefreshPromiseRef.current = null;
      }
    },
    [isAccountEnabled, resetCloudSyncSession, setAuthAuthenticating, setAuthDegraded, setAuthGuest, setAuthRestoring, syncAfterLogin]
  );

  const handleAuthRefreshRetry = useCallback(async () => {
    if (!isAccountEnabled) return;
    await restoreAuthenticatedSession({
      mode: "manual",
      transientRetries: AUTH_RESUME_REFRESH_RETRIES,
      phase: "authenticating",
      syncOnSuccess: true
    });
  }, [isAccountEnabled, restoreAuthenticatedSession]);

  const handleRedeemMusicUnblockInvite = useCallback(async () => {
    if (musicUnblockLoading) return;
    if (authStatus !== "authenticated") {
      setMusicUnblockError("请先登录账号后再兑换。");
      return;
    }
    const inviteCode = musicUnblockInviteInput.trim();
    if (!inviteCode) {
      setMusicUnblockError("请输入兑换码。");
      return;
    }

    setMusicUnblockLoading(true);
    setMusicUnblockMessage(null);
    setMusicUnblockError(null);
    try {
      const entitlement = await redeemMusicUnblockInvite(inviteCode);
      setMusicUnblockInviteInput("");
      setMusicUnblockMessage(entitlement.enabled ? "兑换成功，当前账号已获得解锁资格。" : "兑换已处理，但当前账号暂未获得有效资格。");
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 404) {
        setMusicUnblockError("兑换码无效、已禁用或已过期。");
      } else {
        setMusicUnblockError(toUserFacingMessage(error, "兑换失败，请稍后重试"));
      }
    } finally {
      setMusicUnblockLoading(false);
    }
  }, [authStatus, musicUnblockInviteInput, musicUnblockLoading]);

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
    postShellChromeTokens();
  }, [theme]);

  useEffect(() => {
    const cleanupShellChrome = installShellChromeBridge();
    const cleanupDesktopHost = installDesktopHostBridge();
    return () => {
      cleanupDesktopHost();
      cleanupShellChrome();
    };
  }, []);

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
      const result = await restoreAuthenticatedSession({
        mode: "auto",
        transientRetries: AUTH_RESUME_REFRESH_RETRIES,
        phase: "restoring",
        syncOnSuccess: true
      });
      if (!active) return;
      if (result === "transient_failure" && authStatus === "guest") {
        resetCloudSyncSession();
        setAuthGuest();
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [authStatus, isAccountEnabled, resetCloudSyncSession, restoreAuthenticatedSession, setAuthGuest]);

  useEffect(() => {
    setMusicUnblockMessage(null);
    setMusicUnblockError(null);
    if (!isAccountEnabled || authStatus !== "authenticated") {
      setMusicUnblockInviteInput("");
    }
  }, [authStatus, isAccountEnabled]);

  useEffect(() => {
    if (activeTab !== "library") return;
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;
    if (shouldSkipRecentCloudPull(lastSuccessfulSyncAtRef.current, Date.now(), ACCOUNT_RECENT_SYNC_SKIP_MS)) {
      return;
    }
    void triggerCloudPull("enter-library");
  }, [activeTab, authStatus, isAccountEnabled, player.hasHydrated, triggerCloudPull]);

  useEffect(() => {
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;

    const onFocus = () => {
      void restoreAuthenticatedSession({
        mode: "auto",
        transientRetries: AUTH_RESUME_REFRESH_RETRIES,
        phase: "restoring",
        syncOnSuccess: false
      });
      setPlaybackResumeToken((previous) => previous + 1);
      void triggerCloudPull("window-focus");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
        void restoreAuthenticatedSession({
          mode: "auto",
          transientRetries: AUTH_RESUME_REFRESH_RETRIES,
          phase: "restoring",
          syncOnSuccess: false
        });
      setPlaybackResumeToken((previous) => previous + 1);
      void triggerCloudPull("tab-visible");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authStatus, isAccountEnabled, player.hasHydrated, restoreAuthenticatedSession, triggerCloudPull]);

  useEffect(() => {
    if (syncPollTimerRef.current) {
      window.clearInterval(syncPollTimerRef.current);
      syncPollTimerRef.current = null;
    }
    if (!isAccountEnabled || authStatus !== "authenticated") return;
    if (!player.hasHydrated) return;

    syncPollTimerRef.current = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Silently refresh the access token before it expires so that the
      // authenticated state survives extended foreground sessions.
      void restoreAuthenticatedSession({
        mode: "auto",
        transientRetries: 1,
        phase: "restoring",
        syncOnSuccess: false
      });
      void triggerCloudPull("polling");
    }, ACCOUNT_PULL_POLLING_MS);

    return () => {
      if (syncPollTimerRef.current) {
        window.clearInterval(syncPollTimerRef.current);
        syncPollTimerRef.current = null;
      }
    };
  }, [authStatus, isAccountEnabled, player.hasHydrated, restoreAuthenticatedSession, triggerCloudPull]);

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
          void triggerCloudPull("after-local-push");
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
    accountManagerPhaseRef.current = accountManagerPhase;
  }, [accountManagerPhase]);

  useEffect(() => {
    listenPanelPhaseRef.current = listenPanelPhase;
  }, [listenPanelPhase]);

  useEffect(() => {
    let active = true;
    getDiscoverHome()
      .then((data) => {
        if (!active) return;
        setDiscoverData(data);
        setDiscoverError(null);
        search.seedAssist(data.searchAssist);
      })
      .catch((error) => {
        if (!active) return;
        setDiscoverError(toUserFacingMessage(error, "发现页加载失败，请稍后重试"));
        getSearchAssist("")
          .then((assist) => {
            if (!active) return;
            search.seedAssist(assist);
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
    // seedAssist is stable; only run once on mount for discover bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  };

  const openPlaylistPanel = async (item: DiscoverItem, sourceType: "playlist" | "toplist") => {
    const targetId = item.targetId;
    if (!targetId) {
      setDiscoverError("该推荐项暂时不可用，请稍后重试。");
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
          error: toUserFacingMessage(error, "歌单加载失败，请稍后重试")
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
        error: toUserFacingMessage(error, "导入歌单失败，请稍后重试")
      });
    }
  };

  const openSearchPlaylist = (playlist: Playlist) => {
    void openPlaylistPanel(
      {
        id: `search-playlist-${playlist.id}`,
        title: playlist.name,
        subtitle: playlist.description,
        coverUrl: playlist.coverUrl,
        type: "playlist",
        targetId: playlist.id
      },
      "playlist"
    );
  };

  const playArtistTopTracks = (artistDetail: { topTracks: Track[] }) => {
    if (!artistDetail.topTracks.length) return;
    player.setQueue(artistDetail.topTracks, 0);
    player.setPlaying(true);
  };

  const addArtistTopTracksToQueue = (artistDetail: { topTracks: Track[] }) => {
    artistDetail.topTracks.forEach((track) => player.addToQueue(track));
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
    } catch (error) {
      setDiscoverError(toUserFacingMessage(error, "该推荐项暂时不可用，请稍后重试"));
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

  const collapseExpandedPanelTrack = useCallback(() => {
    setExpandedPanelTrackId(null);
    setExpandedPanelTrackSourceId(null);
  }, []);

  const toggleExpandedPanelTrack = useCallback(
    (trackId: string) => {
      if (!activePanelTrackSourceId) return;
      const isSameTrack = expandedPanelTrackId === trackId && expandedPanelTrackSourceId === activePanelTrackSourceId;
      if (isSameTrack) {
        collapseExpandedPanelTrack();
        return;
      }
      setExpandedPanelTrackId(trackId);
      setExpandedPanelTrackSourceId(activePanelTrackSourceId);
    },
    [activePanelTrackSourceId, collapseExpandedPanelTrack, expandedPanelTrackId, expandedPanelTrackSourceId]
  );

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
        message: toUserFacingMessage(error, "下载链接获取失败，请稍后重试")
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
  // Never hard-disable transport when a track is already loaded/playing.
  const controlDisabled = player.queue.length === 0 && !currentTrack;
  const mainDockProgressDegrees = `${
    player.durationMs > 0 ? Math.min(360, Math.max(0, (player.currentTimeMs / player.durationMs) * 360)) : 0
  }deg`;
  const hasMainDockProgress = Boolean(currentTrack && player.durationMs > 0);
  const isDetailMounted = detailPhase !== "closed";

  useEffect(() => {
    const root = document.documentElement;
    if (detailPhase === "opening" || detailPhase === "open") {
      root.dataset.shellMode = "dark";
    } else {
      delete root.dataset.shellMode;
    }

    postShellChromeTokens();

    return () => {
      delete root.dataset.shellMode;
    };
  }, [detailPhase]);

  const progressPercent =
    player.durationMs > 0 ? Math.min(100, Math.max(0, (player.currentTimeMs / player.durationMs) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, player.volume * 100));
  const activeDetailLyricLines = useMemo(() => controller.lyricLines, [controller.lyricLines]);
  const activeDetailLyricSecondaryLines = useMemo(() => {
    if (detailLyricMode === "translated") return controller.lyricTranslatedLines;
    if (detailLyricMode === "karaoke") return controller.lyricKaraokeLines;
    return [];
  }, [controller.lyricKaraokeLines, controller.lyricTranslatedLines, detailLyricMode]);
  const activeDetailLyricSecondaryByTime = useMemo(
    () => new Map(activeDetailLyricSecondaryLines.map((line) => [line.timeMs, line.text])),
    [activeDetailLyricSecondaryLines]
  );
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

  const homePlaylistPlan = useMemo(
    () =>
      computeHomeGridPlan(
        playlistGridWidth,
        homePlaylistItems.length,
        HOME_PLAYLIST_MIN_CARD_WIDTH,
        HOME_GRID_GAP,
        HOME_GRID_MAX_COLUMNS
      ),
    [playlistGridWidth, homePlaylistItems.length]
  );
  const editorialHero = homePlaylistItems[0] ?? homeChannelItems[0] ?? homeEventItems[0];
  const editorialFeaturedItems = [...homePlaylistItems, ...homeChannelItems]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 12);
  const editorialExploreItems = homeEventItems.slice(0, 12);
  const artworkSourceTracks = useMemo(() => {
    const sourceTracks = [
      ...(activeTab === "home" ? homeSeedTracks.slice(0, 16) : []),
      ...(homePlaylistPanel?.tracks.slice(0, 24) ?? []),
      ...(activeTab === "search" ? search.trackResult.slice(0, ARTWORK_SEARCH_TRACK_LIMIT) : []),
      ...(activeTab === "search" && search.artistDetail?.topTracks
        ? search.artistDetail.topTracks.slice(0, ARTWORK_SEARCH_TRACK_LIMIT)
        : []),
      ...(currentTrack ? [currentTrack] : [])
    ];
    const unique = new Map<string, Track>();
    sourceTracks.forEach((track) => {
      if (!track || unique.has(track.id)) return;
      unique.set(track.id, track);
    });
    return Array.from(unique.values());
  }, [
    activeTab,
    currentTrack,
    homePlaylistPanel?.tracks,
    homeSeedTracks,
    search.artistDetail?.topTracks,
    search.trackResult
  ]);

  useEffect(() => {
    const missingArtworkTracks: Track[] = [];
    const directUpdates: Record<string, string> = {};
    const batchSize =
      activeTab === "search" ? ARTWORK_DETAIL_FETCH_BATCH_SEARCH : ARTWORK_DETAIL_FETCH_BATCH;

    artworkSourceTracks.forEach((track) => {
      const directCover = pickTrackCover(track);
      if (directCover) {
        if (artworkByTrackId[track.id] !== directCover) {
          directUpdates[track.id] = directCover;
        }
        return;
      }

      const cached = artworkByTrackId[track.id];
      // Skip when real art exists, fetch in flight, or detail already failed this session.
      if (
        pendingArtworkRef.current.has(track.id) ||
        failedArtworkRef.current.has(track.id) ||
        isRealCoverUrl(cached)
      ) {
        return;
      }
      missingArtworkTracks.push(track);
    });

    if (Object.keys(directUpdates).length) {
      setArtworkByTrackId((previous) => ({ ...previous, ...directUpdates }));
    }

    missingArtworkTracks.slice(0, batchSize).forEach((track) => {
      pendingArtworkRef.current.add(track.id);
      getTrackDetail(track.id)
        .then((detailTrack) => {
          const detailCover = pickTrackCover(detailTrack);
          if (!detailCover) {
            failedArtworkRef.current.add(track.id);
            return;
          }
          failedArtworkRef.current.delete(track.id);
          setArtworkByTrackId((previous) => ({ ...previous, [track.id]: detailCover }));
        })
        .catch(() => {
          failedArtworkRef.current.add(track.id);
        })
        .finally(() => {
          pendingArtworkRef.current.delete(track.id);
        });
    });
  }, [activeTab, artworkByTrackId, artworkSourceTracks]);

  const finishDetailClose = useCallback(() => {
    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    const returnFocusElement = detailReturnFocusRef.current;
    detailReturnFocusRef.current = null;
    setDetailPhase("closed");
    setDetailDockOrigin(null);
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
    if (detailOpenTimerRef.current) {
      window.clearTimeout(detailOpenTimerRef.current);
      detailOpenTimerRef.current = null;
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
    if (detailOpenTimerRef.current) {
      window.clearTimeout(detailOpenTimerRef.current);
      detailOpenTimerRef.current = null;
    }
    if (!popstateHandlingRef.current) {
      pushHistoryGuardState("detail", activeTabRef.current);
    }
    const dockMeta = playerDockRef.current?.querySelector<HTMLElement>(".player-dock-meta");
    if (dockMeta) {
      const { left, top, width, height } = dockMeta.getBoundingClientRect();
      setDetailDockOrigin({ left, top, width, height });
    }
    setDetailPhase("opening");
    detailOpenFrameRef.current = window.requestAnimationFrame(() => {
      detailOpenFrameRef.current = null;
      detailOpenSecondFrameRef.current = window.requestAnimationFrame(() => {
        detailOpenSecondFrameRef.current = null;
        detailOpenTimerRef.current = window.setTimeout(() => {
          detailOpenTimerRef.current = null;
          setDetailPhase("open");
        }, DETAIL_SHARED_START_HOLD_MS);
      });
    });
  };

  useEffect(() => {
    if (detailPhase !== "open") return;
    detailScreenRef.current?.focus({ preventScroll: true });
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
      if (accountManagerOpen) {
        closeAccountManager();
        return;
      }
      if (listenPanelOpen) {
        closeListenPanel();
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
  }, [
    accountDialogOpen,
    accountManagerOpen,
    listenPanelOpen,
    homePlaylistPanel,
    closeAccountDialog,
    closeAccountManager,
    closeListenPanel,
    closeDetail,
    closeHomePlaylistPanel,
    restoreHomeTab,
    controlDisabled,
    player
  ]);

  useEffect(() => {
    if (!accountDialogOpen) return;
    window.setTimeout(() => {
      focusFirstInteractive(accountDialogPanelRef.current);
    }, 0);
  }, [accountDialogOpen]);

  useEffect(() => {
    if (accountManagerPhase !== "open") return;
    focusFirstInteractive(accountManagerDrawerRef.current);
  }, [accountManagerPhase]);

  useEffect(() => {
    if (listenPanelPhase !== "open") return;
    focusFirstInteractive(listenDrawerRef.current);
  }, [listenPanelPhase]);

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
    const playlistNode = homePlaylistGridRef.current;
    if (!playlistNode) return;

    const update = () => {
      setPlaylistGridWidth(Math.ceil(playlistNode.getBoundingClientRect().width));
    };

    update();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (resizeObserver) {
      resizeObserver.observe(playlistNode);
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
      if (detailOpenTimerRef.current) {
        window.clearTimeout(detailOpenTimerRef.current);
      }
      if (paletteTransitionTimerRef.current) {
        window.clearTimeout(paletteTransitionTimerRef.current);
      }
      if (homePlaylistCloseTimerRef.current) {
        window.clearTimeout(homePlaylistCloseTimerRef.current);
      }
      if (accountManagerCloseTimerRef.current) {
        window.clearTimeout(accountManagerCloseTimerRef.current);
      }
      if (listenPanelCloseTimerRef.current) {
        window.clearTimeout(listenPanelCloseTimerRef.current);
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
      if (listenReconnectTimerRef.current) {
        window.clearTimeout(listenReconnectTimerRef.current);
      }
      if (libraryContentTransitionTimerRef.current) {
        window.clearTimeout(libraryContentTransitionTimerRef.current);
      }
      listenStreamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") {
      if (listenReconnectTimerRef.current) {
        window.clearTimeout(listenReconnectTimerRef.current);
        listenReconnectTimerRef.current = null;
      }
      listenReconnectAttemptRef.current = 0;
      return;
    }
    listenStreamAbortRef.current?.abort();
    if (listenReconnectTimerRef.current) {
      window.clearTimeout(listenReconnectTimerRef.current);
      listenReconnectTimerRef.current = null;
    }
    const abortController = new AbortController();
    listenStreamAbortRef.current = abortController;
    setListenConnectionState(listenReconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
    const sinceVersion = useListenTogetherStore.getState().room?.version ?? 0;
    const scheduleReconnect = (message: string) => {
      if (abortController.signal.aborted) return;
      if (listenLeavingRoomIdsRef.current.has(roomId)) return;
      const latestRoom = useListenTogetherStore.getState().room;
      if (!latestRoom || latestRoom.id !== roomId) return;
      const attempt = Math.min(listenReconnectAttemptRef.current + 1, 4);
      listenReconnectAttemptRef.current = attempt;
      setListenConnectionState("reconnecting");
      setListenMessage(message);
      const baseDelay = Math.min(15_000, 2_000 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 500);
      listenReconnectTimerRef.current = window.setTimeout(() => {
        listenReconnectTimerRef.current = null;
        const currentRoom = useListenTogetherStore.getState().room;
        if (!currentRoom || currentRoom.id !== roomId || listenLeavingRoomIdsRef.current.has(roomId)) return;
        setListenReconnectToken((value) => value + 1);
      }, baseDelay + jitter);
    };

    void openListenRoomStream(
      roomId,
      sinceVersion,
      (event) => {
        if (listenLeavingRoomIdsRef.current.has(roomId)) return;
        const currentRoom = useListenTogetherStore.getState().room;
        if (!currentRoom || currentRoom.id !== roomId || event.version <= currentRoom.version) return;
        if (event.type === "member") {
          void getListenRoom(roomId)
            .then((room) => {
              const latestRoom = useListenTogetherStore.getState().room;
              if (!latestRoom || latestRoom.id !== roomId || listenLeavingRoomIdsRef.current.has(roomId)) return;
              setListenRoom(room);
              setListenConnectionState("connected");
            })
            .catch(() => {
              const latestRoom = useListenTogetherStore.getState().room;
              if (!latestRoom || latestRoom.id !== roomId || listenLeavingRoomIdsRef.current.has(roomId)) return;
              setListenConnectionState("reconnecting");
            });
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
      abortController.signal,
      () => {
        listenReconnectAttemptRef.current = 0;
        setListenConnectionState("connected");
      }
    ).catch((error) => {
      if (abortController.signal.aborted) return;
      if (listenLeavingRoomIdsRef.current.has(roomId)) return;
      const latestRoom = useListenTogetherStore.getState().room;
      if (!latestRoom || latestRoom.id !== roomId) return;
      if (error instanceof AccountApiError && !error.retryable) {
        listenReconnectAttemptRef.current = 0;
        setListenConnectionState("error");
        setListenMessage(toUserFacingMessage(error, "一起听已断开，请稍后重试"));
        leaveListenLocal();
        return;
      }
      scheduleReconnect(toUserFacingMessage(error, "一起听连接中断，正在等待重连"));
    });

    return () => {
      abortController.abort();
    };
  }, [
    leaveListenLocal,
    applyListenPlaybackState,
    authStatus,
    authUser?.id,
    listenRoom?.id,
    listenReconnectToken,
    setListenConnectionState,
    setListenMessage,
    setListenRoom
  ]);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    const timerId = window.setInterval(() => {
      void heartbeatListenRoom(roomId)
        .then((room) => {
          const currentRoom = useListenTogetherStore.getState().room;
          if (!currentRoom || currentRoom.id !== roomId || listenLeavingRoomIdsRef.current.has(roomId)) return;
          setListenRoom(room);
        })
        .catch(() => {
          const currentRoom = useListenTogetherStore.getState().room;
          if (!currentRoom || currentRoom.id !== roomId || listenLeavingRoomIdsRef.current.has(roomId)) return;
          setListenConnectionState("reconnecting");
        });
    }, LISTEN_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [authStatus, listenRoom?.id, setListenConnectionState, setListenRoom]);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    publishListenState("playback");
  }, [
    authStatus,
    listenRoom?.id,
    player.currentIndex,
    player.isPlaying,
    player.mode,
    player.queue,
    publishListenState
  ]);

  useEffect(() => {
    const roomId = listenRoom?.id;
    if (!roomId || authStatus !== "authenticated") return;
    const timerId = window.setInterval(() => {
      publishListenState("progress", {
        minIntervalMs: LISTEN_PROGRESS_SYNC_INTERVAL_MS
      });
    }, LISTEN_PROGRESS_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [authStatus, listenRoom?.id, publishListenState]);

  useEffect(() => {
    if (!listenPanelOpen) return;
    void refreshFriendPanelData();
  }, [listenPanelOpen, refreshFriendPanelData]);

  useEffect(() => {
    if (!listenPanelOpen || authStatus !== "authenticated") return;
    const query = friendSearchInput.trim();
    if (!query) {
      friendSearchRequestIdRef.current += 1;
      setFriendLoading(false);
      setFriendSearchResults([]);
      return;
    }
    if (query.length < 2) {
      friendSearchRequestIdRef.current += 1;
      setFriendLoading(false);
      setFriendSearchResults([]);
      return;
    }
    const timerId = window.setTimeout(() => {
      void runFriendSearch(query);
    }, FRIEND_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [authStatus, friendSearchInput, listenPanelOpen, runFriendSearch, setFriendLoading, setFriendSearchResults]);

  useEffect(() => {
    if (accountManagerTab === "desktop" && isMobileUi) {
      setAccountManagerTab(authStatus === "authenticated" ? "profile" : "advanced");
    }
  }, [accountManagerTab, authStatus, isMobileUi]);

  useEffect(() => {
    if (authStatus === "authenticated") return;
    resetFriendPanel();
  }, [authStatus, resetFriendPanel]);

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
    (index: number) => (node: HTMLElement | null) => {
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
        if (behavior === "smooth" && detailLyricRef.current && Date.now() >= lyricUserScrollLockUntilRef.current) {
          const latestActive = lyricLineRefsRef.current.get(activeDetailLyricIndex);
          const latestContainer = detailLyricRef.current;
          if (latestActive instanceof HTMLElement && latestContainer) {
            const refinedTop = latestActive.offsetTop - latestContainer.clientHeight / 2 + latestActive.clientHeight / 2;
            const refinedMaxTop = Math.max(latestContainer.scrollHeight - latestContainer.clientHeight, 0);
            const finalTop = Math.max(0, Math.min(refinedTop, refinedMaxTop));
            latestContainer.scrollTo({ top: finalTop, behavior: "auto" });
          }
        }
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
    if (!homePlaylistPanel || homePlaylistPanel.sourceType === "queue" || homePlaylistPanel.loading) {
      collapseExpandedPanelTrack();
      return;
    }
    if (!expandedPanelTrackId || !activePanelTrackSourceId) return;
    if (expandedPanelTrackSourceId !== activePanelTrackSourceId) {
      collapseExpandedPanelTrack();
      return;
    }
    const hasExpandedTrack = homePlaylistPanel.tracks.some((track) => track.id === expandedPanelTrackId);
    if (!hasExpandedTrack) {
      collapseExpandedPanelTrack();
    }
  }, [
    activePanelTrackSourceId,
    collapseExpandedPanelTrack,
    expandedPanelTrackId,
    expandedPanelTrackSourceId,
    homePlaylistPanel
  ]);

  useEffect(() => {
    if (homePlaylistPhase !== "closed") return;
    setPlaylistSummaryExpanded(false);
    collapseExpandedPanelTrack();
  }, [collapseExpandedPanelTrack, homePlaylistPhase]);

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
    if (!expandedPanelTrackId || !expandedPanelTrackSourceId) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest<HTMLElement>("[data-panel-expandable-row='true']");
      if (row) {
        const isCurrentRow =
          row.dataset.panelTrackId === expandedPanelTrackId && row.dataset.panelTrackSourceId === expandedPanelTrackSourceId;
        if (isCurrentRow) {
          return;
        }
        return;
      }
      collapseExpandedPanelTrack();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [collapseExpandedPanelTrack, expandedPanelTrackId, expandedPanelTrackSourceId]);

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

  const accountDisplayName = authUser?.nickname?.trim() || authUser?.email || "游客";
  const hasAuthRefreshIssue = Boolean(authRefreshIssue && authStatus !== "authenticated");
  const accountStateText = hasAuthRefreshIssue ? "连接异常" : authStatus === "authenticated" ? syncStateLabel(authSyncState) : authStatusLabel(authStatus);
  const musicUnblockEnabled = authPlaybackAuthorization?.enabled === true;
  const accountTierText = musicUnblockEnabled ? "高级用户" : "普通用户";
  const accountEntryStatusText = authStatus === "authenticated" ? accountTierText : accountStateText;
  const accountOverviewTierText = authStatus === "authenticated" ? accountTierText : "未启用";
  const accountOverviewSyncText = accountStateText;
  const accountSurfaceTitle = accountDisplayName;
  const accountSurfaceDescription = authStatus === "authenticated" ? accountEntryStatusText : "登录后开启云同步、好友与一起听";
  const desktopContext = desktopHost.context;
  const hasDesktopContext = desktopHost.isDesktopHost && Boolean(desktopContext);
  const showDesktopSettings = !isMobileUi;
  const desktopActionPending = desktopActionState.action;
  const desktopCapabilities = desktopContext?.capabilities;
  const accountManagerTabs = [
    { id: "profile" as const, label: "资料", visible: true, disabled: false },
    { id: "security" as const, label: "安全", visible: authStatus === "authenticated", disabled: authStatus !== "authenticated" },
    { id: "advanced" as const, label: "高级", visible: authStatus === "authenticated", disabled: authStatus !== "authenticated" },
    { id: "desktop" as const, label: "桌面", visible: showDesktopSettings, disabled: !showDesktopSettings }
  ].filter((tab) => tab.visible);
  const listenActivityTabs = [
    { id: "listen-invites" as const, label: "一起听邀请", count: listenInvites.length },
    {
      id: "friend-requests" as const,
      label: "好友请求",
      count: friendRequests.incoming.length + friendRequests.outgoing.length
    }
  ];
  const incomingFriendRequestByUserId = useMemo(
    () => new Map(friendRequests.incoming.map((request) => [request.requester.id, request])),
    [friendRequests.incoming]
  );
  const listenLastActorName = listenRoom?.lastActor?.nickname || listenRoom?.lastActor?.email || "你";
  const listenStatusText =
    listenConnectionState === "connected"
      ? "同步正常"
      : listenConnectionState === "reconnecting"
        ? "正在重连"
        : listenConnectionState === "error"
          ? "连接异常"
          : "准备连接";
  const friendSearchQuery = friendSearchInput.trim();
  const friendSearchHint =
    !friendSearchQuery
      ? "支持昵称片段或邮箱片段，输入 2 个字符后会自动搜索。"
      : friendSearchQuery.length < 2
        ? "请至少输入 2 个字符。"
        : friendLoading
          ? "正在搜索匹配的用户..."
          : null;
  const accountFeedbackMessage = accountManagerError || authErrorMessage || accountManagerMessage || authNotice;
  const accountFeedbackTone = accountManagerError || authErrorMessage ? "error" : "info";
  const musicUnblockStatusText = !isAccountEnabled
    ? "账号服务未启用"
    : authStatus !== "authenticated"
      ? "暂未开放"
      : musicUnblockLoading
        ? "处理中"
        : musicUnblockEnabled
          ? "已启用"
          : "未兑换";
  const accountOverviewUnblockText = authStatus === "authenticated" ? musicUnblockStatusText : "暂未开放";
  const accountPanelMode = accountManagerTab === "desktop" ? "settings" : "profile";
  const accountPanelTitle = accountPanelMode === "settings" ? "设置" : "个人中心";
  const listenActivityBadgeCount = listenInvites.length + friendRequests.incoming.length + friendRequests.outgoing.length;
  const listenPanelDescription = listenRoom
    ? `${listenRoom.members.length} 人同步中 · 最近由 ${listenLastActorName} 更新`
    : authStatus === "authenticated"
      ? "创建房间，或输入邀请码加入好友"
      : "登录后可创建房间、邀请好友同步播放";

  const listenPanelContent = (
    <StagePanelShell
      className="stage-panel-listen"
      kicker="Social Listening"
      title="一起听"
      description={listenPanelDescription}
      status={
        <>
          <span className={`drawer-status-chip ${listenConnectionState}`}>{listenStatusText}</span>
          {listenRoom ? <span className="relation-badge ok">进行中</span> : null}
        </>
      }
      onClose={closeListenPanel}
      nav={[
        { id: "room", label: "房间" },
        { id: "friends", label: "好友", count: friendList.length || undefined },
        { id: "activity", label: "动态", count: listenActivityBadgeCount || undefined }
      ]}
      activeNav={listenDrawerTab}
      onNav={(id) => setListenDrawerTab(id as ListenDrawerTab)}
      navAriaLabel="一起听功能标签"
      stageKey={`listen-${listenDrawerTab}-${listenRoom ? "in" : "out"}-${listenActivityTab}`}
    >
      {listenDrawerTab === "room" ? (
        listenRoom ? (
          <div className="stage-flow">
            <StageSection
              index={0}
              title="邀请码"
              hint="分享给好友即可加入 · 最多 8 人"
              action={
                <button type="button" onClick={() => void handleCopyListenInvite()}>
                  复制
                </button>
              }
            >
              <div className="stage-invite-card">
                <strong className="stage-invite-code">{listenRoom.inviteCode}</strong>
                <div className="stage-invite-meta">
                  <span>{listenRoom.members.length} / 8 人</span>
                  <span>{listenStatusText}</span>
                </div>
              </div>
              {listenMessage ? <p className="listen-status warning">{listenMessage}</p> : null}
              <div className="stage-primary-actions">
                <button type="button" className="stage-btn-danger" onClick={() => void handleLeaveListenRoom()} disabled={listenBusy}>
                  离开房间
                </button>
              </div>
            </StageSection>

            <StageSection index={1} title="房间成员" hint={`${listenRoom.members.length} 人在线同步`}>
              <div className="listen-list stage-list">
                {listenRoom.members.map((member) => (
                  <div className="listen-list-row detail" key={member.user.id}>
                    <UserAvatar user={member.user} size="sm" className={member.online ? "online" : ""} />
                    <div>
                      <strong>{member.user.nickname || member.user.email}</strong>
                      <small>
                        {member.role === "host" ? "房主" : "成员"} · {member.online ? "在线" : "离线"}
                      </small>
                    </div>
                    <span className={`relation-badge ${member.online ? "ok" : "muted"}`}>{member.online ? "在线" : "离线"}</span>
                  </div>
                ))}
              </div>
            </StageSection>
          </div>
        ) : (
          <div className="stage-flow">
            <StageSection index={0} title="开始一起听" hint="一次只做一件事：创建，或加入">
              <div className="stage-cta-stack">
                <button
                  type="button"
                  className="stage-btn-primary listen-wide-btn"
                  onClick={() => void handleCreateListenRoom()}
                  disabled={listenBusy || authStatus !== "authenticated"}
                >
                  创建一起听
                </button>
                <div className="stage-divider">
                  <span>或加入已有房间</span>
                </div>
                <form
                  className="listen-join-row stage-join-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleJoinListenRoom();
                  }}
                >
                  <input
                    value={listenInviteInput}
                    placeholder="输入邀请码"
                    onChange={(event) => setListenInviteInput(event.target.value.toUpperCase())}
                  />
                  <button type="submit" disabled={listenBusy || authStatus !== "authenticated"}>
                    加入
                  </button>
                </form>
                {authStatus !== "authenticated" ? (
                  <div className="stage-guest-login-hint">
                    <p className="listen-status">请先登录后再创建或加入房间。</p>
                    {isAccountEnabled ? (
                      <button type="button" className="stage-btn-primary" onClick={openLoginDialog}>
                        去登录
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {listenMessage ? <p className="listen-status warning">{listenMessage}</p> : null}
              </div>
            </StageSection>
            <StageEmpty title="还没有房间" description="创建后邀请码会出现在这里，好友列表可在「好友」页签管理。" />
          </div>
        )
      ) : null}

      {listenDrawerTab === "friends" ? (
        <div className="stage-flow">
          <StageSection index={0} title="添加好友" hint="昵称或邮箱片段，至少 2 个字符">
            <form
              className="listen-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleFriendSearch();
              }}
            >
              <div className="listen-join-row stage-join-form">
                <input
                  value={friendSearchInput}
                  placeholder="搜索用户"
                  onChange={(event) => setFriendSearchInput(event.target.value)}
                />
                <button type="submit" disabled={friendLoading || authStatus !== "authenticated"}>
                  搜索
                </button>
              </div>
              {friendSearchHint ? <p className="listen-status">{friendSearchHint}</p> : null}
            </form>
            <div className="listen-list stage-list">
              {friendSearchResults.length ? (
                friendSearchResults.map((result) => {
                  const incomingRequest = incomingFriendRequestByUserId.get(result.user.id);
                  const primaryLabel = friendRelationActionLabel(result.relationStatus);
                  const disabled =
                    result.relationStatus === "friend" ||
                    result.relationStatus === "outgoing_pending" ||
                    result.relationStatus === "self" ||
                    friendActionBusyId === result.user.id ||
                    (result.relationStatus === "incoming_pending" && !incomingRequest);
                  return (
                    <div className="listen-list-row detail friend-search-result-row" key={result.user.id}>
                      <UserAvatar user={result.user} size="sm" />
                      <div>
                        <strong>{result.user.nickname || result.user.email}</strong>
                        <small>{result.user.email}</small>
                      </div>
                      <span className={`relation-badge relation-${result.relationStatus}`}>{friendRelationLabel(result.relationStatus)}</span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (result.relationStatus === "incoming_pending" && incomingRequest) {
                            void handleRespondFriendRequest(incomingRequest.id, "accept");
                            return;
                          }
                          if (result.relationStatus === "none") {
                            void handleSendFriendRequest(result.user.id);
                          }
                        }}
                      >
                        {primaryLabel}
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="listen-status">{friendSearchQuery ? "暂时没有匹配结果。" : "输入关键词后显示结果。"}</p>
              )}
            </div>
          </StageSection>

          <StageSection index={1} title="我的好友" hint={friendList.length ? `${friendList.length} 位好友` : "还没有好友"}>
            {friendMessage ? <p className="listen-status warning">{friendMessage}</p> : null}
            <div className="listen-list stage-list">
              {friendList.length ? (
                friendList.map((friend) => (
                  <div className="listen-list-row detail" key={friend.user.id}>
                    <UserAvatar user={friend.user} size="sm" />
                    <div>
                      <strong>{friend.user.nickname || friend.user.email}</strong>
                      <small>{friend.user.email}</small>
                    </div>
                    <div className="listen-row-actions">
                      <button
                        type="button"
                        onClick={() => void handleInviteFriendToListen(friend.user.id)}
                        disabled={!listenRoom || friendActionBusyId === friend.user.id}
                      >
                        邀请
                      </button>
                      <button type="button" className="ghost" onClick={() => void handleDeleteFriend(friend.user.id)} disabled={friendActionBusyId === friend.user.id}>
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <StageEmpty title="好友列表为空" description="先在上方搜索并添加好友，再邀请进房间。" />
              )}
            </div>
          </StageSection>
        </div>
      ) : null}

      {listenDrawerTab === "activity" ? (
        <div className="stage-flow">
          {friendMessage ? <p className="listen-status warning">{friendMessage}</p> : null}
          <div className="stage-segmented drawer-subtabbar" role="tablist" aria-label="一起听动态分类">
            {listenActivityTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={listenActivityTab === tab.id}
                className={listenActivityTab === tab.id ? "active" : ""}
                onClick={() => setListenActivityTab(tab.id)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>

          {listenActivityTab === "listen-invites" ? (
            <StageSection
              index={0}
              title="一起听邀请"
              hint="接受后会进入对方房间"
              action={
                <button type="button" className="ghost" onClick={() => void refreshFriendPanelData()} disabled={friendLoading}>
                  刷新
                </button>
              }
            >
              <div className="listen-list stage-list">
                {listenInvites.length ? (
                  listenInvites.map((invite) => (
                    <div className="listen-list-row detail" key={invite.id}>
                      <UserAvatar user={invite.inviter} size="sm" />
                      <div>
                        <strong>{invite.inviter.nickname || invite.inviter.email}</strong>
                        <small>
                          {invite.memberCount} 人房间 · 邀请码 {invite.inviteCode}
                        </small>
                      </div>
                      <div className="listen-row-actions">
                        <button type="button" onClick={() => void handleRespondListenInvite(invite.id, "accept")} disabled={friendActionBusyId === invite.id}>
                          加入
                        </button>
                        <button type="button" className="ghost" onClick={() => void handleRespondListenInvite(invite.id, "reject")} disabled={friendActionBusyId === invite.id}>
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <StageEmpty title="暂无邀请" description="好友邀请你一起听时会显示在这里。" />
                )}
              </div>
            </StageSection>
          ) : null}

          {listenActivityTab === "friend-requests" ? (
            <StageSection index={0} title="好友请求" hint={`${friendRequests.incoming.length + friendRequests.outgoing.length} 条待处理`}>
              <div className="listen-list stage-list">
                {friendRequests.incoming.map((request) => (
                  <div className="listen-list-row detail" key={request.id}>
                    <UserAvatar user={request.requester} size="sm" />
                    <div>
                      <strong>{request.requester.nickname || request.requester.email}</strong>
                      <small>{request.requester.email}</small>
                    </div>
                    <div className="listen-row-actions">
                      <button type="button" onClick={() => void handleRespondFriendRequest(request.id, "accept")} disabled={friendActionBusyId === request.id}>
                        同意
                      </button>
                      <button type="button" className="ghost" onClick={() => void handleRespondFriendRequest(request.id, "reject")} disabled={friendActionBusyId === request.id}>
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
                {friendRequests.outgoing.map((request) => (
                  <div className="listen-list-row detail" key={request.id}>
                    <UserAvatar user={request.addressee} size="sm" />
                    <div>
                      <strong>{request.addressee.nickname || request.addressee.email}</strong>
                      <small>等待对方确认</small>
                    </div>
                    <div className="listen-row-actions">
                      <button type="button" className="ghost" onClick={() => void handleRespondFriendRequest(request.id, "cancel")} disabled={friendActionBusyId === request.id}>
                        取消
                      </button>
                    </div>
                  </div>
                ))}
                {!friendRequests.incoming.length && !friendRequests.outgoing.length ? (
                  <StageEmpty title="没有待处理请求" description="发出或收到的好友申请会出现在这里。" />
                ) : null}
              </div>
            </StageSection>
          ) : null}
        </div>
      ) : null}
    </StagePanelShell>
  );

  const mobilePrimaryTabs: Array<{ id: string; tab?: NavTab; label: string; icon: ReactNode; onSelect: () => void }> = [
    {
      id: "home",
      tab: "home",
      label: "首页",
      icon: <HomeIcon />,
      onSelect: () => {
        setHomePlaylistView("featured");
        goTab("home");
      }
    },
    {
      id: "search",
      tab: "search",
      label: "搜索",
      icon: <SearchIcon />,
      onSelect: () => goTab("search")
    },
    {
      id: "library",
      tab: "library",
      label: "音乐库",
      icon: <LibraryIcon />,
      onSelect: () => goTab("library", "library-favorites")
    },
    {
      id: "listen",
      label: "一起听",
      icon: <ListenIcon />,
      onSelect: openListenPanel
    }
  ];

  const playerDock = (
    <PlayerDock
      variant="global"
      dockRef={playerDockRef}
      hideTrackMeta={detailPhase === "opening" || detailPhase === "open"}
      returningTrackMeta={detailPhase === "closing"}
      isMobile={isMobileUi}
      canOpenDetail={canOpenDetail}
      title={currentTrack?.name ?? "还没有播放音乐"}
      subtitle={currentTrack?.artists.map((item) => item.name).join(" / ") ?? "从发现页开始探索"}
      coverUrl={currentCoverUrl || DEFAULT_COVER_URL}
      progressDegrees={mainDockProgressDegrees}
      hasProgress={hasMainDockProgress}
      isPlaying={player.isPlaying}
      loading={controller.loadingSource}
      controlDisabled={controlDisabled}
      modeLabel={modeMeta.label}
      modeIcon={modeMeta.icon}
      volume={player.volume}
      volumePercent={volumePercent}
      isMuted={isMuted}
      playIcon={<PlayIcon />}
      pauseIcon={<PauseIcon />}
      previousIcon={<PreviousIcon />}
      nextIcon={<NextIcon />}
      queueIcon={<QueueIcon />}
      volumeIcon={<VolumeIcon muted={isMuted} />}
      spinner={<Spinner />}
      mobileTabs={mobilePrimaryTabs.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        active: item.tab ? activeTab === item.tab : false,
        onSelect: item.onSelect
      }))}
      onOpenDetail={(interaction) => {
        if (isDetailMounted) {
          return;
        }
        if (playerDockRef.current) {
          openDetail(playerDockRef.current, interaction);
        }
      }}
      onOpenQueue={isDetailMounted ? openQueuePanelFromDetail : openQueuePanel}
      onPrevious={() => player.previousTrackByUser()}
      onNext={() => player.nextTrackByUser()}
      onTogglePlay={() => player.togglePlay()}
      onNextMode={() => player.nextMode()}
      onVolume={(volume) => player.setVolume(volume)}
      onToggleMute={toggleMute}
    />
  );

  const detailSharedTrackMeta =
    detailDockOrigin && detailPhase !== "closed" && typeof document !== "undefined"
      ? createPortal(
          <div
            className={`detail-shared-track-meta phase-${detailPhase}`}
            aria-hidden="true"
            style={
              {
                "--detail-origin-left": `${detailDockOrigin.left}px`,
                "--detail-origin-top": `${detailDockOrigin.top}px`,
                "--detail-origin-width": `${detailDockOrigin.width}px`,
                "--detail-origin-height": `${detailDockOrigin.height}px`
              } as CSSProperties
            }
          >
            <div className="detail-shared-track-cover" style={{ backgroundImage: `url(${currentCoverUrl || DEFAULT_COVER_URL})` }} />
            <div className="detail-shared-track-copy">
              <p>{currentTrack?.name ?? "还没有播放音乐"}</p>
              <span>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "从发现页开始探索"}</span>
            </div>
          </div>,
          document.body
        )
      : null;

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

  const accountManagerContent = authStatus === "authenticated" || showDesktopSettings ? (
    <StagePanelShell
      className="stage-panel-account"
      kicker={accountPanelMode === "settings" ? "Preferences" : "Account"}
      title={accountPanelTitle}
      description={
        authStatus === "authenticated"
          ? `${accountDisplayName} · ${accountOverviewSyncText}`
          : "调整主题与桌面偏好，登录后可管理资料"
      }
      status={
        authStatus === "authenticated" ? (
          <>
            <span className={`account-tier ${musicUnblockEnabled ? "advanced" : ""}`}>{accountTierText}</span>
            <span className="relation-badge ok">{accountStateText}</span>
          </>
        ) : (
          <span className="relation-badge muted">访客</span>
        )
      }
      onClose={closeAccountManager}
      nav={accountManagerTabs.map((tab) => ({
        id: tab.id,
        label: tab.id === "desktop" ? (hasDesktopContext ? "桌面" : "外观") : tab.label,
        disabled: tab.disabled
      }))}
      activeNav={accountManagerTab}
      onNav={(id) => setAccountManagerTab(id as AccountManagerTab)}
      navAriaLabel="账户管理标签"
      stageKey={`account-${accountManagerTab}`}
      footer={
        authStatus === "authenticated" ? (
          <button type="button" className="ghost stage-footer-logout" onClick={() => void handleLogout()}>
            退出登录
          </button>
        ) : null
      }
    >
      {accountFeedbackMessage ? (
        <p className={`account-manager-status stage-feedback ${accountFeedbackTone === "error" ? "error" : ""}`}>
          {accountFeedbackMessage}
        </p>
      ) : null}

      {accountManagerTab === "profile" ? (
        authStatus === "authenticated" ? (
          <div className="stage-flow">
            <StageSection index={0} title="头像" hint="展示给好友与一起听成员">
              <div className="stage-profile-hero">
                <UserAvatar user={authUser} size="lg" />
                <div className="stage-profile-hero-copy">
                  <strong>{accountDisplayName}</strong>
                  <small>{accountOverviewTierText}</small>
                </div>
                <div className="stage-profile-hero-actions">
                  <input
                    ref={avatarInputRef}
                    className="account-avatar-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => void handleAvatarFileChange(event.target.files?.[0])}
                  />
                  <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                    {avatarUploading ? "上传中" : "更改头像"}
                  </button>
                  {authUser?.avatarUrl ? (
                    <button type="button" className="ghost" onClick={() => void handleDeleteAvatar()} disabled={avatarUploading}>
                      移除
                    </button>
                  ) : null}
                </div>
              </div>
            </StageSection>
            <StageSection index={1} title="昵称" hint="保存后即时同步到云端">
              <form
                className="account-manager-form stage-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleUpdateProfile();
                }}
              >
                <label className="account-form-label">
                  昵称
                  <input
                    type="text"
                    value={profileNicknameInput}
                    maxLength={64}
                    disabled={profileSaving}
                    onChange={(event) => setProfileNicknameInput(event.target.value)}
                  />
                </label>
                <button type="submit" className="account-form-submit stage-btn-primary" disabled={profileSaving || !profileNicknameInput.trim()}>
                  {profileSaving ? "保存中..." : "保存昵称"}
                </button>
              </form>
            </StageSection>
          </div>
        ) : (
          <StageEmpty
            title="请先登录"
            description="登录后可同步音乐库、管理好友并使用一起听。"
            action={
              isAccountEnabled ? (
                <div className="stage-primary-actions">
                  <button type="button" className="stage-btn-primary" onClick={openLoginDialog}>
                    登录
                  </button>
                  <button type="button" className="ghost" onClick={openRegisterDialog}>
                    注册
                  </button>
                </div>
              ) : null
            }
          />
        )
      ) : null}

      {accountManagerTab === "security" ? (
        authStatus === "authenticated" ? (
          <StageSection index={0} title="修改密码" hint="新密码至少 10 位，含大小写字母、数字和符号">
            <form
              className="account-manager-form two stage-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleChangePassword();
              }}
            >
              <label className="account-form-label">
                当前密码
                <input
                  type="password"
                  value={passwordFormState.oldPassword}
                  disabled={passwordSaving}
                  onChange={(event) => setPasswordFormState((previous) => ({ ...previous, oldPassword: event.target.value }))}
                />
              </label>
              <label className="account-form-label">
                新密码
                <input
                  type="password"
                  value={passwordFormState.newPassword}
                  disabled={passwordSaving}
                  onChange={(event) => setPasswordFormState((previous) => ({ ...previous, newPassword: event.target.value }))}
                />
              </label>
              <button type="submit" className="account-form-submit stage-btn-primary" disabled={passwordSaving}>
                {passwordSaving ? "修改中..." : "修改密码"}
              </button>
            </form>
          </StageSection>
        ) : (
          <StageEmpty
            title="请先登录"
            description="登录后可管理账户安全。"
            action={
              isAccountEnabled ? (
                <button type="button" className="stage-btn-primary" onClick={openLoginDialog}>
                  登录
                </button>
              ) : null
            }
          />
        )
      ) : null}

      {accountManagerTab === "advanced" ? (
        authStatus === "authenticated" ? (
          <StageSection index={0} title="高级播放" hint={musicUnblockStatusText}>
            {musicUnblockEnabled ? (
              <div className="stage-status-card ok">
                <strong>已启用高级资格</strong>
                <p>{authPlaybackAuthorization?.inviteLabel ? `兑换码：${authPlaybackAuthorization.inviteLabel}` : "可使用完整播放能力"}</p>
              </div>
            ) : (
              <form
                className="music-unblock-form stage-join-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRedeemMusicUnblockInvite();
                }}
              >
                <input
                  value={musicUnblockInviteInput}
                  onChange={(event) => {
                    setMusicUnblockInviteInput(event.target.value);
                    setMusicUnblockError(null);
                    setMusicUnblockMessage(null);
                  }}
                  placeholder="输入兑换码"
                  disabled={musicUnblockLoading}
                  autoComplete="off"
                />
                <button type="submit" className="stage-btn-primary" disabled={musicUnblockLoading || !musicUnblockInviteInput.trim()}>
                  {musicUnblockLoading ? "兑换中" : "兑换"}
                </button>
              </form>
            )}
            {musicUnblockMessage ? <p className="music-unblock-status">{musicUnblockMessage}</p> : null}
            {musicUnblockError ? <p className="music-unblock-status error">{musicUnblockError}</p> : null}
          </StageSection>
        ) : (
          <StageEmpty
            title="请先登录"
            description="登录后可查看并兑换高级资格。"
            action={
              isAccountEnabled ? (
                <button type="button" className="stage-btn-primary" onClick={openLoginDialog}>
                  登录
                </button>
              ) : null
            }
          />
        )
      ) : null}

      {accountManagerTab === "desktop" && showDesktopSettings ? (
        <div className="stage-flow">
          <StageSection index={0} title="界面主题" hint="深色舞台或浅色界面">
            <div className="settings-theme-card stage-theme-card">
              <div className="settings-theme-copy">
                <strong>主题切换</strong>
                <p>立即作用于当前窗口</p>
              </div>
              <div className="theme-switch-mobile settings-panel-switch">{themeSwitchControl}</div>
            </div>
          </StageSection>

          {desktopContext ? (
            <StageSection index={1} title="桌面客户端" hint={`版本 ${desktopContext.appVersion}`}>
              <div className="stage-meta-grid">
                <p className="drawer-meta-stat">
                  <span>缓存目录</span>
                  <strong className="stage-meta-code">{desktopContext.profileFolder}</strong>
                </p>
                <p className="drawer-meta-stat">
                  <span>主页</span>
                  <strong className="stage-meta-code">{desktopContext.homeUrl}</strong>
                </p>
              </div>
              <div className="account-manager-desktop-actions stage-action-row">
                {desktopCapabilities?.openProfileFolder ? (
                  <button type="button" disabled={desktopActionPending !== null} onClick={() => void handleDesktopHostAction("open-profile-folder")}>
                    打开缓存目录
                  </button>
                ) : null}
                {desktopCapabilities?.clearWebCache ? (
                  <button type="button" disabled={desktopActionPending !== null} onClick={() => void handleDesktopHostAction("clear-web-cache")}>
                    清理缓存并重载
                  </button>
                ) : null}
                {desktopCapabilities?.openDownloadPage ? (
                  <button type="button" disabled={desktopActionPending !== null} onClick={() => void handleDesktopHostAction("open-download-page")}>
                    打开下载页
                  </button>
                ) : null}
                {desktopCapabilities?.openHomeInBrowser ? (
                  <button type="button" className="ghost" disabled={desktopActionPending !== null} onClick={() => void handleDesktopHostAction("open-home-in-browser")}>
                    在浏览器打开网页版
                  </button>
                ) : null}
              </div>
              {desktopActionState.message ? <p className="account-manager-status">{desktopActionState.message}</p> : null}
              {desktopActionState.error ? <p className="account-manager-status error">{desktopActionState.error}</p> : null}
            </StageSection>
          ) : (
            <StageSection index={1} title="运行环境" hint="当前为网页端">
              <StageEmpty title="网页端" description="桌面专属操作在客户端内可用。" />
            </StageSection>
          )}
        </div>
      ) : null}
    </StagePanelShell>
  ) : null;

  const mobileLibraryTools = isMobileUi ? (
    <section className="mobile-library-tools" aria-label="我的工具">
      <article className="mobile-library-tool-card account">
        <div className="mobile-library-tool-title">
          <span>账号</span>
          <small>{accountEntryStatusText}</small>
        </div>
        {isAccountEnabled ? (
          authStatus === "authenticated" ? (
            <button type="button" className="mobile-library-account-row" onClick={openAccountManager}>
              <UserAvatar user={authUser} size="sm" />
              <span>
                <strong>{accountDisplayName}</strong>
                <small>账户管理 · {accountTierText}</small>
              </span>
            </button>
          ) : (
            <div className="mobile-library-account-row passive">
              <UserAvatar user={authUser} size="sm" />
              <span>
                <strong>{accountDisplayName}</strong>
                <small>{accountSurfaceDescription}</small>
              </span>
              <button type="button" onClick={openLoginDialog}>
                登录同步
              </button>
            </div>
          )
        ) : (
          <p className="mobile-library-tool-note">账号服务未启用</p>
        )}
        {hasAuthRefreshIssue ? (
          <div className="account-refresh-warning mobile-inline">
            <p>{authRefreshIssue}</p>
            <button type="button" onClick={() => void handleAuthRefreshRetry()}>
              重试连接
            </button>
          </div>
        ) : null}
      </article>

      <div className="mobile-library-compact-tools">
        <article className="mobile-library-tool-card split compact">
          <div className="mobile-library-tool-title">
            <span>主题</span>
            <small>{theme === "dark" ? "暗色" : "明亮"}</small>
          </div>
          <div className="theme-switch-mobile compact">{themeSwitchControl}</div>
        </article>

        <button type="button" className="mobile-library-tool-card listen-action compact" onClick={openListenPanel}>
          <span>一起听</span>
          <small>{listenRoom ? `${listenRoom.members.length} 人在线` : "好友邀请与多人同步"}</small>
        </button>
      </div>
    </section>
  ) : null;

  const librarySegmentedPillStyle = {
    "--lib-seg-thumb-x": `${librarySegmentedThumb.x}px`,
    "--lib-seg-thumb-w": `${librarySegmentedThumb.width}px`,
    "--lib-seg-count": LIBRARY_VIEW_OPTIONS.length
  } as CSSProperties;

  return (
    <main
      ref={shellRef}
      className={[
        "spotify-shell immersive-shell stage-shell",
        desktopHost.isDesktopHost ? "desktop-host-shell" : "",
        isDetailMounted ? "detail-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--ambient-bg-a": currentPalette.bgA,
          "--ambient-bg-b": currentPalette.bgB,
          "--ambient-glow": currentPalette.glow
        } as CSSProperties
      }
    >
      <audio ref={controller.audioRef} preload="auto" />
      {listenPanelOpen && listenPanelPhase !== "closed" ? (
        <section
          className={`home-playlist-drawer-overlay phase-${listenPanelPhase} utility-drawer-overlay`}
          aria-label="一起听房间"
          onClick={closeListenPanel}
        >
          <div className={`home-playlist-drawer-backdrop phase-${listenPanelPhase}`} />
          <aside
            ref={listenDrawerRef}
            className={`home-playlist-drawer phase-${listenPanelPhase} utility-drawer listen-utility-drawer`}
            role="dialog"
            aria-modal="true"
            aria-label="一起听"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => trapTabWithin(listenDrawerRef.current, event)}
          >
            {listenPanelContent}
          </aside>
        </section>
      ) : null}
      {accountManagerOpen && accountManagerContent && accountManagerPhase !== "closed" ? (
        <section className={`home-playlist-drawer-overlay phase-${accountManagerPhase} utility-drawer-overlay`} aria-label="账户管理" onClick={closeAccountManager}>
          <div className={`home-playlist-drawer-backdrop phase-${accountManagerPhase}`} />
          <aside
            ref={accountManagerDrawerRef}
            className={`home-playlist-drawer phase-${accountManagerPhase} utility-drawer account-manager-drawer`}
            role="dialog"
            aria-modal="true"
            aria-label="账户管理"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => trapTabWithin(accountManagerDrawerRef.current, event)}
          >
            {accountManagerContent}
          </aside>
        </section>
      ) : null}

      {!isMobileUi ? (
        <FloatingNav
          active={activeTab}
          onSelect={(destination) => {
            if (destination === "listen") {
              openListenPanel();
              return;
            }
            if (destination === "home") {
              setHomePlaylistView("featured");
            }
            goTab(destination, destination === "library" ? "library-favorites" : undefined);
          }}
          onProfile={() => {
            if (isAccountEnabled) {
              openAccountManager();
            }
          }}
          onSettings={openDesktopSettings}
        />
      ) : null}

      <section className="spotify-layout immersive-layout without-right-rail">
        <section className={`spotify-main tab-${activeTab}`.trim()}>
          {activeTab === "home" ? (
            <>
              {homePlaylistView === "featured" ? (
                <EditorialHome
                  hero={editorialHero}
                  featured={editorialFeaturedItems}
                  recent={editorialExploreItems}
                  onSelect={(item) => {
                    void handleDiscoverItem(item);
                  }}
                  onMore={() => setHomePlaylistView("more")}
                  onExplore={() => goTab("search")}
                  error={discoverError}
                />
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
                        <div className="home-playlist-cover" style={toCoverBackgroundStyle(item.coverUrl, SMALL_COVER_WIDTHS.homeCard)} />
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
            <SearchPanel
              keyword={search.keyword}
              onKeywordChange={search.setKeyword}
              searchMode={search.searchMode}
              onSwitchMode={search.switchSearchMode}
              status={search.status}
              error={search.error}
              trackResult={search.trackResult}
              artistResult={search.artistResult}
              playlistResult={search.playlistResult}
              searchAssist={search.searchAssist}
              hotAssistCandidates={search.hotAssistCandidates}
              suggestAssistCandidates={search.suggestAssistCandidates}
              visibleHotAssistCount={search.visibleHotAssistCount}
              visibleSuggestAssistCount={search.visibleSuggestAssistCount}
              searchLoadingMore={search.searchLoadingMore}
              canLoadMore={search.canLoadMore}
              loadingPlaceholderCount={search.loadingPlaceholderCount}
              activeResultCount={search.activeResultCount}
              artistDetail={search.artistDetail}
              artistDetailLoading={search.artistDetailLoading}
              artistDetailError={search.artistDetailError}
              inputRef={search.inputRef as Ref<HTMLInputElement>}
              resultsBodyRef={search.resultsBodyRef as Ref<HTMLDivElement>}
              hotAssistRowRef={search.hotAssistRowRef as Ref<HTMLDivElement>}
              suggestAssistRowRef={search.suggestAssistRowRef as Ref<HTMLDivElement>}
              favoriteSet={favoriteSet}
              currentTrackId={currentTrackId}
              isPlaying={player.isPlaying}
              getTrackCover={(track) => resolveTrackCover(track, { width: 88 })}
              onSubmit={() => {
                void search.doSearch();
              }}
              onApplyAssistKeyword={search.applyKeywordAndSearch}
              onOpenArtist={(artist) => {
                void search.openArtistDetail(artist);
              }}
              onCloseArtistDetail={search.closeArtistDetail}
              onOpenPlaylist={openSearchPlaylist}
              onPlayTrack={(item) => {
                player.playTrackNow(item);
                player.setPlaying(true);
              }}
              onToggleFavorite={(item) => player.toggleFavorite(item)}
              onPlayArtistTopTracks={playArtistTopTracks}
              onAddArtistTopTracksToQueue={addArtistTopTracksToQueue}
            />
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

              {mobileLibraryTools}

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
                          coverUrl={resolveTrackCover(track, { width: 88 })}
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
                          coverUrl={resolveTrackCover(track, { width: 88 })}
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
                          <div className="library-imported-cover" style={toCoverBackgroundStyle(playlist.coverUrl, SMALL_COVER_WIDTHS.importedPlaylist)} />
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

      </section>

      {/* Keep one shared dock for home + detail so the control bar never “changes skin”. */}
      {dockPortalTarget ? createPortal(playerDock, dockPortalTarget) : playerDock}
      {detailSharedTrackMeta}

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

                {homePlaylistPanel.loading ? (
                  <div className="home-playlist-skeleton-shell">
                    <div className="home-playlist-drawer-list home-playlist-skeleton-list" ref={homePlaylistListRef}>
                      {Array.from({ length: 8 }, (_, index) => (
                        <div className="home-playlist-skeleton-item" key={index}>
                          <div className="home-playlist-skeleton-row" aria-hidden="true">
                            <div className="cover" />
                            <div className="main" />
                            <div className="meta" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {homePlaylistPanel.error ? (
                  <div className="home-playlist-drawer-list" ref={homePlaylistListRef}>
                    <p className="error error-inline">{homePlaylistPanel.error}</p>
                  </div>
                ) : null}
                {!homePlaylistPanel.loading && !homePlaylistPanel.error && !homePlaylistPanel.tracks.length ? (
                  <div className="home-playlist-drawer-list" ref={homePlaylistListRef}>
                    <p className="spotify-empty">{homePlaylistPanel.sourceType === "queue" ? "当前播放队列为空。" : "该歌单暂时没有可播放歌曲。"}</p>
                  </div>
                ) : null}
                {!homePlaylistPanel.loading && !homePlaylistPanel.error && homePlaylistPanel.tracks.length ? (
                  <AnimatedList
                    items={homePlaylistPanel.tracks}
                    className="home-playlist-track-shell"
                    listClassName="home-playlist-drawer-list"
                    itemClassName="home-playlist-track-motion"
                    listRef={homePlaylistListRef}
                    getItemKey={(track, index) => `panel-${track.id}-${index}`}
                    showGradients
                    enableArrowNavigation={false}
                    renderItem={(track, index) => {
                      const canExpandTrack = homePlaylistPanel.sourceType !== "queue" && Boolean(activePanelTrackSourceId);
                      const isExpanded =
                        canExpandTrack &&
                        expandedPanelTrackId === track.id &&
                        expandedPanelTrackSourceId === activePanelTrackSourceId;
                      const artistNames = track.artists.map((item) => item.name).join(" / ") || "未知歌手";
                      const albumName = track.album?.name?.trim() || "未知专辑";
                      const rowClassName = `home-playlist-track-row ${track.id === currentTrackId ? "active" : ""} ${
                        track.id === locatedPanelTrackId ? "located" : ""
                      } ${isExpanded ? "expanded" : ""}`.trim();

                      if (!canExpandTrack) {
                        return (
                          <article className={rowClassName} ref={bindPanelTrackRowRef(index)} data-panel-track-index={index}>
                            <div
                              className="home-playlist-track-cover"
                              style={{ backgroundImage: `url(${resolveTrackCover(track, { width: SMALL_COVER_WIDTHS.playlistRow })})` }}
                            />
                            <button type="button" className="home-playlist-track-play" onClick={() => playHomePlaylistTrackAt(index)}>
                              <span className="home-playlist-track-line">
                                <span>{`${index + 1}. ${track.name}`}</span>
                                {track.id === currentTrackId ? <PlayingIndicator active={player.isPlaying} /> : null}
                              </span>
                              <small>{artistNames}</small>
                            </button>
                            {!isMobileUi ? (
                              <button type="button" className="home-playlist-track-queue" onClick={() => player.addToQueue(track, true)}>
                                加入队列
                              </button>
                            ) : null}
                          </article>
                        );
                      }

                      return (
                        <article
                          className={rowClassName}
                          ref={bindPanelTrackRowRef(index)}
                          data-panel-track-index={index}
                          data-panel-expandable-row="true"
                          data-panel-track-id={track.id}
                          data-panel-track-source-id={activePanelTrackSourceId ?? undefined}
                        >
                          <div className="home-playlist-track-top">
                            <button
                              type="button"
                              className="home-playlist-track-main"
                              onClick={() => toggleExpandedPanelTrack(track.id)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "收起" : "展开"}歌曲 ${track.name}`}
                            >
                              <div
                                className="home-playlist-track-cover"
                                style={{ backgroundImage: `url(${resolveTrackCover(track, { width: SMALL_COVER_WIDTHS.playlistRow })})` }}
                              />
                              <span className="home-playlist-track-copy">
                                <span className="home-playlist-track-line">
                                  <span>{`${index + 1}. ${track.name}`}</span>
                                  {track.id === currentTrackId ? <PlayingIndicator active={player.isPlaying} /> : null}
                                </span>
                                <small>{artistNames}</small>
                              </span>
                            </button>
                            <div className="home-playlist-track-side">
                              <button
                                type="button"
                                className="home-playlist-track-icon-action primary"
                                aria-label={`播放歌曲 ${track.name}`}
                                title={`播放歌曲 ${track.name}`}
                                onClick={() => playHomePlaylistTrackAt(index)}
                              >
                                <PlayIcon />
                              </button>
                              {!isMobileUi ? (
                                <button
                                  type="button"
                                  className="home-playlist-track-icon-action"
                                  aria-label={`加入队列 ${track.name}`}
                                  title={`加入队列 ${track.name}`}
                                  onClick={() => player.addToQueue(track, true)}
                                >
                                  <QueueIcon />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <AnimatePresence initial={false}>
                            {isExpanded ? (
                              <motion.div
                                key={`expanded-${track.id}-${activePanelTrackSourceId ?? "panel"}`}
                                className="home-playlist-track-expanded"
                                layout
                                initial={{ opacity: 0, y: -10, scale: 0.985 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                              >
                                <motion.div
                                  className="home-playlist-track-expanded-cover"
                                  style={{ backgroundImage: `url(${resolveTrackCover(track, { width: 160 })})` }}
                                  aria-hidden="true"
                                  initial={{ scale: 0.92, rotate: -3 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                  exit={{ scale: 0.95, rotate: -1.5 }}
                                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                                />
                                <motion.div
                                  className="home-playlist-track-expanded-copy"
                                  initial={{ opacity: 0, y: 12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 8 }}
                                  transition={{ duration: 0.22, delay: 0.02, ease: [0.22, 1, 0.36, 1] }}
                                >
                                  <span className="home-playlist-track-expanded-kicker">
                                    {track.id === currentTrackId ? "正在播放" : "歌曲详情"}
                                  </span>
                                  <strong>{track.name}</strong>
                                  <p>{artistNames}</p>
                                  <small>
                                    {albumName} · {formatMs(track.durationMs)}
                                  </small>
                                </motion.div>
                                <motion.div
                                  className="home-playlist-track-expanded-actions"
                                  initial={{ opacity: 0, y: 12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 8 }}
                                  transition={{ duration: 0.22, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
                                >
                                  <button type="button" onClick={() => playHomePlaylistTrackAt(index)}>
                                    立即播放
                                  </button>
                                  <button type="button" className="ghost" onClick={() => player.addToQueue(track, true)}>
                                    加入队列
                                  </button>
                                </motion.div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </article>
                      );
                    }}
                  />
                ) : null}
              </aside>
            </section>,
            playlistPortalTarget
          )
        : null}

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {accountDialogOpen ? (
                <motion.section
                  key="account-auth-dialog"
                  className="account-dialog-overlay stage-auth-overlay"
                  role="dialog"
                  aria-modal="true"
                  aria-label="账号登录"
                  variants={withReducedMotion(overlayVariants, prefersReducedMotion)}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
              <motion.button
                type="button"
                className="account-dialog-backdrop stage-auth-backdrop"
                aria-label="关闭登录窗口"
                onClick={closeAccountDialog}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: prefersReducedMotion ? 0.01 : 0.28 }}
              />
              <motion.form
                ref={accountDialogPanelRef}
                className={`account-dialog-panel stage-auth-panel ${isMobileUi ? "mobile" : "desktop"}`.trim()}
                tabIndex={-1}
                autoComplete="off"
                variants={withReducedMotion(isMobileUi ? sheetMobileVariants : sheetVariants, prefersReducedMotion)}
                initial="hidden"
                animate="visible"
                exit="exit"
                onKeyDown={(event) => trapTabWithin(accountDialogPanelRef.current, event)}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!authFormSubmitting) {
                    void submitAuthForm();
                  }
                }}
              >
                <div className="stage-auth-glow" aria-hidden="true" />
                <header className="account-dialog-head stage-auth-head">
                  <div className="stage-auth-head-copy">
                    <span className="stage-auth-kicker">Echo Stage · Account</span>
                    <h3>{authFormMode === "login" ? "欢迎回来" : "创建你的舞台账号"}</h3>
                    <p className="stage-auth-desc">
                      {authFormMode === "login"
                        ? "登录后同步音乐库、好友与一起听进度。"
                        : "注册后自动开启云同步，数据跟着你走。"}
                    </p>
                  </div>
                  <button type="button" className="stage-auth-close ghost" onClick={closeAccountDialog}>
                    关闭
                  </button>
                </header>

                <div className="account-dialog-tabs stage-auth-tabs" role="tablist" aria-label="登录或注册">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authFormMode === "login"}
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
                    role="tab"
                    aria-selected={authFormMode === "register"}
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

                {/*
                  Keep shared fields mounted so the panel height can layout-animate.
                  Only the extra nickname field expands/collapses.
                */}
                <div className="stage-auth-fields">
                  <label className="account-form-label stage-auth-field">
                    邮箱
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={authFormState.email}
                      disabled={authFormSubmitting}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onChange={(event) => setAuthFormState((previous) => ({ ...previous, email: event.target.value }))}
                    />
                  </label>
                  <label className="account-form-label stage-auth-field">
                    密码
                    <input
                      type="password"
                      placeholder={authFormMode === "register" ? "至少 10 位，含大小写、数字与符号" : "输入密码"}
                      value={authFormState.password}
                      disabled={authFormSubmitting}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setAuthFormState((previous) => ({ ...previous, password: event.target.value }))}
                    />
                  </label>
                  {/*
                    CSS grid 0fr→1fr expand (smoother than Motion height:auto).
                    Field stays mounted so panel height interpolates without measure jank.
                  */}
                  <div
                    className={`stage-auth-extra ${authFormMode === "register" ? "is-open" : ""}`.trim()}
                    aria-hidden={authFormMode !== "register"}
                  >
                    <div className="stage-auth-extra-inner">
                      <label className="account-form-label stage-auth-field">
                        昵称（可选）
                        <input
                          type="text"
                          placeholder="例如：MiningQwQ"
                          value={authFormState.nickname}
                          disabled={authFormSubmitting || authFormMode !== "register"}
                          tabIndex={authFormMode === "register" ? 0 : -1}
                          autoComplete="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          onChange={(event) => setAuthFormState((previous) => ({ ...previous, nickname: event.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {authFormError ? <p className="account-form-error stage-auth-error">{authFormError}</p> : null}

                <button type="submit" className="account-form-submit stage-auth-submit" disabled={authFormSubmitting}>
                  {authFormSubmitting ? "处理中..." : authFormMode === "login" ? "登录并同步" : "注册并同步"}
                </button>
                <p className="account-form-note stage-auth-note">
                  未登录时仍可本地收听；登录后自动开启云同步。
                </p>
              </motion.form>
                </motion.section>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}

      {isDetailMounted ? (
        <section className="player-detail-overlay" role="dialog" aria-modal="true" aria-label="播放详情">
          <div className={`player-detail-backdrop phase-${detailPhase}`.trim()} onClick={closeDetail} />
          <article
            ref={detailScreenRef}
            className={`player-detail-screen stage-detail phase-${detailPhase}`.trim()}
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

            <header className="detail-topbar stage-detail-topbar">
              <button className="detail-collapse-btn" onClick={closeDetail} aria-label="收起播放器">
                <CollapseIcon />
              </button>
              <div className="detail-tab-row stage-detail-tabs">
                <button type="button" className={detailTab === "lyric" ? "active" : ""} onClick={() => setDetailTab("lyric")}>
                  歌词
                </button>
                <button type="button" className={detailTab === "meta" ? "active" : ""} onClick={() => setDetailTab("meta")}>
                  歌曲信息
                </button>
              </div>
            </header>

            <div className="detail-stage stage-detail-stage">
              <section className="detail-stage-left detail-shared-art-target" aria-hidden="true" />

              <section className="detail-stage-right">
                {detailTab === "meta" ? (
                  <div className="detail-meta-list stage-detail-meta">
                    <div className="detail-meta-copy">
                      <p>
                        <span>时长</span>
                        <strong>{formatMs(currentTrack?.durationMs ?? 0)}</strong>
                      </p>
                      {insightLoading ? <p className="stage-detail-hint">正在加载歌曲洞察...</p> : null}
                      {trackInsight?.creators.length ? (
                        <p>
                          <span>创作者</span>
                          <strong>
                            {isMobileUi
                              ? trackInsight.creators
                                  .slice(0, 2)
                                  .map((creator) => `${creator.name}${creator.role ? `（${creator.role}）` : ""}`)
                                  .join(" / ")
                              : trackInsight.creators.map((creator) => `${creator.name}${creator.role ? `（${creator.role}）` : ""}`).join(" / ")}
                          </strong>
                        </p>
                      ) : null}
                      {trackInsight?.wikiSummary ? (
                        <p className="stage-detail-wiki">
                          <span>百科</span>
                          <strong>{isMobileUi ? `${trackInsight.wikiSummary.slice(0, 72)}...` : trackInsight.wikiSummary}</strong>
                        </p>
                      ) : null}
                    </div>

                    <section className="detail-control-card stage-detail-controls" aria-label="播放与下载控制">
                      <div className="detail-control-card-head">
                        <div>
                          <span>播放与下载</span>
                          <small>音质与下载链接</small>
                        </div>
                        {trackInsight?.chorusStartMs ? (
                          <button
                            type="button"
                            className="meta-action-btn meta-action-btn-compact"
                            onClick={() => handleSeekTo(trackInsight.chorusStartMs ?? 0)}
                          >
                            跳转副歌（{formatMs(trackInsight.chorusStartMs)}）
                          </button>
                        ) : null}
                      </div>
                      <div className="detail-control-card-body">
                        <div className="download-row detail-control-row">
                          <span id="playback-level-label" className="download-row-label">
                            播放音质
                          </span>
                          {isMobileUi ? (
                            <select
                              id="playback-level-mobile"
                              value={effectivePlayQualityLevel}
                              onChange={(event) => player.setPlayQualityLevel(event.target.value as PlayQualityLevel)}
                            >
                              {currentTrackAvailablePlayQualityOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <ThemedSelect
                              buttonId="playback-level"
                              labelId="playback-level-label"
                              value={effectivePlayQualityLevel}
                              options={currentTrackAvailablePlayQualityOptions}
                              onChange={(nextValue) => player.setPlayQualityLevel(nextValue as PlayQualityLevel)}
                              className="menu-upward detail-control-select"
                            />
                          )}
                        </div>
                        {trackQualityLoading ? <p className="detail-control-hint">正在侦测当前歌曲可用音质...</p> : null}
                        {!trackQualityLoading && playQualityFallbackNotice ? (
                          <p className="detail-control-hint">{playQualityFallbackNotice}</p>
                        ) : null}
                        {!isMobileUi ? (
                          <div className="download-row detail-control-row detail-control-row-download">
                            <span id="download-level-label" className="download-row-label">
                              下载音质
                            </span>
                            <ThemedSelect
                              buttonId="download-level"
                              labelId="download-level-label"
                              value={downloadState.level}
                              options={[
                                { value: "standard", label: PLAY_QUALITY_LABELS.standard },
                                { value: "exhigh", label: PLAY_QUALITY_LABELS.exhigh },
                                { value: "lossless", label: PLAY_QUALITY_LABELS.lossless },
                                { value: "hires", label: PLAY_QUALITY_LABELS.hires }
                              ]}
                              onChange={(nextValue) =>
                                setDownloadState((previous) => ({
                                  ...previous,
                                  level: nextValue
                                }))
                              }
                              disabled={downloadState.loading || !currentTrack}
                              className="menu-upward detail-control-select"
                            />
                            <button
                              type="button"
                              className="meta-action-btn detail-download-action"
                              disabled={downloadState.loading || !currentTrack}
                              onClick={() => void handleDownloadTrack()}
                            >
                              {downloadState.loading ? "获取中..." : "获取下载链接"}
                            </button>
                          </div>
                        ) : null}
                        {downloadState.message ? <p className="detail-control-hint">{downloadState.message}</p> : null}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="detail-lyric-shell stage-detail-lyric">
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
                    <div className="detail-lyric-scroll polished" ref={detailLyricRef}>
                      {!activeDetailLyricLines.length ? (
                        <p className="detail-empty">暂无该版本歌词</p>
                      ) : (
                        <>
                          <div className="detail-lyric-spacer" aria-hidden="true" />
                          {activeDetailLyricLines.map((line, index) => {
                            const distance = Math.abs(index - activeDetailLyricIndex);
                            const secondaryText =
                              detailLyricMode === "origin"
                                ? ""
                                : activeDetailLyricSecondaryByTime.get(line.timeMs) ?? activeDetailLyricSecondaryLines[index]?.text ?? "";
                            return (
                              <motion.div
                                key={`${line.timeMs}-${index}`}
                                className="detail-lyric-line-wrap"
                                ref={bindLyricLineRef(index)}
                                initial={false}
                                animate={{
                                  opacity: activeDetailLyricIndex < 0 ? 1 : distance === 0 ? 1 : distance === 1 ? 0.48 : 0.2,
                                  scale: index === activeDetailLyricIndex ? 1 : 0.96,
                                  y: index === activeDetailLyricIndex ? 0 : 2
                                }}
                                transition={{ duration: 0.42 }}
                              >
                                <p className={`detail-lyric-line ${index === activeDetailLyricIndex ? "active" : ""}`}>{line.text}</p>
                                {secondaryText ? <p className="detail-lyric-subline">{secondaryText}</p> : null}
                              </motion.div>
                            );
                          })}
                          <div className="detail-lyric-spacer" aria-hidden="true" />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="stage-detail-progress" onClick={(event) => event.stopPropagation()}>
              <div className="stage-detail-progress-times">
                <span>{formatMs(player.currentTimeMs)}</span>
                <span>{formatMs(player.durationMs)}</span>
              </div>
              <div className="stage-detail-progress-rail">
                <input
                  className="stage-detail-progress-input"
                  type="range"
                  min={0}
                  max={Math.max(player.durationMs, 1)}
                  value={Math.min(player.currentTimeMs, Math.max(player.durationMs, 1))}
                  aria-label="播放进度"
                  style={
                    {
                      "--progress": `${progressPercent}%`
                    } as CSSProperties
                  }
                  onChange={(event) => handleSeekTo(Number(event.target.value))}
                />
              </div>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
