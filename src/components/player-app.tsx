"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
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
  countItemsWithinRows,
  heroActionLabel,
  nextVolumeAfterMuteToggle,
  shouldTogglePlaybackBySpace
} from "@/src/lib/player-ui";
import { nextTheme, readThemePreference, resolveInitialTheme, writeThemePreference } from "@/src/lib/theme-preference";
import { getCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import { usePlayerController } from "@/src/hooks/use-player-controller";
import type {
  ArtistDetail,
  ArtistSearchItem,
  DiscoverData,
  DiscoverItem,
  ImportedPlaylist,
  PlaybackMode,
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

const DETAIL_ANIMATION_MS = 260;
const PLAYLIST_PANEL_ANIMATION_MS = 260;
const PALETTE_TRANSITION_MS = 960;
const LIBRARY_CONTENT_LEAVE_MS = 140;
const LIBRARY_CONTENT_ENTER_MS = 220;
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
  const [displayedLibraryView, setDisplayedLibraryView] = useState<LibraryView>("library-favorites");
  const [libraryContentTransitionPhase, setLibraryContentTransitionPhase] = useState<LibraryContentTransitionPhase>("idle");
  const [librarySegmentedThumb, setLibrarySegmentedThumb] = useState<{ x: number; width: number; ready: boolean }>({
    x: 0,
    width: 0,
    ready: false
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importPlaylistInputRef = useRef<HTMLInputElement>(null);
  const librarySegmentedRef = useRef<HTMLDivElement>(null);
  const displayedLibraryViewRef = useRef<LibraryView>("library-favorites");
  const libraryContentTransitionTokenRef = useRef(0);
  const libraryContentTransitionTimerRef = useRef<number | null>(null);
  const previousVolumeRef = useRef(0.8);
  const detailCloseTimerRef = useRef<number | null>(null);
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
  const currentPaletteRef = useRef<DetailPalette>(NEUTRAL_DETAIL_PALETTE);

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
  const currentCoverUrl = useMemo(
    () => (currentTrack ? artworkByTrackId[currentTrack.id] ?? pickTrackCover(currentTrack) ?? DEFAULT_COVER_URL : null),
    [artworkByTrackId, currentTrack]
  );

  const resolveTrackCover = (track?: Track | null): string => {
    if (!track) return DEFAULT_COVER_URL;
    return artworkByTrackId[track.id] ?? pickTrackCover(track) ?? DEFAULT_COVER_URL;
  };

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
  }, []);

  const openHomePlaylistPanelWithAnimation = useCallback(() => {
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
      setSearchStatus("idle");
      setTrackResult([]);
      setArtistResult([]);
      setSearchArtistDetail(null);
      setSearchArtistDetailError(null);
      setSearchError(null);
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
      setSearchError("该推荐项暂时不可用，请稍后重试。");
      return;
    }

    try {
      if (action.type === "open-external") {
        window.open(action.url, "_blank", "noopener,noreferrer");
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
      setSearchError("该推荐项暂时不可用，请稍后重试。");
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
      window.open(source.url, "_blank", "noopener,noreferrer");
      setDownloadState((previous) => ({ ...previous, loading: false, message: `已获取 ${source.level} 音质下载链接` }));
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

  const closeDetailWithAnimation = useCallback(() => {
    if (detailPhaseRef.current === "closed" || detailPhaseRef.current === "closing") {
      return;
    }
    setDetailPhase("closing");
    detailCloseTimerRef.current = window.setTimeout(() => {
      setDetailPhase("closed");
      detailCloseTimerRef.current = null;
    }, DETAIL_ANIMATION_MS);
  }, []);

  const openDetail = () => {
    if (detailPhase === "open" || detailPhase === "opening") {
      return;
    }
    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    if (!popstateHandlingRef.current) {
      pushHistoryGuardState("detail", activeTabRef.current);
    }
    setDetailPhase("opening");
    window.requestAnimationFrame(() => {
      setDetailPhase("open");
    });
  };

  const closeDetail = useCallback(() => {
    const guard = readHistoryGuardState();
    if (!popstateHandlingRef.current && guard?.layer === "detail") {
      window.history.back();
    } else {
      closeDetailWithAnimation();
    }
  }, [closeDetailWithAnimation]);

  const openQueuePanelFromDetail = () => {
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
  }, [homePlaylistPanel, closeDetail, closeHomePlaylistPanel, restoreHomeTab, controlDisabled, player]);

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
      if (libraryContentTransitionTimerRef.current) {
        window.clearTimeout(libraryContentTransitionTimerRef.current);
      }
    };
  }, []);

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

  const playerDock = (
    <footer ref={playerDockRef} className="spotify-player-bar clickable" onClick={openDetail}>
      <div className="spotify-player-left">
        <p className="player-title">{currentTrack?.name ?? ""}</p>
        <p className="player-subtitle">{currentTrack?.artists.map((item) => item.name).join(" / ") ?? ""}</p>
      </div>

      <div className="spotify-player-center">
        <div className="spotify-player-controls">
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

  const librarySegmentedPillStyle = {
    "--lib-seg-thumb-x": `${librarySegmentedThumb.x}px`,
    "--lib-seg-thumb-w": `${librarySegmentedThumb.width}px`,
    "--lib-seg-count": LIBRARY_VIEW_OPTIONS.length
  } as CSSProperties;

  return (
    <main ref={shellRef} className="spotify-shell">
      <audio ref={controller.audioRef} preload="auto" />

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
            {isMobileUi ? <div className="theme-switch-mobile">{themeSwitchControl}</div> : null}
          </div>

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
            {!isMobileUi ? (
              <div className="theme-switch-card">
                <span>网页主题</span>
                {themeSwitchControl}
              </div>
            ) : null}
          </section>
        </aside>

        <section className="spotify-main">
          {!(isMobileUi && activeTab === "library") ? (
            <section className="now-playing-merged glass-surface">
              <div className="now-playing-merged-main">
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
                <div className="now-playing-merged-meta">
                  <h3>{currentTrack?.name ?? "还没有播放任何歌曲"}</h3>
                  <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先搜索并播放歌曲"}</p>
                  <div className="now-state-row">
                    <span className={`status-pill ${player.isPlaying ? "live" : ""}`}>{player.isPlaying ? "播放中" : "已暂停"}</span>
                    <span className="status-pill">{modeMeta.label}</span>
                  </div>
                </div>
              </div>
              <div className="now-playing-merged-actions">
                <div className="spotify-player-controls compact">
                  <IconButton
                    ariaLabel={modeMeta.label}
                    title={modeMeta.label}
                    disabled={controlDisabled}
                    onClick={() => player.nextMode()}
                    className="ghost"
                  >
                    {modeMeta.icon}
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
                </div>
                <button className="now-playing-merged-detail-btn" onClick={openDetail}>
                  展开详情
                </button>
              </div>
            </section>
          ) : null}

          {activeTab === "home" ? (
            <>
              <header className="home-toolbar">
                <div className="home-toolbar-main">
                  <h1>发现音乐</h1>
                  <p>精选内容与你的播放偏好</p>
                </div>
                <div className="home-toolbar-actions">
                  <button onClick={() => goTab("search")}>去搜索</button>
                  <button onClick={() => goTab("library")}>我的音乐库</button>
                </div>
              </header>

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
            <section className="spotify-results glass-surface">
              <div className="spotify-section-title">
                <h2>搜索音乐</h2>
                <span>支持歌曲、歌手、专辑关键词</span>
              </div>

              <div className="spotify-search-panel">
                <input
                  ref={searchInputRef}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={
                    searchAssist?.defaultKeyword ? `试试：${searchAssist.defaultKeyword}` : "例如：周杰伦、晴天"
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void doSearch();
                    }
                  }}
                />
                <button onClick={() => void doSearch()} disabled={searchStatus === "loading"}>
                  {searchStatus === "loading" ? (
                    <>
                      <Spinner />
                      搜索中
                    </>
                  ) : (
                    "搜索"
                  )}
                </button>
              </div>
              <div className="search-mode-switch" role="tablist" aria-label="搜索类型切换">
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

                    {searchStatus === "idle" ? <p className="spotify-empty">输入关键词开始搜索，例如“周杰伦”或“晴天”。</p> : null}
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
            </section>
          ) : null}

          {activeTab === "library" ? (
            <section className="spotify-results glass-surface library-hub">
              <header className="library-hub-head">
                <div>
                  <h2>你的音乐库</h2>
                  <p>把收藏与最近播放整理到更清晰的二级页面中。</p>
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
                            <button type="button" className="danger" onClick={() => player.removeImportedPlaylist(playlist.id)}>
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
          <section className="spotify-now-card">
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
            <h3>{currentTrack?.name ?? "还没有播放任何歌曲"}</h3>
            <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先在搜索页选择歌曲开始播放"}</p>
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
              aria-label={homePlaylistPanel.sourceType === "queue" ? "播放队列" : "歌单详情"}
            >
              <div className={`home-playlist-drawer-backdrop phase-${homePlaylistPhase}`.trim()} onClick={closeHomePlaylistPanel} />
              <aside className={`home-playlist-drawer phase-${homePlaylistPhase}`.trim()} onClick={(event) => event.stopPropagation()}>
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
                  <button type="button" className="ghost" onClick={closeHomePlaylistPanel}>
                    关闭
                  </button>
                </div>

                <div className="home-playlist-drawer-list">
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
                        <article className={`home-playlist-track-row ${track.id === currentTrackId ? "active" : ""}`.trim()} key={`panel-${track.id}-${index}`}>
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

      {isDetailMounted ? (
        <section className="player-detail-overlay" role="dialog" aria-label="播放详情">
          <div className={`player-detail-backdrop phase-${detailPhase}`.trim()} onClick={closeDetail} />
          <article
            className={`player-detail-screen phase-${detailPhase}`.trim()}
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
                    <p>可播性：{trackInsight?.playable === false ? "受限" : "正常"}</p>
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
                    {trackInsight?.alternatives.length ? (
                      <button
                        type="button"
                        className="meta-action-btn"
                        onClick={() => {
                          const alternative = trackInsight.alternatives[0];
                          if (!alternative) return;
                          player.playTrackNow(alternative);
                          player.setPlaying(true);
                        }}
                      >
                        播放替代版本：{trackInsight.alternatives[0].name}
                      </button>
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
