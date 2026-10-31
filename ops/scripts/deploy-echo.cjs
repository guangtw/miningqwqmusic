#!/usr/bin/env node
// Invoked through SSH under flock. No migrations, global restarts, or secret output.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
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
const previousMusic = fs.realpathSync(musicBase + '/current');
const database = '/www/wwwroot/miningqwqlogin/prisma/dev.db';
if (!originalLogin || !fs.existsSync(database)) throw Error('Existing account service/database missing');
const work = musicBase + '/shared/deploy-backups/' + manifest.id;
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
process.umask(0o077);
function stage() {
  if (fs.existsSync(musicRelease) || fs.existsSync(loginRelease)) throw Error('Release already exists; use a new release id');
  const oldSchema = fs.readFileSync(originalLogin.pm_cwd + '/prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n');
  if (oldSchema !== fs.readFileSync(packageDir + '/login/prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n')) throw Error('Database schema changed: an explicit migration plan is required before deployment');
  fs.cpSync(packageDir + '/music', musicRelease, { recursive: true });
  fs.cpSync(packageDir + '/login', loginRelease, { recursive: true });
  fs.copyFileSync(musicBase + '/shared/.env.production', musicRelease + '/.env.production');
  for (const name of ['.env', '.env.production']) {
    const from = originalLogin.pm_cwd + '/' + name;
    if (!fs.existsSync(from)) continue;
    let env = fs.readFileSync(from, 'utf8');
    if (name === '.env' && !/^DATABASE_URL=/m.test(env)) throw Error('Account database configuration missing');
    env = env.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL="file:' + database + '"');
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
  if (!rollback) env.DATABASE_URL = 'file:' + database;
  const config = { apps: [{ name: 'miningqwqlogin', script: originalLogin.pm_exec_path, args: originalLogin.args, cwd, interpreter: node, exec_mode: 'fork', instances: 1, env }] };
  const file = work + (rollback ? '/login-rollback.json' : '/login-release.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const current = JSON.parse(execFileSync(pm2, ['jlist'], { encoding: 'utf8' }));
  if (current.some(p => p.name === 'miningqwqlogin')) execFileSync(pm2, ['delete', 'miningqwqlogin'], { stdio: 'inherit' });
  execFileSync(pm2, ['start', file, '--only', 'miningqwqlogin'], { stdio: 'inherit' });
}
function liveAccountQa(origin) {
  execFileSync(node, [path.join(packageDir, 'ops/verify-account-session.cjs'), origin, loginRelease], { stdio: 'inherit', timeout: 150000 });
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
  startCandidate('candidate-login', loginRelease, 3102);
  startCandidate('candidate-music', musicRelease, 3101, { ACCOUNT_SERVICE_BASE_URL: 'http://127.0.0.1:3102' });
  await ready(3102, true);
  await ready(3101);
  liveAccountQa('http://127.0.0.1:3101');
  let loginChanged = false;
  let musicChanged = false;
  try {
    loginChanged = true;
    configureLogin(loginRelease);
    await ready(3002, true);
    pointMusic(musicRelease);
    musicChanged = true;
    execFileSync(pm2, ['restart', 'miningqwqmusic', '--update-env'], { stdio: 'inherit' });
    await ready(3001);
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
    try { if (musicChanged) { pointMusic(previousMusic); execFileSync(pm2, ['restart', 'miningqwqmusic', '--update-env'], { stdio: 'inherit' }); } } catch (e) { recoveryErrors.push(e.message); }
    try { if (loginChanged) configureLogin(originalLogin.pm_cwd, true); } catch (e) { recoveryErrors.push(e.message); }
    try { execFileSync(pm2, ['save'], { stdio: 'inherit' }); } catch (e) { recoveryErrors.push(e.message); }
    if (recoveryErrors.length) console.error('ROLLBACK_REQUIRES_ATTENTION', recoveryErrors.join('; '));
    throw error;
  }
})().catch(e => { failed = true; console.error(e.message); process.exitCode = 1; }).finally(() => {
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
