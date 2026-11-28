import { describe, expect, it } from 'vitest';
import { beatIndexAt, detect } from '../../src/frontend/lib/beats';

const RATE = 4000;
const HOP = 40;

/** 合成一段低频底鼓：bpm 拍速，第 4 拍弱一点；可叠白噪声 */
function kicks(seconds: number, bpm: number, noise = 0) {
  const out = new Float32Array(RATE * seconds);
  const beat = 60 / bpm;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const tb = t % beat;
    const strong = Math.floor(t / beat) % 4 === 3 ? 0.5 : 1;
    out[i] = Math.sin(2 * Math.PI * (45 + 70 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9) * 0.8 * strong + rnd() * noise;
  }
  return out;
}

describe('beat detection', () => {
  it('finds every kick of a steady 120 BPM pattern, on time', () => {
    const map = detect(kicks(20, 120), RATE, HOP)!;
    expect(map).not.toBeNull();
    // 20 秒 40 拍，第一拍前面没有参照可能漏掉
    expect(map.times.length).toBeGreaterThanOrEqual(38);
    expect(map.times.length).toBeLessThanOrEqual(41);
    for (const t of map.times) {
      const off = t % 500;
      expect(Math.min(off, 500 - off)).toBeLessThan(30);
    }
  });

  it('gives the weak beat a lower strength than the downbeats', () => {
    const map = detect(kicks(20, 120), RATE, HOP)!;
    const weak: number[] = [];
    const strong: number[] = [];
    map.times.forEach((t, i) => (Math.round(t / 500) % 4 === 3 ? weak : strong).push(map.strength[i]));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(weak)).toBeLessThan(avg(strong) * 0.8);
    expect(Math.max(...map.strength)).toBeLessThanOrEqual(1);
  });

  it('still locks on under background noise', () => {
    const map = detect(kicks(20, 96, 0.08), RATE, HOP)!;
    const beat = 625;
    const near = [...map.times].filter((t) => {
      const off = t % beat;
      return Math.min(off, beat - off) < 35;
    });
    expect(near.length / map.times.length).toBeGreaterThan(0.85);
    expect(near.length).toBeGreaterThanOrEqual(28);
  });

  it('returns null for silence or a clip too short to judge', () => {
    expect(detect(new Float32Array(RATE * 10), RATE, HOP)).toBeNull();
    expect(detect(kicks(1, 120), RATE, HOP)).toBeNull();
  });

  it('beatIndexAt finds the first beat at or after a time', () => {
    const map = { times: new Float32Array([100, 600, 1100]), strength: new Float32Array([1, 1, 1]) };
    expect(beatIndexAt(map, 0)).toBe(0);
    expect(beatIndexAt(map, 600)).toBe(1);
    expect(beatIndexAt(map, 601)).toBe(2);
    expect(beatIndexAt(map, 5000)).toBe(3);
  });
});
