import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedPlaylist, Track } from '@/src/types/music';
import type { DirectConversationDto, DirectMessageDto } from '@/src/types/social';

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));
const fail = (status: number, code: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ code, message: 'x', traceId: 'unit', retryable: false, ...extra }), { status });

const ME = 'me';
const PEER = 'peer';
const peer = { id: PEER, nickname: '阿杰', avatarUrl: null, avatarFallbackText: '阿', avatarFallbackBg: '#000' };
const msg = (sequence: number, from = PEER, extra: Partial<DirectMessageDto> = {}): DirectMessageDto => ({
  id: `m${sequence}`,
  conversationId: 'c1',
  sequence,
  senderUserId: from,
  clientMessageId: `cm${sequence}`,
  text: `第 ${sequence} 条`,
  createdAt: new Date(2026, 10, 3, 10, sequence).toISOString(),
  ...extra,
});
const conversation = (extra: Partial<DirectConversationDto> = {}): DirectConversationDto => ({
  id: 'c1',
  peer,
  lastMessage: msg(2),
  unreadCount: 1,
  lastReadSequence: 1,
  peerLastReadSequence: 0,
  sendPolicy: { relationship: 'friend', hasMutualMessages: true, canSend: true, remainingBeforeReply: null, reason: null },
  ...extra,
});

async function signIn() {
  const { authStore } = await import('@/src/frontend/lib/account');
  authStore.set({ status: 'authenticated', token: 'tok', user: { id: ME, email: 'me@example.test' } as never });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('direct messages', () => {
  it('merges live messages once, counts unread only for newer peer messages, and keeps read position monotonic', async () => {
    const reads: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/read')) {
          reads.push(JSON.parse(String(init.body)));
          return ok({ conversationId: 'c1', lastReadSequence: 3, unreadCount: 0 });
        }
        if (url.includes('/messages?') || url.endsWith('/messages')) return ok({ items: [msg(1), msg(2)], hasMore: false, nextBefore: 1, nextAfter: 2 });
        return ok(conversation());
      }),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    await m.openThread(PEER);
    expect(m.messagesStore.get().threads[PEER].messages.map((x) => x.sequence)).toEqual([1, 2]);

    m.onMessageCreated(msg(3));
    m.onMessageCreated(msg(3)); // SSE 重放
    m.onMessageCreated(msg(2)); // 旧事件
    const s = m.messagesStore.get();
    expect(s.threads[PEER].messages.map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(s.conversations[PEER].unreadCount).toBe(2);
    expect(m.unreadTotal(s)).toBe(2);

    m.markRead(PEER, msg(3));
    m.markRead(PEER, msg(1)); // 往回的不发
    await vi.waitFor(() => expect(m.messagesStore.get().conversations[PEER].unreadCount).toBe(0));
    expect(reads).toEqual([{ throughMessageId: 'm3' }]);
    expect(m.messagesStore.get().conversations[PEER].lastReadSequence).toBe(3);

    m.onMessageRead({ conversationId: 'c1', userId: PEER, lastReadSequence: 3 });
    m.onMessageRead({ conversationId: 'c1', userId: PEER, lastReadSequence: 2 });
    expect(m.messagesStore.get().conversations[PEER].peerLastReadSequence).toBe(3);
  });

  it('pops one notice per peer for fresh incoming messages, but not for replays, own messages or the open chat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/messages?') || url.endsWith('/messages') ? ok({ items: [msg(1), msg(2)], hasMore: false, nextBefore: 1, nextAfter: 2 }) : ok(conversation()),
      ),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    await m.openThread(PEER);
    const now = () => new Date().toISOString();
    location.hash = '#/library';

    m.onMessageCreated(msg(1, PEER, { createdAt: now() })); // 已读过的旧序号
    m.onMessageCreated(msg(3, PEER, { createdAt: new Date(Date.now() - 600_000).toISOString() })); // 补拉回来的旧消息
    m.onMessageCreated(msg(4, ME, { createdAt: now() })); // 自己在别处发的
    expect(m.noticeStore.get().notice).toBeNull();

    m.onMessageCreated(msg(5, PEER, { createdAt: now(), text: '在吗' }));
    m.onMessageCreated(msg(6, PEER, { createdAt: now(), text: '周末一起听' }));
    expect(m.noticeStore.get().notice).toMatchObject({ peerId: PEER, text: '周末一起听', count: 2 });

    m.dismissNotice();
    location.hash = `#/chat/${PEER}`;
    m.onMessageCreated(msg(7, PEER, { createdAt: now() }));
    expect(m.noticeStore.get().notice).toBeNull();
  });

  it('reuses the clientMessageId on retry and drops the optimistic bubble when the server message arrives', async () => {
    const sent: { clientMessageId: string; text: string }[] = [];
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init?.method === 'POST' && url.endsWith('/messages')) {
          const body = JSON.parse(String(init.body));
          sent.push(body);
          if (!online) throw new TypeError('offline');
          return ok({ message: msg(3, ME, { clientMessageId: body.clientMessageId, text: body.text }), conversation: conversation({ lastMessage: msg(3, ME) }) });
        }
        if (url.includes('/messages')) return ok({ items: [msg(1), msg(2)], hasMore: false, nextBefore: 1, nextAfter: 2 });
        return ok(conversation());
      }),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    await m.openThread(PEER);

    expect(await m.sendMessage(PEER, '  晚上听什么  ')).toBe('failed');
    const failed = m.messagesStore.get().threads[PEER].outbox[0];
    expect(failed).toMatchObject({ text: '晚上听什么', status: 'failed' });

    online = true;
    expect(await m.sendMessage(PEER, failed.text, failed.clientMessageId)).toBe('sent');
    expect(sent.map((x) => x.clientMessageId)).toEqual([failed.clientMessageId, failed.clientMessageId]);
    const t = m.messagesStore.get().threads[PEER];
    expect(t.outbox).toEqual([]);
    expect(t.messages.at(-1)?.text).toBe('晚上听什么');
  });

  it('gives the text back when the stranger quota is used up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init?.method === 'POST') return fail(403, 5804);
        if (url.includes('/messages')) return ok({ items: [], hasMore: false, nextBefore: null, nextAfter: null });
        return ok(
          conversation({
            id: null,
            lastMessage: null,
            unreadCount: 0,
            sendPolicy: { relationship: 'stranger', hasMutualMessages: false, canSend: false, remainingBeforeReply: 0, reason: 'stranger_limit' },
          }),
        );
      }),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    await m.openThread(PEER);
    expect(await m.sendMessage(PEER, '你好')).toBe('limit');
    expect(m.messagesStore.get().threads[PEER].outbox).toEqual([]);
  });
});

describe('music cards and listen invitations', () => {
  const invite = (status: string, updatedAt: string) =>
    msg(3, PEER, {
      kind: 'listen_invite',
      text: '[一起听邀请] 等待回应',
      content: {
        version: 1,
        kind: 'listen_invite',
        invitation: { inviteId: 'i1', roomId: 'r1', inviterUserId: PEER, inviteeUserId: ME, status: status as never, expiresAt: '2026-11-03T20:00:00Z', respondedAt: null },
      },
      updatedAt,
    });

  it('falls back to text for old, unknown or mismatched content', async () => {
    const m = await import('@/src/frontend/lib/messages');
    expect(m.cardOf(msg(1))).toBeNull();
    expect(m.cardOf({ kind: 'image' as never, content: { version: 1, kind: 'image' } as never })).toBeNull();
    expect(m.cardOf({ kind: 'track', content: { version: 2, kind: 'track' } as never })).toBeNull();
    const card = msg(2, PEER, { kind: 'album', text: '[专辑] 叶惠美', content: { version: 1, kind: 'album', album: { id: '1', name: '叶惠美', artists: [] } } });
    expect(m.cardOf(card)?.kind).toBe('album');
    expect(m.previewText(card, false)).toBe('分享了专辑《叶惠美》');
    expect(m.previewText(invite('pending', '2026-11-03T10:00:00Z'), false)).toBe('邀请你一起听');
  });

  it('replaces updated invitations in place without touching unread, and never goes back to an older state', async () => {
    let summary = conversation({ lastMessage: invite('pending', '2026-11-03T10:00:00Z'), unreadCount: 1, lastReadSequence: 2 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/messages?') || url.endsWith('/messages')
          ? ok({ items: [msg(1), msg(2), invite('pending', '2026-11-03T10:00:00Z')], hasMore: false, nextBefore: 1, nextAfter: 3 })
          : ok(summary),
      ),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    await m.openThread(PEER);

    m.onMessageUpdated(invite('accepted', '2026-11-03T10:05:00Z'));
    m.onMessageUpdated(invite('pending', '2026-11-03T10:00:00Z')); // 晚到的旧状态
    const s = m.messagesStore.get();
    const status = (x: DirectMessageDto | null | undefined) => (x?.content as { invitation: { status: string } } | undefined)?.invitation.status;
    expect(s.threads[PEER].messages.map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(status(s.threads[PEER].messages[2])).toBe('accepted');
    expect(status(s.conversations[PEER].lastMessage)).toBe('accepted');
    expect(s.conversations[PEER].unreadCount).toBe(1);

    // 摘要接口还拿着旧版本：不能把已接受盖回等待中
    summary = conversation({ lastMessage: invite('pending', '2026-11-03T10:00:00Z'), unreadCount: 1, lastReadSequence: 2 });
    await m.openThread(PEER);
    expect(status(m.messagesStore.get().conversations[PEER].lastMessage)).toBe('accepted');
  });

  it('keeps the original card request for retries and builds clean share payloads', async () => {
    const bodies: Record<string, unknown>[] = [];
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init?.method === 'POST' && url.endsWith('/messages')) {
          const body = JSON.parse(String(init.body));
          bodies.push(body);
          if (!online) throw new TypeError('offline');
          return ok({ message: msg(3, ME, { clientMessageId: body.clientMessageId, kind: 'track', content: { version: 1, kind: 'track', track: body.resource } }), conversation: conversation() });
        }
        if (url.includes('/messages')) return ok({ items: [msg(1), msg(2)], hasMore: false, nextBefore: 1, nextAfter: 2 });
        return ok(conversation());
      }),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/messages');
    const share = await import('@/src/frontend/lib/share');
    await m.openThread(PEER);

    const track = {
      id: '186016',
      name: '晴天',
      artists: [{ id: '', name: '周杰伦' }, { id: '2', name: '  ' }],
      album: { id: '18905', name: '叶惠美', coverUrl: 'data:image/png;base64,xx' },
      durationMs: 269000.4,
      url: 'https://example.test/audio.mp3',
    } as unknown as Track;
    expect(await share.shareTo(PEER, { kind: 'track', track }, '  这首  ')).toBe('failed');
    const o = m.messagesStore.get().threads[PEER].outbox[0];
    expect(o.preview?.kind).toBe('track');
    expect(bodies[0]).toEqual({
      clientMessageId: o.clientMessageId,
      kind: 'track',
      text: '这首',
      resource: { id: '186016', name: '晴天', artists: [{ id: '0', name: '周杰伦' }], album: { id: '18905', name: '叶惠美' }, durationMs: 269000 },
    });

    online = true;
    expect(await m.resend(PEER, o)).toBe('sent');
    expect(bodies[1]).toEqual(bodies[0]);
    expect(m.messagesStore.get().threads[PEER].outbox).toEqual([]);
  });
});

describe('account events', () => {
  it('parses ids from SSE frames split across chunks', async () => {
    const { parseSse } = await import('@/src/frontend/lib/listen');
    const first = parseSse('id: 42\nevent: message.created\ndata: {"id":"42"');
    expect(first.events).toEqual([]);
    const second = parseSse(`${first.rest}}\n\n: keepalive\n\n`);
    expect(second.events).toEqual([{ id: '42', event: 'message.created', data: { id: '42' } }]);
  });

  it('dedupes by cursor, advances it only after handling, and refreshes the library for newer playlist revisions', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ok({ revision: 7, favorites: {}, recent: [], importedPlaylists: {}, updatedAt: '' }));
    vi.stubGlobal('fetch', fetchMock);
    await signIn();
    const events = await import('@/src/frontend/lib/events');
    const { libraryStore } = await import('@/src/frontend/lib/account');
    libraryStore.set({ revision: 5 });
    // 不比本机新：不拉
    events.handleAccountEvent({ id: '11', type: 'playlist.changed', payload: { playlistId: 'mine-a', revision: 5 }, createdAt: '' });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).not.toHaveBeenCalled();
    // 连着两条新的：合成一次
    events.handleAccountEvent({ id: '12', type: 'playlist.changed', payload: { playlistId: 'mine-a', revision: 6 }, createdAt: '' });
    events.handleAccountEvent({ id: '13', type: 'playlist.changed', payload: { playlistId: null, revision: 7 }, createdAt: '' });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 游标之前的（重连重放）丢掉
    events.handleAccountEvent({ id: '12', type: 'playlist.changed', payload: { playlistId: 'mine-a', revision: 99 }, createdAt: '' });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const track = (i: number): Track => ({
  id: `t${i}`,
  name: `第 ${i} 首`,
  artists: [{ id: `a${i}`, name: '艺人' }],
  album: { id: `al${i}`, name: '专辑', coverUrl: `https://p1.music.126.net/${i}.jpg` },
  durationMs: 180000 + i,
});

describe('playlist order and cover', () => {
  it('derives self-made covers from the first track only', async () => {
    const { playlistCover, toRecords } = await import('@/src/frontend/lib/playlists');
    const pl: ImportedPlaylist = {
      id: 'mine-a',
      name: 'A',
      coverUrl: 'https://old.example/cover.jpg',
      tracks: [{ ...track(2), album: { id: 'x', name: 'x' } }, track(3)],
      sourceUrl: 'local://playlist/mine-a',
      importedAt: 1,
      updatedAt: 1,
    };
    // 第一首没有封面：清空，不取后面的
    expect(playlistCover(pl)).toBeUndefined();
    expect(toRecords(pl)[0].coverUrl).toBeUndefined();
    const reordered = { ...pl, tracks: [track(3), pl.tracks[0]] };
    expect(playlistCover(reordered)).toBe('https://p1.music.126.net/3.jpg');
    expect(toRecords(reordered)[0].coverUrl).toBe('https://p1.music.126.net/3.jpg');
    expect(playlistCover({ ...pl, tracks: [] })).toBeUndefined();
  });

  async function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${url.replace(/^.*\/api\/account\/library\//, '')}`);
        return handler(url, init);
      }),
    );
    await signIn();
    const { libraryStore } = await import('@/src/frontend/lib/account');
    const pls = await import('@/src/frontend/lib/playlists');
    const pl: ImportedPlaylist = {
      id: 'mine-a',
      name: 'A',
      tracks: [track(1), track(2), track(3)],
      sourceUrl: 'local://playlist/mine-a',
      importedAt: 1,
      updatedAt: 1,
    };
    const records = Object.fromEntries(pls.toRecords(pl).map((r) => [r.id, r]));
    await pls.mergeCloudPlaylists(records, false);
    libraryStore.set({ revision: 3 });
    calls.length = 0;
    return { calls, libraryStore, pls, records };
  }

  const snapshotOf = (tracks: Track[], revision: number, toRecords: (pl: ImportedPlaylist) => ImportedPlaylist[]) => ({
    revision,
    favorites: {},
    recent: [],
    updatedAt: '',
    importedPlaylists: Object.fromEntries(
      toRecords({ id: 'mine-a', name: 'A', tracks, sourceUrl: 'local://playlist/mine-a', importedAt: 1, updatedAt: 1 }).map((r) => [r.id, r]),
    ),
  });

  it('sends one atomic reorder and applies the returned records', async () => {
    let body: { expectedRevision: number; trackIds: string[] } | null = null;
    const { calls, libraryStore, pls } = await setup((url, init) => {
      body = JSON.parse(String(init.body));
      const tracks = body!.trackIds.map((id) => track(Number(id.slice(1))));
      return ok({ revision: 4, updatedAt: '', records: snapshotOf(tracks, 4, pls.toRecords).importedPlaylists, removedRecordIds: [] });
    });
    await pls.movePlaylistTrack('mine-a', 2, 0);
    expect(calls).toEqual(['PUT imported-playlists/mine-a/order']);
    expect(body).toEqual({ expectedRevision: 3, trackIds: ['t3', 't1', 't2'] });
    expect(libraryStore.get().revision).toBe(4);
    expect(libraryStore.get().pendingPlaylists['mine-a']).toBeUndefined();
    expect(pls.playlistCover(libraryStore.get().importedPlaylists['mine-a'])).toBe('https://p1.music.126.net/3.jpg');
  });

  it('retries with the fresh revision when only the library version moved on', async () => {
    let puts = 0;
    const { calls, libraryStore, pls } = await setup((url, init) => {
      if (url.endsWith('/snapshot')) return ok(snapshotOf([track(1), track(2), track(3)], 8, pls.toRecords));
      puts++;
      if (puts === 1) return fail(409, 5301);
      const ids = JSON.parse(String(init.body)).trackIds as string[];
      return ok({ revision: 9, updatedAt: '', records: snapshotOf(ids.map((id) => track(Number(id.slice(1)))), 9, pls.toRecords).importedPlaylists, removedRecordIds: [] });
    });
    await pls.movePlaylistTrack('mine-a', 0, 2);
    expect(calls).toEqual(['PUT imported-playlists/mine-a/order', 'GET snapshot', 'PUT imported-playlists/mine-a/order']);
    expect(libraryStore.get().revision).toBe(9);
    expect(libraryStore.get().importedPlaylists['mine-a'].tracks.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('adopts the cloud copy instead of overwriting when the playlist changed elsewhere', async () => {
    const { calls, libraryStore, pls } = await setup((url) => {
      if (url.endsWith('/snapshot')) return ok(snapshotOf([track(2), track(1), track(3), track(4)], 8, pls.toRecords));
      return fail(409, 5301);
    });
    await pls.movePlaylistTrack('mine-a', 0, 2);
    expect(calls).toEqual(['PUT imported-playlists/mine-a/order', 'GET snapshot']);
    expect(libraryStore.get().importedPlaylists['mine-a'].tracks.map((t) => t.id)).toEqual(['t2', 't1', 't3', 't4']);
    expect(libraryStore.get().revision).toBe(8);
  });

  it('treats a lost response as success when the snapshot already has the new order', async () => {
    const { calls, libraryStore, pls } = await setup((url) => {
      if (url.endsWith('/snapshot')) return ok(snapshotOf([track(3), track(1), track(2)], 5, pls.toRecords));
      throw new TypeError('network down');
    });
    await pls.movePlaylistTrack('mine-a', 2, 0);
    expect(calls).toEqual(['PUT imported-playlists/mine-a/order', 'GET snapshot']);
    expect(libraryStore.get().pendingPlaylists['mine-a']).toBeUndefined();
    expect(libraryStore.get().revision).toBe(5);
  });

  it('rebases an offline reorder on the newer cloud tracks before submitting', async () => {
    let online = false;
    let sentIds: string[] = [];
    const { libraryStore, pls } = await setup((url, init) => {
      if (!online) throw new TypeError('offline');
      if (url.endsWith('/snapshot')) return ok(snapshotOf([track(1), track(2), track(3), track(4)], 6, pls.toRecords));
      sentIds = JSON.parse(String(init.body)).trackIds;
      return ok({ revision: 7, updatedAt: '', records: snapshotOf(sentIds.map((id) => track(Number(id.slice(1)))), 7, pls.toRecords).importedPlaylists, removedRecordIds: [] });
    });
    await pls.movePlaylistTrack('mine-a', 2, 0);
    expect(libraryStore.get().pendingPlaylists['mine-a']).toBe('reorder');

    online = true;
    const cloud = snapshotOf([track(1), track(2), track(3), track(4)], 6, pls.toRecords);
    libraryStore.set({ revision: 6 });
    await pls.mergeCloudPlaylists(cloud.importedPlaylists, false);
    await vi.waitFor(() => expect(libraryStore.get().pendingPlaylists['mine-a']).toBeUndefined());
    // 本机的顺序 + 云端新加的接在后面
    expect(sentIds).toEqual(['t3', 't1', 't2', 't4']);
  });
});

describe('comments helpers', () => {
  it('formats times and upgrades avatar urls', async () => {
    const { avatarSrc, commentTime } = await import('@/src/frontend/lib/comments');
    const now = new Date(2026, 10, 3, 12, 0);
    expect(commentTime(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe('今天 09:05');
    expect(commentTime(new Date(2026, 0, 2).getTime(), now)).toBe('1 月 2 日');
    expect(commentTime(new Date(2014, 9, 17).getTime(), now)).toBe('2014 年 10 月 17 日');
    expect(avatarSrc('http://p3.music.126.net/a.jpg')).toBe('https://p3.music.126.net/a.jpg?param=80y80');
    expect(avatarSrc(undefined)).toBeUndefined();
  });

  it('labels chat time stamps relative to today', async () => {
    const { stampText } = await import('@/src/frontend/views/Chat');
    const now = new Date(2026, 10, 3, 12, 0);
    expect(stampText(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe('今天 09:05');
    expect(stampText(new Date(2026, 10, 2, 22, 30).toISOString(), now)).toBe('昨天 22:30');
    expect(stampText(new Date(2025, 4, 1, 8, 0).toISOString(), now)).toBe('2025 年 5 月 1 日 08:00');
  });
});
