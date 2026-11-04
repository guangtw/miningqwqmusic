// Install only pinned public binaries. Never place environment/configuration files in the download directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const directory = '/www/wwwroot/miningqwqmusic/shared/client-downloads';
const extension = '/www/server/panel/vhost/nginx/extension/www.echo.miningqwq.cn';
const nginx = '/www/server/nginx/sbin/nginx';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function validatedAssets(catalog) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.platforms) || !catalog.platforms.length) throw Error('Invalid download catalog');
  const names = new Set();
  return catalog.platforms.flatMap(platform => {
    if (!['windows', 'android'].includes(platform.platform) || !/^(windows|android)-v\d+\.\d+\.\d+$/.test(platform.releaseTag)
      || !Array.isArray(platform.artifacts) || !platform.artifacts.length) throw Error('Invalid download platform');
    return platform.artifacts.map(asset => {
      if (!/^MiningQwQMusic-[A-Za-z0-9.-]+\.(exe|apk)$/.test(asset.fileName) || names.has(asset.fileName)
        || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || !['application/vnd.microsoft.portable-executable', 'application/vnd.android.package-archive'].includes(asset.contentType)) {
        throw Error('Invalid download artifact');
      }
      names.add(asset.fileName);
      return { ...asset, releaseTag: platform.releaseTag };
    });
  });
}

function nginxLocation(asset) {
  return `# Managed by install-client-downloads.cjs; keep old versioned files available.\nlocation = /downloads/clients/${asset.fileName} {\n    alias ${directory}/${asset.fileName};\n    types {}\n    default_type ${asset.contentType};\n    add_header Content-Disposition 'attachment; filename="${asset.fileName}"';\n    add_header Cache-Control "public, max-age=31536000, immutable";\n    add_header X-Content-Type-Options nosniff always;\n    add_header Strict-Transport-Security "max-age=31536000" always;\n    etag on;\n    max_ranges 1;\n}\n`;
}

function install(stage) {
  if (process.getuid?.() !== 0) throw Error('Use authorized sudo');
  if (!/^\/home\/aiops\/releases\/client-downloads-[a-zA-Z0-9-]+$/.test(stage) || fs.realpathSync(stage) !== stage) throw Error('Unexpected download stage');
  const assets = validatedAssets(JSON.parse(fs.readFileSync(path.join(stage, 'catalog.json'), 'utf8')));
  // Verify the entire transfer before making any public changes.
  for (const asset of assets) {
    const file = path.join(stage, asset.fileName);
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size !== asset.size || digest(file) !== asset.sha256) throw Error('Transferred file differs: ' + asset.fileName);
    const target = path.join(directory, asset.fileName);
    if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || digest(target) !== asset.sha256)) throw Error('Refusing to replace immutable file: ' + asset.fileName);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
  fs.mkdirSync(extension, { recursive: true, mode: 0o755 });
  const previous = new Map();
  try {
    for (const asset of assets) {
      const target = path.join(directory, asset.fileName);
      if (!fs.existsSync(target)) {
        const next = target + '.incoming';
        fs.copyFileSync(path.join(stage, asset.fileName), next);
        fs.chmodSync(next, 0o644);
        fs.renameSync(next, target);
      }
      const config = path.join(extension, 'echo-client-' + asset.fileName + '.conf');
      previous.set(config, fs.existsSync(config) ? fs.readFileSync(config) : null);
      fs.writeFileSync(config, nginxLocation(asset), { mode: 0o644 });
    }
    execFileSync(nginx, ['-t'], { stdio: 'inherit' });
    execFileSync(nginx, ['-s', 'reload'], { stdio: 'inherit' });
    console.log('CLIENT_DOWNLOAD_FILES_INSTALLED', assets.length);
  } catch (error) {
    for (const [config, content] of previous) {
      if (content === null) fs.unlinkSync(config);
      else fs.writeFileSync(config, content);
    }
    execFileSync(nginx, ['-t'], { stdio: 'inherit' });
    execFileSync(nginx, ['-s', 'reload'], { stdio: 'inherit' });
    throw error;
  }
}

module.exports = { validatedAssets, nginxLocation };
if (require.main === module) install(path.resolve(process.argv[2] || ''));
