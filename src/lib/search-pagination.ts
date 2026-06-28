export function appendPagedItems<T extends { id: string }>(currentItems: T[], nextItems: T[]): T[] {
  if (!currentItems.length) return [...nextItems];
  const seen = new Set(currentItems.map((item) => item.id));
  const merged = [...currentItems];
  nextItems.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });
  return merged;
}

export function shouldLoadNextSearchPage(input: {
  status: "idle" | "loading" | "success" | "empty" | "error";
  loadingMore: boolean;
  loadedCount: number;
  total: number;
}): boolean {
  if (input.status !== "success") return false;
  if (input.loadingMore) return false;
  if (input.total <= 0) return false;
  return input.loadedCount < input.total;
}

export function shouldLoadNextSearchPageByScroll(input: {
  canLoadMore: boolean;
  hasUserScrolled: boolean;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  if (!input.canLoadMore) return false;
  if (!input.hasUserScrolled) return false;
  if (input.scrollHeight <= input.clientHeight + 24) return false;

  const preloadThreshold = Math.max(120, Math.min(220, input.clientHeight * 0.18));
  const distanceToBottom = input.scrollHeight - (input.scrollTop + input.clientHeight);
  return distanceToBottom <= preloadThreshold;
}

export function getSearchLoadingPlaceholderCount(mode: "track" | "artist" | "playlist"): number {
  return mode === "track" ? 3 : 4;
}
