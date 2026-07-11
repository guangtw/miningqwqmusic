import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerDock } from "@/src/components/immersive/player-dock";

const baseProps = {
  isMobile: false,
  canOpenDetail: true,
  title: "测试歌曲",
  subtitle: "测试歌手",
  coverUrl: "/assets/default-cover.svg",
  progressDegrees: "60deg",
  hasProgress: true,
  isPlaying: false,
  loading: false,
  controlDisabled: false,
  modeLabel: "列表循环",
  modeIcon: <span>mode</span>,
  volume: 0.8,
  volumePercent: 80,
  isMuted: false,
  playIcon: <span>play</span>,
  pauseIcon: <span>pause</span>,
  previousIcon: <span>prev</span>,
  nextIcon: <span>next</span>,
  queueIcon: <span>queue</span>,
  volumeIcon: <span>vol</span>,
  spinner: <span>spin</span>,
  onOpenQueue: vi.fn(),
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onTogglePlay: vi.fn(),
  onNextMode: vi.fn(),
  onVolume: vi.fn(),
  onToggleMute: vi.fn()
};

describe("PlayerDock", () => {
  it("renders stage dock metadata and primary controls without a progress bar", () => {
    render(<PlayerDock {...baseProps} />);

    expect(screen.getByText("测试歌曲")).toBeInTheDocument();
    expect(screen.getByText("测试歌手")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开播放队列" })).toBeInTheDocument();
    expect(screen.queryByLabelText("播放进度")).not.toBeInTheDocument();
    expect(document.querySelector(".stage-player-dock.no-progress")).toBeTruthy();
  });

  it("opens detail when the track meta area is activated", () => {
    const onOpenDetail = vi.fn();
    render(<PlayerDock {...baseProps} onOpenDetail={onOpenDetail} />);

    fireEvent.click(screen.getByText("测试歌曲"));
    expect(onOpenDetail).toHaveBeenCalledWith("pointer");
  });

  it("removes dock metadata from the control layout while the shared detail layer is in flight", () => {
    render(<PlayerDock {...baseProps} hideTrackMeta />);

    expect(document.querySelector(".stage-player-dock.detail-meta-in-flight")).toBeTruthy();
    expect(document.querySelector(".stage-player-dock .player-dock-meta")).not.toBeInTheDocument();
  });

  it("reserves the original metadata slot before receiving the returning shared layer", () => {
    render(<PlayerDock {...baseProps} returningTrackMeta />);

    expect(document.querySelector(".stage-player-dock.detail-meta-returning .player-dock-meta")).toBeTruthy();
  });

  it("does not open detail for empty dock meta", () => {
    const onOpenDetail = vi.fn();
    render(
      <PlayerDock
        {...baseProps}
        canOpenDetail={false}
        title="还没有播放音乐"
        subtitle="从发现页开始探索"
        onOpenDetail={onOpenDetail}
      />
    );

    fireEvent.click(screen.getByText("还没有播放音乐"));
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("does not open detail when play control is pressed", () => {
    const onOpenDetail = vi.fn();
    const onTogglePlay = vi.fn();
    render(<PlayerDock {...baseProps} onOpenDetail={onOpenDetail} onTogglePlay={onTogglePlay} />);

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("wires transport and queue actions", () => {
    const onTogglePlay = vi.fn();
    const onOpenQueue = vi.fn();
    const onNext = vi.fn();
    render(
      <PlayerDock
        {...baseProps}
        onTogglePlay={onTogglePlay}
        onOpenQueue={onOpenQueue}
        onNext={onNext}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    fireEvent.click(screen.getByRole("button", { name: "下一首" }));

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
