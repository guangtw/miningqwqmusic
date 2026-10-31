import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedPlaylist, Track } from '@/src/types/music';

const track = (i: number): Track => ({
  id: `t${i}`,
  name: `第 ${i} 首`,
  artists: [{ id: `a${i}`, name: '艺人' }],
  album: { id: `al${i}`, name: '专辑', coverUrl: `https://p1.music.126.net/${i}.jpg` },
  durationMs: 180000 + i,
});

/** 和账户服务一样数字段 */
function fields(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce<number>((n, x) => n + fields(x), 0);
  const values = Object.values(node as Record<string, unknown>);
  return values.length + values.reduce<number>((n, x) => n + fields(x), 0);
}

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('playlist cloud records', () => {
  it('splits a long playlist under the field limit and stitches it back in order', async () => {
    const { toRecords, fromRecords } = await import('@/src/frontend/lib/playlists');
    const pl: ImportedPlaylist = {
      id: 'mine-abc',
      name: '长歌单',
      description: '两百首',
      tracks: Array.from({ length: 200 }, (_, i) => track(i)),
      sourceUrl: 'local://playlist/mine-abc',
      importedAt: 1,
      updatedAt: 2,
    };
    const records = toRecords(pl);
    expect(records.length).toBeGreaterThan(1);
    for (const r of records) expect(fields({ playlist: r })).toBeLessThanOrEqual(400);
    expect(records.map((r) => r.id)).toEqual(records.map((_, i) => (i ? `mine-abc~${i + 1}` : 'mine-abc')));

    const { playlists, parts } = fromRecords(Object.fromEntries(records.map((r) => [r.id, r])));
    expect(Object.keys(playlists)).toEqual(['mine-abc']);
    expect(playlists['mine-abc'].tracks.map((t) => t.id)).toEqual(pl.tracks.map((t) => t.id));
    expect(playlists['mine-abc'].description).toBe('两百首');
    expect(parts['mine-abc']).toHaveLength(records.length);
  });

  it('stores linked playlists as an index card without tracks', async () => {
    const { toRecords, kindOf } = await import('@/src/frontend/lib/playlists');
    const linked: ImportedPlaylist = {
      id: '3778678',
      name: '热歌榜',
      tracks: [track(1)],
      sourceUrl: 'https://music.163.com/playlist?id=3778678',
      importedAt: 1,
      updatedAt: 1,
    };
    expect(kindOf(linked)).toBe('linked');
    expect(toRecords(linked)).toEqual([{ ...linked, tracks: [] }]);
  });
});

describe('playlist sync', () => {
  it('pushes new playlists and deletes parts that are no longer needed', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${decodeURIComponent(url.split('/imported-playlists/')[1] ?? url)}`);
        return ok({ revision: calls.length, updatedAt: new Date().toISOString() });
      }),
    );
    const { authStore, libraryStore } = await import('@/src/frontend/lib/account');
    const pls = await import('@/src/frontend/lib/playlists');
    authStore.set({ status: 'authenticated', token: 'tok', user: { id: 'u1', email: 'u1@example.test' } as never });

    const pl = pls.createPlaylist('通勤', '', Array.from({ length: 80 }, (_, i) => track(i)));
    await vi.waitFor(() => expect(libraryStore.get().pendingPlaylists[pl.id]).toBeUndefined());
    const parts = libraryStore.get().cloudParts[pl.id];
    expect(parts.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.startsWith('PUT'))).toBe(true);

    calls.length = 0;
    for (let i = 79; i >= 3; i--) pls.removeFromPlaylist(pl.id, i);
    await vi.waitFor(() => expect(libraryStore.get().cloudParts[pl.id]).toEqual([pl.id]));
    expect(calls).toContain(`DELETE ${parts[parts.length - 1]}`);
    expect(libraryStore.get().importedPlaylists[pl.id].tracks).toHaveLength(3);
  });

  it('keeps local edits made while offline when the cloud snapshot arrives', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (online ? ok({ revision: 9, updatedAt: '' }) : new Response(JSON.stringify({ code: 5403, message: 'down' }), { status: 503 }))),
    );
    const { authStore, libraryStore } = await import('@/src/frontend/lib/account');
    const pls = await import('@/src/frontend/lib/playlists');
    authStore.set({ status: 'authenticated', token: 'tok', user: { id: 'u1', email: 'u1@example.test' } as never });

    const pl = pls.createPlaylist('离线新建', '', [track(1)]);
    await vi.waitFor(() => expect(libraryStore.get().pendingPlaylists[pl.id]).toBe('upsert'));

    online = true;
    await pls.mergeCloudPlaylists({}, false);
    expect(libraryStore.get().importedPlaylists[pl.id]?.name).toBe('离线新建');
    expect(libraryStore.get().pendingPlaylists[pl.id]).toBeUndefined();
  });
});
