import { useCallback, useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

// 最近取过的数据。返回上一页时直接用它同步渲染：
// 页面切换的视图过渡拍快照时内容已经在了，封面能飞回原来的卡片，也不会先闪骨架屏。
const cache = new Map<string, { data: unknown; at: number }>();
const MAX_AGE_MS = 5 * 60_000;

function fresh<T>(key?: string): T | undefined {
  const hit = key ? cache.get(key) : undefined;
  return hit && Date.now() - hit.at < MAX_AGE_MS ? (hit.data as T) : undefined;
}

/** cacheKey 不传就不缓存；传了的话，同一个 key 在几分钟内再次进入直接用上次的结果 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], cacheKey?: string): AsyncState<T> {
  const [state, setState] = useState<{ key?: string; data?: T; error?: Error; loading: boolean }>(() => {
    const data = fresh<T>(cacheKey);
    return data === undefined ? { key: cacheKey, loading: true } : { key: cacheKey, data, loading: false };
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const hit = tick === 0 ? fresh<T>(cacheKey) : undefined;
    if (hit !== undefined) {
      setState({ key: cacheKey, data: hit, loading: false });
      return;
    }
    setState({ key: cacheKey, loading: true });
    fn().then(
      (data) => {
        if (cacheKey) cache.set(cacheKey, { data, at: Date.now() });
        if (alive) setState({ key: cacheKey, data, loading: false });
      },
      (error: Error) => alive && setState({ key: cacheKey, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, cacheKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // key 刚变、effect 还没跑的那一次渲染，不要把上一个 key 的数据画出来
  if (cacheKey && state.key !== cacheKey) {
    const data = fresh<T>(cacheKey);
    return { data, error: undefined, loading: data === undefined, reload };
  }
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
