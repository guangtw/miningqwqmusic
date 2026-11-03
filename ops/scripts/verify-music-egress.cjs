const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { install } = require('./music-egress.cjs');

(async () => {
  const received = [];
  const server = http.createServer((req, res) => { received.push(Date.now()); setTimeout(() => res.end('ok'), 15); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const gate = install({ interval: 30, maxConcurrent: 2 });
  const request = signal => new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'music.163.com', port: server.address().port, lookup: (_host, opts, cb) => opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4), signal }, res => {
      res.resume(); res.once('end', resolve);
    });
    req.once('error', reject);
  });
  const controller = new AbortController();
  const first = Array.from({ length: 15 }, () => request()); const cancelled = request(controller.signal).catch(error => error);
  controller.abort();
  await Promise.all([...first, cancelled]);
  assert.equal(received.length, 15);
  assert.ok(gate.snapshot().minStartIntervalMs >= 30);
  assert.ok(received[14] - received[0] >= 350);
  assert.ok(gate.snapshot().maxActive <= 2);
  server.close(); await once(server, 'close');
  console.log('EGRESS_SOCKET_SMOKE_PASSED');
})().catch(error => { console.error(error); process.exit(1); });
