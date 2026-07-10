"use client";

import type { CSSProperties, Ref } from "react";
import { TrackRow } from "@/src/components/track-row";
import { getSizedImageUrl } from "@/src/lib/image-url";
import type { SearchMode, SearchStatus } from "@/src/hooks/use-search-panel";
import type { ArtistDetail, ArtistSearchItem, Playlist, SearchAssist, Track } from "@/src/types/music";

const DEFAULT_COVER_URL = "/assets/default-cover.svg";
const SMALL_COVER_WIDTHS = {
  artistSearch: 56,
  playlistRow: 56
} as const;

export const SEARCH_MODE_OPTIONS: Array<{ value: SearchMode; label: string }> = [
  { value: "track", label: "单曲" },
  { value: "artist", label: "歌手" },
  { value: "playlist", label: "歌单" }
];

export type SearchPanelProps = {
  keyword: string;
  onKeywordChange: (value: string) => void;
  searchMode: SearchMode;
  onSwitchMode: (mode: SearchMode) => void;
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
  inputRef?: Ref<HTMLInputElement>;
  resultsBodyRef?: Ref<HTMLDivElement>;
  hotAssistRowRef?: Ref<HTMLDivElement>;
  suggestAssistRowRef?: Ref<HTMLDivElement>;
  favoriteSet: Record<string, Track>;
  currentTrackId: string | null;
  isPlaying: boolean;
  /** Resolved artwork URL for a track (enriched cache preferred). */
  getTrackCover?: (track: Track) => string;
  onSubmit: () => void;
  onApplyAssistKeyword: (keyword: string) => void;
  onOpenArtist: (artist: ArtistSearchItem) => void;
  onCloseArtistDetail: () => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onPlayTrack: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onPlayArtistTopTracks: (detail: ArtistDetail) => void;
  onAddArtistTopTracksToQueue: (detail: ArtistDetail) => void;
};

function resolveSizedCover(url: string | undefined, width: number, height = width): string {
  return getSizedImageUrl(url, { width, height }) ?? DEFAULT_COVER_URL;
}

function toCoverBackgroundStyle(url: string | undefined, width: number, height = width): CSSProperties {
  return {
    backgroundImage: `url(${resolveSizedCover(url, width, height)})`
  };
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function SearchGlyph() {
  return (
    <svg className="search-field-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="6" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <path d="m15.3 15.3 4.1 4.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
    </svg>
  );
}

function resultMetaLabel(mode: SearchMode, count: number, status: SearchStatus): string | null {
  if (status !== "success" || count <= 0) return null;
  if (mode === "artist") return `${count} 位歌手`;
  if (mode === "playlist") return `${count} 个歌单`;
  return `${count} 首单曲`;
}

function ArtistSearchRow({
  artist,
  onOpen
}: {
  artist: ArtistSearchItem;
  onOpen: (artist: ArtistSearchItem) => void;
}) {
  return (
    <button type="button" className="artist-search-row" onClick={() => onOpen(artist)}>
      <div
        className="artist-search-cover"
        style={toCoverBackgroundStyle(artist.coverUrl, SMALL_COVER_WIDTHS.artistSearch * 2)}
      />
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

function PlaylistSearchRow({
  playlist,
  onOpen
}: {
  playlist: Playlist;
  onOpen: (playlist: Playlist) => void;
}) {
  return (
    <button type="button" className="playlist-search-row" onClick={() => onOpen(playlist)}>
      <div
        className="playlist-search-cover"
        style={toCoverBackgroundStyle(playlist.coverUrl, SMALL_COVER_WIDTHS.playlistRow * 2)}
      />
      <div className="playlist-search-main">
        <h3>{playlist.name}</h3>
        <p>{playlist.description || "打开查看完整歌单内容"}</p>
      </div>
      <span className="artist-search-entry">打开歌单</span>
    </button>
  );
}

function SearchEmptyState({
  status,
  mode,
  error
}: {
  status: SearchStatus;
  mode: SearchMode;
  error: string | null;
}) {
  if (status === "error") {
    return <p className="error error-inline search-feedback">{error}</p>;
  }

  if (status === "empty") {
    const copy =
      mode === "artist"
        ? "没有找到匹配歌手，换个关键词试试。"
        : mode === "playlist"
          ? "没有找到匹配歌单，换个关键词试试。"
          : "没有找到匹配结果，换个关键词试试。";
    return (
      <div className="search-empty-card">
        <SearchGlyph />
        <p>{copy}</p>
      </div>
    );
  }

  if (status !== "idle") return null;

  const copy =
    mode === "artist"
      ? "输入歌手名开始搜索，例如“邓紫棋”。"
      : mode === "playlist"
        ? "输入歌单关键词，例如“深夜循环”。"
        : "输入歌曲或歌手，例如“林俊杰”或“修炼爱情”。";

  return (
    <div className="search-empty-card">
      <SearchGlyph />
      <p>{copy}</p>
      <span>回车即可搜索 · 点击芯片可快速填入</span>
    </div>
  );
}

export function SearchPanel({
  keyword,
  onKeywordChange,
  searchMode,
  onSwitchMode,
  status,
  error,
  trackResult,
  artistResult,
  playlistResult,
  searchAssist,
  hotAssistCandidates,
  suggestAssistCandidates,
  searchLoadingMore,
  canLoadMore,
  loadingPlaceholderCount,
  activeResultCount,
  artistDetail,
  artistDetailLoading,
  artistDetailError,
  inputRef,
  resultsBodyRef,
  hotAssistRowRef,
  suggestAssistRowRef,
  favoriteSet,
  currentTrackId,
  isPlaying,
  getTrackCover,
  onSubmit,
  onApplyAssistKeyword,
  onOpenArtist,
  onCloseArtistDetail,
  onOpenPlaylist,
  onPlayTrack,
  onToggleFavorite,
  onPlayArtistTopTracks,
  onAddArtistTopTracksToQueue
}: SearchPanelProps) {
  const hasResultList = activeResultCount > 0 || Boolean(artistDetail);
  const showAssistChrome = Boolean(searchAssist) && !hasResultList && status !== "loading";
  const showHot = Boolean(searchAssist?.hotKeywords.length) && !keyword.trim();
  const showSuggest = Boolean(searchAssist?.suggestions.length) && Boolean(keyword.trim());
  const metaLabel = artistDetail
    ? artistDetail.topTracks.length
      ? `热门单曲 · ${artistDetail.topTracks.length} 首`
      : null
    : resultMetaLabel(searchMode, activeResultCount, status);

  return (
    <section className="spotify-results search-results-shell search-stage">
      <div className={`search-sticky-head ${hasResultList ? "is-compact" : ""}`.trim()}>
        <div className="search-toolbar">
          <div className="search-title-block">
            <h2>搜索</h2>
            <p className="search-title-kicker">单曲 · 歌手 · 歌单</p>
          </div>
          <div className={`search-mode-switch mode-${searchMode}`} role="tablist" aria-label="搜索类型切换">
            <span className="search-mode-switch-thumb" aria-hidden="true" />
            {SEARCH_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={searchMode === option.value}
                className={searchMode === option.value ? "active" : ""}
                onClick={() => onSwitchMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <form
          className="spotify-search-panel search-field-shell"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <span className="search-field-icon" aria-hidden="true">
            <SearchGlyph />
          </span>
          <input
            ref={inputRef}
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder={
              searchAssist?.defaultKeyword ? `试试：${searchAssist.defaultKeyword}` : "搜索歌曲、歌手或歌单"
            }
            aria-label="搜索关键词"
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? (
              <>
                <Spinner />
                搜索中
              </>
            ) : (
              "搜索"
            )}
          </button>
        </form>

        {showAssistChrome ? (
          <div className="search-assist-block">
            {showHot ? (
              <div className="search-assist-row">
                <span>热搜</span>
                <div ref={hotAssistRowRef} className="search-assist-chips">
                  {hotAssistCandidates.map((hot) => (
                    <button key={`hot-${hot}`} type="button" onClick={() => onApplyAssistKeyword(hot)}>
                      {hot}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {showSuggest ? (
              <div className="search-assist-row">
                <span>联想</span>
                <div ref={suggestAssistRowRef} className="search-assist-chips">
                  {suggestAssistCandidates.map((suggestion) => (
                    <button
                      key={`suggest-${suggestion}`}
                      type="button"
                      onClick={() => onApplyAssistKeyword(suggestion)}
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

      <div ref={resultsBodyRef} className="search-results-body">
        {metaLabel ? (
          <div className="search-results-meta">
            <span>{metaLabel}</span>
            {!canLoadMore && status === "success" ? <span className="search-results-meta-note">已全部加载</span> : null}
          </div>
        ) : null}

        {searchMode === "track" ? (
          <>
            {status === "success" || status === "loading" || trackResult.length > 0 ? (
              <div className="spotify-track-table-head">
                <span className="track-head-cover" aria-hidden="true" />
                <span>歌曲</span>
                <span>专辑</span>
                <span className="align-right">时长</span>
                <span className="align-center">操作</span>
              </div>
            ) : null}
            <div className="spotify-track-list">
              {status === "loading"
                ? Array.from({ length: 8 }).map((_, index) => (
                    <div key={`skeleton-track-${index}`} className="track-skeleton-row" aria-hidden="true">
                      <div className="track-skeleton-cover" />
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
                  isPlaying={isPlaying}
                  coverUrl={getTrackCover?.(track)}
                  onPlay={onPlayTrack}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}

              {status === "idle" || status === "empty" || status === "error" ? (
                <SearchEmptyState status={status} mode="track" error={error} />
              ) : null}
              {searchLoadingMore
                ? Array.from({ length: loadingPlaceholderCount }).map((_, index) => (
                    <div key={`loading-track-${index}`} className="track-skeleton-row" aria-hidden="true">
                      <div className="track-skeleton-cover" />
                      <div />
                      <div />
                      <div />
                      <div />
                    </div>
                  ))
                : null}
            </div>
          </>
        ) : searchMode === "artist" ? (
          <div className="spotify-track-list">
            {artistDetail ? (
              <section className="artist-detail-panel">
                <header className="artist-detail-head">
                  <button type="button" className="meta-action-btn" onClick={onCloseArtistDetail}>
                    返回歌手列表
                  </button>
                  <div className="artist-detail-profile">
                    <div
                      className="artist-detail-cover"
                      style={toCoverBackgroundStyle(artistDetail.coverUrl, 160)}
                    />
                    <div>
                      <h3>{artistDetail.name}</h3>
                      <p>{artistDetail.briefDesc ? artistDetail.briefDesc.slice(0, 120) : "暂无歌手简介"}</p>
                    </div>
                  </div>
                  <div className="artist-detail-actions">
                    <button type="button" className="meta-action-btn" onClick={() => onPlayArtistTopTracks(artistDetail)}>
                      播放热门单曲
                    </button>
                    <button
                      type="button"
                      className="meta-action-btn"
                      onClick={() => onAddArtistTopTracksToQueue(artistDetail)}
                    >
                      加入队列
                    </button>
                  </div>
                </header>
                <div className="spotify-track-table-head">
                  <span className="track-head-cover" aria-hidden="true" />
                  <span>歌曲</span>
                  <span>专辑</span>
                  <span className="align-right">时长</span>
                  <span className="align-center">操作</span>
                </div>
                <div className="spotify-track-list">
                  {artistDetail.topTracks.map((track) => (
                    <TrackRow
                      key={`artist-track-${track.id}`}
                      track={track}
                      liked={Boolean(favoriteSet[track.id])}
                      currentTrackId={currentTrackId}
                      isPlaying={isPlaying}
                      coverUrl={getTrackCover?.(track)}
                      onPlay={onPlayTrack}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                  {!artistDetail.topTracks.length ? (
                    <p className="spotify-empty">该歌手暂无可播放热门单曲。</p>
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                {status === "loading"
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <div key={`skeleton-artist-${index}`} className="artist-search-skeleton-row" aria-hidden="true">
                        <div />
                        <div />
                        <div />
                      </div>
                    ))
                  : null}
                {artistResult.map((artist) => (
                  <ArtistSearchRow key={artist.id} artist={artist} onOpen={onOpenArtist} />
                ))}
                {status === "idle" || status === "empty" || status === "error" ? (
                  <SearchEmptyState status={status} mode="artist" error={error} />
                ) : null}
                {artistDetailLoading ? <p className="spotify-empty">歌手详情加载中...</p> : null}
                {artistDetailError ? <p className="error error-inline">{artistDetailError}</p> : null}
                {searchLoadingMore
                  ? Array.from({ length: loadingPlaceholderCount }).map((_, index) => (
                      <div key={`loading-artist-${index}`} className="artist-search-skeleton-row" aria-hidden="true">
                        <div />
                        <div />
                        <div />
                      </div>
                    ))
                  : null}
              </>
            )}
          </div>
        ) : (
          <div className="spotify-track-list">
            {status === "loading"
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div key={`skeleton-playlist-${index}`} className="artist-search-skeleton-row" aria-hidden="true">
                    <div />
                    <div />
                    <div />
                  </div>
                ))
              : null}
            {playlistResult.map((playlist) => (
              <PlaylistSearchRow key={playlist.id} playlist={playlist} onOpen={onOpenPlaylist} />
            ))}
            {status === "idle" || status === "empty" || status === "error" ? (
              <SearchEmptyState status={status} mode="playlist" error={error} />
            ) : null}
            {searchLoadingMore
              ? Array.from({ length: loadingPlaceholderCount }).map((_, index) => (
                  <div key={`loading-playlist-${index}`} className="artist-search-skeleton-row" aria-hidden="true">
                    <div />
                    <div />
                    <div />
                  </div>
                ))
              : null}
          </div>
        )}
        {status === "success" && error ? <p className="error error-inline search-feedback">{error}</p> : null}
      </div>
    </section>
  );
}
