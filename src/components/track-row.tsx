"use client";

import type { CSSProperties, ReactNode } from "react";
import { getSizedImageUrl } from "@/src/lib/image-url";
import type { Track } from "@/src/types/music";

const DEFAULT_COVER_URL = "/assets/default-cover.svg";
const COVER_SIZE = 44;

export type TrackRowProps = {
  track: Track;
  liked: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  /** Prefer resolved/enriched artwork over track.coverUrl when provided. */
  coverUrl?: string | null;
  onPlay: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
};

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minute = Math.floor(totalSeconds / 60);
  const second = totalSeconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function isUsableCover(url?: string | null): url is string {
  return Boolean(url && url !== DEFAULT_COVER_URL);
}

function resolveTrackCoverUrl(track: Track, preferred?: string | null): string {
  const raw = (isUsableCover(preferred) ? preferred : undefined) || track.coverUrl || track.album?.coverUrl;
  return getSizedImageUrl(raw, { width: COVER_SIZE * 2, height: COVER_SIZE * 2 }) ?? DEFAULT_COVER_URL;
}

function coverStyle(track: Track, preferred?: string | null): CSSProperties {
  return {
    backgroundImage: `url(${resolveTrackCoverUrl(track, preferred)})`
  };
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.8c0-.9.96-1.46 1.74-1.02l9.1 5.2c.8.46.8 1.58 0 2.04l-9.1 5.2c-.78.44-1.74-.12-1.74-1.02V5.8z" fill="currentColor" />
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

export function TrackRow({
  track,
  liked,
  currentTrackId,
  isPlaying,
  coverUrl,
  onPlay,
  onToggleFavorite
}: TrackRowProps) {
  const isCurrent = currentTrackId === track.id;
  const isPlayingCurrent = isCurrent && isPlaying;
  return (
    <article className={`spotify-track-row ${isCurrent ? "current" : ""}`.trim()}>
      <div className="spotify-track-cover" style={coverStyle(track, coverUrl)} aria-hidden="true" />
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
