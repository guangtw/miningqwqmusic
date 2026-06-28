import { describe, expect, it } from "vitest";
import {
  appendPagedItems,
  getSearchLoadingPlaceholderCount,
  shouldLoadNextSearchPage,
  shouldLoadNextSearchPageByScroll
} from "@/src/lib/search-pagination";

describe("search pagination helpers", () => {
  it("appends the next page without duplicating items already rendered", () => {
    const merged = appendPagedItems(
      [
        { id: "1", name: "A" },
        { id: "2", name: "B" }
      ],
      [
        { id: "2", name: "B" },
        { id: "3", name: "C" }
      ]
    );

    expect(merged).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
      { id: "3", name: "C" }
    ]);
  });

  it("loads another page only when not already loading and there are still more results", () => {
    expect(
      shouldLoadNextSearchPage({
        status: "success",
        loadingMore: false,
        loadedCount: 20,
        total: 65
      })
    ).toBe(true);

    expect(
      shouldLoadNextSearchPage({
        status: "success",
        loadingMore: true,
        loadedCount: 20,
        total: 65
      })
    ).toBe(false);

    expect(
      shouldLoadNextSearchPage({
        status: "empty",
        loadingMore: false,
        loadedCount: 0,
        total: 0
      })
    ).toBe(false);

    expect(
      shouldLoadNextSearchPage({
        status: "success",
        loadingMore: false,
        loadedCount: 65,
        total: 65
      })
    ).toBe(false);
  });

  it("does not auto-load before the user has actually scrolled the results container", () => {
    expect(
      shouldLoadNextSearchPageByScroll({
        canLoadMore: true,
        hasUserScrolled: false,
        scrollTop: 0,
        clientHeight: 640,
        scrollHeight: 1800
      })
    ).toBe(false);
  });

  it("loads when the user has scrolled near the bottom of an overflowing results list", () => {
    expect(
      shouldLoadNextSearchPageByScroll({
        canLoadMore: true,
        hasUserScrolled: true,
        scrollTop: 1088,
        clientHeight: 640,
        scrollHeight: 1800
      })
    ).toBe(true);
  });

  it("does not load early when the user is still far from the bottom", () => {
    expect(
      shouldLoadNextSearchPageByScroll({
        canLoadMore: true,
        hasUserScrolled: true,
        scrollTop: 540,
        clientHeight: 640,
        scrollHeight: 2200
      })
    ).toBe(false);
  });

  it("does not load when the list has not overflowed enough to scroll", () => {
    expect(
      shouldLoadNextSearchPageByScroll({
        canLoadMore: true,
        hasUserScrolled: false,
        scrollTop: 0,
        clientHeight: 900,
        scrollHeight: 920
      })
    ).toBe(false);
  });

  it("returns a small bottom placeholder count for each search mode", () => {
    expect(getSearchLoadingPlaceholderCount("track")).toBe(3);
    expect(getSearchLoadingPlaceholderCount("artist")).toBe(4);
    expect(getSearchLoadingPlaceholderCount("playlist")).toBe(4);
  });
});
