import { describe, expect, it } from 'vitest';
import { lineProgress, splitCredits, type DisplayLine } from '@/src/frontend/lib/lrc';

const line = (timeMs: number, text: string): DisplayLine => ({ timeMs, text });

describe('splitCredits', () => {
  it('moves the leading credit lines out of the lyrics', () => {
    const { credits, lines } = splitCredits([line(0, '作词：某人'), line(0, '作曲 : 另一人'), line(0, 'Arranger: X'), line(9000, '清晨的光'), line(14000, '针尖划过')]);
    expect(credits).toEqual([
      { role: '作词', name: '某人' },
      { role: '作曲', name: '另一人' },
      { role: 'Arranger', name: 'X' },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['清晨的光', '针尖划过']);
  });

  it('leaves a colon inside the song alone', () => {
    const input = [line(1000, '清晨的光'), line(5000, '作词：这句其实是歌词')];
    expect(splitCredits(input)).toEqual({ credits: [], lines: input });
  });

  it('keeps everything when every line looks like a credit', () => {
    const input = [line(0, '作词：某人'), line(0, '作曲：某人')];
    expect(splitCredits(input)).toEqual({ credits: [], lines: input });
  });
});

describe('lineProgress', () => {
  const lines = [line(0, '一二三四'), line(10000, '五六'), line(10800, '七')];

  it('fills a line over an estimate of how long it is sung, not the whole gap', () => {
    // 4 字 ≈ 4 × 290 + 500 = 1660ms，比到下一句的 10 秒短
    expect(lineProgress(lines, 0, 0)).toBe(0);
    expect(lineProgress(lines, 0, 830)).toBeCloseTo(0.5, 2);
    expect(lineProgress(lines, 0, 1660)).toBe(1);
    expect(lineProgress(lines, 0, 8000)).toBe(1);
  });

  it('never runs past the next line', () => {
    // 到下一句只有 800ms，比估出来的 1080ms 短
    expect(lineProgress(lines, 1, 10400)).toBeCloseTo(0.5, 2);
  });

  it('is 0 for a missing line', () => {
    expect(lineProgress(lines, -1, 500)).toBe(0);
  });
});
