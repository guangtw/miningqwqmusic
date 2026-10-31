
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(n?: number): string {
  if (!n) return '0';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${Math.round(n / 1e4)} 万`;
  return String(n);
}

export function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 长日期：2026 年 10 月 30 日 · 星期五 */
export function longDate(d = new Date()): string {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]}`;
}

/** 侧栏、页脚用的短日期：10.31 · 周六 */
export function shortDate(d = new Date()): string {
  return `${d.getMonth() + 1}.${d.getDate()} · 周${WEEK[d.getDay()]}`;
}

/** 本地日期键：2026-10-31（按天缓存用） */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 唱片的 A/B 面编号：前一半是 A 面，后一半是 B 面 */
export function sideLabel(i: number, total: number): string {
  const half = Math.ceil(total / 2);
  return i < half ? `A${i + 1}` : `B${i - half + 1}`;
}

export const artistNames = (list: { name: string }[]) => list.map((a) => a.name).join(' / ');
