import type { Track } from '@/src/types/music';
import type { DirectMessageContent, SharedAlbum, SharedPlaylist } from '@/src/types/social';
import { uiStore } from '../player/ui';
import { authStore, libraryStore } from './account';
import { sendCard, type SendBody } from './messages';
import { playlistCover, settlePlaylist } from './playlists';
import { toast } from './toast';

/*
 * 把歌曲、专辑、歌单分享进私信。
 * 卡片上的名字、封面只是展示用的快照：按后端的 DTO 一项项挑出来，不把上游对象整个塞进去，
 * 不合规的字段（空名字、奇怪的 id、data: 封面）丢掉而不是让整条消息被拒。
 */

export type ShareTarget =
  | { kind: 'track'; track: Track }
  | { kind: 'album'; album: SharedAlbum }
  | { kind: 'playlist'; playlist: SharedPlaylist }
  /** 自己的自建歌单：服务端读云端那份存快照 */
  | { kind: 'mine'; id: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const cut = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n);

function cover(url?: string) {
  if (!url) return undefined;
  try {
    const u = new URL(url.replace(/^http:\/\//, 'https://'));
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && url.length <= 2048 ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const artists = (list: { id: string; name: string }[]) =>
  list
    .map((a) => ({ id: ID.test(a.id) ? a.id : '0', name: cut(a.name, 200) }))
    .filter((a) => a.name)
    .slice(0, 20);

export function sharedTrack(t: Track): Track {
  const album = t.album && ID.test(t.album.id) && cut(t.album.name, 200) ? { id: t.album.id, name: cut(t.album.name, 200) } : undefined;
  const c = cover(t.coverUrl ?? t.album?.coverUrl);
  return {
    id: t.id,
    name: cut(t.name, 200) || '未知歌曲',
    artists: artists(t.artists),
    ...(album ? { album } : {}),
    durationMs: Math.min(86_400_000, Math.max(0, Math.round(t.durationMs || 0))),
    ...(c ? { coverUrl: c } : {}),
  };
}

export function sharedAlbum(a: { id: string; name: string; coverUrl?: string; artists: { id: string; name: string }[]; trackCount?: number }): SharedAlbum {
  const c = cover(a.coverUrl);
  return {
    id: a.id,
    name: cut(a.name, 200) || '未知专辑',
    artists: artists(a.artists),
    ...(c ? { coverUrl: c } : {}),
    ...(a.trackCount != null ? { trackCount: a.trackCount } : {}),
  };
}

export function sharedPlaylist(p: { id: string; name: string; coverUrl?: string; description?: string; trackCount?: number }): SharedPlaylist {
  const c = cover(p.coverUrl);
  const desc = cut(p.description, 1000);
  return {
    id: p.id,
    name: cut(p.name, 200) || '未命名歌单',
    ...(c ? { coverUrl: c } : {}),
    ...(desc ? { description: desc } : {}),
    ...(p.trackCount != null ? { trackCount: p.trackCount } : {}),
  };
}

/** 网易云的 id 都是数字串；本地生成的、带奇怪字符的分享不了 */
export const shareable = (t: ShareTarget) =>
  t.kind === 'mine' ? !!libraryStore.get().importedPlaylists[t.id] : ID.test(t.kind === 'track' ? t.track.id : t.kind === 'album' ? t.album.id : t.playlist.id);

/** 卡片送达前先画出来的样子（也是分享框里的预览） */
export function previewOf(t: ShareTarget, caption?: string): DirectMessageContent | null {
  const extra = caption?.trim() ? { caption: caption.trim() } : {};
  if (t.kind === 'track') return { version: 1, kind: 'track', ...extra, track: sharedTrack(t.track) };
  if (t.kind === 'album') return { version: 1, kind: 'album', ...extra, album: t.album };
  if (t.kind === 'playlist') return { version: 1, kind: 'playlist', ...extra, source: 'netease', playlist: t.playlist, hasSnapshot: false };
  const pl = libraryStore.get().importedPlaylists[t.id];
  if (!pl) return null;
  return {
    version: 1,
    kind: 'playlist',
    ...extra,
    source: 'echo_snapshot',
    playlist: sharedPlaylist({ ...pl, coverUrl: playlistCover(pl), trackCount: pl.tracks.length }),
    hasSnapshot: true,
  };
}

/** 发给某个人。返回和文字消息一样：sent / failed（气泡留在聊天里可以重发）/ limit */
export function shareTo(peer: string, t: ShareTarget, caption: string) {
  const text = caption.trim().slice(0, 2000) || undefined;
  const preview = previewOf(t, text);
  if (!preview) return Promise.resolve('failed' as const);
  const body: SendBody =
    t.kind === 'track'
      ? { kind: 'track', text, resource: preview.kind === 'track' ? preview.track : sharedTrack(t.track) }
      : t.kind === 'album'
        ? { kind: 'album', text, resource: t.album }
        : t.kind === 'playlist'
          ? { kind: 'playlist', text, resource: t.playlist }
          : { kind: 'playlist', text, playlistId: t.id };
  return sendCard(peer, body, preview, t.kind === 'mine' ? () => settlePlaylist(t.id) : undefined);
}

/** 各处「分享给好友」按钮：没登录先去登录 */
export function openShare(t: ShareTarget) {
  if (authStore.get().status !== 'authenticated') {
    toast('登录后就能分享给好友。');
    return uiStore.set({ login: true, menu: null });
  }
  if (!shareable(t)) return toast('这个分享不了。');
  uiStore.set({ share: t, menu: null });
}
