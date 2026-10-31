import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('search history', () => {
  it('keeps the latest ten distinct words, newest first, and survives a reload', async () => {
    const h = await import('@/src/frontend/lib/searchHistory');
    for (let i = 0; i < 12; i++) h.rememberSearch(`词${i}`);
    h.rememberSearch(' 词5 ');
    expect(h.searchHistoryStore.get().words).toEqual(['词5', '词11', '词10', '词9', '词8', '词7', '词6', '词4', '词3', '词2']);

    h.forgetSearch('词11');
    vi.resetModules();
    const again = await import('@/src/frontend/lib/searchHistory');
    expect(again.searchHistoryStore.get().words.slice(0, 2)).toEqual(['词5', '词10']);
    again.clearSearchHistory();
    expect(again.searchHistoryStore.get().words).toEqual([]);
  });
});
