import { music, type DiscoverItem, type Track } from '../api';
import { epigraph as cfg } from '../config/site';
import { dayKey } from './format';
import { displayLines, isUnsynced } from './lrc';
import { readJSON, writeJSON } from './storage';

/** 今日卷首语：一句歌词 + 它出自哪首歌、在歌里的哪个时间点 */
export interface Epigraph {
  day: string;
  text: string;
  translation?: string;
  /** 这句在歌里的时间；无时间轴的歌词为 null */
  timeMs: number | null;
  track: Track;
}

const KEY = 'cph.epigraph.v1';

/** 字符串 → 稳定的伪随机数，同一天、同一个歌单选出来的结果总是一样 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const chars = (s: string) => Array.from(s).length;

/**
 * 从一首歌的歌词里挑一句。副歌（重复出现的句子）通常最有分量，优先选；
 * 署名行、太短或太长的句子不要。
 */
function pickLine(lines: ReturnType<typeof displayLines>, seed: number) {
  const ok = lines.filter((l) => {
    const t = l.text.trim();
    return chars(t) >= cfg.minChars && chars(t) <= cfg.maxChars && !cfg.skip.test(t);
  });
  if (!ok.length) return null;
  const count = new Map<string, number>();
  for (const l of ok) count.set(l.text.trim(), (count.get(l.text.trim()) ?? 0) + 1);
  const best = Math.max(...count.values());
  // 重复出现的句子里挑；都只出现一次就在全部候选里挑
  const pool = ok.filter((l) => count.get(l.text.trim()) === best);
  // 同一句重复多次时取第一次出现的位置
  const uniq = pool.filter((l, i) => pool.findIndex((x) => x.text.trim() === l.text.trim()) === i);
  return uniq[seed % uniq.length];
}

/** 当天已经选好的卷首语（同步读取，首页再次打开时直接画出来） */
export function cachedEpigraph(): Epigraph | null {
  const c = readJSON<Epigraph | null>(KEY, null);
  return c && c.day === dayKey() ? c : null;
}

/** 选今天的卷首语：取封面故事歌单 → 按日期定一首起点 → 依次试几首直到摘到一句 */
export async function todaysEpigraph(source: DiscoverItem | undefined): Promise<Epigraph | null> {
  const cached = cachedEpigraph();
  if (cached) return cached;
  if (!source?.targetId || (source.type !== 'playlist' && source.type !== 'toplist')) return null;

  const day = dayKey();
  const seed = hash(`${day}:${source.targetId}`);
  const list = source.type === 'toplist' ? await music.toplist(source.targetId) : await music.playlist(source.targetId);
  const tracks = list.tracks;
  if (!tracks.length) return null;

  for (let i = 0; i < Math.min(cfg.maxTracks, tracks.length); i++) {
    const track = tracks[(seed + i) % tracks.length];
    try {
      const lines = displayLines(await music.lyric(track.id));
      const line = pickLine(lines, seed);
      if (!line) continue;
      const result: Epigraph = {
        day,
        text: line.text.trim(),
        translation: line.translation,
        timeMs: isUnsynced(lines) ? null : line.timeMs,
        track,
      };
      writeJSON(KEY, result);
      return result;
    } catch {
      // 这首取不到歌词，换下一首
    }
  }
  return null;
}
