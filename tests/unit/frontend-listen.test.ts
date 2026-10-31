import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/src/types/music';

const track = (i: number): Track => ({
  id: `t${i}`,
  name: `第 ${i} 首`,
  artists: [{ id: `a${i}`, name: '艺人' }, { id: '', name: '没 id 的合唱' }],
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

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});

describe('listen together', () => {
  it('splits an SSE stream into events and keeps the unfinished tail', async () => {
    const { parseSse } = await import('@/src/frontend/lib/listen');
    const { events, rest } = parseSse(
      'event: ready\ndata: {"sinceVersion":3}\n\n: keepalive\n\nevent: state\ndata: {"version":4,"type":"seek"}\n\nevent: member\ndata: {"vers',
    );
    expect(events).toEqual([
      { event: 'ready', data: { sinceVersion: 3 } },
      { event: 'state', data: { version: 4, type: 'seek' } },
    ]);
    expect(rest).toBe('event: member\ndata: {"vers');
  });

  it('shares a window of the queue that fits the account service field limit', async () => {
    const { sharedState } = await import('@/src/frontend/lib/listen');
    const { playerStore } = await import('@/src/frontend/player/player');
    const queue = Array.from({ length: 80 }, (_, i) => track(i));
    const s = { ...playerStore.get(), queue, index: 40, playing: true, mode: 'one' as const };
    const shared = sharedState(s, 61234.6);
    expect(fields({ type: 'playback', playbackState: shared })).toBeLessThanOrEqual(400);
    // 当前这首前面带两首，后面带到上限
    expect(shared.queue[shared.currentIndex].id).toBe('t40');
    expect(shared.currentIndex).toBe(2);
    expect(shared.queue.length).toBeGreaterThan(10);
    expect(shared).toMatchObject({ currentTimeMs: 61235, isPlaying: true, mode: 'loop-one' });
    // 账户服务要求艺人 id 非空
    expect(shared.queue[0].artists).toEqual([{ id: 'a38', name: '艺人' }, { id: '0', name: '没 id 的合唱' }]);
  });

  it('shares an empty, stopped state when nothing is queued', async () => {
    const { sharedState } = await import('@/src/frontend/lib/listen');
    const { playerStore } = await import('@/src/frontend/player/player');
    expect(sharedState({ ...playerStore.get(), queue: [], index: -1, playing: true }, 0)).toMatchObject({ queue: [], currentIndex: -1, isPlaying: false });
  });

  it('keeps list repeat distinct from stopping at the end of the queue', async () => {
    const { sharedState } = await import('@/src/frontend/lib/listen');
    const { playerStore } = await import('@/src/frontend/player/player');
    const state = { ...playerStore.get(), queue: [track(1)], index: 0 };
    expect(sharedState({ ...state, mode: 'loop' }, 0).mode).toBe('loop-all');
    expect(sharedState({ ...state, mode: 'order' }, 0).mode).toBe('sequence');
  });
});

describe('friends', () => {
  it('masks other people’s email addresses', async () => {
    const { maskEmail } = await import('@/src/frontend/lib/friends');
    expect(maskEmail('listener@example.test')).toBe('li***@example.test');
    expect(maskEmail('ab@x.cn')).toBe('a***@x.cn');
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});
