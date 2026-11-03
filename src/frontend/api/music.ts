import { api, covers } from '../config/site';
import { toplistCover } from '../lib/covers';
import { authed } from '../lib/account';
import { path, request } from './http';
import type {
  AlbumDetail,
  ArtistDetail,
  ArtistSearchItem,
  DiscoverData,
  DownloadSource,
  PagedResult,
  Playlist,
  PlayQualityLevel,
  PlaySource,
  PlaylistResolveResult,
  SceneData,
  SearchAssist,
  SongInsight,
  ToplistItem,
  Track,
  TrackLyric,
  TrackQualityAvailability,
} from './types';

const p = api.paths;

// ---- 榜单封面替换 ----
// 官方榜单本质上也是歌单，从搜索或直接链接进入时也要认得出来，
// 所以第一次需要时拉一次榜单列表记下 id。

let toplistIndex: Promise<Map<string, string>> | null = null;

function knownToplists(): Promise<Map<string, string>> {
  toplistIndex ??= request<ToplistItem[]>(p.toplists)
    .then((list) => new Map(list.map((t) => [t.id, t.name])))
    .catch(() => {
      toplistIndex = null;
      return new Map<string, string>();
    });
  return toplistIndex;
}

const cover = (id: string, name: string) => toplistCover(id, name).url;

async function withToplistCover<T extends { id: string; name: string; coverUrl?: string }>(item: T): Promise<T> {
  if (!covers.replaceToplist) return item;
  const name = (await knownToplists()).get(item.id);
  return name ? { ...item, coverUrl: cover(item.id, name) } : item;
}

export const music = {
  async discoverHome() {
    const d = await request<DiscoverData>(p.discoverHome);
    if (!covers.replaceToplist) return d;
    return {
      ...d,
      blocks: d.blocks.map((b) => ({
        ...b,
        items: b.items.map((it) =>
          it.type === 'toplist' && it.targetId ? { ...it, coverUrl: cover(it.targetId, it.title) } : it,
        ),
      })),
    };
  },
  searchAssist: (q = '', signal?: AbortSignal) => request<SearchAssist>(p.searchAssist, { query: { q }, signal }),

  // BFF 的分页从 1 开始
  searchTracks: (q: string, page = 1, signal?: AbortSignal) =>
    request<PagedResult<Track>>(p.searchTracks, { query: { q, page, pageSize: api.pageSize }, signal }),
  searchArtists: (q: string, page = 1, pageSize: number = api.pageSize, signal?: AbortSignal) =>
    request<PagedResult<ArtistSearchItem>>(p.searchArtists, { query: { q, page, pageSize }, signal }),
  async searchPlaylists(q: string, page = 1, pageSize: number = api.pageSize, signal?: AbortSignal) {
    const r = await request<PagedResult<Playlist>>(p.searchPlaylists, { query: { q, page, pageSize }, signal });
    signal?.throwIfAborted();
    return { ...r, items: await Promise.all(r.items.map(withToplistCover)) };
  },

  track: (id: string) => request<Track>(path(p.track, { id })),
  playUrl: (id: string, level: PlayQualityLevel, token?: string | null, signal?: AbortSignal) =>
    authed<PlaySource>(path(p.playUrl, { id }), { query: { level }, token, signal }),
  lyric: (id: string, signal?: AbortSignal) => request<TrackLyric>(path(p.lyric, { id }), { signal }),
  qualityOptions: (id: string, token?: string | null) =>
    authed<TrackQualityAvailability>(path(p.qualityOptions, { id }), { token }),
  insight: (id: string, signal?: AbortSignal) => request<SongInsight>(path(p.insight, { id }), { signal }),
  downloadUrl: (id: string, level: PlayQualityLevel) => request<DownloadSource>(path(p.downloadUrl, { id }), { query: { level } }),
  sati: (tag?: string) => request<SceneData>(p.sceneSati, { query: { tag } }),
  sport: (bpm: number) => request<SceneData>(p.sceneSport, { query: { bpm } }),

  async playlist(id: string) {
    return withToplistCover(await request<Playlist>(path(p.playlist, { id })));
  },
  resolvePlaylist: (input: string) => request<PlaylistResolveResult>(p.playlistResolve, { query: { input } }),
  async toplists() {
    const list = await request<ToplistItem[]>(p.toplists);
    toplistIndex = Promise.resolve(new Map(list.map((t) => [t.id, t.name])));
    if (!covers.replaceToplist) return list;
    return list.map((t) => ({ ...t, coverUrl: cover(t.id, t.name) }));
  },
  async toplist(id: string) {
    const pl = await request<Playlist>(path(p.toplist, { id }));
    return covers.replaceToplist ? { ...pl, coverUrl: cover(id, pl.name) } : pl;
  },
  album: (id: string) => request<AlbumDetail>(path(p.album, { id })),
  artist: (id: string, signal?: AbortSignal) => request<ArtistDetail>(path(p.artist, { id }), { signal }),
};
