// Candidate/production verification through the BFF. Only disposable users are changed.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const origin = process.argv[2], accountRoot = process.argv[3];
if (process.argv.includes('--local-test')) {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? path.resolve(process.env.DATABASE_URL.slice(5)) : '';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? '') || !accountRoot ||
    !databasePath.startsWith(path.join(os.tmpdir(), 'echo-social-http-'))) throw Error('Local QA requires loopback and an isolated temporary database');
} else {
  if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
  require(accountRoot + '/node_modules/@next/env').loadEnvConfig(accountRoot);
  const configured = fs.readFileSync(accountRoot + '/.env', 'utf8').match(/^DATABASE_URL=(.*)$/m);
  if (!configured) throw Error('Account database configuration missing');
  process.env.DATABASE_URL = configured[1].trim().replace(/^['"]|['"]$/g, '');
}
const { PrismaClient } = require(accountRoot + '/node_modules/@prisma/client');
const prisma = new PrismaClient();
const users = [];
const abort = new AbortController();
let reader;
const deadline = setTimeout(() => abort.abort(), 60000);
function check(value, message) { if (!value) throw Error(message); }
async function api(user, route, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + '/api/account/' + route, { method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: 'Bearer ' + user.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  check(response.status === expected && (expected !== 200 || payload.code === 0), 'Social QA: ' + route + ' HTTP ' + response.status);
  return payload.data;
}
async function untilMessage(id, type = 'message.created') {
  let buffer = '';
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) throw Error('Account event stream closed early');
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop();
    for (const block of blocks) {
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (data) {
        const event = JSON.parse(data);
        if (event.type === type && event.payload?.message?.id === id) return event.payload.message;
      }
    }
  }
}
(async () => {
  try {
    for (let i = 0; i < 2; i++) {
      const email = 'echo-social-' + crypto.randomBytes(10).toString('hex') + '@example.test';
      const data = await api(null, 'auth/register', { email, password: 'Aa1!' + crypto.randomBytes(24).toString('base64url'), nickname: 'Social QA' });
      users.push({ id: data.user.id, token: data.accessToken, email });
    }
    const [a, b] = users;
    const path = target => 'messages/users/' + target.id;
    const send = (from, to, key) => api(from, path(to) + '/messages', { clientMessageId: key, text: key });
    const first = await send(a, b, 'first');
    check((await send(a, b, 'first')).message.id === first.message.id, 'Message retry was not idempotent');
    await send(a, b, 'second'); await send(a, b, 'third');
    await api(a, path(b) + '/messages', { clientMessageId: 'fourth', text: 'fourth' }, 403);
    const marker = (await api(a, 'events?after=0')).nextCursor;
    const response = await fetch(origin + '/api/account/events/stream?after=' + marker, {
      headers: { authorization: 'Bearer ' + a.token }, signal: abort.signal
    });
    check(response.ok && response.headers.get('content-type')?.includes('text/event-stream'), 'Account SSE unavailable');
    reader = response.body.getReader();
    const reply = await send(b, a, 'reply');
    await untilMessage(reply.message.id);
    check((await api(a, 'events?after=' + marker)).items.some(event => event.payload.message?.id === reply.message.id), 'Durable replay missing');
    await send(a, b, 'fourth');
    const marked = await api(b, path(a) + '/read', { throughMessageId: first.message.id });
    check(marked.unreadCount === 3, 'Read marker consumed newer messages');
    const request = await api(a, 'friends/requests', { userId: b.id });
    await api(b, 'friends/requests/' + request.id + '/accept', {});
    check((await api(a, path(b))).sendPolicy.relationship === 'friend', 'Existing friendship not reused');
    await api(a, 'friends/' + b.id, undefined, 200, 'DELETE');
    check((await api(a, path(b))).sendPolicy.canSend, 'Mutual reply qualification was lost');
    const track = id => ({ id, name: id, artists: [{ id: 'qa', name: 'QA' }], durationMs: 1000, coverUrl: 'https://example.test/' + id + '.jpg' });
    const playlist = { id: 'mine-release-qa', name: 'Release QA', tracks: [track('a'), track('b')],
      sourceUrl: 'local://playlist/mine-release-qa', coverUrl: 'https://example.test/stale.jpg', importedAt: 1, updatedAt: 1 };
    const saved = await api(a, 'library/imported-playlists/' + playlist.id, { playlist }, 200, 'PUT');
    check(saved.records[playlist.id].coverUrl.endsWith('/a.jpg'), 'Automatic first-track cover failed');
    const ordered = await api(a, 'library/imported-playlists/' + playlist.id + '/order', { expectedRevision: saved.revision, trackIds: ['b', 'a'] }, 200, 'PUT');
    check(ordered.records[playlist.id].tracks[0].id === 'b' && ordered.records[playlist.id].coverUrl.endsWith('/b.jpg'), 'Atomic order/cover failed');
    await api(a, 'library/imported-playlists/' + playlist.id + '/order', { expectedRevision: saved.revision, trackIds: ['a', 'b'] }, 409, 'PUT');
    const snapshot = await api(a, 'library/snapshot');
    check(snapshot.importedPlaylists[playlist.id].coverUrl.endsWith('/b.jpg'), 'Snapshot cover is stale');
    const sharedTrack = await api(a, path(b) + '/messages', { clientMessageId: 'shared-track', kind: 'track', resource: track('186016') });
    check(sharedTrack.message.kind === 'track' && sharedTrack.message.content.track.id === '186016', 'Typed track card missing');
    check((await untilMessage(sharedTrack.message.id)).content.track.id === '186016', 'Typed track SSE missing');
    const sharedPlaylist = await api(a, path(b) + '/messages', { clientMessageId: 'shared-playlist', kind: 'playlist', playlistId: playlist.id });
    const sharedResource = await api(b, 'messages/' + sharedPlaylist.message.id + '/resource');
    check(sharedResource.playlist.tracks.length === 2 && sharedResource.playlist.tracks[0].id === 'b', 'Private playlist share snapshot incorrect');
    await api(a, path(b) + '/messages', { clientMessageId: 'shared-album', kind: 'album', resource: { id: '32311', name: 'QA Album', artists: [] } });
    const friendAgain = await api(a, 'friends/requests', { userId: b.id });
    await api(b, 'friends/requests/' + friendAgain.id + '/accept', {});
    const room = await api(a, 'listen/rooms', { playbackState: { queue: [track('186016')], currentIndex: 0, currentTimeMs: 0,
      isPlaying: false, mode: 'sequence', updatedAt: new Date().toISOString() } });
    const invitation = await api(a, 'listen/rooms/' + room.id + '/invites', { friendUserId: b.id });
    const retryInvite = await api(a, 'listen/rooms/' + room.id + '/invites', { friendUserId: b.id });
    check(invitation.messageId && retryInvite.messageId === invitation.messageId, 'Listen invitation message missing or duplicated');
    const invitationCard = await api(b, 'messages/' + invitation.messageId);
    check(invitationCard.kind === 'listen_invite' && invitationCard.content.invitation.status === 'pending', 'Pending invitation card incorrect');
    check((await untilMessage(invitation.messageId)).content.invitation.status === 'pending', 'Invitation created SSE missing');
    await api(b, 'listen/invites/' + invitation.id + '/accept', {});
    check((await api(b, 'messages/' + invitation.messageId)).content.invitation.status === 'accepted', 'Invitation acceptance did not update message');
    const updatedInvitation = await untilMessage(invitation.messageId, 'message.updated');
    check(updatedInvitation.content.invitation.status === 'accepted' && updatedInvitation.sequence === invitationCard.sequence, 'Invitation updated SSE incorrect');
    await api(b, 'listen/rooms/' + room.id + '/leave', {});
    await api(a, 'listen/rooms/' + room.id + '/leave', {});
    const comments = await fetch(origin + '/api/music/track/186016/comments?sort=hot&limit=1', { signal: AbortSignal.timeout(30000) });
    const payload = await comments.json();
    check(comments.ok && payload.code === 0 && Array.isArray(payload.data.items), 'Read-only comments unavailable');
    const write = await fetch(origin + '/api/music/track/186016/comments', { method: 'POST', signal: AbortSignal.timeout(15000) });
    check(write.status === 405, 'Comments unexpectedly permit writes');
    console.log('RICH_MESSAGES_AND_LISTEN_INVITATION_REGRESSION_PASSED');
    console.log('SOCIAL_COMMENTS_PLAYLIST_REGRESSION_PASSED');
  } finally {
    clearTimeout(deadline); abort.abort();
    await reader?.cancel().catch(() => {});
    for (const user of users) await prisma.user.deleteMany({ where: { id: user.id, email: user.email } });
    await prisma.$disconnect();
    console.log('Disposable social QA accounts removed');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
