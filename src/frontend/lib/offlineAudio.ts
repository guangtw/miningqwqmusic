import type { OfflineAudioSource, PlayQualityLevel, Track } from '@/src/types/music';
import { music } from '../api/music';
import { artistNames } from './format';

type OfflineCommand = 'capabilities' | 'list' | 'start' | 'find' | 'remove' | 'set-cache' | 'clear-cache' | 'invalidate';
type OfflineBridge = {
  version: number;
  request(command: OfflineCommand, data?: Record<string, unknown>): Promise<unknown>;
};

export type OfflineEntry = {
  id: string;
  kind: 'download' | 'cache';
  trackId: string;
  name: string;
  artist: string;
  durationMs: number;
  quality: PlayQualityLevel;
  level: PlayQualityLevel;
  mime: string;
  bytes: number;
  writtenBytes: number;
  status: 'queued' | 'transferring' | 'ready' | 'failed';
  error?: string;
  createdAt: number;
  lastUsedAt: number;
};

export type OfflineCapabilities = { version: 1; cacheEnabled: boolean; maxCacheBytes: number };
export type OfflineLibrary = OfflineCapabilities & { entries: OfflineEntry[] };
export type OfflinePlayback = OfflineEntry & { url: string };

function bridge() {
  return typeof window === 'undefined' ? undefined : (window as Window & { MiningOffline?: OfflineBridge }).MiningOffline;
}

export function hasOfflineAudio() { return bridge()?.version === 1; }

async function request<T>(command: OfflineCommand, data?: Record<string, unknown>): Promise<T> {
  const native = bridge();
  if (native?.version !== 1) throw new Error('unsupported_client');
  return await native.request(command, data) as T;
}

export const offlineCapabilities = () => request<OfflineCapabilities>('capabilities');
export const listOfflineAudio = () => request<OfflineLibrary>('list');
export const configureAudioCache = (enabled: boolean, maxBytes: number) =>
  request<OfflineCapabilities>('set-cache', { enabled, maxBytes });
export const clearAudioCache = () => request<void>('clear-cache');
export const removeOfflineAudio = (id: string) => request<void>('remove', { id });
export const invalidateTrackCache = (trackId: string) => request<void>('invalidate', { trackId });

export async function findOfflineAudio(trackId: string, quality: PlayQualityLevel, opts: {
  md5?: string; anyQuality?: boolean; id?: string;
} = {}): Promise<OfflinePlayback | undefined> {
  if (!hasOfflineAudio()) return;
  const row = await request<Partial<OfflinePlayback>>('find', { ...opts, trackId, quality });
  return row.status === 'ready' && row.url ? row as OfflinePlayback : undefined;
}

function start(track: Track, quality: PlayQualityLevel, source: OfflineAudioSource, kind: OfflineEntry['kind'], unmeteredOnly: boolean) {
  return request<OfflineEntry>('start', {
    kind, quality, source, unmeteredOnly,
    track: { id: track.id, name: track.name, artist: artistNames(track.artists) },
  });
}

export async function enqueueOfflineDownload(track: Track, quality: PlayQualityLevel, unmeteredOnly = true) {
  if (!hasOfflineAudio()) throw new Error('unsupported_client');
  const { offline } = await music.downloadUrl(track.id, quality, 'android');
  if (!offline) throw new Error('unsupported_source');
  return start(track, quality, offline, 'download', unmeteredOnly);
}

export function cachePlayedAudio(track: Track, quality: PlayQualityLevel, source: OfflineAudioSource) {
  return start(track, quality, source, 'cache', true);
}

export function offlineEntryTrack(entry: OfflineEntry): Track {
  return {
    id: entry.trackId, name: entry.name, durationMs: entry.durationMs,
    artists: entry.artist ? [{ id: '', name: entry.artist }] : [],
  };
}

export function offlineAudioError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'unsupported_client': return '当前客户端不支持离线音频。';
    case 'unsupported_source': return '这首歌没有可保存的完整音源。';
    case 'space_low': return '手机空间不足。';
    case 'queue_full': return '下载队列已满，稍后再试。';
    case 'integrity_failed': return '歌曲文件校验失败，请重新下载。';
    case 'transfer_failed':
    case 'interrupted': return '下载中断，请重新下载。';
    case 'file_missing': return '本地文件已不存在。';
    case 'storage_unavailable': return '暂时无法写入本地存储。';
    case 'timeout': return '本地音频服务暂未响应。';
    default: return code;
  }
}
