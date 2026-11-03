// Runs both existing production builds against a fresh temporary database and a local upstream stub.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const loginRoot = path.resolve(process.env.ECHO_LOGIN_REPO || path.join(root, '../MiningQwQLogin'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-social-http-'));
const databaseUrl = 'file:' + path.join(temp, 'test.db').replace(/\\/g, '/');
const { PrismaClient } = require(path.join(loginRoot, 'node_modules/@prisma/client'));
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const children = [];
const logs = [];
const upstream = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== '/comment/new') { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 200, data: { sortType: Number(url.searchParams.get('sortType')),
    totalCount: 1, hasMore: false, cursor: '1', comments: [{ commentId: 1, content: 'Local fixture', time: 1, likedCount: 0,
      user: { userId: 1, nickname: 'Fixture' }, beReplied: [] }] } }));
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
async function freePort() { const server = http.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }
function run(cwd, args, env, label) {
  const fd = fs.openSync(path.join(temp, label + '.log'), 'a');
  logs.push(fd);
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], windowsHide: true });
  children.push(child);
  return child;
}
async function ready(port, account = false) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${account ? '/api/account/auth/session' : '/'}`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status === (account ? 401 : 200)) return;
    } catch { /* Only temporary loopback services are probed. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('Local production server did not start: ' + port);
}
async function terminate(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
(async () => {
  try {
    for (const cwd of [root, loginRoot]) if (!fs.existsSync(path.join(cwd, '.next/BUILD_ID'))) throw Error('Build both repositories first');
    for (const name of fs.readdirSync(path.join(loginRoot, 'prisma/migrations')).sort()) {
      const file = path.join(loginRoot, 'prisma/migrations', name, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const statements = fs.readFileSync(file, 'utf8').split(';').map(part => part.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
      for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    }
    const sourcePort = await listen(upstream), loginPort = await freePort(), musicPort = await freePort();
    const common = { DATABASE_URL: databaseUrl, AUTH_JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      AUTH_COOKIE_SECURE: 'false', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
    run(loginRoot, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(loginPort)], common, 'login');
    run(root, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(musicPort)], {
      ...common, ACCOUNT_SERVICE_BASE_URL: `http://127.0.0.1:${loginPort}`, MUSIC_SOURCE_BASE_URL: `http://127.0.0.1:${sourcePort}`,
      MUSIC_SOURCE_MOCK_ENABLED: 'false', MUSIC_SOURCE_MOCK_FALLBACK: 'false'
    }, 'music');
    await Promise.all([ready(loginPort, true), ready(musicPort)]);
    const qa = run(root, [path.join(__dirname, 'verify-social-playlist-session.cjs'), `http://127.0.0.1:${musicPort}`, loginRoot, '--local-test'], common, 'qa');
    const code = await new Promise(resolve => qa.once('exit', resolve));
    const output = fs.readFileSync(path.join(temp, 'qa.log'), 'utf8');
    process.stdout.write(output);
    if (code !== 0) throw Error('Local backend HTTP verification failed; logs: ' + temp);
    if (await prisma.user.count() !== 0 || await prisma.directMessage.count() !== 0 || await prisma.accountEvent.count() !== 0) throw Error('Disposable HTTP QA data was not cleaned up');
    console.log('LOCAL_BACKEND_HTTP_VERIFIED');
  } finally {
    await Promise.all(children.map(terminate));
    for (const fd of logs) fs.closeSync(fd);
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await prisma.$disconnect();
    // Retain the isolated temporary database/logs for diagnosis; no repository database is changed.
    console.log('Local HTTP QA artifacts:', temp);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
