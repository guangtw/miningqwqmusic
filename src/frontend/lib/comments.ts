import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackComment, TrackCommentPage } from '@/src/types/music';
import { ApiError, path, request } from '../api/http';
import { api } from '../config/site';

// 歌曲评论：网易云的公开评论，只读。换歌、换排序都从第一页重来；按评论 id 去重（翻页期间上游内容会变）。

export type CommentSort = 'hot' | 'time';
const LIMIT = 20;

interface State {
  key: string;
  items: TrackComment[];
  total: number;
  hasMore: boolean;
  cursor: string | null;
  loading: boolean;
  error: string | null;
}

const fresh = (key: string): State => ({ key, items: [], total: 0, hasMore: true, cursor: null, loading: false, error: null });

/** 上游在冷却 / 排队 / 超时：说清楚，让人自己点重试，不自动循环 */
function describe(e: unknown) {
  if (e instanceof ApiError) {
    if ([2002, 2004, 2008].includes(e.code)) return '评论区这会儿有点忙，过一会儿再试。';
    if (e.code === 2009) return '现在是演示数据，没有评论。';
  }
  return (e as Error).message || '评论没加载出来。';
}

export function useComments(trackId: string | undefined, sort: CommentSort, enabled: boolean) {
  const key = `${trackId}:${sort}`;
  const [state, setState] = useState<State>(() => fresh(key));
  const live = useRef(state);
  live.current = state.key === key ? state : fresh(key);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(
    async (reset = false) => {
      const cur = live.current;
      if (!trackId || (!reset && (cur.loading || !cur.hasMore))) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const base = reset ? fresh(key) : cur;
      setState({ ...base, loading: true, error: null });
      try {
        const page = await request<TrackCommentPage>(path(api.paths.comments, { id: trackId }), {
          query: { sort, limit: LIMIT, cursor: base.cursor ?? undefined },
          signal: c.signal,
        });
        if (c.signal.aborted) return;
        const seen = new Set(base.items.map((x) => x.id));
        setState({
          key,
          items: [...base.items, ...page.items.filter((x) => !seen.has(x.id) && !!seen.add(x.id))],
          total: page.total,
          hasMore: page.hasMore && !!page.nextCursor,
          cursor: page.nextCursor,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (c.signal.aborted || (e as Error).name === 'AbortError') return;
        // 游标失效：从头来
        if (e instanceof ApiError && e.code === 4001 && base.cursor) return void setState(fresh(key));
        setState({ ...base, loading: false, error: describe(e) });
      }
    },
    [trackId, sort, key],
  );

  useEffect(() => {
    if (enabled && trackId && !live.current.items.length && !live.current.error) void load(true);
  }, [enabled, trackId, key, load]);
  useEffect(() => () => ctrl.current?.abort(), [key]);

  return { ...live.current, more: () => void load(), retry: () => void load(live.current.items.length === 0) };
}

/** 评论时间：今天 14:20 / 10 月 17 日 / 2014 年 10 月 17 日 */
export function commentTime(ms: number, now = new Date()) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 网易云头像给的是 http，https 页面上换成 https，顺便要个小图 */
export function avatarSrc(url?: string) {
  if (!url) return undefined;
  const secure = url.replace(/^http:\/\/(p\d+\.music\.126\.net)/, 'https://$1');
  return /music\.126\.net/.test(secure) && !secure.includes('param=') ? `${secure}${secure.includes('?') ? '&' : '?'}param=80y80` : secure;
}
