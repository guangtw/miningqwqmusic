import { coverOf, music, type ImportedPlaylist, type LibraryRevisionResult, type Playlist, type Track } from '../api';
import { path } from '../api/http';
import { api } from '../config/site';
import { toplistCover } from './covers';
import { authed, authStore, libraryStore } from './account';
import { toast } from './toast';

// 歌单都存在账户服务的 importedPlaylists 里，分两种：
// - 自建（mine）：id 以 mine- 开头，sourceUrl 是 local://playlist/<id>，曲目存在云端；
// - 链接（linked）：网易云歌单，只存一张「索引卡」（名字、封面、来源），打开时实时拉曲目，
//   这样原歌单更新了这里也跟着变，也不会撞上账户服务的字段上限。
//
// 账户服务每个请求最多 api.cloudFieldLimit 个 JSON 字段（默认 400），一首歌大约 10 个，
// 所以自建歌单在云端按「分卷」存：第 1 卷用歌单 id，第 k 卷用 <id>~k，拉下来时再拼回去。

export type PlaylistKind = 'mine' | 'linked';

const LOCAL = 'local://playlist/';
const PART_SEP = '~';

export const kindOf = (pl: ImportedPlaylist): PlaylistKind => (pl.sourceUrl.startsWith(LOCAL) ? 'mine' : 'linked');
export const isMine = (pl: ImportedPlaylist | undefined): pl is ImportedPlaylist => !!pl && kindOf(pl) === 'mine';
export const neteaseUrl = (id: string) => `https://music.163.com/playlist?id=${encodeURIComponent(id)}`;

const signedIn = () => authStore.get().status === 'authenticated';
const userId = () => authStore.get().user?.id;

/** 歌单封面：自己设的 > 第一首歌的封面；没封面的链接歌单是官方榜单，用生成的榜单封面 */
export const playlistCover = (pl: ImportedPlaylist) =>
  pl.coverUrl ?? (pl.tracks[0] ? coverOf(pl.tracks[0]) : kindOf(pl) === 'linked' ? toplistCover(pl.id, pl.name).url : undefined);

/** 存进歌单的曲目：只留展示需要的字段 */
const cloudTrack = (t: Track): Track => {
  const cover = coverOf(t);
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
    ...(t.album?.id && t.album.name ? { album: { id: t.album.id, name: t.album.name } } : {}),
    durationMs: Math.max(0, Math.round(t.durationMs || 0)),
    ...(cover ? { coverUrl: cover } : {}),
  };
};

// ---------------- 分卷 ----------------

/** 和账户服务一样数字段：对象的每个键算一个，数组本身不算 */
function countFields(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce<number>((n, x) => n + countFields(x), 0);
  const entries = Object.values(node as Record<string, unknown>);
  return entries.length + entries.reduce<number>((n, x) => n + countFields(x), 0);
}

const partId = (id: string, k: number) => (k === 1 ? id : `${id}${PART_SEP}${k}`);

/** 一张歌单 → 云端记录。链接歌单不带曲目；自建歌单按字段上限切成几卷 */
export function toRecords(pl: ImportedPlaylist): ImportedPlaylist[] {
  if (kindOf(pl) === 'linked') return [{ ...pl, tracks: [] }];
  const budget = api.cloudFieldLimit - 12;
  const head = (k: number): ImportedPlaylist => ({
    id: partId(pl.id, k),
    name: pl.name,
    ...(k === 1 && pl.description ? { description: pl.description } : {}),
    ...(k === 1 && pl.coverUrl ? { coverUrl: pl.coverUrl } : {}),
    tracks: [],
    sourceUrl: k === 1 ? `${LOCAL}${pl.id}` : `${LOCAL}${pl.id}?part=${k}`,
    importedAt: pl.importedAt,
    // 只有第 1 卷带修改时间，后面几卷内容没变时请求体也不变，可以跳过
    updatedAt: k === 1 ? pl.updatedAt : pl.importedAt,
  });
  const parts = [head(1)];
  let used = countFields({ playlist: parts[0] });
  for (const t of pl.tracks.map(cloudTrack)) {
    const cost = countFields(t);
    if (used + cost > budget && parts[parts.length - 1].tracks.length) {
      parts.push(head(parts.length + 1));
      used = countFields({ playlist: parts[parts.length - 1] });
    }
    parts[parts.length - 1].tracks.push(t);
    used += cost;
  }
  return parts;
}

/** 云端记录 → 歌单（把分卷拼回去）。同时返回每张歌单在云端有哪些记录 */
export function fromRecords(records: Record<string, ImportedPlaylist>) {
  const playlists: Record<string, ImportedPlaylist> = {};
  const parts: Record<string, string[]> = {};
  const extra: { base: string; k: number; rec: ImportedPlaylist }[] = [];
  for (const [rid, rec] of Object.entries(records)) {
    const m = /\?part=(\d+)$/.exec(rec.sourceUrl);
    if (m && rec.sourceUrl.startsWith(LOCAL)) {
      extra.push({ base: rec.sourceUrl.slice(LOCAL.length, -m[0].length), k: Number(m[1]), rec: { ...rec, id: rid } });
    } else {
      playlists[rid] = { ...rec, id: rid, tracks: [...rec.tracks] };
      parts[rid] = [rid];
    }
  }
  extra.sort((a, b) => a.k - b.k);
  for (const { base, rec } of extra) {
    // 第 1 卷丢了的残卷没法还原名字以外的信息，干脆不显示，下次保存时会被清掉
    if (!playlists[base]) continue;
    playlists[base].tracks.push(...rec.tracks);
    parts[base].push(rec.id);
  }
  return { playlists, parts };
}

// ---------------- 写云端 ----------------

/** 同一张歌单的写入排队执行，避免两次保存交错 */
const chains = new Map<string, Promise<unknown>>();
function serial<T>(id: string, run: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
  chains.set(id, next);
  void next.finally(() => chains.get(id) === next && chains.delete(id));
  return next;
}

const sigOf = (rec: ImportedPlaylist) => JSON.stringify(rec);

function setPending(id: string, op: 'upsert' | 'delete' | null) {
  const pendingPlaylists = { ...libraryStore.get().pendingPlaylists };
  if (op) pendingPlaylists[id] = op;
  else delete pendingPlaylists[id];
  libraryStore.set({ pendingPlaylists });
}

async function pushUpsert(id: string) {
  const owner = userId();
  const pl = libraryStore.get().importedPlaylists[id];
  if (!pl) return;
  const records = toRecords(pl);
  const keep = new Set(records.map((r) => r.id));
  const { cloudParts, cloudSigs } = libraryStore.get();
  const sigs = { ...cloudSigs };
  let revision: number | undefined;
  for (const rec of records) {
    const sig = sigOf(rec);
    if (sigs[rec.id] === sig) continue;
    const r = await authed<LibraryRevisionResult>(path(api.paths.libraryPlaylist, { id: rec.id }), { method: 'PUT', body: { playlist: rec } });
    if (userId() !== owner) return;
    sigs[rec.id] = sig;
    revision = r.revision;
  }
  // 歌单变短了：多出来的旧分卷删掉
  for (const rid of cloudParts[id] ?? []) {
    if (keep.has(rid)) continue;
    const r = await authed<LibraryRevisionResult>(path(api.paths.libraryPlaylist, { id: rid }), { method: 'DELETE' });
    if (userId() !== owner) return;
    delete sigs[rid];
    revision = r.revision;
  }
  libraryStore.set((s) => ({
    cloudParts: { ...s.cloudParts, [id]: [...keep] },
    cloudSigs: sigs,
    ...(revision ? { revision } : {}),
  }));
}

async function pushDelete(id: string) {
  const owner = userId();
  const { cloudParts, cloudSigs } = libraryStore.get();
  const sigs = { ...cloudSigs };
  let revision: number | undefined;
  for (const rid of cloudParts[id] ?? [id]) {
    const r = await authed<LibraryRevisionResult>(path(api.paths.libraryPlaylist, { id: rid }), { method: 'DELETE' });
    if (userId() !== owner) return;
    delete sigs[rid];
    revision = r.revision;
  }
  libraryStore.set((s) => {
    const next = { ...s.cloudParts };
    delete next[id];
    return { cloudParts: next, cloudSigs: sigs, ...(revision ? { revision } : {}) };
  });
}

/** 把一张歌单的本地状态写到云端；失败了留着「待同步」标记，下次拉取时补 */
function sync(id: string, op: 'upsert' | 'delete', quiet = false) {
  setPending(id, op);
  if (!signedIn()) return Promise.resolve();
  return serial(id, async () => {
    try {
      if (op === 'upsert') await pushUpsert(id);
      else await pushDelete(id);
      if (libraryStore.get().pendingPlaylists[id] === op) setPending(id, null);
    } catch (e) {
      if (!quiet) toast(`歌单没同步上：${(e as Error).message}`);
    }
  });
}

/** pullLibrary 拿到云端快照后调用：合并歌单，并把本机待同步的改动补上去 */
export async function mergeCloudPlaylists(records: Record<string, ImportedPlaylist>, merge: boolean) {
  const { playlists: cloud, parts } = fromRecords(records);
  const local = libraryStore.get();
  const next: Record<string, ImportedPlaylist> = { ...cloud };
  const pending = { ...local.pendingPlaylists };
  for (const [id, op] of Object.entries(local.pendingPlaylists)) {
    if (op === 'delete') delete next[id];
    else if (local.importedPlaylists[id]) next[id] = local.importedPlaylists[id];
  }
  // 刚登录：本机独有的歌单补传上去
  if (merge) {
    for (const [id, pl] of Object.entries(local.importedPlaylists)) {
      if (!(id in cloud) && !pending[id]) {
        next[id] = pl;
        pending[id] = 'upsert';
      }
    }
  }
  const sigs: Record<string, string> = {};
  for (const [rid, rec] of Object.entries(records)) sigs[rid] = sigOf({ ...rec, id: rid });
  libraryStore.set({ importedPlaylists: next, cloudParts: parts, cloudSigs: sigs, pendingPlaylists: pending });
  for (const [id, op] of Object.entries(pending)) await sync(id, op, true);
}

// ---------------- 对外的操作 ----------------

const newId = () => `mine-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function save(pl: ImportedPlaylist) {
  libraryStore.set((s) => ({ importedPlaylists: { ...s.importedPlaylists, [pl.id]: pl } }));
  return sync(pl.id, 'upsert');
}

export function createPlaylist(name: string, description?: string, tracks: Track[] = []): ImportedPlaylist {
  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const pl: ImportedPlaylist = {
    id,
    name: name.trim(),
    ...(description?.trim() ? { description: description.trim() } : {}),
    tracks: tracks.filter((t) => !seen.has(t.id) && !!seen.add(t.id)).map(cloudTrack),
    sourceUrl: `${LOCAL}${id}`,
    importedAt: now,
    updatedAt: now,
  };
  void save(pl);
  return pl;
}

export function updatePlaylistInfo(id: string, info: { name: string; description?: string }) {
  const pl = libraryStore.get().importedPlaylists[id];
  if (!pl) return;
  const { description: _old, ...rest } = pl;
  void save({ ...rest, name: info.name.trim(), ...(info.description?.trim() ? { description: info.description.trim() } : {}), updatedAt: Date.now() });
}

/** 往自建歌单里加歌，已经有的跳过。返回实际加了几首 */
export function addToPlaylist(id: string, tracks: Track[]): number {
  const pl = libraryStore.get().importedPlaylists[id];
  if (!isMine(pl)) return 0;
  const have = new Set(pl.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id) && !!have.add(t.id)).map(cloudTrack);
  if (fresh.length) void save({ ...pl, tracks: [...pl.tracks, ...fresh], updatedAt: Date.now() });
  return fresh.length;
}

export function removeFromPlaylist(id: string, index: number) {
  const pl = libraryStore.get().importedPlaylists[id];
  if (!isMine(pl) || !pl.tracks[index]) return;
  void save({ ...pl, tracks: pl.tracks.filter((_, i) => i !== index), updatedAt: Date.now() });
}

export function movePlaylistTrack(id: string, from: number, to: number) {
  const pl = libraryStore.get().importedPlaylists[id];
  if (!isMine(pl) || from === to || !pl.tracks[from] || to < 0 || to >= pl.tracks.length) return;
  const tracks = [...pl.tracks];
  const [t] = tracks.splice(from, 1);
  tracks.splice(to, 0, t);
  void save({ ...pl, tracks, updatedAt: Date.now() });
}

export function deletePlaylist(id: string) {
  libraryStore.set((s) => {
    const importedPlaylists = { ...s.importedPlaylists };
    delete importedPlaylists[id];
    return { importedPlaylists };
  });
  return sync(id, 'delete');
}

/** 收藏 / 导入一张网易云歌单：只存索引卡 */
export function linkPlaylist(p: Playlist, sourceUrl = neteaseUrl(p.id)) {
  const now = Date.now();
  const existing = libraryStore.get().importedPlaylists[p.id];
  return save({
    id: p.id,
    name: p.name || `歌单 ${p.id}`,
    ...(p.description ? { description: p.description } : {}),
    // 榜单封面是本地生成的 data: 图，不往云端存，显示时再生成
    ...(p.coverUrl && !p.coverUrl.startsWith('data:') ? { coverUrl: p.coverUrl } : {}),
    tracks: [],
    sourceUrl: existing?.sourceUrl && kindOf(existing) === 'linked' ? existing.sourceUrl : sourceUrl,
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
  });
}

/** 粘贴的链接 / 分享文案 / 纯 id → 歌单详情 */
export async function resolvePlaylistInput(input: string): Promise<{ playlist: Playlist; sourceUrl: string }> {
  const text = input.trim();
  const id = /^\d{3,}$/.test(text) ? text : (await music.resolvePlaylist(text)).playlistId;
  const playlist = await music.playlist(id);
  const url = /https?:\/\/\S+/.exec(text)?.[0];
  return { playlist: { ...playlist, id: playlist.id || id }, sourceUrl: url ?? neteaseUrl(id) };
}
