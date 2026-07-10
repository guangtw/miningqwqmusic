import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel } from "@/src/components/immersive/search-panel";
import type { ArtistDetail, ArtistSearchItem, Playlist, Track } from "@/src/types/music";

const sampleTrack: Track = {
  id: "t1",
  name: "修炼爱情",
  artists: [{ id: "a1", name: "林俊杰" }],
  album: { id: "al1", name: "因你而在" },
  durationMs: 287000
};

const sampleArtist: ArtistSearchItem = {
  id: "ar1",
  name: "邓紫棋",
  musicSize: 120,
  albumSize: 18
};

const samplePlaylist: Playlist = {
  id: "p1",
  name: "深夜循环",
  description: "安静听歌",
  tracks: []
};

const sampleArtistDetail: ArtistDetail = {
  id: "ar1",
  name: "邓紫棋",
  briefDesc: "歌手简介",
  topTracks: [sampleTrack]
};

function baseProps(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  return {
    keyword: "",
    onKeywordChange: vi.fn(),
    searchMode: "track" as const,
    onSwitchMode: vi.fn(),
    status: "idle" as const,
    error: null,
    trackResult: [] as Track[],
    artistResult: [] as ArtistSearchItem[],
    playlistResult: [] as Playlist[],
    searchAssist: {
      defaultKeyword: "林俊杰",
      hotKeywords: ["热搜一", "热搜二"],
      suggestions: ["联想一"]
    },
    hotAssistCandidates: ["热搜一", "热搜二"],
    suggestAssistCandidates: ["联想一"],
    visibleHotAssistCount: 2,
    visibleSuggestAssistCount: 1,
    searchLoadingMore: false,
    canLoadMore: false,
    loadingPlaceholderCount: 3,
    activeResultCount: 0,
    artistDetail: null as ArtistDetail | null,
    artistDetailLoading: false,
    artistDetailError: null as string | null,
    favoriteSet: {},
    currentTrackId: null as string | null,
    isPlaying: false,
    onSubmit: vi.fn(),
    onApplyAssistKeyword: vi.fn(),
    onOpenArtist: vi.fn(),
    onCloseArtistDetail: vi.fn(),
    onOpenPlaylist: vi.fn(),
    onPlayTrack: vi.fn(),
    onToggleFavorite: vi.fn(),
    onPlayArtistTopTracks: vi.fn(),
    onAddArtistTopTracksToQueue: vi.fn(),
    ...overrides
  };
}

describe("SearchPanel", () => {
  it("renders title, mode tabs, and idle empty copy", () => {
    render(<SearchPanel {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "搜索" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "单曲" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "歌手" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "歌单" })).toBeInTheDocument();
    expect(screen.getByText("输入歌曲或歌手，例如“林俊杰”或“修炼爱情”。")).toBeInTheDocument();
  });

  it("submits the search form", () => {
    const onSubmit = vi.fn();
    render(<SearchPanel {...baseProps({ onSubmit })} />);

    fireEvent.submit(screen.getByRole("search"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("applies a hot keyword when clicked", () => {
    const onApplyAssistKeyword = vi.fn();
    render(<SearchPanel {...baseProps({ onApplyAssistKeyword })} />);

    fireEvent.click(screen.getByRole("button", { name: "热搜一" }));
    expect(onApplyAssistKeyword).toHaveBeenCalledWith("热搜一");
  });

  it("switches search mode", () => {
    const onSwitchMode = vi.fn();
    render(<SearchPanel {...baseProps({ onSwitchMode })} />);

    fireEvent.click(screen.getByRole("tab", { name: "歌手" }));
    expect(onSwitchMode).toHaveBeenCalledWith("artist");
  });

  it("renders track results and play action", () => {
    const onPlayTrack = vi.fn();
    render(
      <SearchPanel
        {...baseProps({
          status: "success",
          trackResult: [sampleTrack],
          activeResultCount: 1,
          onPlayTrack
        })}
      />
    );

    expect(screen.getByText("修炼爱情")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "播放歌曲" }));
    expect(onPlayTrack).toHaveBeenCalledWith(sampleTrack);
  });

  it("applies resolved cover art to track rows", () => {
    const { container } = render(
      <SearchPanel
        {...baseProps({
          status: "success",
          trackResult: [sampleTrack],
          activeResultCount: 1,
          getTrackCover: () => "https://example.com/cover.jpg"
        })}
      />
    );

    const cover = container.querySelector(".spotify-track-cover") as HTMLElement | null;
    expect(cover?.style.backgroundImage).toContain("example.com/cover.jpg");
  });

  it("applies cover art on artist-detail top tracks and switches meta copy", () => {
    const { container } = render(
      <SearchPanel
        {...baseProps({
          searchMode: "artist",
          status: "success",
          activeResultCount: 3,
          artistDetail: sampleArtistDetail,
          getTrackCover: () => "https://example.com/artist-track.jpg"
        })}
      />
    );

    expect(screen.getByText("热门单曲 · 1 首")).toBeInTheDocument();
    const cover = container.querySelector(".spotify-track-cover") as HTMLElement | null;
    expect(cover?.style.backgroundImage).toContain("artist-track.jpg");
  });

  it("marks the sticky head compact when results are present", () => {
    const { container } = render(
      <SearchPanel
        {...baseProps({
          status: "success",
          trackResult: [sampleTrack],
          activeResultCount: 1
        })}
      />
    );

    expect(container.querySelector(".search-sticky-head.is-compact")).toBeTruthy();
  });

  it("shows error and empty states", () => {
    const { rerender } = render(<SearchPanel {...baseProps({ status: "empty" })} />);
    expect(screen.getByText("没有找到匹配结果，换个关键词试试。")).toBeInTheDocument();

    rerender(<SearchPanel {...baseProps({ status: "error", error: "搜索失败" })} />);
    expect(screen.getByText("搜索失败")).toBeInTheDocument();
  });

  it("hides assist chips when results are present to free vertical space", () => {
    render(
      <SearchPanel
        {...baseProps({
          status: "success",
          trackResult: [sampleTrack],
          activeResultCount: 1
        })}
      />
    );

    expect(screen.queryByText("热搜")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "热搜一" })).not.toBeInTheDocument();
    expect(screen.getByText("1 首单曲")).toBeInTheDocument();
  });

  it("renders artist detail panel and close action", () => {
    const onCloseArtistDetail = vi.fn();
    render(
      <SearchPanel
        {...baseProps({
          searchMode: "artist",
          status: "success",
          artistDetail: sampleArtistDetail,
          onCloseArtistDetail
        })}
      />
    );

    expect(screen.getByText("返回歌手列表")).toBeInTheDocument();
    expect(screen.getByText("邓紫棋")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回歌手列表" }));
    expect(onCloseArtistDetail).toHaveBeenCalled();
  });

  it("renders artist list rows", () => {
    const onOpenArtist = vi.fn();
    render(
      <SearchPanel
        {...baseProps({
          searchMode: "artist",
          status: "success",
          artistResult: [sampleArtist],
          activeResultCount: 1,
          onOpenArtist
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /邓紫棋/ }));
    expect(onOpenArtist).toHaveBeenCalledWith(sampleArtist);
  });

  it("renders playlist rows", () => {
    const onOpenPlaylist = vi.fn();
    render(
      <SearchPanel
        {...baseProps({
          searchMode: "playlist",
          status: "success",
          playlistResult: [samplePlaylist],
          activeResultCount: 1,
          onOpenPlaylist
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /深夜循环/ }));
    expect(onOpenPlaylist).toHaveBeenCalledWith(samplePlaylist);
  });
});
