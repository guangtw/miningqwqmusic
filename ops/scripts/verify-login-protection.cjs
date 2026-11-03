'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const origin = process.argv[2], accountRoot = process.argv[3];
if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
const local = new URL(origin).hostname === '127.0.0.1';
const email = 'codex-login-' + crypto.randomBytes(8).toString('hex') + '@example.test';
const password = 'Aa1!' + crypto.randomBytes(24).toString('base64url');
let userId;
async function post(action, secret, ip) {
  const response = await fetch(origin + '/api/account/auth/' + action, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password: secret }), signal: AbortSignal.timeout(15000)
  });
  return { response, payload: await response.json() };
}
(async () => {
  try {
    const registered = await post('register', password, '192.0.2.111');
    if (registered.response.status !== 200) throw Error('Login protection QA registration failed');
    userId = registered.payload.data.user.id;
    for (let i = 0; i < 5; i++) {
      const wrong = await post('login', password + 'wrong', '192.0.2.111');
      if (wrong.response.status !== 401 || wrong.payload.code !== 5202) throw Error('Credential protection changed');
    }
    const locked = await post('login', password, '192.0.2.111');
    if (locked.response.status !== 429 || locked.payload.code !== 5206 || !(locked.payload.retryAfterSeconds > 0)
      || !(Number(locked.response.headers.get('retry-after')) > 0)) throw Error('Login lock or retry hint missing');
    const other = await post('login', password, '192.0.2.112');
    if (local) {
      if (other.response.status !== 200) throw Error('Independent trusted source inherited another source lock');
    } else if (other.response.status !== 429 || other.payload.code !== 5206) {
      throw Error('Public caller bypassed lock by forging proxy headers');
    }
    console.log(local ? 'LOGIN_SOURCE_ISOLATION_PASSED' : 'LOGIN_PROXY_SPOOF_PROTECTION_PASSED');
  } finally {
    if (userId) {
      const env = fs.readFileSync(accountRoot + '/.env', 'utf8').match(/^DATABASE_URL=(.*)$/m);
      if (!env) throw Error('Cannot locate QA cleanup database');
      process.env.DATABASE_URL = env[1].trim().replace(/^['"]|['"]$/g, '');
      const { PrismaClient } = require(accountRoot + '/node_modules/@prisma/client');
      const db = new PrismaClient();
      try {
        const deleted = await db.user.deleteMany({ where: { id: userId, email } });
        if (deleted.count !== 1) throw Error('Login QA cleanup failed');
      } finally { await db.$disconnect(); }
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
