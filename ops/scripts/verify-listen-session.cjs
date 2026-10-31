// Disposable, two-account end-to-end check, run on the server against a named release.
const fs = require('fs');
const crypto = require('crypto');
const origin = process.argv[2];
const accountRoot = process.argv[3];
if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
const users = [];
let roomId;
let reader;
const streamAbort = new AbortController();
const deadline = setTimeout(() => streamAbort.abort(), 30000);
async function api(user, path, body) {
  const response = await fetch(origin + '/api/account' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { authorization: 'Bearer ' + user.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw Error('Listen QA ' + path + ': HTTP ' + response.status + ', code ' + result.code);
  return result.data;
}
async function register() {
  const email = 'codex-listen-' + crypto.randomBytes(8).toString('hex') + '@example.invalid';
  const result = await api(null, '/auth/register', { email, password: 'Aa1!' + crypto.randomBytes(24).toString('base64url'), nickname: 'Listen QA' });
  const user = { id: result.user.id, email, token: result.accessToken };
  users.push(user);
  return user;
}
let buffer = '';
const events = [];
const decoder = new TextDecoder();
async function until(test) {
  for (;;) {
    while (events.length) {
      const event = events.shift();
      if (test(event)) return event;
    }
    const chunk = await reader.read();
    if (chunk.done) throw Error('Listen stream closed before the expected event');
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop();
    for (const block of blocks) {
      const name = block.match(/^event:\s*(.+)$/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (name && data) events.push({ event: name, data: JSON.parse(data) });
    }
  }
}
function check(value, message) { if (!value) throw Error(message); }
(async () => {
  try {
    const host = await register();
    const guest = await register();
    const state = { queue: [{ id: '186016', name: 'Listen QA', artists: [{ id: '0', name: 'QA' }], durationMs: 180000 }], currentIndex: 0, currentTimeMs: 0, isPlaying: true, mode: 'loop-all', updatedAt: new Date(0).toISOString() };
    const room = await api(host, '/listen/rooms', { playbackState: state });
    roomId = room.id;
    check(Date.parse(room.playbackState.updatedAt) > Date.now() - 10000, 'Room did not use the server clock');
    const joined = await api(guest, '/listen/rooms/join', { inviteCode: room.inviteCode });
    const response = await fetch(origin + '/api/account/listen/rooms/' + roomId + '/stream?sinceVersion=' + joined.version, {
      headers: { authorization: 'Bearer ' + guest.token, accept: 'text/event-stream' }, signal: streamAbort.signal
    });
    check(response.ok && response.headers.get('content-type')?.includes('text/event-stream'), 'SSE transport is unavailable');
    reader = response.body.getReader();
    const ready = await until(event => event.event === 'ready');
    check(!!ready.data.serverTime, 'SSE clock synchronization missing');
    const seek = await api(host, '/listen/rooms/' + roomId + '/state', { type: 'seek', baseVersion: joined.version, playbackState: { ...state, currentTimeMs: 12000 } });
    const received = await until(event => event.event === 'state' && event.data.version === seek.version);
    check(received.data.payload.currentTimeMs === 12000, 'Peer did not receive the seek');
    const paused = await api(guest, '/listen/rooms/' + roomId + '/state', { type: 'playback', baseVersion: seek.version, playbackState: { ...state, currentTimeMs: 15000, isPlaying: false } });
    const stale = await api(host, '/listen/rooms/' + roomId + '/state', { type: 'progress', baseVersion: joined.version, playbackState: state });
    check(stale.version === paused.version && !stale.playbackState.isPlaying && stale.playbackState.currentTimeMs === 15000, 'Old progress overwrote a new playback command');
    await api(host, '/listen/rooms/' + roomId + '/leave', {});
    const transferred = await api(guest, '/listen/rooms/' + roomId);
    check(transferred.hostUserId === guest.id && transferred.playbackLeaderUserId === guest.id, 'Room ownership did not transfer');
    const cleared = await api(guest, '/listen/rooms/' + roomId + '/state', { type: 'queue', baseVersion: transferred.version, playbackState: { ...state, queue: [], currentIndex: -1, currentTimeMs: 0, isPlaying: false } });
    const empty = await until(event => event.event === 'state' && event.data.version === cleared.version);
    check(empty.data.payload.queue.length === 0, 'Empty queue did not reach the peer stream');
    await api(guest, '/listen/rooms/' + roomId + '/leave', {});
    const closed = await until(event => event.event === 'closed');
    check(closed.data.code === 5504 || closed.data.code === 5505, 'Room closure did not end the stream');
    console.log('TWO_ACCOUNT_LISTEN_SSE_AND_CONTROL_REGRESSION_PASSED');
  } finally {
    clearTimeout(deadline);
    streamAbort.abort();
    await reader?.cancel().catch(() => undefined);
    if (roomId) for (const user of users) await api(user, '/listen/rooms/' + roomId + '/leave', {}).catch(() => undefined);
    if (users.length) {
      const env = fs.readFileSync(accountRoot + '/.env', 'utf8');
      const match = env.match(/^DATABASE_URL=(.*)$/m);
      if (!match) throw Error('QA cleanup database config missing');
      process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
      const { PrismaClient } = require(accountRoot + '/node_modules/@prisma/client');
      const prisma = new PrismaClient();
      try {
        const deleted = await prisma.user.deleteMany({ where: { OR: users.map(user => ({ id: user.id, email: user.email })) } });
        check(deleted.count === users.length, 'Listen QA account cleanup incomplete');
        console.log('Disposable listen QA accounts removed');
      } finally { await prisma.$disconnect(); }
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
