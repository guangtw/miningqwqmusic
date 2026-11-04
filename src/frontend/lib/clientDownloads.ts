import { request } from '../api/http';
import { api } from '../config/site';

// 客户端下载：版本、大小、哈希都以 /api/downloads 为准，前端不写死。
// 下载本身走普通链接（稳定入口 307 到本站固定文件），不拿 fetch 把安装包读进内存。

export interface ClientArtifact {
  variant: string;
  fileName: string;
  /** 字节 */
  size: number;
  sha256: string;
  contentType: string;
  /** 这个版本固定不变的文件地址 */
  url: string;
  downloadUrl: string;
}

export interface ClientPlatform {
  platform: string;
  name: string;
  version: string;
  architecture: string;
  releaseTag: string;
  /** UTC ISO 时间 */
  publishedAt: string;
  /** 稳定入口：永远指向最新版 */
  downloadUrl: string;
  artifacts: ClientArtifact[];
}

export interface ClientDownloads {
  schemaVersion: number;
  platforms: ClientPlatform[];
}

export const fetchClientDownloads = (signal?: AbortSignal) => request<ClientDownloads>(api.paths.clientDownloads, { signal });

/** 84.1 MB / 1.0 MB / 640 KB（按 1024 进位，和 Windows 资源管理器显示的一致） */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  // 1004 KB 这种快满 1 MB 的就直接说 1.0 MB
  if (n < 1000 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / 1024 / 1024;
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 2026.11.01，按访客本地时区 */
export function releaseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 4f17b681…87dbd92b */
export const shortHash = (hash: string) => (hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash);

/** 1.0.10 > 1.0.9；位数不同按 0 补齐 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export interface Visitor {
  /** 这台设备适合的客户端平台；iPhone、Mac 这些没有客户端的是 null */
  platform: 'windows' | 'android' | null;
  /** 苹果设备：给「添加到主屏幕」的说明 */
  apple: boolean;
  /** 正在客户端里打开：Windows 壳是 WebView2（有 chrome.webview），Android 壳在 UA 末尾带版本 */
  inClient: 'windows' | 'android' | null;
  /** Android 客户端自己的版本（UA 里带的）；Windows 壳不报版本 */
  clientVersion?: string;
}

export function detectVisitor(ua = navigator.userAgent, w: { chrome?: { webview?: unknown } } = window as never): Visitor {
  const android = /MiningQwQMusicAndroid\/([\d.]+)/.exec(ua);
  if (android) return { platform: 'android', apple: false, inClient: 'android', clientVersion: android[1] };
  if (w.chrome?.webview) return { platform: 'windows', apple: false, inClient: 'windows' };
  if (/Android/i.test(ua)) return { platform: 'android', apple: false, inClient: null };
  // iPadOS 默认伪装成 Mac，一样归到苹果
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/.test(ua)) return { platform: null, apple: true, inClient: null };
  if (/Windows NT/.test(ua) && !/Windows Phone/.test(ua)) return { platform: 'windows', apple: false, inClient: null };
  return { platform: null, apple: false, inClient: null };
}

/** 客户端不再推广安装客户端；普通 Windows / Android 浏览器仍可看到下载入口。 */
export function isNativeClient(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && detectVisitor().inClient !== null;
}

/** 推荐的那个排第一，其余保持接口给的顺序 */
export function orderFor(platforms: ClientPlatform[], first: string | null): ClientPlatform[] {
  if (!first) return platforms;
  return [...platforms].sort((a, b) => Number(b.platform === first) - Number(a.platform === first));
}
