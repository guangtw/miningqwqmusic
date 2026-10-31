import { useEffect, useState } from 'react';
import { imageKey, sized } from '../components/Cover';
import { knownTint } from './covers';

/** 封面主色，用色相 + 饱和度表示；明度交给 CSS 按主题决定，保证文字对比度 */
export interface Tint {
  h: number;
  s: number;
}

export const DEFAULT_TINT: Tint = { h: 16, s: 88 };

const cache = new Map<string, Promise<Tint>>();
/** 已经算出来的颜色，组件挂载时能同步拿到，免得先闪默认色再过渡 */
const resolved = new Map<string, Tint>();

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

/**
 * 在 24×24 缩略图上找「最有颜色」的像素群：按色相分桶，
 * 权重 = 饱和度 × 中间明度，取权重最大的桶的平均色相。
 * 图床不允许跨域读取像素时回退到默认色。
 */
function extract(url: string): Promise<Tint> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const n = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, n, n);
        const data = ctx.getImageData(0, 0, n, n).data;
        const buckets = Array.from({ length: 24 }, () => ({ w: 0, hx: 0, hy: 0, s: 0 }));
        for (let i = 0; i < data.length; i += 4) {
          const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          const w = s * (1 - Math.abs(l - 0.5) * 2) ** 0.7;
          if (w < 0.05) continue;
          const b = buckets[Math.floor(h / 15) % 24];
          b.w += w;
          b.hx += Math.cos((h * Math.PI) / 180) * w;
          b.hy += Math.sin((h * Math.PI) / 180) * w;
          b.s += s * w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        if (best.w < 1.5) return resolve({ h: DEFAULT_TINT.h, s: 12 });
        const h = ((Math.atan2(best.hy, best.hx) * 180) / Math.PI + 360) % 360;
        resolve({ h: Math.round(h), s: Math.round(Math.min(92, Math.max(38, (best.s / best.w) * 100))) });
      } catch {
        resolve(DEFAULT_TINT);
      }
    };
    img.onerror = () => resolve(DEFAULT_TINT);
    img.src = url;
  });
}

export function tintOf(url?: string): Promise<Tint> {
  if (!url) return Promise.resolve(DEFAULT_TINT);
  // 生成的榜单封面主色已知，不用读像素
  const known = knownTint(url);
  if (known) return Promise.resolve(known);
  const key = sized(url, 64)!;
  let p = cache.get(key);
  if (!p) {
    p = extract(key).then((t) => {
      resolved.set(imageKey(url), t);
      return t;
    });
    cache.set(key, p);
  }
  return p;
}

/** 同步查颜色：算过的直接给，没算过的返回 null */
export function peekTint(url?: string): Tint | null {
  if (!url) return null;
  return knownTint(url) ?? resolved.get(imageKey(url)) ?? null;
}

export function useTint(url?: string): Tint | null {
  const [tint, setTint] = useState<Tint | null>(() => peekTint(url));
  useEffect(() => {
    let alive = true;
    const known = peekTint(url);
    if (known) {
      setTint(known);
      return;
    }
    tintOf(url).then((t) => alive && setTint(t));
    return () => {
      alive = false;
    };
  }, [url]);
  return tint;
}

/** 生成可直接放进 style 的 CSS 变量 */
export const tintVars = (t: Tint | null): React.CSSProperties =>
  t ? ({ '--tint-h': t.h, '--tint-s': `${t.s}%` } as React.CSSProperties) : {};

/** 全站强调色跟随正在播放的歌 */
export function applyGlobalTint(t: Tint) {
  const root = document.documentElement.style;
  root.setProperty('--accent-h', String(t.h));
  root.setProperty('--accent-s', `${t.s}%`);
}
