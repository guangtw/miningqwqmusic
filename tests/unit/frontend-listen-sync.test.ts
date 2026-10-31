import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { id: 'me', nickname: '我' } },
  listeners: new Set<() => void>(),
  action: (_: string) => {},
  authed: vi.fn(), token: vi.fn(), follow: vi.fn(),
  streams: [] as ReadableStreamDefaultController<Uint8Array>[],
  state: { queue: [{ id: '1', name: '歌', artists: [{ id: 'a', name: '艺人' }], durationMs: 180000 }], index: 0, mode: 'loop', playing: true, loading: false, position: 0 }
}));
vi.mock('@/src/frontend/lib/account', () => ({
  authStore: { get: () => f.auth, subscribe: (cb: () => void) => { f.listeners.add(cb); return () => f.listeners.delete(cb); } },
  authed: f.authed, accessToken: f.token, displayName: () => '听众'
}));
vi.mock('@/src/frontend/player/player', () => ({
  playerStore: { get: () => f.state }, audioTime: () => f.state.position,
  isPlaybackIntended: () => f.state.playing, applyRemote: f.follow,
  onPlayerAction: (cb: (type: string) => void) => { f.action = cb; }, setAutoAdvanceGuard: vi.fn()
}));
vi.mock('@/src/frontend/lib/friends', () => ({ refreshSocial: vi.fn() }));
vi.mock('@/src/frontend/lib/toast', () => ({ toast: vi.fn() }));

const room = (id = 'room', version = 10) => ({
  id, version, hostUserId: 'me', playbackLeaderUserId: 'me', members: [],
  serverTime: new Date().toISOString(), playbackState: {
    queue: f.state.queue, currentIndex: 0, currentTimeMs: 0, isPlaying: true,
    mode: 'sequence', updatedAt: new Date().toISOString()
  }
});
const event = (version: number, state: object) => f.streams.at(-1)!.enqueue(new TextEncoder().encode(
  `event: state\ndata: ${JSON.stringify({ version, type: 'seek', actor: { id: 'me' }, payload: state })}\n\n`
));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let listen: typeof import('@/src/frontend/lib/listen');
let cleanup: (() => void) | undefined;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.clearAllMocks();
  sessionStorage.clear(); localStorage.clear();
  f.streams = []; f.listeners.clear();
  f.auth = { status: 'authenticated', user: { id: 'me', nickname: '我' } };
  f.authed.mockImplementation(async () => room());
  f.token.mockResolvedValue('access');
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      f.streams.push(controller);
      init.signal.addEventListener('abort', () => { try { controller.close(); } catch {} }, { once: true });
    }
  }), { headers: { 'content-type': 'text/event-stream' } })));
  listen = await import('@/src/frontend/lib/listen');
});
afterEach(async () => {
  cleanup?.(); cleanup = undefined;
  await listen.leaveRoom();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('ignores stale replay but follows another device on the same account, including clearing the queue', async () => {
  await listen.joinRoom('code'); await vi.advanceTimersByTimeAsync(0);
  f.follow.mockClear();
  event(9, room().playbackState);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.follow).not.toHaveBeenCalled();
  event(11, { ...room().playbackState, currentTimeMs: 42000, isPlaying: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.follow).toHaveBeenLastCalledWith(expect.objectContaining({ positionMs: 42000, playing: false }));
  event(12, { ...room().playbackState, queue: [], currentIndex: -1, isPlaying: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.follow).toHaveBeenLastCalledWith(expect.objectContaining({ queue: [], index: -1 }));
});

it('serializes commands and never lets an older HTTP response overwrite a newer streamed version', async () => {
  await listen.joinRoom('code'); await vi.advanceTimersByTimeAsync(0);
  const first = deferred<ReturnType<typeof room>>();
  const second = deferred<ReturnType<typeof room>>();
  const calls: Record<string, any>[] = [];
  f.authed.mockImplementation((_url, init) => {
    calls.push(init.body); return calls.length === 1 ? first.promise : second.promise;
  });
  f.action('playback'); await vi.advanceTimersByTimeAsync(400);
  f.action('seek'); await vi.advanceTimersByTimeAsync(400);
  expect(calls).toHaveLength(1);
  event(20, room().playbackState); await vi.advanceTimersByTimeAsync(0);
  first.resolve(room('room', 11)); await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ type: 'seek', baseVersion: 20 });
  expect(listen.listenStore.get().room?.version).toBe(20);
  second.resolve(room('room', 21)); await vi.advanceTimersByTimeAsync(0);
  expect(listen.listenStore.get().room?.version).toBe(21);
  f.authed.mockResolvedValue(room());
});

it('keeps the saved room through a temporary restore failure and retries without another login', async () => {
  const { ApiError } = await import('@/src/frontend/api/http');
  sessionStorage.setItem('qwq-listen-room', 'room');
  f.authed.mockRejectedValueOnce(new ApiError('offline', 5000, 503)).mockResolvedValue(room());
  cleanup = listen.watchListen();
  await vi.advanceTimersByTimeAsync(0);
  expect(sessionStorage.getItem('qwq-listen-room')).toBe('room');
  await vi.advanceTimersByTimeAsync(5000);
  expect(listen.listenStore.get().phase).toBe('live');
});

it('cannot end a newly rejoined room when an old request returns a gone error', async () => {
  const { ApiError } = await import('@/src/frontend/api/http');
  await listen.joinRoom('code'); await vi.advanceTimersByTimeAsync(0);
  const old = deferred<ReturnType<typeof room>>();
  f.authed.mockImplementation((url) => url.endsWith('/state') ? old.promise : Promise.resolve(room()));
  f.action('playback'); await vi.advanceTimersByTimeAsync(400);
  await listen.leaveRoom(); await listen.joinRoom('code');
  old.reject(new ApiError('gone', 5504, 403)); await vi.advanceTimersByTimeAsync(0);
  expect(listen.listenStore.get()).toMatchObject({ phase: 'live', room: { id: 'room' } });
});

it('does not let an aborted stream token lookup clear a newer room', async () => {
  const old = deferred<string | null>();
  f.token.mockReturnValueOnce(old.promise).mockResolvedValue('access');
  await listen.joinRoom('a');
  f.authed.mockResolvedValue(room('new-room'));
  await listen.joinRoom('b');
  old.resolve(null); await vi.advanceTimersByTimeAsync(0);
  expect(listen.listenStore.get().room?.id).toBe('new-room');
});

it('keeps the current room when joining another room fails', async () => {
  await listen.joinRoom('good');
  f.authed.mockRejectedValueOnce(new Error('Invalid invitation'));
  await expect(listen.joinRoom('bad')).rejects.toThrow('Invalid invitation');
  expect(listen.listenStore.get()).toMatchObject({ phase: 'live', room: { id: 'room' } });
});

it('cannot reopen a room from a join response arriving after logout', async () => {
  cleanup = listen.watchListen();
  const joining = deferred<ReturnType<typeof room>>();
  f.authed.mockReturnValueOnce(joining.promise);
  const pending = listen.joinRoom('code');
  f.auth = { ...f.auth, status: 'guest' };
  f.listeners.forEach(callback => callback());
  joining.resolve(room()); await pending;
  expect(listen.listenStore.get()).toMatchObject({ phase: 'idle', room: null });
});
