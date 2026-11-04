// Explicit operator command: one GitHub fetch per pinned asset, never run on a visitor request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import installer from './install-client-downloads.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = path.join(root, 'src/lib/client-downloads/catalog.json');
const assets = installer.validatedAssets(JSON.parse(fs.readFileSync(manifest, 'utf8')));
const run = (bin, args) => execFileSync(bin, args, { stdio: 'inherit' });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-client-downloads-'));
const remote = '/home/aiops/releases/client-downloads-' + crypto.randomUUID();
run('ssh', ['-o', 'ConnectTimeout=8', 'aliyun-ai', 'sudo -n true && echo DOWNLOAD_TRANSPORT_OK']);
console.log('Local staging:', stage);
try {
  for (const asset of assets) {
    run('gh', ['release', 'download', asset.releaseTag, '--repo', 'guangtw/miningqwqmusic', '--pattern', asset.fileName, '--dir', stage]);
    const file = path.join(stage, asset.fileName);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (fs.statSync(file).size !== asset.size || sha256 !== asset.sha256) throw Error('GitHub asset verification failed: ' + asset.fileName);
    console.log('GITHUB_ASSET_VERIFIED', asset.fileName, sha256);
  }
  fs.copyFileSync(manifest, path.join(stage, 'catalog.json'));
  fs.copyFileSync(path.join(root, 'ops/scripts/install-client-downloads.cjs'), path.join(stage, 'install-client-downloads.cjs'));
  run('ssh', ['aliyun-ai', 'mkdir -m 700 ' + remote]);
  run('scp', [...assets.map(asset => path.join(stage, asset.fileName)), path.join(stage, 'catalog.json'), path.join(stage, 'install-client-downloads.cjs'), 'aliyun-ai:' + remote + '/']);
  run('ssh', ['aliyun-ai', 'sudo -n /www/server/nvm/versions/node/v24.15.0/bin/node ' + remote + '/install-client-downloads.cjs ' + remote]);
  console.log('CLIENT_DOWNLOAD_SYNC_COMPLETE', remote);
} finally {
  // Keep the remote operator stage for audit/recovery; it is outside all public roots.
  fs.rmSync(stage, { recursive: true, force: true });
}
