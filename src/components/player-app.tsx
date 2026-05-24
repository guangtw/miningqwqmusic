"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  getAlbumDetail,
  getArtistDetail,
  getDiscoverHome,
  getPlaylistDetail,
  getSatiScene,
  getSearchAssist,
  getSportScene,
  getTrackDetail,
  getTrackDownloadUrl,
  getTrackInsight,
  getToplistDetail,
  searchMusic
} from "@/src/lib/client-api";
import { heroActionLabel, nextVolumeAfterMuteToggle } from "@/src/lib/player-ui";
import { getCurrentTrack, usePlayerStore } from "@/src/store/player-store";
import { usePlayerController } from "@/src/hooks/use-player-controller";
import type { DiscoverData, DiscoverItem, PlaybackMode, Playlist, SceneData, SongInsight, Track } from "@/src/types/music";

type NavTab = "home" | "search" | "library";
type SearchStatus = "idle" | "loading" | "success" | "empty" | "error";
type LibraryView = "library-overview" | "library-favorites" | "library-recent";
type DetailViewTab = "lyric" | "meta";
type DetailLyricMode = "origin" | "translated" | "karaoke";
type DetailModalPhase = "closed" | "opening" | "open" | "closing";
type DetailPalette = {
  bgA: string;
  bgB: string;
  glow: string;
};
type HomePlaylistPanelState = {
  id: string;
  sourceType: "playlist" | "toplist";
  title: string;
  subtitle?: string;
  coverUrl?: string;
  tracks: Track[];
  loading: boolean;
  error: string | null;
};
type HistoryGuardLayer = "detail" | "tab";
type HistoryGuardState = {
  __mqmGuard?: {
    layer: HistoryGuardLayer;
    tab: NavTab;
    at: number;
  };
};

const DETAIL_ANIMATION_MS = 260;
const THEME_DETAIL_FALLBACK_PALETTE: DetailPalette = {
  bgA: "var(--detail-fallback-a)",
  bgB: "var(--detail-fallback-b)",
  glow: "var(--detail-fallback-glow)"
};

const NEUTRAL_DETAIL_PALETTE: DetailPalette = {
  bgA: "rgb(31, 35, 45)",
  bgB: "rgb(14, 16, 22)",
  glow: "var(--detail-fallback-glow)"
};

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
      <path d="M16.9 4H21v4.1h-1.7V6.7h-2.4c-1.3 0-2.5.7-3.2 1.8l-.7 1.2a6 6 0 0 1-5.1 2.9H3V11h4.9c1.3 0 2.5-.7 3.2-1.8l.7-1.2A6 6 0 0 1 16.9 4zm0 16H21v-4.1h-1.7v1.4h-2.4c-1.3 0-2.5-.7-3.2-1.8l-.7-1.2a6 6 0 0 0-5.1-2.9H3V13h4.9c1.3 0 2.5.7 3.2 1.8l.7 1.2a6 6 0 0 0 5.1 2.9z" fill="currentColor" />
      <path d="M3 4h4.2a6 6 0 0 1 5.1 2.9l.4.7-1.4 1-.4-.7c-.7-1.1-1.9-1.8-3.2-1.8H3V4zm17.8 8.5L21 13.8h-4.1a6 6 0 0 0-5.1 2.9l-.4.7-1.4-1 .4-.7a6 6 0 0 1 5.1-2.9h4.1l-.2 1.3z" fill="currentColor" />
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

function TrackRow({
  track,
  liked,
  onPlay,
  onToggleFavorite
}: {
  track: Track;
  liked: boolean;
  onPlay: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
}) {
  return (
    <article className="spotify-track-row">
      <div className="spotify-track-main">
        <h3>{track.name}</h3>
        <p>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</p>
      </div>
      <p className="spotify-track-album">{track.album?.name ?? "未知专辑"}</p>
      <p className="spotify-track-duration">{formatMs(track.durationMs)}</p>
      <div className="spotify-track-actions">
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

export function PlayerApp() {
  const player = usePlayerStore();
  const controller = usePlayerController();

  const shellRef = useRef<HTMLElement>(null);
  const playerDockRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [libraryView, setLibraryView] = useState<LibraryView>("library-overview");
  const [detailPhase, setDetailPhase] = useState<DetailModalPhase>("closed");
  const [detailTab, setDetailTab] = useState<DetailViewTab>("lyric");
  const [detailLyricMode, setDetailLyricMode] = useState<DetailLyricMode>("origin");
  const [detailPalette, setDetailPalette] = useState<DetailPalette>(NEUTRAL_DETAIL_PALETTE);
  const [keyword, setKeyword] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<Track[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [discoverData, setDiscoverData] = useState<DiscoverData | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [homePlaylistPanel, setHomePlaylistPanel] = useState<HomePlaylistPanelState | null>(null);
  const [searchAssist, setSearchAssist] = useState<{ hotKeywords: string[]; suggestions: string[]; defaultKeyword?: string } | null>(null);
  const [trackInsight, setTrackInsight] = useState<SongInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousVolumeRef = useRef(0.8);
  const detailCloseTimerRef = useRef<number | null>(null);
  const homePlaylistRequestIdRef = useRef(0);
  const pendingArtworkRef = useRef<Set<string>>(new Set());
  const popstateHandlingRef = useRef(false);
  const activeTabRef = useRef<NavTab>("home");
  const detailPhaseRef = useRef<DetailModalPhase>("closed");
  const [dockPortalTarget, setDockPortalTarget] = useState<HTMLElement | null>(null);
  const [artworkByTrackId, setArtworkByTrackId] = useState<Record<string, string>>({});

  const queueTrack = useMemo(() => getCurrentTrack(player), [player]);
  const currentTrack = controller.currentTrack ?? queueTrack;
  const currentTrackId = currentTrack?.id ?? null;
  const currentTrackName = currentTrack?.name ?? null;
  const favoriteSet = player.favorites;
  const modeMeta = MODE_META[player.mode];
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
    detailPhaseRef.current = detailPhase;
  }, [detailPhase]);

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
    setDetailLyricMode("origin");
  }, [currentTrack?.id]);

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

  const closeHomePlaylistPanel = useCallback(() => {
    setHomePlaylistPanel(null);
  }, []);

  const restoreHomeTab = useCallback(() => {
    setActiveTab("home");
    setLibraryView("library-overview");
  }, []);

  const goTab = (tab: NavTab, nextLibraryView?: LibraryView) => {
    const previousTab = activeTabRef.current;
    if (!popstateHandlingRef.current && tab !== "home" && previousTab !== tab) {
      pushHistoryGuardState("tab", tab);
    }
    setActiveTab(tab);
    if (tab !== "home") {
      closeHomePlaylistPanel();
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

  const openPlaylistPanel = async (item: DiscoverItem) => {
    const targetId = item.targetId ?? item.id;
    if (!targetId) return;
    const sourceType = item.type === "toplist" ? "toplist" : "playlist";
    const requestId = ++homePlaylistRequestIdRef.current;
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

  const doSearch = async () => {
    const q = keyword.trim();
    if (!q) {
      setSearchStatus("idle");
      setResult([]);
      setSearchError(null);
      return;
    }

    setSearchStatus("loading");
    setSearchError(null);
    try {
      const data = await searchMusic(q, 1, 20);
      setResult(data.items);
      setSearchStatus(data.items.length === 0 ? "empty" : "success");
    } catch (error) {
      setResult([]);
      setSearchStatus("error");
      setSearchError(error instanceof Error ? error.message : "网络异常，搜索失败，请稍后重试。");
    }
  };

  const applyKeywordAndSearch = (nextKeyword: string) => {
    const normalized = nextKeyword.trim();
    if (!normalized) return;
    setKeyword(normalized);
    setSearchStatus("loading");
    setSearchError(null);
    window.setTimeout(() => {
      void searchMusic(normalized, 1, 20)
        .then((data) => {
          setResult(data.items);
          setSearchStatus(data.items.length ? "success" : "empty");
          setSearchError(null);
        })
        .catch((error) => {
          setResult([]);
          setSearchStatus("error");
          setSearchError(error instanceof Error ? error.message : "网络异常，搜索失败，请稍后重试。");
        });
    }, 0);
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
    const targetId = item.targetId ?? item.id;
    if (!targetId) return;

    try {
      if (item.type === "track" || item.type === "banner" || item.type === "scene") {
        await tryPlaySceneTrack(targetId);
        return;
      }

      if (item.type === "playlist") {
        await openPlaylistPanel(item);
        return;
      }

      if (item.type === "toplist") {
        await openPlaylistPanel(item);
        return;
      }

      if (item.type === "album") {
        const album = await getAlbumDetail(targetId);
        if (!album.tracks.length) return;
        player.setQueue(album.tracks, 0);
        player.setPlaying(true);
        return;
      }

      if (item.type === "artist") {
        const artist = await getArtistDetail(targetId);
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

  const playHomePlaylistTrack = (track: Track) => {
    player.playTrackNow(track);
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
    const next = nextVolumeAfterMuteToggle(player.volume, previousVolumeRef.current);
    previousVolumeRef.current = next.previousVolume;
    player.setVolume(next.volume);
  };

  const isMuted = player.volume <= 0;
  const hasTrack = Boolean(currentTrack ?? queueTrack);
  const controlDisabled = player.queue.length === 0;
  const isDetailMounted = detailPhase !== "closed";
  const progressPercent =
    player.durationMs > 0 ? Math.min(100, Math.max(0, (player.currentTimeMs / player.durationMs) * 100)) : 0;
  const volumePercent = Math.min(100, Math.max(0, player.volume * 100));
  const activeDetailLyricLines = useMemo(() => {
    if (detailLyricMode === "translated" && controller.lyricTranslatedLines.length) {
      return controller.lyricTranslatedLines;
    }
    if (detailLyricMode === "karaoke" && controller.lyricKaraokeLines.length) {
      return controller.lyricKaraokeLines;
    }
    return controller.lyricLines;
  }, [controller.lyricKaraokeLines, controller.lyricLines, controller.lyricTranslatedLines, detailLyricMode]);
  const detailLyricRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const sourceTracks = [
      ...homeSeedTracks,
      ...result,
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
  }, [homeSeedTracks, result, player.queue, player.recent, player.favorites, currentTrack, artworkByTrackId]);

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
  }, [homePlaylistPanel, closeDetail, closeHomePlaylistPanel, restoreHomeTab]);

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
    return () => {
      if (detailCloseTimerRef.current) {
        window.clearTimeout(detailCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDetailMounted || detailTab !== "lyric" || !detailLyricRef.current) return;
    const active = detailLyricRef.current.querySelector(".detail-lyric-line.active");
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isDetailMounted, detailTab, detailLyricMode, controller.lyricIndex, currentTrack?.id, activeDetailLyricLines.length]);

  useEffect(() => {
    if (!isDetailMounted) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isDetailMounted]);

  useEffect(() => {
    if (!currentTrackId) {
      setDetailPalette(NEUTRAL_DETAIL_PALETTE);
      return;
    }

    if (!currentCoverUrl || currentCoverUrl === DEFAULT_COVER_URL) {
      setDetailPalette(THEME_DETAIL_FALLBACK_PALETTE);
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
          setDetailPalette(THEME_DETAIL_FALLBACK_PALETTE);
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
          setDetailPalette(THEME_DETAIL_FALLBACK_PALETTE);
          return;
        }
        const avgR = red / count;
        const avgG = green / count;
        const avgB = blue / count;

        const bgA = `rgb(${clampColor(avgR * 0.78 + 20)}, ${clampColor(avgG * 0.74 + 18)}, ${clampColor(avgB * 0.72 + 20)})`;
        const bgB = `rgb(${clampColor(avgR * 0.28 + 8)}, ${clampColor(avgG * 0.26 + 8)}, ${clampColor(avgB * 0.28 + 10)})`;
        const glow = `rgba(${clampColor(avgR)}, ${clampColor(avgG)}, ${clampColor(avgB)}, 0.33)`;
        setDetailPalette({ bgA, bgB, glow });
      } catch {
        setDetailPalette(THEME_DETAIL_FALLBACK_PALETTE);
      }
    };

    image.onerror = () => {
      if (!cancelled) {
        setDetailPalette(THEME_DETAIL_FALLBACK_PALETTE);
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
          <IconButton ariaLabel="上一首" title="上一首" disabled={controlDisabled} onClick={() => player.previousTrack()} className="ghost">
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
          <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrack()} className="ghost">
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
              background: `linear-gradient(90deg, var(--green) 0%, var(--green) ${progressPercent}%, #4a4a4a ${progressPercent}%, #4a4a4a 100%)`
            }}
            onChange={(event) => controller.seekTo(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <span>{formatMs(player.durationMs)}</span>
        </div>
      </div>

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
            background: `linear-gradient(90deg, #16c55b 0%, #35e073 ${volumePercent}%, #4a4a4a ${volumePercent}%, #4a4a4a 100%)`
          }}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          onClick={(event) => event.stopPropagation()}
        />
        <span>{Math.round(player.volume * 100)}%</span>
      </div>
    </footer>
  );

  return (
    <main ref={shellRef} className="spotify-shell">
      <audio ref={controller.audioRef} preload="metadata" />

      <section className="spotify-layout">
        <aside className="spotify-sidebar">
          <div className="spotify-logo">MiningQwQ Music</div>
          <nav className="spotify-nav">
            <button className={activeTab === "home" ? "active" : ""} onClick={() => goTab("home")}>
              主页
            </button>
            <button className={activeTab === "search" ? "active" : ""} onClick={() => goTab("search")}>
              搜索
            </button>
            <button className={activeTab === "library" ? "active" : ""} onClick={() => goTab("library", "library-overview")}>
              你的音乐库
            </button>
          </nav>

          <section className="spotify-collections">
            <h3>我的音乐</h3>
            <div className="sidebar-entry-list">
              <button
                className={`sidebar-entry ${activeTab === "library" && libraryView === "library-overview" ? "active" : ""}`.trim()}
                onClick={() => goTab("library", "library-overview")}
              >
                <span>你的音乐库</span>
                <small>{player.queue.length + player.recent.length} 首</small>
                <em>›</em>
              </button>
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
            </div>
          </section>
        </aside>

        <section className="spotify-main">
          <section className="now-playing-merged glass-surface">
            <div className="now-playing-merged-main">
              <div className="now-playing-merged-cover">
                <div className={`vinyl ${player.isPlaying ? "spinning" : ""}`}>
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
                <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrack()} className="ghost">
                  <NextIcon />
                </IconButton>
              </div>
              <button className="now-playing-merged-detail-btn" onClick={openDetail}>
                展开详情
              </button>
            </div>
          </section>

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

              <section className="home-channel-row">
                {(discoverData?.blocks.find((block) => block.id === "discover-banner")?.items ?? []).slice(0, 6).map((item, index) => (
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
                {!discoverData?.blocks.find((block) => block.id === "discover-banner")?.items.length ? (
                  (homeSeedTracks.length ? homeSeedTracks : player.queue).slice(0, 6).map((track, index) => (
                    <button
                      key={`channel-${track.id}-${index}`}
                      className="home-channel-card"
                      onClick={() => {
                        player.playTrackNow(track);
                        player.setPlaying(true);
                      }}
                    >
                      <div className="home-channel-cover" style={{ backgroundImage: `url(${resolveTrackCover(track)})` }} />
                      <span className="home-channel-tag">推荐频道</span>
                      <h3>{track.name}</h3>
                      <p>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</p>
                    </button>
                  ))
                ) : null}
                {!homeSeedTracks.length && !discoverData?.blocks.find((block) => block.id === "discover-banner")?.items.length ? (
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
                  <button onClick={() => goTab("search")}>查看更多</button>
                </div>
                <div className="home-playlist-grid">
                  {(discoverData?.blocks.find((block) => block.id === "discover-personalized")?.items ?? []).slice(0, 10).map((item, index) => (
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
                  {!discoverData?.blocks.find((block) => block.id === "discover-personalized")?.items.length
                    ? homeSeedTracks.slice(0, 10).map((track, index) => (
                        <button
                          key={`playlist-${track.id}-${index}`}
                          className="home-playlist-card"
                          onClick={() => {
                            player.playTrackNow(track);
                            player.setPlaying(true);
                          }}
                        >
                          <div className="home-playlist-cover" style={{ backgroundImage: `url(${resolveTrackCover(track)})` }} />
                          <h3>{track.name}</h3>
                          <p>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</p>
                        </button>
                      ))
                    : null}
                  {!homeSeedTracks.length && !discoverData?.blocks.find((block) => block.id === "discover-personalized")?.items.length ? (
                    <p className="spotify-empty">还没有可推荐内容，先去搜索并播放一首歌吧。</p>
                  ) : null}
                </div>
              </section>

              <section className="home-event-section">
                <div className="home-section-head">
                  <h2>精选活动</h2>
                </div>
                {discoverData?.blocks.find((block) => block.id === "discover-toplist")?.items.length ? (
                  <div className="home-mini-list">
                    {discoverData.blocks
                      .find((block) => block.id === "discover-toplist")
                      ?.items.slice(0, 6)
                      .map((item, index) => (
                        <button key={`toplist-${item.id}-${index}`} onClick={() => void handleDiscoverItem(item)}>
                          <span>{item.title}</span>
                          <span className="home-mini-index">{visibleSubtitle(item.subtitle, "查看歌单")}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
                <div className="home-event-grid">
                  <article className="home-event-card">
                    <h3>本周热听精选</h3>
                    <p>根据你的播放偏好生成，快速找回最近循环的旋律。</p>
                    <button onClick={() => goTab("library")}>查看最近播放</button>
                  </article>
                  <article className="home-event-card alt">
                    <h3>立刻开始你的音乐旅程</h3>
                    <p>在搜索页输入歌名或歌手，构建属于你的私人歌单。</p>
                    <button onClick={() => goTab("search")}>去搜索</button>
                  </article>
                  <article className="home-event-card">
                    <h3>助眠解压</h3>
                    <p>调用场景资源接口，快速进入轻氛围播放。</p>
                    <button
                      onClick={() => {
                        const trackId = sceneSati?.resources[0]?.trackId;
                        if (trackId) {
                          void tryPlaySceneTrack(trackId);
                        }
                      }}
                    >
                      立即体验
                    </button>
                  </article>
                  <article className="home-event-card alt">
                    <h3>跑步漫游</h3>
                    <p>按 BPM 推荐节奏内容，适合运动场景连续播放。</p>
                    <button
                      onClick={() => {
                        const trackId = sceneSport?.resources[0]?.trackId;
                        if (trackId) {
                          void tryPlaySceneTrack(trackId);
                        }
                      }}
                    >
                      开始 130 BPM
                    </button>
                  </article>
                </div>
                {discoverError ? <p className="error error-inline">{discoverError}</p> : null}
              </section>

              {homePlaylistPanel ? (
                <section className="home-playlist-drawer-overlay" role="dialog" aria-label="歌单详情">
                  <div className="home-playlist-drawer-backdrop" onClick={closeHomePlaylistPanel} />
                  <aside className="home-playlist-drawer" onClick={(event) => event.stopPropagation()}>
                    <header className="home-playlist-drawer-head">
                      <div className="home-playlist-drawer-cover" style={{ backgroundImage: `url(${homePlaylistPanel.coverUrl ?? DEFAULT_COVER_URL})` }} />
                      <div className="home-playlist-drawer-meta">
                        <span>{homePlaylistPanel.sourceType === "toplist" ? "热播榜单" : "推荐歌单"}</span>
                        <h3>{homePlaylistPanel.title}</h3>
                        <p>{visibleSubtitle(homePlaylistPanel.subtitle, "点击歌曲开始播放，或先加入播放队列。")}</p>
                      </div>
                    </header>

                    <div className="home-playlist-drawer-actions">
                      <button type="button" onClick={playHomePlaylistAll} disabled={homePlaylistPanel.loading || !homePlaylistPanel.tracks.length}>
                        播放全部
                      </button>
                      <button type="button" onClick={addHomePlaylistToQueue} disabled={homePlaylistPanel.loading || !homePlaylistPanel.tracks.length}>
                        全部加入队列
                      </button>
                      <button type="button" className="ghost" onClick={closeHomePlaylistPanel}>
                        关闭
                      </button>
                    </div>

                    <div className="home-playlist-drawer-list">
                      {homePlaylistPanel.loading ? <p className="spotify-empty">歌单加载中...</p> : null}
                      {homePlaylistPanel.error ? <p className="error error-inline">{homePlaylistPanel.error}</p> : null}
                      {!homePlaylistPanel.loading && !homePlaylistPanel.error && !homePlaylistPanel.tracks.length ? (
                        <p className="spotify-empty">该歌单暂时没有可播放歌曲。</p>
                      ) : null}
                      {!homePlaylistPanel.loading && !homePlaylistPanel.error
                        ? homePlaylistPanel.tracks.map((track, index) => (
                            <article className="home-playlist-track-row" key={`panel-${track.id}-${index}`}>
                              <button
                                type="button"
                                className="home-playlist-track-play"
                                onClick={() => playHomePlaylistTrack(track)}
                              >
                                <span>{`${index + 1}. ${track.name}`}</span>
                                <small>{track.artists.map((item) => item.name).join(" / ") || "未知歌手"}</small>
                              </button>
                              <button
                                type="button"
                                className="home-playlist-track-queue"
                                onClick={() => player.addToQueue(track, true)}
                              >
                                加入队列
                              </button>
                            </article>
                          ))
                        : null}
                    </div>
                  </aside>
                </section>
              ) : null}
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
              {searchAssist ? (
                <div className="search-assist-block">
                  {searchAssist.hotKeywords.length ? (
                    <div className="search-assist-row">
                      <span>热搜</span>
                      <div>
                        {searchAssist.hotKeywords.slice(0, 8).map((hot) => (
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
                      <div>
                        {searchAssist.suggestions.slice(0, 8).map((suggestion) => (
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

              <div className="spotify-track-table-head">
                <span>歌曲</span>
                <span>专辑</span>
                <span className="align-right">时长</span>
                <span className="align-center">操作</span>
              </div>
              <div className="spotify-track-list">
                {searchStatus === "loading"
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <div key={`skeleton-${index}`} className="track-skeleton-row" aria-hidden="true">
                        <div />
                        <div />
                        <div />
                        <div />
                      </div>
                    ))
                  : null}

                {result.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    liked={Boolean(favoriteSet[track.id])}
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
            </section>
          ) : null}

          {activeTab === "library" ? (
            <section className="spotify-results glass-surface library-hub">
              <header className="library-hub-head">
                <div>
                  <h2>你的音乐库</h2>
                  <p>把收藏与最近播放整理到更清晰的二级页面中。</p>
                </div>
                <div className="library-segmented">
                  <button className={libraryView === "library-overview" ? "active" : ""} onClick={() => setLibraryView("library-overview")}>
                    概览
                  </button>
                  <button className={libraryView === "library-favorites" ? "active" : ""} onClick={() => setLibraryView("library-favorites")}>
                    收藏
                  </button>
                  <button className={libraryView === "library-recent" ? "active" : ""} onClick={() => setLibraryView("library-recent")}>
                    最近播放
                  </button>
                </div>
              </header>

              {libraryView === "library-overview" ? (
                <section className="library-overview-grid">
                  <article className="library-overview-card">
                    <p className="library-overview-label">收藏歌曲</p>
                    <h3>{Object.keys(player.favorites).length} 首</h3>
                    <p>把喜欢的歌曲集中管理，随时一键播放。</p>
                    <button onClick={() => setLibraryView("library-favorites")}>查看收藏列表</button>
                  </article>
                  <article className="library-overview-card">
                    <p className="library-overview-label">最近播放</p>
                    <h3>{player.recent.length} 首</h3>
                    <p>继续上次的播放进度，快速回到熟悉旋律。</p>
                    <button onClick={() => setLibraryView("library-recent")}>查看最近播放</button>
                  </article>
                </section>
              ) : null}

              {libraryView === "library-favorites" ? (
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

              {libraryView === "library-recent" ? (
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
              <div className={`vinyl ${player.isPlaying ? "spinning" : ""}`}>
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
                    const playing = index === player.currentIndex;
                    return (
                      <button
                        key={`${track.id}-${index}`}
                        className={`spotify-queue-item ${playing ? "active" : ""}`}
                        onClick={() => {
                          player.setQueue(player.queue, index);
                          player.setPlaying(true);
                        }}
                      >
                        <span>{track.name}</span>
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

      {isDetailMounted ? (
        <section className="player-detail-overlay" role="dialog" aria-label="播放详情">
          <div className={`player-detail-backdrop phase-${detailPhase}`.trim()} onClick={closeDetail} />
          <article
            className={`player-detail-screen phase-${detailPhase}`.trim()}
            style={
              {
                "--detail-cover": currentCoverUrl ? `url(${currentCoverUrl})` : "none",
                "--detail-bg-a": detailPalette.bgA,
                "--detail-bg-b": detailPalette.bgB,
                "--detail-glow": detailPalette.glow
              } as CSSProperties
            }
          >
            <header className="detail-topbar">
              <button className="detail-collapse-btn" onClick={closeDetail} aria-label="收起播放器">
                <CollapseIcon />
              </button>
            </header>

            <div className="detail-stage">
              <section className="detail-stage-left">
                <div className="detail-turntable-wrap">
                  <div className={`detail-turntable ${player.isPlaying ? "spinning" : ""}`}>
                    <div className="detail-turntable-cover-mask">
                      <div className="detail-turntable-cover" style={{ backgroundImage: `url(${resolveTrackCover(currentTrack)})` }} />
                    </div>
                  </div>
                </div>
                <div className="detail-bottom-meta">
                  <h3>{currentTrack?.name ?? "还没有播放任何歌曲"}</h3>
                  <p>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? "请先在搜索页选择歌曲开始播放"}</p>
                </div>
              </section>

              <section className="detail-stage-right">
                <div className="detail-title-block">
                  <h2>{currentTrack?.name ?? "还没有播放任何歌曲"}</h2>
                  <p>
                    专辑：{currentTrack?.album?.name ?? "未知专辑"}　歌手：{currentTrack?.artists.map((item) => item.name).join(" / ") || "未知歌手"}
                  </p>
                </div>

                <div className="detail-tab-row">
                  <button className={detailTab === "lyric" ? "active" : ""} onClick={() => setDetailTab("lyric")}>
                    歌词
                  </button>
                  <button className={detailTab === "meta" ? "active" : ""} onClick={() => setDetailTab("meta")}>
                    歌曲信息
                  </button>
                </div>

                {detailTab === "meta" ? (
                  <div className="detail-meta-list">
                    <p>时长：{formatMs(currentTrack?.durationMs ?? 0)}</p>
                    <p>可播性：{trackInsight?.playable === false ? "受限" : "正常"}</p>
                    {insightLoading ? <p>正在加载歌曲洞察...</p> : null}
                    {trackInsight?.creators.length ? (
                      <p>
                        创作者：{trackInsight.creators.map((creator) => `${creator.name}${creator.role ? `（${creator.role}）` : ""}`).join(" / ")}
                      </p>
                    ) : null}
                    {trackInsight?.wikiSummary ? <p>百科：{trackInsight.wikiSummary}</p> : null}
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
                    {downloadState.message ? <p>{downloadState.message}</p> : null}
                  </div>
                ) : (
                  <div className="detail-lyric-shell">
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
                        activeDetailLyricLines.map((line, index) => (
                          <p key={`${line.timeMs}-${index}`} className={`detail-lyric-line ${index === controller.lyricIndex ? "active" : ""}`}>
                            {line.text}
                          </p>
                        ))
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
                    background: `linear-gradient(90deg, var(--detail-glow) 0%, var(--detail-glow) ${progressPercent}%, rgba(255,255,255,0.22) ${progressPercent}%, rgba(255,255,255,0.22) 100%)`
                  }}
                  onChange={(event) => controller.seekTo(Number(event.target.value))}
                />
              </div>

              <div className="detail-dock-row">
                <div className="detail-dock-song">
                  <b>{currentTrack?.name ?? "未播放"}</b>
                  <span>{currentTrack?.artists.map((item) => item.name).join(" / ") ?? ""}</span>
                </div>

                <div className="detail-dock-controls">
                  <IconButton ariaLabel="循环" title="循环" onClick={() => player.nextMode()} className="ghost">
                    {modeMeta.icon}
                  </IconButton>
                  <IconButton ariaLabel="上一首" title="上一首" disabled={controlDisabled} onClick={() => player.previousTrack()} className="ghost">
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
                  <IconButton ariaLabel="下一首" title="下一首" disabled={controlDisabled} onClick={() => player.nextTrack()} className="ghost">
                    <NextIcon />
                  </IconButton>
                </div>

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
                      background: `linear-gradient(90deg, var(--detail-glow) 0%, var(--detail-glow) ${volumePercent}%, rgba(255,255,255,0.22) ${volumePercent}%, rgba(255,255,255,0.22) 100%)`
                    }}
                    onChange={(event) => player.setVolume(Number(event.target.value))}
                  />
                </div>
              </div>
            </footer>
          </article>
        </section>
      ) : null}
    </main>
  );
}
