import { createStore } from './store';
import { readJSON, writeJSON } from './storage';

// 最近搜过的词，只存在这台设备上。

const KEY = 'qwq-search-history-v1';
const MAX = 10;

export const searchHistoryStore = createStore<{ words: string[] }>({ words: readJSON<string[]>(KEY, []).slice(0, MAX) });

function save(words: string[]) {
  searchHistoryStore.set({ words });
  writeJSON(KEY, words);
}

/** 记一次：同一个词挪到最前，不重复 */
export function rememberSearch(q: string) {
  const w = q.trim();
  if (!w) return;
  const words = searchHistoryStore.get().words;
  if (words[0] === w) return;
  save([w, ...words.filter((x) => x !== w)].slice(0, MAX));
}

export const forgetSearch = (w: string) => save(searchHistoryStore.get().words.filter((x) => x !== w));
export const clearSearchHistory = () => save([]);
