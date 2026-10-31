import { music, type Track } from '../api';
import { getSettings } from './settings';
import { toast } from './toast';

// 下载：按设置里的音质要一个下载地址，拉成文件存下来。
// 音源站不允许跨域读取时，退回到新标签页直接打开地址（浏览器会自己下载或播放）。

const unsafe = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** 「艺人 - 歌名.mp3」，去掉文件名里不能用的字符 */
export function fileName(t: Track, format?: string) {
  const by = t.artists.map((a) => a.name).filter(Boolean).join('、');
  const base = `${by ? `${by} - ` : ''}${t.name}`.replace(unsafe, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base || t.id}.${(format || 'mp3').toLowerCase()}`;
}

const mb = (n?: number) => (n ? ` · ${(n / 1024 / 1024).toFixed(1)} MB` : '');

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const busy = new Set<string>();

export async function downloadTrack(t: Track) {
  if (busy.has(t.id)) return toast(`《${t.name}》正在准备，稍等。`);
  busy.add(t.id);
  try {
    const src = await music.downloadUrl(t.id, getSettings().quality);
    const name = fileName(t, src.format);
    // https 页面里取 http 地址会被拦，网易云的音源站两种都支持
    const url = location.protocol === 'https:' ? src.url.replace(/^http:/, 'https:') : src.url;
    toast(`正在下载《${t.name}》${mb(src.size)}`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      save(await res.blob(), name);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  } catch (e) {
    toast((e as Error).message);
  } finally {
    busy.delete(t.id);
  }
}
