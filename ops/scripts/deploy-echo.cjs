#!/usr/bin/env node
// Invoked through SSH under flock. Only an exact, documented additive migration is allowed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { normalizeLegacyUnblockSources, setEnvValues } = require('./music-source-config.cjs');
const { selectAccountMigrations } = require('./account-migrations.cjs');
if (process.getuid?.() !== 0) throw Error('Deployment requires the authorized sudo account');
const packageDir = path.resolve(process.argv[2] || '');
if (!packageDir.startsWith('/home/aiops/releases/')) throw Error('Unexpected package directory');
const manifest = JSON.parse(fs.readFileSync(packageDir + '/release.json', 'utf8'));
if (manifest.schema !== 1 || !/^echo-[0-9]{14}-[a-f0-9]{8}$/.test(manifest.id) || !/^[a-f0-9]{40}$/.test(manifest.musicCommit) || !/^[a-f0-9]{40}$/.test(manifest.loginCommit)) throw Error('Invalid release manifest');
if (path.basename(packageDir) !== manifest.id) throw Error('Package directory differs from release id');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lockHash = file => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
for (const [file, expected] of Object.entries(manifest.files)) {
  if (!/^(music|login|ops)\//.test(file) || file.split('/').includes('..') || /(^|\/)\.env|\.db(?:-|$)|\.pem$|(^|\/)uploads\//.test(file)) throw Error('Forbidden package file');
  if (digest(path.join(packageDir, file)) !== expected) throw Error('Source checksum failed: ' + file);
}
const musicBase = '/www/wwwroot/miningqwqmusic';
const musicRelease = musicBase + '/releases/' + manifest.id;
const loginRelease = '/www/wwwroot/miningqwqlogin-releases/' + manifest.id;
const pm2 = '/www/server/nvm/versions/node/v24.15.0/bin/pm2';
const node = '/www/server/nvm/versions/node/v24.15.0/bin/node';
const npmCli = '/www/server/nvm/versions/node/v24.15.0/lib/node_modules/npm/bin/npm-cli.js';
const processes = JSON.parse(execFileSync(pm2, ['jlist'], { encoding: 'utf8' }));
const originalLogin = processes.find(p => p.name === 'miningqwqlogin')?.pm2_env;
const originalMusic = processes.find(p => p.name === 'miningqwqmusic')?.pm2_env;
const originalUpstream = processes.find(p => p.name === 'ncm-api')?.pm2_env;
const originalWorker = processes.find(p => p.name === 'miningqwq-membership-worker')?.pm2_env;
const previousMusic = fs.realpathSync(musicBase + '/current');
const database = '/www/wwwroot/miningqwqlogin/prisma/dev.db';
if (!originalMusic || !originalLogin || !originalUpstream || !fs.existsSync(database)) throw Error('Existing account service/upstream/database missing');
const work = musicBase + '/shared/deploy-backups/' + manifest.id;
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
process.umask(0o077);
let accountMigrations = [];
const musicEnvFile = musicBase + '/shared/.env.production';
const originalMusicEnv = fs.readFileSync(musicEnvFile, 'utf8');
const releaseMusicEnv = setEnvValues(normalizeLegacyUnblockSources(originalMusicEnv), {
  MUSIC_SOURCE_EGRESS_MANAGED: '1', MUSIC_SOURCE_MAX_CONCURRENT: '8', ACCOUNT_TRUST_PROXY_HEADERS: '1',
  ACCOUNT_PUBLIC_ORIGIN: 'https://echo.miningqwq.cn'
});
// Trust identity only behind this verified, overwriting proxy and loopback listeners.
const nginxProxy = fs.readFileSync('/www/server/panel/vhost/nginx/proxy/www.echo.miningqwq.cn/80de4b618cfe935c8dc495a21848582d_www.echo.miningqwq.cn.conf', 'utf8');
if (!/proxy_set_header\s+X-Real-IP\s+\$remote_addr\s*;/i.test(nginxProxy)
  || !/proxy_pass\s+http:\/\/127\.0\.0\.1:3001\s*;/.test(nginxProxy)) throw Error('Trusted proxy topology is not verified');
// Restore only the two switches introduced by the reverted quality release.
// Verified against protected echo-20261101152723-076be33a/upstream-before.json:
// both switches were unset. No process credentials or backup dependency enter Git.
const targetUpstreamFlags = { ENABLE_FLAC: '', FOLLOW_SOURCE_ORDER: '' };
const qualityFlags = env => ({ ENABLE_FLAC: env.ENABLE_FLAC ?? '', FOLLOW_SOURCE_ORDER: env.FOLLOW_SOURCE_ORDER ?? '' });
let upstreamChanged = false;
const originalEgressEnv = Object.fromEntries(['NODE_OPTIONS', 'ECHO_MUSIC_EGRESS_ENABLED', 'ECHO_MUSIC_EGRESS_STATE_FILE', 'ECHO_MUSIC_EGRESS_INTERVAL_MS'].map(key => [key, originalUpstream[key] ?? '']));
function configureEgress(rollback = false) {
  const preload = work + '/music-egress.cjs';
  const env = rollback ? { ...originalEgressEnv, ...qualityFlags(originalUpstream) } : {
    ...targetUpstreamFlags,
    // Replace only our preceding preload; preserve unrelated Node options.
    NODE_OPTIONS: (originalEgressEnv.NODE_OPTIONS.replace(/(?:^|\s)--require=\S*\/music-egress\.cjs(?=\s|$)/g, '').trim() + ' --require=' + preload).trim(),
    ECHO_MUSIC_EGRESS_ENABLED: '1', ECHO_MUSIC_EGRESS_INTERVAL_MS: '1000',
    ECHO_MUSIC_EGRESS_STATE_FILE: musicBase + '/shared/music-egress-state.json'
  };
  execFileSync(pm2, ['restart', 'ncm-api', '--update-env'], { env: { ...process.env, ...env }, stdio: 'inherit' });
}
function stage() {
  if (fs.existsSync(musicRelease) || fs.existsSync(loginRelease)) throw Error('Release already exists; use a new release id');
  const oldSchema = fs.readFileSync(originalLogin.pm_cwd + '/prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n');
  const newSchema = fs.readFileSync(packageDir + '/login/prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n');
  accountMigrations = selectAccountMigrations(packageDir + '/login', oldSchema, newSchema);
  fs.cpSync(packageDir + '/music', musicRelease, { recursive: true });
  fs.cpSync(packageDir + '/login', loginRelease, { recursive: true });
  fs.writeFileSync(musicRelease + '/.env.production', releaseMusicEnv, { mode: 0o600 });
  for (const name of ['.env', '.env.production']) {
    const from = originalLogin.pm_cwd + '/' + name;
    if (!fs.existsSync(from)) continue;
    let env = fs.readFileSync(from, 'utf8');
    if (name === '.env' && !/^DATABASE_URL=/m.test(env)) throw Error('Account database configuration missing');
    env = env.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL="file:' + database + '"');
    env = setEnvValues(env, { AUTH_TRUST_PROXY_HEADERS: 'true' });
    fs.writeFileSync(loginRelease + '/' + name, env, { mode: 0o600 });
  }
  if (fs.existsSync(loginRelease + '/public/uploads')) throw Error('Package must not contain live uploads');
  fs.mkdirSync(loginRelease + '/public', { recursive: true });
  fs.symlinkSync('/www/wwwroot/miningqwqlogin/public/uploads', loginRelease + '/public/uploads', 'dir');
  fs.writeFileSync(musicRelease + '/public/__deployment.json', JSON.stringify({ id: manifest.id, musicCommit: manifest.musicCommit, loginCommit: manifest.loginCommit, createdAt: manifest.createdAt }), { mode: 0o644 });
  const fd = fs.openSync(work + '/build.log', 'a', 0o600);
  try {
    for (const [source, target] of [[originalLogin.pm_cwd, loginRelease], [previousMusic, musicRelease]]) {
      const options = { cwd: target, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', fd, fd] };
      if (fs.existsSync(source + '/node_modules') && lockHash(source + '/package-lock.json') === lockHash(target + '/package-lock.json')) {
        execFileSync('cp', ['-a', '--reflink=auto', source + '/node_modules', target + '/node_modules'], options);
      } else execFileSync(node, [npmCli, 'ci', '--include=dev'], options);
      if (target === loginRelease) execFileSync(node, ['node_modules/prisma/build/index.js', 'generate'], options);
      execFileSync(node, [npmCli, 'run', 'build'], options);
      console.log('LINUX_BUILD_PASSED', target);
    }
  } finally { fs.closeSync(fd); }
}
const candidates = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchLocal = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
function startCandidate(name, cwd, port, env = {}) {
  const active = execFileSync('ss', ['-ltn'], { encoding: 'utf8' });
  if (active.split('\n').some(line => line.includes(':' + port + ' '))) throw Error('Candidate port in use: ' + port);
  const fd = fs.openSync(work + '/' + name + '.log', 'a', 0o600);
  const child = spawn(node, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, NODE_ENV: 'production', ...env } });
  child.unref();
  candidates.push({ pid: child.pid, cwd, port });
}
async function ready(port, login = false) {
  let error;
  for (let i = 0; i < 25; i++) {
    try {
      const response = await fetchLocal('http://127.0.0.1:' + port + (login ? '/api/account/auth/session' : '/'));
      if (response.status !== (login ? 401 : 200)) throw Error('Unexpected response on port ' + port + ': ' + response.status);
      if (login && response.headers.get('set-cookie')) throw Error('Read-only session endpoint writes a cookie');
      return;
    } catch (e) { error = e; await pause(1000); }
  }
  throw error;
}
function pointMusic(target) {
  if (!target.startsWith(musicBase + '/releases/')) throw Error('Unexpected release target');
  const staged = musicBase + '/current.session-next';
  if (fs.existsSync(staged)) throw Error('Release switch already pending');
  fs.symlinkSync(target, staged);
  fs.renameSync(staged, musicBase + '/current');
}
function configureLogin(cwd, rollback = false) {
  const env = { ...(originalLogin.env || {}), NODE_ENV: 'production', PORT: 3002 };
  if (!rollback) { env.DATABASE_URL = 'file:' + database; env.AUTH_TRUST_PROXY_HEADERS = 'true'; }
  const config = { apps: [{ name: 'miningqwqlogin', script: rollback ? originalLogin.pm_exec_path : cwd + '/node_modules/next/dist/bin/next',
    args: rollback ? originalLogin.args : ['start', '--hostname', '127.0.0.1', '--port', '3002'], cwd, interpreter: node, exec_mode: 'fork', instances: 1, env }] };
  const file = work + (rollback ? '/login-rollback.json' : '/login-release.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const current = JSON.parse(execFileSync(pm2, ['jlist'], { encoding: 'utf8' }));
  if (current.some(p => p.name === 'miningqwqlogin')) execFileSync(pm2, ['delete', 'miningqwqlogin'], { stdio: 'inherit' });
  execFileSync(pm2, ['start', file, '--only', 'miningqwqlogin'], { stdio: 'inherit' });
}
function configureMusic(cwd, rollback = false) {
  const env = { ...(originalMusic.env || {}), NODE_ENV: 'production', PORT: 3001 };
  if (!rollback) Object.assign(env, { MUSIC_SOURCE_EGRESS_MANAGED: '1', MUSIC_SOURCE_MAX_CONCURRENT: '8', ACCOUNT_TRUST_PROXY_HEADERS: '1',
    ACCOUNT_PUBLIC_ORIGIN: 'https://echo.miningqwq.cn' });
  const config = { apps: [{ name: 'miningqwqmusic', script: rollback ? originalMusic.pm_exec_path : musicBase + '/current/node_modules/next/dist/bin/next',
    args: rollback ? originalMusic.args : ['start', '--hostname', '127.0.0.1', '--port', '3001'], cwd, interpreter: node, exec_mode: 'fork', instances: 1, env }] };
  const file = work + (rollback ? '/music-rollback.json' : '/music-release.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const current = JSON.parse(execFileSync(pm2, ['jlist'], { encoding: 'utf8' }));
  if (current.some(p => p.name === 'miningqwqmusic')) execFileSync(pm2, ['delete', 'miningqwqmusic'], { stdio: 'inherit' });
  execFileSync(pm2, ['start', file, '--only', 'miningqwqmusic'], { stdio: 'inherit' });
}
let workerStartedAt = 0;
function configureMembershipWorker(cwd, rollback = false) {
  const current = JSON.parse(execFileSync(pm2, ['jlist'], { encoding: 'utf8' }));
  if (current.some(p => p.name === 'miningqwq-membership-worker')) {
    execFileSync(pm2, ['delete', 'miningqwq-membership-worker'], { stdio: 'inherit' });
  }
  if (rollback && !originalWorker) return;
  const source = rollback ? originalWorker : originalLogin;
  const env = { ...(source.env || {}), NODE_ENV: 'production', DATABASE_URL: 'file:' + database };
  const config = { apps: [{ name: 'miningqwq-membership-worker', cwd,
    script: rollback ? originalWorker.pm_exec_path : cwd + '/scripts/membership-worker.mjs',
    interpreter: node, exec_mode: 'fork', instances: 1, kill_timeout: 35000, env }] };
  const file = work + (rollback ? '/worker-rollback.json' : '/worker-release.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  if (!rollback) workerStartedAt = Date.now();
  execFileSync(pm2, ['start', file, '--only', 'miningqwq-membership-worker'], { stdio: 'inherit' });
}
async function readyMembershipWorker() {
  for (let i = 0; i < 20; i++) {
    const heartbeat = execFileSync('/usr/bin/sqlite3', [database,
      'SELECT "workerHeartbeatAt" FROM "MembershipPolicy" WHERE id=1'], { encoding: 'utf8' }).trim();
    // Prisma's SQLite DateTime is stored as milliseconds.
    if (heartbeat && Number.isFinite(Number(heartbeat)) && Number(heartbeat) >= workerStartedAt &&
      Math.abs(Date.now() - Number(heartbeat)) < 30000) {
      console.log('MEMBERSHIP_WORKER_HEARTBEAT_VERIFIED');
      return;
    }
    await pause(1000);
  }
  throw Error('Membership worker heartbeat missing');
}
function verifyLoopbackListeners() {
  const sockets = execFileSync('ss', ['-ltn'], { encoding: 'utf8' }).split('\n');
  for (const port of [3001, 3002]) {
    const listeners = sockets.filter(line => new RegExp(':' + port + '\\s').test(line));
    if (!listeners.length || listeners.some(line => !line.includes('127.0.0.1:' + port + ' '))) throw Error('Public trusted-proxy listener detected: ' + port);
  }
}
function liveAccountQa(origin) {
  if (fs.existsSync(musicBase + '/shared/mail.env')) {
    execFileSync(node, ['scripts/mail-channel.mjs', '--verify'], { cwd: loginRelease, stdio: 'inherit', timeout: 35000 });
    console.log('SMTP_AUTHENTICATION_REGRESSION_PASSED');
  }
  execFileSync(node, [path.join(packageDir, 'ops/verify-login-protection.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 90000 });
  execFileSync(node, [path.join(packageDir, 'ops/verify-account-session.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 150000 });
  execFileSync(node, [path.join(packageDir, 'ops/verify-listen-session.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 90000 });
  execFileSync(node, [path.join(packageDir, 'ops/verify-membership-session.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 90000 });
  execFileSync(node, [path.join(packageDir, 'ops/verify-social-playlist-session.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 120000 });
}
let failed = false;
(async () => {
  stage();
  if (!fs.lstatSync(musicBase + '/current').isSymbolicLink()) throw Error('Unexpected live music path');
  if (!database.startsWith('/www/wwwroot/miningqwqlogin/') || !fs.existsSync(database)) throw Error('Persistent database missing');
  const backup = work;
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  fs.writeFileSync(backup + '/previous-music-release', previousMusic, { mode: 0o600 });
  fs.writeFileSync(backup + '/login-before.json', JSON.stringify(originalLogin), { mode: 0o600 });
  fs.writeFileSync(backup + '/music-before.json', JSON.stringify(originalMusic), { mode: 0o600 });
  fs.writeFileSync(backup + '/upstream-before.json', JSON.stringify(originalUpstream), { mode: 0o600 });
  if (originalWorker) fs.writeFileSync(backup + '/worker-before.json', JSON.stringify(originalWorker), { mode: 0o600 });
  fs.copyFileSync(packageDir + '/ops/music-egress.cjs', work + '/music-egress.cjs');
  execFileSync(node, ['--check', work + '/music-egress.cjs']);
  // Real sockets, fake DNS to loopback only. Never load-test the music provider.
  execFileSync(node, [packageDir + '/ops/verify-music-egress.cjs'], { stdio: 'inherit', timeout: 15000 });
  if (accountMigrations.length) {
    // Online backup includes WAL; application rollback keeps additive tables and new messages.
    execFileSync('/usr/bin/sqlite3', [database, '.backup ' + backup + '/before-account-migrations.db']);
    for (const migration of accountMigrations) {
      execFileSync(node, [migration.script, '--apply'], {
        cwd: loginRelease, env: { ...process.env, DATABASE_URL: 'file:' + database }, stdio: 'inherit'
      });
      console.log('ACCOUNT_MIGRATION_VERIFIED', migration.name);
    }
  }
  upstreamChanged = true;
  configureEgress();
  await ready(3000);
  const policy = await fetchLocal('http://127.0.0.1:3000/');
  if (policy.headers.get('x-echo-egress-policy') !== 'netease-api-v2') throw Error('Actual NetEase egress guard is not installed');
  console.log('MUSIC_EGRESS_INSTALLED', 'netease-api-v2', 'burst=3', 'refill=1000ms', 'maxConcurrent=2');
  startCandidate('candidate-login', loginRelease, 3102);
  startCandidate('candidate-music', musicRelease, 3101, { ACCOUNT_SERVICE_BASE_URL: 'http://127.0.0.1:3102',
    ACCOUNT_PUBLIC_ORIGIN: 'http://127.0.0.1:3101' });
  await ready(3102, true);
  await ready(3101);
  liveAccountQa('http://127.0.0.1:3101');
  let loginChanged = false;
  let musicChanged = false;
  let musicEnvChanged = false;
  let workerChanged = false;
  try {
    if (releaseMusicEnv !== originalMusicEnv) {
      fs.writeFileSync(work + '/music-env-before', originalMusicEnv, { mode: 0o600 });
      musicEnvChanged = true;
      fs.writeFileSync(musicEnvFile, releaseMusicEnv, { mode: 0o600 });
      console.log('MUSIC_RUNTIME_CONFIGURATION_UPDATED');
    }
    loginChanged = true;
    configureLogin(loginRelease);
    await ready(3002, true);
    workerChanged = true;
    configureMembershipWorker(loginRelease);
    await readyMembershipWorker();
    pointMusic(musicRelease);
    musicChanged = true;
    configureMusic(musicBase + '/current');
    await ready(3001);
    verifyLoopbackListeners();
    liveAccountQa('https://echo.miningqwq.cn');
    const receipt = await (await fetchLocal('https://echo.miningqwq.cn/__deployment.json?check=' + manifest.id)).json();
    if (receipt.id !== manifest.id || receipt.musicCommit !== manifest.musicCommit || receipt.loginCommit !== manifest.loginCommit) throw Error('Public release receipt mismatch');
    const homepage = await fetchLocal('https://echo.miningqwq.cn');
    if (homepage.status !== 200 || !(await homepage.text()).includes('<title>Mining唱片行</title>')) throw Error('Public homepage check failed');
    execFileSync(pm2, ['save'], { stdio: 'inherit' });
    fs.writeFileSync(backup + '/deployment-complete', new Date().toISOString(), { mode: 0o600 });
    console.log('PRODUCTION_DEPLOYED', manifest.id);
  } catch (error) {
    console.error('Deployment failed; restoring both original services');
    const recoveryErrors = [];
    try { if (musicEnvChanged) fs.writeFileSync(musicEnvFile, originalMusicEnv, { mode: 0o600 }); } catch (e) { recoveryErrors.push(e.message); }
    try { if (musicChanged) { pointMusic(previousMusic); configureMusic(originalMusic.pm_cwd, true); } } catch (e) { recoveryErrors.push(e.message); }
    try { if (loginChanged) configureLogin(originalLogin.pm_cwd, true); } catch (e) { recoveryErrors.push(e.message); }
    try { if (workerChanged) configureMembershipWorker(originalWorker?.pm_cwd ?? originalLogin.pm_cwd, true); } catch (e) { recoveryErrors.push(e.message); }
    try { execFileSync(pm2, ['save'], { stdio: 'inherit' }); } catch (e) { recoveryErrors.push(e.message); }
    if (recoveryErrors.length) console.error('ROLLBACK_REQUIRES_ATTENTION', recoveryErrors.join('; '));
    throw error;
  }
})().catch(e => {
  failed = true;
  console.error(e.message);
  if (upstreamChanged) {
    try {
      configureEgress(true);
      execFileSync(pm2, ['save'], { stdio: 'inherit' });
    } catch (recoveryError) { console.error('ROLLBACK_REQUIRES_ATTENTION', recoveryError.message); }
  }
  process.exitCode = 1;
}).finally(() => {
  for (const candidate of candidates) {
    try {
      const cwd = fs.realpathSync('/proc/' + candidate.pid + '/cwd');
      const socket = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' }).split('\n').find(line => line.includes(':' + candidate.port + ' '));
      if (cwd !== candidate.cwd || !socket?.includes('pid=' + candidate.pid + ',')) throw Error('Candidate identity mismatch');
      process.kill(candidate.pid, 'SIGTERM');
      console.log('CANDIDATE_STOPPED', candidate.port);
    } catch (e) { console.error('Candidate cleanup:', e.message); }
  }
  fs.writeFileSync(packageDir + '/result.json', JSON.stringify({ id: manifest.id, status: failed ? 'failed' : 'success', finishedAt: new Date().toISOString() }), { mode: 0o644 });
});
