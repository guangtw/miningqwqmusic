import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchMusic: vi.fn(),
  searchArtists: vi.fn(),
  searchPlaylists: vi.fn(),
  getArtistDetail: vi.fn(),
  getSearchAssist: vi.fn()
}));

vi.mock("@/src/lib/client-api", () => ({
  searchMusic: mocks.searchMusic,
  searchArtists: mocks.searchArtists,
  searchPlaylists: mocks.searchPlaylists,
  getArtistDetail: mocks.getArtistDetail,
  getSearchAssist: mocks.getSearchAssist
}));

import { useSearchPanel } from "@/src/hooks/use-search-panel";

describe("useSearchPanel", () => {
  beforeEach(() => {
    mocks.searchMusic.mockReset();
    mocks.searchArtists.mockReset();
    mocks.searchPlaylists.mockReset();
    mocks.getArtistDetail.mockReset();
    mocks.getSearchAssist.mockReset();
    mocks.getSearchAssist.mockResolvedValue({ hotKeywords: [], suggestions: [] });
  });

  it("sets an error when searching with an empty keyword", async () => {
    const { result } = renderHook(() => useSearchPanel({ active: true }));

    await act(async () => {
      await result.current.doSearch();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("请输入关键词后再搜索。");
    expect(mocks.searchMusic).not.toHaveBeenCalled();
  });

  it("loads track results on success", async () => {
    mocks.searchMusic.mockResolvedValue({
      items: [{ id: "1", name: "A", artists: [], durationMs: 1000 }],
      page: 1,
      pageSize: 20,
      total: 1
    });

    const { result } = renderHook(() => useSearchPanel({ active: false }));

    act(() => {
      result.current.setKeyword("林俊杰");
    });

    await act(async () => {
      await result.current.doSearch();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.trackResult).toHaveLength(1);
    expect(result.current.trackResult[0]?.name).toBe("A");
    expect(mocks.searchMusic).toHaveBeenCalledWith("林俊杰", 1, 20);
  });

  it("appends paged results when loading more", async () => {
    mocks.searchMusic
      .mockResolvedValueOnce({
        items: [
          { id: "1", name: "A", artists: [], durationMs: 1000 },
          { id: "2", name: "B", artists: [], durationMs: 1000 }
        ],
        page: 1,
        pageSize: 20,
        total: 3
      })
      .mockResolvedValueOnce({
        items: [{ id: "3", name: "C", artists: [], durationMs: 1000 }],
        page: 2,
        pageSize: 20,
        total: 3
      });

    const { result } = renderHook(() => useSearchPanel({ active: false }));

    act(() => {
      result.current.setKeyword("test");
    });

    await act(async () => {
      await result.current.doSearch();
    });

    await waitFor(() => expect(result.current.canLoadMore).toBe(true));

    await act(async () => {
      await result.current.loadMoreSearchResults();
    });

    await waitFor(() => {
      expect(result.current.trackResult.map((item) => item.id)).toEqual(["1", "2", "3"]);
    });
    expect(mocks.searchMusic).toHaveBeenLastCalledWith("test", 2, 20);
  });

  it("switches mode and re-searches when keyword exists", async () => {
    mocks.searchMusic.mockResolvedValue({
      items: [{ id: "1", name: "A", artists: [], durationMs: 1000 }],
      page: 1,
      pageSize: 20,
      total: 1
    });
    mocks.searchArtists.mockResolvedValue({
      items: [{ id: "ar1", name: "Artist" }],
      page: 1,
      pageSize: 20,
      total: 1
    });

    const { result } = renderHook(() => useSearchPanel({ active: false }));

    act(() => {
      result.current.setKeyword("邓紫棋");
    });
    await act(async () => {
      await result.current.doSearch();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    await act(async () => {
      result.current.switchSearchMode("artist");
    });

    await waitFor(() => {
      expect(result.current.searchMode).toBe("artist");
      expect(result.current.artistResult).toHaveLength(1);
    });
    expect(mocks.searchArtists).toHaveBeenCalledWith("邓紫棋", 1, 20);
  });

  it("discards stale search responses", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mocks.searchMusic.mockImplementationOnce(() => firstPromise).mockResolvedValueOnce({
      items: [{ id: "new", name: "New", artists: [], durationMs: 1000 }],
      page: 1,
      pageSize: 20,
      total: 1
    });

    const { result } = renderHook(() => useSearchPanel({ active: false }));

    act(() => {
      result.current.setKeyword("one");
    });
    let firstSearch: Promise<void> = Promise.resolve();
    act(() => {
      firstSearch = result.current.doSearch();
    });

    act(() => {
      result.current.setKeyword("two");
    });
    await act(async () => {
      await result.current.doSearch();
    });

    await act(async () => {
      resolveFirst({
        items: [{ id: "old", name: "Old", artists: [], durationMs: 1000 }],
        page: 1,
        pageSize: 20,
        total: 1
      });
      await firstSearch;
    });

    expect(result.current.trackResult[0]?.id).toBe("new");
    expect(result.current.trackResult.some((item) => item.id === "old")).toBe(false);
  });

  it("seeds assist data from the parent", () => {
    const { result } = renderHook(() => useSearchPanel({ active: false }));

    act(() => {
      result.current.seedAssist({
        defaultKeyword: "默认",
        hotKeywords: ["热"],
        suggestions: ["联"]
      });
    });

    expect(result.current.searchAssist?.defaultKeyword).toBe("默认");
    expect(result.current.hotAssistCandidates).toEqual(["热"]);
  });
});
