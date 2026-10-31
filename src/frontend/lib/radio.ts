import { music, type SceneResource, type Track } from '../api';

// 场景电台：跑步漫游（按步频挑歌）和静心（助眠、冥想、白噪音……）。

export const PACES = [
  { bpm: 100, label: '散步' },
  { bpm: 120, label: '快走' },
  { bpm: 140, label: '慢跑' },
  { bpm: 160, label: '跑步' },
  { bpm: 180, label: '冲刺' },
] as const;
export const BPM_RANGE = { min: 80, max: 200, step: 2 };

/** 场景资源只带标题和封面，拼成能放的曲目；艺人位写分类名 */
export function fromResource(r: SceneResource, by = ''): Track {
  return {
    id: r.trackId ?? r.id,
    name: r.title,
    artists: [{ id: '', name: by || r.subtitle || '' }],
    album: { id: '', name: '', coverUrl: r.coverUrl },
    durationMs: 0,
    coverUrl: r.coverUrl,
  };
}

/**
 * 上游每个步频只回一首歌，同一个步频每次都一样。
 * 所以在目标步频上下各扫几档（±10 以内，间隔 2），去重后就是一张节奏相近的歌单，
 * 越接近目标步频的排得越前。
 */
const OFFSETS = [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10];

export async function sportMix(bpm: number): Promise<Track[]> {
  const scenes = await Promise.allSettled(OFFSETS.map((o) => music.sport(bpm + o)));
  const seen = new Set<string>();
  const picks: SceneResource[] = [];
  for (const s of scenes) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value.resources) {
      if (!r.trackId || seen.has(r.trackId)) continue;
      seen.add(r.trackId);
      picks.push(r);
    }
  }
  if (!picks.length && scenes.every((s) => s.status === 'rejected')) throw (scenes[0] as PromiseRejectedResult).reason;
  // 换成完整曲目（带艺人链接、专辑和时长）；查不到就用场景里的标题和封面
  return Promise.all(
    picks.map((r) =>
      music.track(r.trackId!).then(
        (t) => (t.name ? { ...t, coverUrl: t.coverUrl ?? r.coverUrl } : fromResource(r)),
        () => fromResource(r),
      ),
    ),
  );
}
