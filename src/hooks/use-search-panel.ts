"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  getArtistDetail,
  getSearchAssist,
  searchArtists,
  searchMusic,
  searchPlaylists
} from "@/src/lib/client-api";
import { countItemsWithinRows } from "@/src/lib/player-ui";
import {
  appendPagedItems,
  getSearchLoadingPlaceholderCount,
  shouldLoadNextSearchPage,
  shouldLoadNextSearchPageByScroll
} from "@/src/lib/search-pagination";
import { toUserFacingMessage } from "@/src/lib/user-facing-error";
import type { ArtistDetail, ArtistSearchItem, Playlist, SearchAssist, Track } from "@/src/types/music";

export type SearchStatus = "idle" | "loading" | "success" | "empty" | "error";
export type SearchMode = "track" | "artist" | "playlist";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_ASSIST_MAX_ITEMS = 20;
export const SEARCH_ASSIST_MAX_ROWS = 2;

export type UseSearchPanelOptions = {
  active: boolean;
  pageSize?: number;
};

export type UseSearchPanelResult = {
  keyword: string;
  setKeyword: (value: string) => void;
  searchMode: SearchMode;
  status: SearchStatus;
  error: string | null;
  trackResult: Track[];
  artistResult: ArtistSearchItem[];
  playlistResult: Playlist[];
  searchAssist: SearchAssist | null;
  hotAssistCandidates: string[];
  suggestAssistCandidates: string[];
  visibleHotAssistCount: number;
  visibleSuggestAssistCount: number;
  searchLoadingMore: boolean;
  canLoadMore: boolean;
  loadingPlaceholderCount: number;
  activeResultCount: number;
  artistDetail: ArtistDetail | null;
  artistDetailLoading: boolean;
  artistDetailError: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  resultsBodyRef: RefObject<HTMLDivElement | null>;
  hotAssistRowRef: RefObject<HTMLDivElement | null>;
  suggestAssistRowRef: RefObject<HTMLDivElement | null>;
  seedAssist: (assist: SearchAssist | null) => void;
  doSearch: () => Promise<void>;
  applyKeywordAndSearch: (nextKeyword: string) => void;
  switchSearchMode: (nextMode: SearchMode) => void;
  openArtistDetail: (artist: ArtistSearchItem) => Promise<void>;
  closeArtistDetail: () => void;
  loadMoreSearchResults: () => Promise<void>;
};

export function useSearchPanel(options: UseSearchPanelOptions): UseSearchPanelResult {
  const { active, pageSize = SEARCH_PAGE_SIZE } = options;

  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("track");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [trackResult, setTrackResult] = useState<Track[]>([]);
  const [artistResult, setArtistResult] = useState<ArtistSearchItem[]>([]);
  const [playlistResult, setPlaylistResult] = useState<Playlist[]>([]);
  const [searchPage, setSearchPage] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);
  const [artistDetailLoading, setArtistDetailLoading] = useState(false);
  const [artistDetailError, setArtistDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchAssist, setSearchAssist] = useState<SearchAssist | null>(null);
  const [visibleHotAssistCount, setVisibleHotAssistCount] = useState(SEARCH_ASSIST_MAX_ITEMS);
  const [visibleSuggestAssistCount, setVisibleSuggestAssistCount] = useState(SEARCH_ASSIST_MAX_ITEMS);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsBodyRef = useRef<HTMLDivElement>(null);
  const hotAssistRowRef = useRef<HTMLDivElement>(null);
  const suggestAssistRowRef = useRef<HTMLDivElement>(null);
  const searchRequestIdRef = useRef(0);
  const searchLoadingMoreRef = useRef(false);
  const searchHasUserScrolledRef = useRef(false);

  const hotAssistCandidates = useMemo(
    () => searchAssist?.hotKeywords.slice(0, SEARCH_ASSIST_MAX_ITEMS) ?? [],
    [searchAssist]
  );
  const suggestAssistCandidates = useMemo(
    () => searchAssist?.suggestions.slice(0, SEARCH_ASSIST_MAX_ITEMS) ?? [],
    [searchAssist]
  );

  const activeSearchResultCount = useMemo(() => {
    if (searchMode === "artist") return artistResult.length;
    if (searchMode === "playlist") return playlistResult.length;
    return trackResult.length;
  }, [artistResult.length, playlistResult.length, searchMode, trackResult.length]);

  const canLoadMore = useMemo(() => {
    if (searchMode === "artist" && artistDetail) return false;
    return shouldLoadNextSearchPage({
      status,
      loadingMore: searchLoadingMore,
      loadedCount: activeSearchResultCount,
      total: searchTotal
    });
  }, [activeSearchResultCount, artistDetail, searchLoadingMore, searchMode, searchTotal, status]);

  const loadingPlaceholderCount = useMemo(() => getSearchLoadingPlaceholderCount(searchMode), [searchMode]);

  const seedAssist = useCallback((assist: SearchAssist | null) => {
    setSearchAssist(assist);
  }, []);

  const fetchSearchPage = useCallback(
    async (q: string, mode: SearchMode, page: number) => {
      if (mode === "artist") {
        return {
          mode,
          data: await searchArtists(q, page, pageSize)
        } as const;
      }
      if (mode === "playlist") {
        return {
          mode,
          data: await searchPlaylists(q, page, pageSize)
        } as const;
      }
      return {
        mode,
        data: await searchMusic(q, page, pageSize)
      } as const;
    },
    [pageSize]
  );

  const runSearch = useCallback(
    async (nextKeyword: string, mode: SearchMode) => {
      const q = nextKeyword.trim();
      if (!q) {
        searchLoadingMoreRef.current = false;
        searchHasUserScrolledRef.current = false;
        setStatus("error");
        setTrackResult([]);
        setArtistResult([]);
        setPlaylistResult([]);
        setSearchPage(0);
        setSearchTotal(0);
        setSearchLoadingMore(false);
        setArtistDetail(null);
        setArtistDetailError(null);
        setError("请输入关键词后再搜索。");
        return;
      }

      const requestId = ++searchRequestIdRef.current;
      searchLoadingMoreRef.current = false;
      searchHasUserScrolledRef.current = false;
      setStatus("loading");
      setSearchLoadingMore(false);
      setSearchPage(0);
      setSearchTotal(0);
      setArtistDetail(null);
      setArtistDetailError(null);
      setError(null);
      try {
        const response = await fetchSearchPage(q, mode, 1);
        if (requestId !== searchRequestIdRef.current) return;
        if (response.mode === "artist") {
          const data = response.data;
          setArtistResult(data.items);
          setTrackResult([]);
          setPlaylistResult([]);
          setSearchPage(data.page);
          setSearchTotal(data.total);
          setStatus(data.items.length === 0 ? "empty" : "success");
        } else if (response.mode === "playlist") {
          const data = response.data;
          setPlaylistResult(data.items);
          setTrackResult([]);
          setArtistResult([]);
          setSearchPage(data.page);
          setSearchTotal(data.total);
          setStatus(data.items.length === 0 ? "empty" : "success");
        } else {
          const data = response.data;
          setTrackResult(data.items);
          setArtistResult([]);
          setPlaylistResult([]);
          setSearchPage(data.page);
          setSearchTotal(data.total);
          setStatus(data.items.length === 0 ? "empty" : "success");
        }
      } catch (searchError) {
        if (requestId !== searchRequestIdRef.current) return;
        setTrackResult([]);
        setArtistResult([]);
        setPlaylistResult([]);
        setSearchPage(0);
        setSearchTotal(0);
        setSearchLoadingMore(false);
        setStatus("error");
        setError(toUserFacingMessage(searchError, "搜索失败，请稍后重试"));
      }
    },
    [fetchSearchPage]
  );

  const loadMoreSearchResults = useCallback(async () => {
    const q = keyword.trim();
    if (!q) return;
    if (!canLoadMore) return;
    if (searchLoadingMoreRef.current) return;

    const nextPage = searchPage + 1;
    const requestId = searchRequestIdRef.current;
    searchLoadingMoreRef.current = true;
    setSearchLoadingMore(true);
    setError(null);
    try {
      const response = await fetchSearchPage(q, searchMode, nextPage);
      if (requestId !== searchRequestIdRef.current) return;

      if (response.mode === "artist") {
        const data = response.data;
        setArtistResult((previous) => appendPagedItems(previous, data.items));
        setSearchPage(data.page);
        setSearchTotal(data.total);
      } else if (response.mode === "playlist") {
        const data = response.data;
        setPlaylistResult((previous) => appendPagedItems(previous, data.items));
        setSearchPage(data.page);
        setSearchTotal(data.total);
      } else {
        const data = response.data;
        setTrackResult((previous) => appendPagedItems(previous, data.items));
        setSearchPage(data.page);
        setSearchTotal(data.total);
      }
    } catch (searchError) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(toUserFacingMessage(searchError, "更多搜索结果加载失败，请稍后重试"));
    } finally {
      searchLoadingMoreRef.current = false;
      if (requestId !== searchRequestIdRef.current) return;
      setSearchLoadingMore(false);
    }
  }, [canLoadMore, fetchSearchPage, keyword, searchMode, searchPage]);

  const doSearch = useCallback(async () => {
    await runSearch(keyword, searchMode);
  }, [keyword, runSearch, searchMode]);

  const applyKeywordAndSearch = useCallback(
    (nextKeyword: string) => {
      const normalized = nextKeyword.trim();
      if (!normalized) return;
      setKeyword(normalized);
      window.setTimeout(() => {
        void runSearch(normalized, searchMode);
      }, 0);
    },
    [runSearch, searchMode]
  );

  const openArtistDetail = useCallback(async (artist: ArtistSearchItem) => {
    setArtistDetail(null);
    setArtistDetailLoading(true);
    setArtistDetailError(null);
    try {
      const detail = await getArtistDetail(artist.id);
      setArtistDetail(detail);
    } catch (detailError) {
      setArtistDetailError(toUserFacingMessage(detailError, "歌手详情加载失败，请稍后重试"));
    } finally {
      setArtistDetailLoading(false);
    }
  }, []);

  const closeArtistDetail = useCallback(() => {
    setArtistDetail(null);
    setArtistDetailError(null);
    setArtistDetailLoading(false);
  }, []);

  const switchSearchMode = useCallback(
    (nextMode: SearchMode) => {
      if (nextMode === searchMode) return;
      setSearchMode(nextMode);
      searchLoadingMoreRef.current = false;
      searchHasUserScrolledRef.current = false;
      setArtistDetail(null);
      setArtistDetailError(null);
      setArtistDetailLoading(false);
      if (!keyword.trim()) {
        setStatus("idle");
        setTrackResult([]);
        setArtistResult([]);
        setPlaylistResult([]);
        setSearchPage(0);
        setSearchTotal(0);
        setSearchLoadingMore(false);
        setError(null);
        return;
      }
      void runSearch(keyword, nextMode);
    },
    [keyword, runSearch, searchMode]
  );

  useEffect(() => {
    if (!active) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [active]);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      getSearchAssist(q)
        .then((assist) => {
          if (!alive) return;
          setSearchAssist(assist);
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  useLayoutEffect(() => {
    setVisibleHotAssistCount(hotAssistCandidates.length);
  }, [hotAssistCandidates.length]);

  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
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
    if (!active) return;
    const root = resultsBodyRef.current;
    if (!root) return;

    const handleScroll = () => {
      if (root.scrollTop > 12) {
        searchHasUserScrolledRef.current = true;
      }
      if (
        shouldLoadNextSearchPageByScroll({
          canLoadMore,
          hasUserScrolled: searchHasUserScrolledRef.current,
          scrollTop: root.scrollTop,
          clientHeight: root.clientHeight,
          scrollHeight: root.scrollHeight
        })
      ) {
        void loadMoreSearchResults();
      }
    };

    root.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll);
    };
  }, [active, canLoadMore, loadMoreSearchResults]);

  return {
    keyword,
    setKeyword,
    searchMode,
    status,
    error,
    trackResult,
    artistResult,
    playlistResult,
    searchAssist,
    hotAssistCandidates,
    suggestAssistCandidates,
    visibleHotAssistCount,
    visibleSuggestAssistCount,
    searchLoadingMore,
    canLoadMore,
    loadingPlaceholderCount,
    activeResultCount: activeSearchResultCount,
    artistDetail,
    artistDetailLoading,
    artistDetailError,
    inputRef,
    resultsBodyRef,
    hotAssistRowRef,
    suggestAssistRowRef,
    seedAssist,
    doSearch,
    applyKeywordAndSearch,
    switchSearchMode,
    openArtistDetail,
    closeArtistDetail,
    loadMoreSearchResults
  };
}
