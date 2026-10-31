import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/src/types/music';

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sport radio', () => {
  it('sweeps nearby BPMs, drops repeats and keeps the closest tempo first', async () => {
    // 上游：每个步频一首，140 和 142 给的是同一首；138 的详情查不到
    const byBpm: Record<number, string> = { 140: 's1', 142: 's1', 138: 's2', 144: 's3' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://x');
        if (url.pathname.endsWith('/scene/sport')) {
          const id = byBpm[Number(url.searchParams.get('bpm'))];
          return ok({ tags: [], resources: id ? [{ id, title: `场景${id}`, subtitle: '某人', coverUrl: `c-${id}`, trackId: id }] : [] });
        }
        const id = url.pathname.split('/').pop()!;
        if (id === 's2') return new Response(JSON.stringify({ code: 3001, message: 'nope' }), { status: 404 });
        return ok({ id, name: `完整${id}`, artists: [{ id: 'a', name: '艺人' }], album: { id: 'b', name: '专辑' }, durationMs: 1000 });
      }),
    );
    const { sportMix } = await import('@/src/frontend/lib/radio');
    const tracks = await sportMix(140);
    expect(tracks.map((t) => t.id)).toEqual(['s1', 's2', 's3']);
    expect(tracks[0].name).toBe('完整s1');
    expect(tracks[0].coverUrl).toBe('c-s1');
    // 查不到详情的用场景里的标题和封面
    expect(tracks[1]).toMatchObject({ name: '场景s2', coverUrl: 'c-s2', artists: [{ id: '', name: '某人' }] });
  });
});

describe('song insight helpers', () => {
  it('groups creators by role in order and splits style tags', async () => {
    const { groupCreators, styleTags } = await import('@/src/frontend/lib/insight');
    expect(
      groupCreators([
        { name: '甲', role: '作词' },
        { name: '乙', role: '作曲' },
        { name: '丙', role: '作词' },
        { name: '甲', role: '作词' },
        { name: '丁' },
      ]),
    ).toEqual([
      ['作词', ['甲', '丙']],
      ['作曲', ['乙']],
      ['创作', ['丁']],
    ]);
    expect(styleTags('流行-华语流行')).toEqual(['流行', '华语流行']);
    expect(styleTags(undefined)).toEqual([]);
  });

  it('names downloads after the artists and title without unsafe characters', async () => {
    const { fileName } = await import('@/src/frontend/lib/download');
    const t = { id: '1', name: 'A/B: "Live"?', artists: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], album: { id: '', name: '' }, durationMs: 0 } as Track;
    expect(fileName(t, 'FLAC')).toBe('甲、乙 - A B Live.flac');
    expect(fileName({ ...t, artists: [] }, undefined)).toBe('A B Live.mp3');
  });
});
