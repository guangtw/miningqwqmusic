import { useEffect, useState } from 'react';
import { isIPhone } from './device';

/**
 * 唱机背后那层虚化封面（.np-art），预先在一张小画布上糊好（#22）。
 *
 * 原来是一张比面板大一圈（inset: -12%）的封面直接挂 `filter: blur(72px) saturate(1.6)`，面板收着时 display:none。
 * 一打开唱机，GPU 得当场把一整屏放大的图糊一遍；切页 / 开合唱机的视图过渡里面板是「活」的快照，淡入的 1.2 秒里每帧都要重做，
 * 手机上点唱片那一下的顿挫有一部分就在这里（iPhone 上早就因此整个关掉了）。
 *
 * 现在换歌时就按同样的几何算好：画布 = 那个放大一圈的盒子按 1/12 缩小，封面按 cover 铺满，
 * 用同样的 blur（按比例缩成 6px）+ saturate 糊好；画布外是透明的，和 CSS 滤镜一样，四边会淡出。
 * 显示时直接拉伸这张小图，不再挂滤镜。模糊半径有 6 个采样点宽，拉伸后看不出插值的痕迹。
 */

const SCALE = 1 / 12;
const BLUR = 72;
const cache = new Map<string, Promise<string | null>>();
const ready = new Map<string, string | null>();

function keyOf(url: string) {
  return `${url}|${Math.round(innerWidth)}x${Math.round(innerHeight)}`;
}

function bake(url: string, key: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        // .np-art 的盒子：面板（= 视口）四边各放大 12%
        const w = Math.max(8, Math.round(innerWidth * 1.24 * SCALE));
        const h = Math.max(8, Math.round(innerHeight * 1.24 * SCALE));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx || !('filter' in ctx)) return resolve(null);
        ctx.filter = `blur(${BLUR * SCALE}px) saturate(1.6)`;
        // background-size: cover; background-position: center
        const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * k;
        const dh = img.naturalHeight * k;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        // 图床不让跨域读像素：退回 CSS 滤镜
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((out) => {
    ready.set(key, out);
    return out;
  });
}

/** 糊好的封面（data URL）；还没算好、或者算不了时返回 null，调用方退回 CSS 滤镜 */
export function useBakedArt(url: string | undefined): string | null {
  const key = url ? keyOf(url) : '';
  const [out, setOut] = useState(() => (key ? (ready.get(key) ?? null) : null));
  useEffect(() => {
    if (!url || isIPhone()) {
      setOut(null);
      return;
    }
    if (ready.has(key)) {
      setOut(ready.get(key) ?? null);
      return;
    }
    let alive = true;
    let p = cache.get(key);
    if (!p) cache.set(key, (p = bake(url, key)));
    void p.then((v) => alive && setOut(v));
    return () => {
      alive = false;
    };
  }, [url, key]);
  return out;
}
