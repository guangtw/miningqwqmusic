import type { LyricLine } from "@/src/types/music";

const LINE_PATTERN = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?](.*)/;

export function parseLyric(raw: string): LyricLine[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = LINE_PATTERN.exec(line);
      if (!match) return null;

      const minute = Number(match[1]);
      const second = Number(match[2]);
      const msPart = (match[3] ?? "0").padEnd(3, "0");
      const text = match[4].trim();
      const timeMs = minute * 60_000 + second * 1000 + Number(msPart);

      return {
        timeMs,
        text: text || "..."
      } satisfies LyricLine;
    })
    .filter((line): line is LyricLine => line !== null)
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function locateCurrentLyricIndex(lines: LyricLine[], currentMs: number): number {
  if (!lines.length) return -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (currentMs >= lines[i].timeMs) return i;
  }
  return 0;
}
