import type { LyricLine, TrackLyric } from '../api/types';

export interface DisplayLine extends LyricLine {
  translation?: string;
}

/** 把 BFF 返回的原文和译文按时间对齐成一行一组，空行去掉 */
export function displayLines(lyric: TrackLyric | null): DisplayLine[] {
  if (!lyric) return [];
  const tr = new Map((lyric.translatedLines ?? []).map((l) => [l.timeMs, l.text]));
  return lyric.lines
    .filter((l) => l.text.trim())
    .map((l) => {
      const t = tr.get(l.timeMs);
      return t && t !== l.text ? { ...l, translation: t } : l;
    });
}

/** 没有时间轴（全为 0）时当作纯文本歌词 */
export const isUnsynced = (lines: LyricLine[]) => lines.length > 1 && lines.every((l) => l.timeMs === 0);

/** 当前时间对应的歌词行下标 */
export function activeLineIndex(lines: LyricLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= timeMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
