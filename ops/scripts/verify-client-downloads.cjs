const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

async function verifyClientDownloads(origin, catalogFile, { filesOnly = false, full = false } = {}) {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(full ? 120000 : 15000) });
  if (!filesOnly) {
    const response = await request(origin + '/api/downloads');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.code, 0);
    assert.equal(body.data.schemaVersion, 1);
    assert.equal(body.data.platforms.length, catalog.platforms.length);
    for (const platform of catalog.platforms) {
      const actual = body.data.platforms.find(item => item.platform === platform.platform);
      assert.equal(actual.version, platform.version);
      assert.deepEqual(actual.artifacts.map(({ url, downloadUrl, ...asset }) => asset), platform.artifacts);
      for (const variant of [undefined, ...platform.artifacts.map(asset => asset.variant)]) {
        const asset = variant ? platform.artifacts.find(item => item.variant === variant) : platform.artifacts[0];
        const redirect = await request(origin + '/api/downloads/' + platform.platform + (variant ? '?variant=' + variant : ''), { redirect: 'manual' });
        assert.equal(redirect.status, 307);
        assert.equal(redirect.headers.get('location'), '/downloads/clients/' + asset.fileName);
      }
    }
    for (const route of ['macos', 'windows?variant=https://example.test/', 'android?variant=portable']) {
      assert.equal((await request(origin + '/api/downloads/' + route, { redirect: 'manual' })).status, 404);
    }
  }
  // Candidate Next servers do not serve binaries: Nginx owns downloads on the public origin.
  const fileOrigin = 'https://echo.miningqwq.cn';
  for (const asset of catalog.platforms.flatMap(platform => platform.artifacts)) {
    const url = fileOrigin + '/downloads/clients/' + asset.fileName;
    const head = await request(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), asset.size);
    assert.equal(head.headers.get('content-type'), asset.contentType);
    assert.equal(head.headers.get('content-disposition'), `attachment; filename="${asset.fileName}"`);
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.match(head.headers.get('cache-control'), /immutable/);
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    // A tail range exercises actual resume support, beyond only checking the header.
    const start = asset.size - 32;
    const partial = await request(url, { headers: { Range: `bytes=${start}-` } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), `bytes ${start}-${asset.size - 1}/${asset.size}`);
    assert.equal((await partial.arrayBuffer()).byteLength, 32);
    if (full) {
      const response = await request(url);
      assert.equal(response.status, 200);
      const hash = crypto.createHash('sha256');
      let size = 0;
      for await (const chunk of response.body) { size += chunk.length; hash.update(chunk); }
      assert.equal(size, asset.size);
      assert.equal(hash.digest('hex'), asset.sha256);
      console.log('PUBLIC_DOWNLOAD_SHA256_VERIFIED', asset.fileName);
    }
  }
  console.log('CLIENT_DOWNLOADS_VERIFIED', origin, full ? 'full-sha256' : 'head-and-range');
}

module.exports = { verifyClientDownloads };
if (require.main === module) verifyClientDownloads(process.argv[2], process.argv[3], {
  filesOnly: process.argv.includes('--files-only'), full: process.argv.includes('--full'),
}).catch(error => { console.error(error); process.exitCode = 1; });
