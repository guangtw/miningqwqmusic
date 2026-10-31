import { useEffect, useState } from 'react';
import { music, type SongInsight } from '../api';

// 歌曲百科（创作人、曲风、副歌位置、原唱版本），按歌缓存，同一首不重复问。

const MAX = 60;
const cache = new Map<string, Promise<SongInsight>>();

export function insightOf(id: string) {
  let p = cache.get(id);
  if (!p) {
    p = music.insight(id);
    // 失败的不留，下次再问
    p.catch(() => cache.delete(id));
    cache.set(id, p);
    if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  }
  return p;
}

export function useInsight(id: string | undefined, enabled = true) {
  const [state, setState] = useState<{ id?: string; data?: SongInsight; error?: Error }>({});
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    insightOf(id).then(
      (data) => alive && setState({ id, data }),
      (error: Error) => alive && setState({ id, error }),
    );
    return () => {
      alive = false;
    };
  }, [id, enabled]);
  // 换歌后、新结果到之前不显示上一首的
  const fresh = state.id === id;
  return { data: fresh ? state.data : undefined, error: fresh ? state.error : undefined, loading: !!id && enabled && !fresh };
}

/** 同一个角色的人归到一起，按第一次出现的顺序：作词 → 作曲 → 编曲… */
export function groupCreators(creators: SongInsight['creators']) {
  const groups = new Map<string, string[]>();
  for (const c of creators) {
    const role = c.role || '创作';
    const list = groups.get(role) ?? [];
    if (!list.includes(c.name)) list.push(c.name);
    groups.set(role, list);
  }
  return [...groups.entries()];
}

/** 「流行-华语流行」这类曲风串拆成标签 */
export const styleTags = (summary?: string) =>
  [...new Set((summary ?? '').split(/[-、,，/|]/).map((s) => s.trim()).filter(Boolean))];
