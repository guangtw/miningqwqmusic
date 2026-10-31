import { covers as coverConfig } from '../config/site';
import type { Tint } from './palette';

// 榜单封面生成器：用唱片行的版式重新画榜单封面，替换上游那套统一模板图。
// 输出 SVG data URL，<img>、唱片标签、封面飞行过渡都能直接用。

type Motif = 'bars' | 'sun' | 'wave' | 'rings' | 'grooves';

/** 名字里出现这些词就用对应图案；都不匹配时按 id 轮换 */
const MOTIF_RULES: [RegExp, Motif][] = [
  [/飙升|潜力|实时|爆款|风向/, 'bars'],
  [/热|爱听|爱搜|分享/, 'sun'],
  [/说唱|电音|DJ|BEAT|舞曲|摇滚|慢摇|派对/i, 'wave'],
  [/新|原创|AI/i, 'rings'],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hexToHsl(hex: string): Tint & { l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l };
}

/** 标题：去掉平台前缀；太长的只取到第一个「榜」 */
export function shortTitle(name: string): string {
  let t = name.replace(/^(网易云音乐|网易云|云音乐)\s*/, '').trim();
  const cut = t.indexOf('榜');
  if (t.length > 9 && cut > 0) t = t.slice(0, cut + 1);
  return t || name;
}

/** 按视觉宽度断行：中文算 1，拉丁字母和数字算 0.58 */
function wrap(text: string, maxWidth: number): string[] {
  const width = (c: string) => (/[\u0000-ÿ]/.test(c) ? 0.58 : 1);
  // 拉丁单词不拆开
  const tokens = text.match(/[A-Za-z0-9®.&'’-]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let line = '';
  let w = 0;
  for (const tok of tokens) {
    const tw = [...tok].reduce((s, c) => s + width(c), 0);
    if (w + tw > maxWidth && line.trim()) {
      lines.push(line.trim());
      line = '';
      w = 0;
      if (!tok.trim()) continue;
    }
    line += tok;
    w += tw;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** 先算要几行，再按平均宽度断行，避免最后一行只剩一个字 */
function balancedWrap(text: string, maxWidth: number): string[] {
  const n = wrap(text, maxWidth).length;
  if (n <= 1) return [text];
  const total = lineWidth(text);
  const target = Math.min(maxWidth, total / n + 0.6);
  const lines = wrap(text, target);
  return lines.length > n ? wrap(text, maxWidth) : lines;
}

const lineWidth = (s: string) => [...s].reduce((n, c) => n + (/[\u0000-ÿ]/.test(c) ? 0.58 : 1), 0);

function motifSvg(m: Motif, fg: string, accent: string, seed: number): string {
  switch (m) {
    case 'bars': {
      // 一组逐渐升高的柱子，最后一根用强调色
      const n = 6;
      return Array.from({ length: n }, (_, i) => {
        const h = 40 + i * 22 + ((seed >> i) & 7) * 3;
        const x = 150 + i * 23;
        return `<rect x="${x}" y="${190 - h}" width="15" height="${h}" rx="2" fill="${i === n - 1 ? accent : fg}" opacity="${i === n - 1 ? 1 : 0.18 + i * 0.1}"/>`;
      }).join('');
    }
    case 'sun':
      return `<circle cx="214" cy="92" r="70" fill="${accent}"/>` +
        Array.from({ length: 5 }, (_, i) => `<circle cx="214" cy="92" r="${84 + i * 14}" fill="none" stroke="${fg}" stroke-opacity="${0.22 - i * 0.04}" stroke-width="1.5"/>`).join('');
    case 'wave': {
      // 声波：一排高低起伏的竖线
      const bars = Array.from({ length: 22 }, (_, i) => {
        const amp = 10 + Math.abs(Math.sin(i * 0.7 + (seed % 7))) * 58;
        return `<rect x="${118 + i * 8}" y="${96 - amp / 2}" width="4" height="${amp}" rx="2" fill="${i % 5 === 2 ? accent : fg}" opacity="${i % 5 === 2 ? 1 : 0.55}"/>`;
      }).join('');
      return bars;
    }
    case 'rings':
      return Array.from({ length: 7 }, (_, i) => `<circle cx="226" cy="74" r="${12 + i * 16}" fill="none" stroke="${i === 2 ? accent : fg}" stroke-width="${i === 2 ? 6 : 2}" opacity="${i === 2 ? 1 : 0.32}"/>`).join('');
    default:
      // 唱片一角：密纹 + 标签
      return Array.from({ length: 16 }, (_, i) => `<circle cx="300" cy="0" r="${70 + i * 9}" fill="none" stroke="${fg}" stroke-opacity="0.13" stroke-width="1"/>`).join('') +
        `<circle cx="300" cy="0" r="58" fill="${accent}"/>`;
  }
}

function pickMotif(name: string, seed: number): Motif {
  for (const [re, m] of MOTIF_RULES) if (re.test(name)) return m;
  return (['grooves', 'rings', 'bars', 'wave'] as Motif[])[seed % 4];
}

export interface GeneratedCover {
  url: string;
  tint: Tint;
}

const cache = new Map<string, GeneratedCover>();

/** 生成一张榜单封面 */
export function toplistCover(id: string, name: string, kicker?: string): GeneratedCover {
  const key = `${id}|${name}|${kicker ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const seed = hash(id || name);
  const [bg, accent] = coverConfig.palette[seed % coverConfig.palette.length];
  const hsl = hexToHsl(bg);
  const fg = hsl.l > 0.62 ? '#141414' : '#ffffff';
  const title = shortTitle(name);

  // 字号随标题长度变化：能一行放下（且字不太小）就一行，否则均分成两行，最多三行
  const options = ([[64, 4], [52, 5], [44, 6], [38, 7], [32, 8]] as const).map(([s, w]) => ({ size: s, lines: balancedWrap(title, w) }));
  const pick =
    options.find((o) => o.lines.length === 1 && o.size >= 44) ??
    options.find((o) => o.lines.length === 2) ??
    options[options.length - 1];
  let size: number = pick.size;
  const lines = pick.lines.slice(0, 3);
  const widest = Math.max(...lines.map(lineWidth));
  if (widest * size > 260) size = Math.floor(260 / widest);
  const lh = size * 1.08;
  const baseY = 272 - (lines.length - 1) * lh;

  const text = lines
    .map((l, i) => `<text x="22" y="${(baseY + i * lh).toFixed(1)}" font-size="${size}" font-weight="800" letter-spacing="${-size * 0.04}" fill="${fg}">${esc(l)}</text>`)
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="300" height="300" fill="${bg}"/>` +
    motifSvg(pickMotif(name, seed), fg, accent, seed) +
    `<rect width="300" height="300" fill="url(#g)"/>` +
    `<g font-family="'PingFang SC','HarmonyOS Sans SC','MiSans','Microsoft YaHei','Noto Sans CJK SC','Noto Sans SC',sans-serif">` +
    `<text x="22" y="34" font-size="11" font-family="ui-monospace,Menlo,monospace" letter-spacing="1.5" fill="${fg}" opacity="0.75">${esc((kicker || 'CHART').toUpperCase())}</text>` +
    text +
    `</g></svg>`;

  const out = { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), tint: { h: hsl.h, s: Math.max(40, hsl.s) } };
  cache.set(key, out);
  return out;
}

/** 生成封面的主色直接已知，取色时不用再读像素 */
export function knownTint(url: string): Tint | undefined {
  for (const c of cache.values()) if (c.url === url) return c.tint;
  return undefined;
}
