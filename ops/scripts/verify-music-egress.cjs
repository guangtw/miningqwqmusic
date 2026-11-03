const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { install } = require('./music-egress.cjs');

(async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push({ at: Date.now(), path: req.url });
    setTimeout(() => res.end(Buffer.alloc(8192)), 15);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const gate = install({ interval: 30, maxConcurrent: 2 });
  const request = (signal, hostname = 'music.163.com', path = '/api/song/detail', headersOnly = false) => new Promise((resolve, reject) => {
    const req = http.get({ hostname, path, port: server.address().port, lookup: (_host, opts, cb) => opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4), signal }, res => {
      if (headersOnly) resolve();
      else { res.resume(); res.once('end', resolve); }
    });
    req.once('error', reject);
  });
  const controller = new AbortController();
  const first = Array.from({ length: 15 }, () => request()); const cancelled = request(controller.signal).catch(error => error);
  controller.abort();
  await Promise.all([...first, cancelled]);
  assert.equal(received.length, 15);
  assert.equal(gate.snapshot().started, 15);
  assert.ok(received[14].at - received[0].at >= 330);
  assert.ok(gate.snapshot().maxActive <= 2);
  // Header-only consumers must not hold an in-flight slot until a hard timeout.
  await Promise.race([
    (async () => { await request(undefined, 'music.163.com', '/api/header-only', true); await request(undefined, 'music.163.com', '/api/header-only', true); await request(undefined, 'music.163.com', '/api/header-only', true); })(),
    new Promise((_, reject) => { const t = setTimeout(() => reject(Error('Header-only transport did not release its slot')), 1000); t.unref(); })
  ]);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(gate.snapshot().active, 0);
  const before = gate.snapshot().started;
  gate.pause('netease', 1000, true);
  await Promise.all([request(undefined, 'qq.example.test'), request(undefined, 'm801.music.126.net'), request(undefined, 'music.163.com', '/static/logo.png')]);
  assert.equal(gate.snapshot().started, before);
  await assert.rejects(request(), { code: 'ECHO_ADMISSION' });
  server.close(); await once(server, 'close');
  console.log('EGRESS_SOCKET_SMOKE_PASSED');
})().catch(error => { console.error(error); process.exit(1); });
