"use client";

import type { CSSProperties, ReactNode, Ref } from "react";

export type PlayerDockMobileTab = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
};

export type PlayerDockProps = {
  variant?: "global" | "detail";
  dockRef?: Ref<HTMLElement>;
  isMobile: boolean;
  canOpenDetail: boolean;
  title: string;
  subtitle: string;
  coverUrl: string;
  progressDegrees: string;
  hasProgress: boolean;
  isPlaying: boolean;
  loading: boolean;
  controlDisabled: boolean;
  modeLabel: string;
  modeIcon: ReactNode;
  volume: number;
  volumePercent: number;
  isMuted: boolean;
  playIcon: ReactNode;
  pauseIcon: ReactNode;
  previousIcon: ReactNode;
  nextIcon: ReactNode;
  queueIcon: ReactNode;
  volumeIcon: ReactNode;
  spinner: ReactNode;
  mobileTabs?: PlayerDockMobileTab[];
  onOpenDetail?: (interaction: "pointer" | "keyboard") => void;
  onOpenQueue: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onNextMode: () => void;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
};

function formatVolumeStyle(volumePercent: number, inactive = "rgba(255,255,255,0.22)"): string {
  return `linear-gradient(180deg, ${inactive} 0%, ${inactive} ${100 - volumePercent}%, var(--stage-accent-strong, var(--brand-strong)) ${100 - volumePercent}%, var(--stage-accent, var(--brand)) 100%)`;
}

function DockIconButton({
  ariaLabel,
  title,
  disabled,
  className,
  onClick,
  children
}: {
  ariaLabel: string;
  title?: string;
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
      className={`icon-btn ${className ?? ""}`.trim()}
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

export function PlayerDock({
  variant = "global",
  dockRef,
  isMobile,
  canOpenDetail,
  title,
  subtitle,
  coverUrl,
  progressDegrees,
  hasProgress,
  isPlaying,
  loading,
  controlDisabled,
  modeLabel,
  modeIcon,
  volume,
  volumePercent,
  isMuted,
  playIcon,
  pauseIcon,
  previousIcon,
  nextIcon,
  queueIcon,
  volumeIcon,
  spinner,
  mobileTabs,
  onOpenDetail,
  onOpenQueue,
  onPrevious,
  onNext,
  onTogglePlay,
  onNextMode,
  onVolume,
  onToggleMute
}: PlayerDockProps) {
  const isDetail = variant === "detail";
  const empty = !canOpenDetail && !isDetail;
  const volumeInactive = isDetail ? "var(--detail-range-inactive)" : "rgba(255,255,255,0.22)";

  return (
    <footer
      ref={dockRef}
      className={[
        // Global dock needs fixed chrome classes; detail dock must NOT use
        // spotify-player-bar or it inherits position:fixed !important.
        isDetail ? "detail-dock immersive-player-dock player-dock-shell stage-player-dock no-progress" : "spotify-player-bar immersive-player-dock player-dock-shell stage-player-dock no-progress",
        canOpenDetail && !isDetail ? "clickable" : "",
        empty ? "empty" : "",
        isPlaying ? "is-playing" : "",
        hasProgress ? "has-track" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-disabled={!canOpenDetail && !isDetail}
      data-variant={variant}
    >
      <div className={`player-dock-main-grid player-dock-body ${isDetail ? "detail-player-main-grid" : ""}`.trim()}>
        <div
          className={`spotify-player-left player-dock-meta ${canOpenDetail && !isDetail ? "is-openable" : ""}`.trim()}
          role={canOpenDetail && !isDetail ? "button" : undefined}
          tabIndex={canOpenDetail && !isDetail ? 0 : undefined}
          onClick={() => {
            if (!isDetail && canOpenDetail && onOpenDetail) {
              onOpenDetail("pointer");
            }
          }}
          onKeyDown={(event) => {
            if (!isDetail && canOpenDetail && onOpenDetail && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onOpenDetail("keyboard");
            }
          }}
        >
          <div
            className={`player-dock-cover ${empty ? "is-empty" : ""}`.trim()}
            style={{ backgroundImage: `url(${coverUrl})` }}
            aria-hidden="true"
          />
          <div className="player-dock-copy">
            <p className="player-title">{title}</p>
            <p className="player-subtitle">{subtitle}</p>
          </div>
        </div>

        <div className="spotify-player-center player-dock-center" onClick={(event) => event.stopPropagation()}>
          <div className={`spotify-player-controls ${isDetail ? "detail-dock-controls" : ""}`.trim()}>
            <div className="player-control-side player-control-side-left">
              <DockIconButton ariaLabel="打开播放队列" title="打开播放队列" onClick={onOpenQueue} className="ghost dock-icon">
                {queueIcon}
              </DockIconButton>
            </div>

            <div className="player-control-transport">
              <DockIconButton
                ariaLabel="上一首"
                title="上一首"
                disabled={controlDisabled}
                onClick={onPrevious}
                className="ghost dock-icon"
              >
                {previousIcon}
              </DockIconButton>

              <div
                className={`player-progress-orbit ${hasProgress ? "has-progress" : "idle"} ${isPlaying ? "is-playing" : ""}`.trim()}
                style={{ "--play-progress-angle": progressDegrees } as CSSProperties}
              >
                <DockIconButton
                  ariaLabel={isPlaying ? "暂停" : "播放"}
                  title={isPlaying ? "暂停" : "播放"}
                  className="play-main"
                  disabled={controlDisabled}
                  onClick={onTogglePlay}
                >
                  {loading ? spinner : isPlaying ? pauseIcon : playIcon}
                </DockIconButton>
              </div>

              <DockIconButton
                ariaLabel="下一首"
                title="下一首"
                disabled={controlDisabled}
                onClick={onNext}
                className="ghost dock-icon"
              >
                {nextIcon}
              </DockIconButton>
            </div>

            <div className="player-control-side player-control-side-right">
              <DockIconButton
                ariaLabel={modeLabel}
                title={modeLabel}
                disabled={controlDisabled}
                onClick={onNextMode}
                className="ghost dock-icon"
              >
                {modeIcon}
              </DockIconButton>
            </div>
          </div>
        </div>

        {!isMobile ? (
          <div
            className={`spotify-player-right player-dock-volume ${isDetail ? "detail-dock-volume" : ""}`.trim()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="player-volume-stack">
              <div className="player-volume-popover">
                <span>{Math.round(volume * 100)}%</span>
                <input
                  className="range-slider range-volume vertical"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  aria-label="音量"
                  style={{ background: formatVolumeStyle(volumePercent, volumeInactive) }}
                  onChange={(event) => onVolume(Number(event.target.value))}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
              <DockIconButton
                ariaLabel={isMuted ? "取消静音" : "静音"}
                title={isMuted ? "取消静音" : "静音"}
                onClick={onToggleMute}
                className={isMuted ? "warn dock-icon" : "ghost dock-icon"}
              >
                {volumeIcon}
              </DockIconButton>
            </div>
          </div>
        ) : null}
      </div>

      {isMobile && mobileTabs?.length ? (
        <nav className="mobile-bottom-tabs" role="tablist" aria-label="页面切换">
          {mobileTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.active}
              className={item.active ? "active" : ""}
              onClick={(event) => {
                event.stopPropagation();
                item.onSelect();
              }}
            >
              <span className="mobile-bottom-tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </footer>
  );
}
