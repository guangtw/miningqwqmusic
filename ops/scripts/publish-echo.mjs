#!/usr/bin/env node
// Release committed source only; never package the developer's .env or SQLite files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const flags = new Set(process.argv.slice(2));
for (const flag of flags) if (!['--push', '--prepare-only', '--reuse-local-deps'].includes(flag)) throw Error('Unknown option: ' + flag);
const loginRoot = path.resolve(process.env.ECHO_LOGIN_REPO || path.join(root, '../MiningQwQLogin'));
const host = 'aliyun-ai';
const origin = 'https://echo.miningqwq.cn';
const run = (bin, args, cwd = root, options = {}) => execFileSync(bin, args, { cwd, stdio: 'inherit', ...options });
const read = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, encoding: 'utf8' }).trim();
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lockHash = file => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const available = (base, names) => names.filter(name => fs.existsSync(path.join(base, name)));
const configs = ['package.json', 'package-lock.json', 'next.config.mjs', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.mjs', '.eslintrc.json'];
const runtime = ['app', 'src', 'public', ...configs];
const loginRuntime = [...runtime, 'prisma/schema.prisma', 'prisma/migrations', 'scripts'];
const checkFiles = ['tests', 'vitest.config.ts', 'vitest.setup.ts', 'playwright.config.ts'];

function committedPaths(repo, names) {
  const tracked = read('git', ['ls-tree', '-r', '--name-only', 'HEAD'], repo).split('\n');
  return names.filter(name => tracked.some(file => file === name || file.startsWith(name + '/')));
}
function exportCommit(repo, prefix, names, stage) {
  const archive = path.join(stage, prefix + '.tar');
  run('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '--prefix=' + prefix + '/', '--output=' + archive, 'HEAD', ...committedPaths(repo, names), ':(exclude)public/uploads'], repo);
  run('tar', ['-xf', archive, '-C', stage]);
}
function copyPaths(from, to, names) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of available(from, names)) fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
}
function fileHashes(base, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(path.join(base, prefix), { withFileTypes: true })) {
    const relative = (prefix ? prefix + '/' : '') + entry.name;
    if (entry.isSymbolicLink()) throw Error('Release source must not contain symlinks: ' + relative);
    if (entry.isDirectory()) Object.assign(out, fileHashes(base, relative));
    else {
      if (/(^|\/)\.env|\.db(?:-|$)|\.pem$|(^|\/)uploads\//.test(relative)) throw Error('Sensitive file in release: ' + relative);
      out[relative] = hash(path.join(base, relative));
    }
  }
  return out;
}
function checkRepo(repo) {
  run('git', ['fetch', 'origin'], repo);
  run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], repo);
  const commit = read('git', ['rev-parse', 'HEAD'], repo);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid commit');
  return commit;
}
function npm(stage, args) {
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(cli)) throw Error('Run this script with npm run deploy:echo');
  run(process.execPath, [cli, ...args], stage, { env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_PORT: '3047', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3047', PLAYWRIGHT_ISOLATED: '1', REFERENCE_BASE_URL: '' } });
}
function dependencies(repo, exported) {
  if (flags.has('--reuse-local-deps')) {
    if (lockHash(path.join(repo, 'package-lock.json')) !== lockHash(path.join(exported, 'package-lock.json'))) throw Error('Local dependencies do not match the committed lockfile');
    if (!fs.existsSync(path.join(repo, 'node_modules'))) throw Error('Local dependencies are missing');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(exported, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  } else npm(exported, ['ci']);
}

let phase = 'transport';
try {
  // Fail before expensive tests if transport or sudo is unavailable.
  if (!flags.has('--prepare-only')) run('ssh', ['-o', 'ConnectTimeout=8', host, 'sudo -n true && echo DEPLOY_TRANSPORT_OK']);
  phase = 'source';
  const musicCommit = checkRepo(root);
  const loginCommit = checkRepo(loginRoot);
  const id = 'echo-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + musicCommit.slice(0, 8);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-publish-'));
  console.log('Release:', id, '\nExact source:', musicCommit, loginCommit, '\nWork directory:', stage);
  const helpers = ['deploy-echo.cjs', 'account-migrations.cjs', 'music-source-config.cjs', 'verify-account-session.cjs', 'verify-listen-session.cjs', 'verify-membership-session.cjs', 'verify-social-playlist-session.cjs', 'run-echo-release.sh'];
  exportCommit(root, 'music', [...runtime, ...checkFiles, ...helpers.map(name => 'ops/scripts/' + name)], stage);
  exportCommit(loginRoot, 'login', [...loginRuntime, ...checkFiles], stage);
  const pack = path.join(stage, 'release');
  copyPaths(path.join(stage, 'music'), path.join(pack, 'music'), runtime);
  copyPaths(path.join(stage, 'login'), path.join(pack, 'login'), loginRuntime);
  fs.mkdirSync(path.join(pack, 'ops'));
  for (const name of helpers) fs.copyFileSync(path.join(stage, 'music/ops/scripts', name), path.join(pack, 'ops', name));
  const manifest = { schema: 1, id, musicCommit, loginCommit, createdAt: new Date().toISOString(), files: fileHashes(pack) };
  fs.writeFileSync(path.join(pack, 'release.json'), JSON.stringify(manifest, null, 2));
  if (!flags.has('--prepare-only')) {
    phase = 'tests';
    dependencies(root, path.join(stage, 'music'));
    dependencies(loginRoot, path.join(stage, 'login'));
    // npm ci does not reliably generate the Prisma client in a clean export.
    // Generate from the exported schema without loading the developer's .env/DB.
    npm(path.join(stage, 'login'), ['exec', '--', 'prisma', 'generate']);
    npm(path.join(stage, 'music'), ['exec', '--', 'tsc', '--noEmit']);
    // Keep file-level DB setup independent without exhausting SQLite/Windows I/O.
    // Tests that intentionally issue concurrent requests still run unchanged.
    npm(path.join(stage, 'login'), ['run', 'test:run', '--', '--fileParallelism=false']);
    npm(path.join(stage, 'music'), ['run', 'test:run', '--', '--fileParallelism=false']);
    npm(path.join(stage, 'music'), ['run', 'test:e2e']);
  }
  const archive = path.join(stage, id + '.tar.gz');
  phase = 'package';
  run('tar', ['-czf', archive, '-C', pack, 'music', 'login', 'ops', 'release.json']);
  const digest = hash(archive);
  fs.writeFileSync(path.join(stage, 'receipt.json'), JSON.stringify({ id, musicCommit, loginCommit, archive, sha256: digest }, null, 2));
  if (flags.has('--prepare-only')) { console.log('PACKAGE_VERIFIED', archive, digest); process.exit(0); }
  const remote = '/home/aiops/releases/' + id;
  phase = 'upload';
  run('ssh', [host, 'mkdir -p ' + remote]);
  run('scp', [archive, host + ':' + remote + '/release.tar.gz']);
  // The transport hash is checked before any release code is extracted/executed.
  run('ssh', [host, 'cd ' + remote + ' && echo "' + digest + '  release.tar.gz" | sha256sum -c - && tar -xzf release.tar.gz && /bin/bash -n ops/run-echo-release.sh && /usr/bin/node --check ops/deploy-echo.cjs && /usr/bin/node --check ops/verify-account-session.cjs && /usr/bin/node --check ops/verify-listen-session.cjs && /usr/bin/node --check ops/verify-membership-session.cjs && /usr/bin/node --check ops/verify-social-playlist-session.cjs && /usr/bin/node --check ops/account-migrations.cjs && (umask 077; nohup /bin/bash ' + remote + '/ops/run-echo-release.sh > job.log 2>&1 < /dev/null & echo DEPLOY_PID=$!)']);
  phase = 'server';
  const deadline = Date.now() + 15 * 60 * 1000;
  let complete = false;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    let result;
    try { result = read('ssh', ['-o', 'ConnectTimeout=8', host, 'test ! -f ' + remote + '/result.json || sudo -n cat ' + remote + '/result.json']); }
    catch { console.log('Cannot read server status over SSH; the detached job continues. Waiting for the next status check.'); }
    if (result) {
      const state = JSON.parse(result);
      if (state.id !== id || state.status !== 'success') throw Error('Server release failed; previous services restored where necessary. Log: ' + remote + '/job.log');
      complete = true;
      break;
    }
    try {
      const probe = await fetch(origin + '/__deployment.json?check=' + id, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const receipt = await probe.json();
      if (receipt.id === id) console.log('New release is serving; awaiting completed server checks.');
    } catch { /* The old release can legitimately have no receipt yet. */ }
    console.log('SERVER_DEPLOYMENT_RUNNING', id);
  }
  if (!complete) throw Error('Timed out waiting for the server result. Do not start a second release; inspect the detached job first: ' + remote);
  phase = 'verify';
  const response = await fetch(origin + '/__deployment.json?check=' + id, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const receipt = await response.json();
  if (!response.ok || receipt.id !== id || receipt.musicCommit !== musicCommit || receipt.loginCommit !== loginCommit) throw Error('Public deployment receipt does not match the requested release');
  console.log('PRODUCTION_VERIFIED', origin, id);
  if (flags.has('--push')) {
    phase = 'github';
    run('git', ['push', 'origin', loginCommit + ':refs/heads/main'], loginRoot);
    run('git', ['push', 'origin', musicCommit + ':refs/heads/main'], root);
    for (const [repo, expected] of [[loginRoot, loginCommit], [root, musicCommit]]) {
      if (read('git', ['ls-remote', 'origin', 'refs/heads/main'], repo).split(/\s/)[0] !== expected) throw Error('GitHub branch verification failed');
    }
    const notes = path.join(stage, 'release-notes.md');
    fs.writeFileSync(notes, `Verified production: ${origin}\n\nMusic/frontend: ${musicCommit}\nAccount service: ${loginCommit}\nArchive SHA-256: ${digest}\n\nThe source archive contains both services and their deployment manifest. Production environment files, uploads, credentials and SQLite databases are excluded.\n`);
    run('gh', ['release', 'create', id, '--repo', 'guangtw/miningqwqmusic', '--target', musicCommit, '--title', id, '--notes-file', notes, archive]);
    console.log('GITHUB_AND_PRODUCTION_VERIFIED');
  }
} catch (error) {
  console.error('RELEASE_FAILED [' + phase + ']:', error.message);
  if (phase === 'transport') console.error('Check the server /32 route and current single-IP firewall rule. Do not change sudo or disable host-key verification.');
  else if (['source', 'tests', 'package', 'upload'].includes(phase)) console.error('This release has not changed production or pushed source.');
  else if (phase === 'github') console.error('Production was verified. Complete the GitHub step using the same commits/package; do not redeploy.');
  else console.error('Inspect the server job/result before starting another release. Only PRODUCTION_VERIFIED confirms a completed deployment.');
  process.exitCode = 1;
}
