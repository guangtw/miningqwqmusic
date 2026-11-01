// Real BFF verification with disposable accounts; never consume distributed codes or ranks.
const fs = require('fs');
const crypto = require('crypto');
const origin = process.argv[2], accountRoot = process.argv[3];
if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
require(accountRoot + '/node_modules/@next/env').loadEnvConfig(accountRoot);
const env = fs.readFileSync(accountRoot + '/.env', 'utf8').match(/^DATABASE_URL=(.*)$/m);
if (!env) throw Error('Account database configuration missing');
process.env.DATABASE_URL = env[1].trim().replace(/^['"]|['"]$/g, '');
const { PrismaClient } = require(accountRoot + '/node_modules/@prisma/client');
const prisma = new PrismaClient();
const secret = process.env.MUSIC_UNBLOCK_INVITE_SECRET ?? process.env.AUTH_JWT_SECRET;
if (!secret) throw Error('Invite secret missing');
const users = [], invites = [];
const rank = 1000000000 + crypto.randomInt(100000000);
async function api(path, account, body, expected = 200) {
  const headers = { 'content-type': 'application/json', 'user-agent': 'Echo membership release QA' };
  if (account) { headers.authorization = 'Bearer ' + account.token; headers.cookie = account.cookie; }
  const response = await fetch(origin + '/api/account/' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (response.status !== expected || (expected === 200 && payload.code !== 0)) throw Error('Membership QA failed: ' + path + ' HTTP ' + response.status);
  return { data: payload.data, response };
}
async function seed(days, number) {
  const code = `Mining-VIP-${days ? days + 'd' : number}-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
  const invite = await prisma.musicUnblockInviteCode.create({ data: {
    codeHash: crypto.createHash('sha256').update(secret + ':' + code.toUpperCase()).digest('hex'),
    label: 'Disposable release QA', membershipKind: days ? 'timed' : 'permanent', durationDays: days,
    memberNumber: number
  } });
  invites.push(invite.id);
  return code;
}
(async () => {
  try {
    for (let i = 0; i < 2; i++) {
      const email = 'echo-member-' + crypto.randomBytes(10).toString('hex') + '@example.test';
      const result = await api('auth/register', null, { email, password: 'Aa1!' + crypto.randomBytes(24).toString('base64url'), nickname: 'Membership QA' });
      users.push({ id: result.data.user.id, email, token: result.data.accessToken, cookie: result.response.headers.getSetCookie().map(s => s.split(';')[0]).join('; ') });
    }
    const [a, b] = users;
    // Reserve a temporary QA-only rank directly; leave the real sequence untouched.
    await prisma.playbackAuthorization.create({ data: { userId: a.id, source: 'manual', status: 'revoked', revokedAt: new Date(), memberNumber: rank, membershipKind: 'timed' } });
    const shortCode = await seed(3, null), longCode = await seed(30, null), permanent = await seed(null, rank + 1);
    const before = Date.now();
    const first = (await api('music/unblock/redeem', a, { inviteCode: shortCode })).data;
    if (!first.enabled || first.membershipKind !== 'timed' || first.memberNumber !== rank || Date.parse(first.expiresAt) < before + 3 * 86400000) throw Error('Timed membership metadata incorrect');
    await api('music/unblock/redeem', b, { inviteCode: shortCode }, 409);
    const repeated = (await api('music/unblock/redeem', a, { inviteCode: shortCode })).data;
    if (repeated.expiresAt !== first.expiresAt || repeated.version !== first.version) throw Error('Code replay extended membership');
    const extended = (await api('music/unblock/redeem', a, { inviteCode: longCode })).data;
    if (Date.parse(extended.expiresAt) - Date.parse(first.expiresAt) !== 30 * 86400000) throw Error('New code did not extend remaining term');
    await prisma.playbackAuthorization.update({ where: { userId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = (await api('auth/me', a)).data.playbackAuthorization;
    const probe = await api('auth/session', a);
    if (expired.enabled || expired.status !== 'expired' || probe.data.playbackAuthorization.enabled || probe.response.headers.get('set-cookie')) throw Error('Expired membership or read-only cookie check failed');
    const upgraded = (await api('music/unblock/redeem', a, { inviteCode: permanent })).data;
    if (!upgraded.enabled || upgraded.membershipKind !== 'permanent' || upgraded.expiresAt !== null || upgraded.memberNumber !== rank + 1) throw Error('Permanent rank metadata incorrect');
    await prisma.playbackAuthorization.update({ where: { userId: a.id }, data: { status: 'revoked', revokedAt: new Date() } });
    const revoked = (await api('music/unblock/redeem', a, { inviteCode: permanent })).data;
    if (revoked.enabled || revoked.status !== 'revoked') throw Error('Consumed code revived revoked member');
    console.log('SINGLE_USE_MEMBERSHIP_EXPIRY_RANK_REGRESSION_PASSED');
  } finally {
    for (const user of users) await prisma.user.deleteMany({ where: { id: user.id, email: user.email } });
    if (invites.length) await prisma.musicUnblockInviteCode.deleteMany({ where: { id: { in: invites }, label: 'Disposable release QA' } });
    await prisma.$disconnect();
    console.log('Disposable membership QA accounts and codes removed');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
