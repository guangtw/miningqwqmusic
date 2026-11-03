import type { LibrarySnapshot } from '@/src/types/account';
import type { PlaylistRecordsResult } from '@/src/types/social';
import { coverOf, music, type ImportedPlaylist, type LibraryRevisionResult, type Playlist, type Track } from '../api';
import { ApiError, path } from '../api/http';
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
//
// 排序走账户服务的原子接口（一次提交整张歌单的曲目顺序，服务端在一个事务里重新分卷、只推进一次版本）；
// 加歌、删歌、改名还是按卷写。两种写法不同时进行：本机还有没传上去的曲目改动时，排序跟着那次整张上传一起走。

export type PlaylistKind = 'mine' | 'linked';

const LOCAL = 'local://playlist/';
const PART_SEP = '~';

export const kindOf = (pl: ImportedPlaylist): PlaylistKind => (pl.sourceUrl.startsWith(LOCAL) ? 'mine' : 'linked');
export const isMine = (pl: ImportedPlaylist | undefined): pl is ImportedPlaylist => !!pl && kindOf(pl) === 'mine';
export const neteaseUrl = (id: string) => `https://music.163.com/playlist?id=${encodeURIComponent(id)}`;

const signedIn = () => authStore.get().status === 'authenticated';
const userId = () => authStore.get().user?.id;

/** 自建歌单的封面永远是当前第一首的封面（和账户服务的规则一致）：没有就空着，不往后找 */
const autoCover = (pl: ImportedPlaylist) => (pl.tracks[0] ? coverOf(pl.tracks[0]) : undefined);

/**
 * 歌单封面。自建歌单按本地曲目现算，加歌、删歌、拖动排序时立刻跟着变，不等云端；
 * 链接歌单用原歌单的封面，没有封面的是官方榜单，用生成的榜单封面
 */
export const playlistCover = (pl: ImportedPlaylist) =>
  kindOf(pl) === 'mine' ? autoCover(pl) : (pl.coverUrl ?? (pl.tracks[0] ? coverOf(pl.tracks[0]) : toplistCover(pl.id, pl.name).url));

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
export function countFields(node: unknown): number {
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
    // 和服务端归一化后的一样，签名才对得上，没改的分卷下次保存能跳过
    ...(k === 1 && autoCover(pl) ? { coverUrl: autoCover(pl) } : {}),
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

type PendingOp = 'upsert' | 'delete' | 'reorder';

function setPending(id: string, op: PendingOp | null) {
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

/** 本机记得的云端版本（分卷签名就是当时的记录原文），用来判断别处有没有改过这张歌单 */
function knownCloud(id: string): ImportedPlaylist | undefined {
  const { cloudParts, cloudSigs } = libraryStore.get();
  try {
    const records = Object.fromEntries((cloudParts[id] ?? []).filter((rid) => cloudSigs[rid]).map((rid) => [rid, JSON.parse(cloudSigs[rid]) as ImportedPlaylist]));
    return fromRecords(records).playlists[id];
  } catch {
    return undefined;
  }
}

const orderKey = (pl: ImportedPlaylist | undefined) => (pl ? pl.tracks.map((t) => t.id).join('\n') : '');
const sameSet = (a: ImportedPlaylist, b: ImportedPlaylist) => [...a.tracks.map((t) => t.id)].sort().join() === [...b.tracks.map((t) => t.id)].sort().join();

/** 云端这张歌单的记录 → 本机：曲目、分卷、签名；本机在请求期间又改过顺序的话，曲目先留本机的 */
function adoptRecords(id: string, records: Record<string, ImportedPlaylist>, removed: string[], revision: number, keepLocalIf?: string) {
  const { playlists, parts } = fromRecords(records);
  libraryStore.set((s) => {
    const cloudSigs = { ...s.cloudSigs };
    for (const rid of removed) delete cloudSigs[rid];
    for (const [rid, rec] of Object.entries(records)) cloudSigs[rid] = sigOf({ ...rec, id: rid });
    const local = s.importedPlaylists[id];
    const keep = keepLocalIf != null && orderKey(local) !== keepLocalIf;
    const importedPlaylists = { ...s.importedPlaylists };
    if (!keep && playlists[id]) importedPlaylists[id] = playlists[id];
    return { revision, cloudParts: { ...s.cloudParts, [id]: parts[id] ?? [] }, cloudSigs, importedPlaylists };
  });
}

/** 拉一次快照，只把这张歌单换成云端的（别的歌单、收藏照旧，留给 pullLibrary） */
async function cloudCopy(id: string) {
  const snap = await authed<LibrarySnapshot>(api.paths.librarySnapshot);
  const records = Object.fromEntries(
    Object.entries(snap.importedPlaylists ?? {}).filter(([rid, rec]) => rid === id || rec.sourceUrl.startsWith(`${LOCAL}${id}?part=`)),
  );
  return { snap, records, playlist: fromRecords(records).playlists[id] };
}

/**
 * 原子排序：把本机的曲目顺序整张交给账户服务。
 * - 版本冲突（播放记录、收藏也会推进资料库版本）：拉快照核对。云端这张歌单还是排序前的样子，就用新版本号重交一次；
 *   别处改过它，就换成云端的版本并提示，不拿旧顺序去覆盖
 * - 网络断了：先看快照里是不是已经排好了，免得把成功的排序当失败
 */
async function pushReorder(id: string) {
  const owner = userId();
  const before = knownCloud(id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const pl = libraryStore.get().importedPlaylists[id];
    if (!isMine(pl)) return;
    const sent = orderKey(pl);
    try {
      const r = await authed<PlaylistRecordsResult>(path(api.paths.libraryPlaylistOrder, { id }), {
        method: 'PUT',
        body: { expectedRevision: libraryStore.get().revision, trackIds: pl.tracks.map((t) => t.id) },
      });
      if (userId() !== owner) return;
      adoptRecords(id, r.records, r.removedRecordIds, r.revision, sent);
      return;
    } catch (e) {
      if (userId() !== owner) return;
      const err = e instanceof ApiError ? e : null;
      const conflict = err?.status === 409 && err.code === 5301;
      const offline = err?.code === 5000 && err.status === 0;
      const stale = err && [5901, 5902, 5903].includes(err.code);
      if (!conflict && !offline && !stale) throw e;
      const { snap, records, playlist } = await cloudCopy(id);
      if (userId() !== owner) return;
      const removed = (libraryStore.get().cloudParts[id] ?? []).filter((rid) => !(rid in records));
      if (playlist && orderKey(playlist) === sent) {
        // 其实已经排好了（上一次请求成功了只是没收到回复，或者顺序本来就一样）
        adoptRecords(id, records, removed, snap.revision, sent);
        return;
      }
      if (offline) throw e;
      if (conflict && attempt === 0 && playlist && before && orderKey(playlist) === orderKey(before) && sameSet(playlist, pl)) {
        // 只是版本号落后，这张歌单没被别处动过：用新版本号重交
        libraryStore.set({ revision: snap.revision });
        continue;
      }
      if (!playlist) {
        libraryStore.set((s) => {
          const importedPlaylists = { ...s.importedPlaylists };
          delete importedPlaylists[id];
          return { importedPlaylists, revision: snap.revision };
        });
        toast('这张歌单已经在别的设备上删掉了。');
        return;
      }
      adoptRecords(id, records, removed, snap.revision);
      toast('这张歌单在别处改过了，已换成最新的版本，再排一次吧。');
      return;
    }
  }
}

/** 把一张歌单的本地状态写到云端；失败了留着「待同步」标记，下次拉取时补 */
function sync(id: string, op: PendingOp, quiet = false) {
  setPending(id, op);
  if (!signedIn()) return Promise.resolve();
  return serial(id, async () => {
    try {
      // 排队期间又有了曲目改动：整张上传会带上新顺序，不再单独排序
      const run = op === 'reorder' && libraryStore.get().pendingPlaylists[id] === 'upsert' ? 'upsert' : op;
      if (run === 'upsert') await pushUpsert(id);
      else if (run === 'reorder') await pushReorder(id);
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
    const mine = local.importedPlaylists[id];
    if (op === 'delete') delete next[id];
    else if (op === 'reorder' && mine) {
      if (!cloud[id]) {
        // 云端没有：刚登录就是本机独有的，整张传上去；不然是别处删掉了
        if (merge) {
          next[id] = mine;
          pending[id] = 'upsert';
        } else delete pending[id];
        continue;
      }
      // 离线时排过序：曲目以云端为准，按本机的顺序排，云端新加的接在后面
      const at = new Map(mine.tracks.map((t, i) => [t.id, i]));
      const tracks = [
        ...cloud[id].tracks.filter((t) => at.has(t.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!),
        ...cloud[id].tracks.filter((t) => !at.has(t.id)),
      ];
      next[id] = { ...cloud[id], tracks };
      if (orderKey(next[id]) === orderKey(cloud[id])) delete pending[id];
    } else if (mine) next[id] = mine;
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
  return reorderPlaylist(id, tracks);
}

/** 换成新的曲目顺序（同一批歌，只是次序不同）：先在本机换好、封面跟着变，再交给云端 */
export function reorderPlaylist(id: string, tracks: Track[]) {
  const pl = libraryStore.get().importedPlaylists[id];
  if (!isMine(pl) || orderKey({ ...pl, tracks }) === orderKey(pl)) return;
  libraryStore.set((s) => ({ importedPlaylists: { ...s.importedPlaylists, [id]: { ...pl, tracks, updatedAt: Date.now() } } }));
  const pending = libraryStore.get().pendingPlaylists[id];
  // 曲目改动还没传上去：排序跟着整张上传一起走
  return sync(id, pending === 'upsert' ? 'upsert' : 'reorder');
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
