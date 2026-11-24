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

/** 歌词开头的署名行：「作词：某人」「Composer: xxx」 */
const CREDIT = /^\s*(作词|作曲|编曲|制作人?|监制|混音|母带|录音|和声|吉他|贝斯|鼓|键盘|弦乐|出品|发行|统筹|策划|OP|SP|Lyrics?|Lyricist|Composer|Composed by|Arranger|Arranged by|Producer|Produced by|Mix(?:ing)?|Master(?:ing)?)\s*[:：]\s*(.+)$/i;

export interface Credit {
  role: string;
  name: string;
}

/**
 * 把开头连着的署名行拆出来单独排（歌名下面一行小字），不占歌词的位置、不跟着高亮。
 * 只拆开头那一段：唱到一半出现的「xx：」可能就是歌词本身
 */
export function splitCredits(lines: DisplayLine[]): { credits: Credit[]; lines: DisplayLine[] } {
  const credits: Credit[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = CREDIT.exec(lines[i].text);
    if (!m) break;
    credits.push({ role: m[1], name: m[2].trim() });
  }
  // 整首都像署名（极少见）就当没拆
  if (i === lines.length) return { credits: [], lines };
  return { credits, lines: credits.length ? lines.slice(i) : lines };
}

/**
 * 当前这句唱到哪儿了（0~1），给逐字点亮用。只有整句的时间，按字数估一个演唱时长：
 * 一句唱完通常比到下一句的间隔短（句尾拖音、间奏），所以取两者较小的那个
 */
export function lineProgress(lines: LyricLine[], i: number, timeMs: number): number {
  const line = lines[i];
  if (!line) return 0;
  const next = lines[i + 1]?.timeMs ?? line.timeMs + 6000;
  const sung = [...line.text].length * 290 + 500;
  const span = Math.max(400, Math.min(next - line.timeMs, sung));
  return Math.min(1, Math.max(0, (timeMs - line.timeMs) / span));
}
