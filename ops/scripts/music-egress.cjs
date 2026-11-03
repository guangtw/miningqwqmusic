// Loaded in ncm-api before app.js. Admission happens before socket assignment,
// including nested plugin requests, redirects and retries through node:http(s).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const waitError = (seconds = 3) => Object.assign(new Error('Music upstream admission deferred'), { code: 'ECHO_ADMISSION', retryAfter: seconds });
const scopeOf = hostname => /(^|\.)music\.163\.com$|(^|\.)music\.126\.net$/.test(hostname)
  ? 'netease' : 'source:' + crypto.createHash('sha256').update(hostname).digest('hex').slice(0, 12);

class EgressGate {
  constructor(options = {}) {
    this.interval = options.interval ?? 1000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.timeout = options.queueTimeout ?? 30000;
    this.stateFile = options.stateFile;
    this.active = 0; this.nextStart = 0; this.queue = []; this.health = new Map(); this.lastOwner = ''; this.sequence = 0;
    this.counts = { started: 0, completed: 0, failed: 0, cancelled: 0, rejected: 0, rateLimited: 0, waitMs: 0, maxActive: 0, lastStartAt: 0, minStartIntervalMs: null };
    if (this.stateFile && fs.existsSync(this.stateFile)) {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (saved.schema !== 1 || !Array.isArray(saved.cooldowns)) throw Error('Invalid music egress state');
      this.nextStart = Math.max(Date.now(), Number(saved.nextStart) || 0);
      for (const [key, until, strikes, limited] of saved.cooldowns) {
        if (/^(netease|source:[a-f0-9]{12})$/.test(key) && Number.isFinite(until) && until > Date.now()) {
          this.health.set(key, { until, strikes: bounded(strikes, 0, 0, 5), failures: [], recovery: true, probing: 0, epoch: 0, limited: limited === true });
        }
      }
    }
  }
  state(scope) {
    if (!this.health.has(scope)) {
      if (this.health.size >= 256) throw waitError();
      this.health.set(scope, { until: 0, strikes: 0, failures: [], recovery: false, probing: 0, epoch: 0 });
    }
    return this.health.get(scope);
  }
  save() {
    if (!this.stateFile) return true;
    const data = { schema: 1, nextStart: this.nextStart, cooldowns: [...this.health].filter(([, h]) => h.until > Date.now()).map(([k, h]) => [k, h.until, h.strikes, h.limited === true]) };
    try {
      fs.writeFileSync(this.stateFile + '.tmp', JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(this.stateFile + '.tmp', this.stateFile);
      return true;
    } catch {
      if (!this.storageFailed) console.error(JSON.stringify({ event: 'music_egress_storage_failed' }));
      this.storageFailed = true;
      for (const job of [...this.queue]) this.remove(job, waitError(60));
      return false;
    }
  }
  pause(scope, ms, limited = false) {
    const state = this.state(scope);
    const alreadyLimited = state.limited && state.until > Date.now();
    if (limited) {
      if (Date.now() - state.until > 600000) state.strikes = 0;
      state.strikes = Math.min(5, state.strikes + 1); this.counts.rateLimited++;
    }
    state.until = Math.max(state.until, Date.now() + (ms ?? Math.min(300000, 30000 * 2 ** Math.max(0, state.strikes - 1))));
    state.recovery = true; state.epoch++; state.limited = limited || alreadyLimited;
    this.save();
    for (const job of [...this.queue]) if (job.scope === scope) this.remove(job, waitError(Math.ceil((state.until - Date.now()) / 1000)));
    this.schedule();
  }
  run(task, options = {}) {
    const { scope = 'netease', priority = 1, owner = '', signal } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const health = this.state(scope);
    if (this.storageFailed || health.until > Date.now() || this.queue.length >= 64) { this.counts.rejected++; return Promise.reject(waitError()); }
    return new Promise((resolve, reject) => {
      const job = { task, scope, priority, owner, signal, resolve, reject, at: Date.now() };
      job.abort = () => { this.counts.cancelled++; this.remove(job, signal.reason); };
      job.timer = setTimeout(() => { this.counts.rejected++; this.remove(job, waitError()); }, this.timeout);
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.pump();
    });
  }
  remove(job, error) {
    const index = this.queue.indexOf(job);
    if (index < 0) return;
    this.queue.splice(index, 1); this.cleanup(job); job.reject(error); this.schedule();
  }
  cleanup(job) { clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort); }
  schedule() { clearTimeout(this.wake); this.wake = undefined; this.pump(); }
  pump() {
    if (this.storageFailed || this.wake || this.active >= this.maxConcurrent) return;
    const candidates = this.queue.filter(job => {
      const state = this.state(job.scope);
      return state.until <= Date.now() && (!state.recovery || !state.probing);
    });
    if (!candidates.length) return;
    if (this.nextStart > Date.now()) { this.wake = setTimeout(() => { this.wake = undefined; this.pump(); }, this.nextStart - Date.now()); return; }
    const rank = job => Math.max(0, job.priority - Math.floor((Date.now() - job.at) / 10000));
    candidates.sort((a, b) => rank(a) - rank(b) || Number(a.owner === this.lastOwner) - Number(b.owner === this.lastOwner) || a.at - b.at);
    const job = candidates[0];
    this.queue.splice(this.queue.indexOf(job), 1); this.cleanup(job);
    const state = this.state(job.scope), epoch = state.epoch;
    const ticket = ++this.sequence;
    state.probing = ticket;
    this.active++; this.counts.started++; this.counts.waitMs += Date.now() - job.at;
    if (this.counts.lastStartAt) this.counts.minStartIntervalMs = Math.min(this.counts.minStartIntervalMs ?? Infinity, Date.now() - this.counts.lastStartAt);
    this.counts.lastStartAt = Date.now();
    this.counts.maxActive = Math.max(this.counts.maxActive, this.active);
    this.lastOwner = job.owner;
    this.nextStart = Date.now() + this.interval * (state.recovery ? 2 : 1);
    if (!this.save()) { this.active--; state.probing = 0; job.reject(waitError(60)); return; }
    Promise.resolve().then(job.task).then(value => {
      this.counts.completed++;
      if (state.epoch === epoch) { state.recovery = false; state.failures = []; }
      job.resolve(value);
    }, error => {
      const reason = job.signal?.reason;
      const cancelled = job.signal?.aborted && (reason?.name === 'AbortError' || ['ABORT_ERR', 'ERR_CANCELED'].includes(reason?.code));
      if (cancelled) this.counts.cancelled++; else this.counts.failed++;
      if (!cancelled && error?.code !== 'ECHO_ADMISSION') {
        state.failures = state.failures.filter(at => Date.now() - at < 30000);
        state.failures.push(Date.now());
        if (state.failures.length >= 3 || state.recovery) this.pause(job.scope, 5000);
      }
      job.reject(error);
    }).finally(() => { this.active--; if (state.probing === ticket) state.probing = 0; this.pump(); });
    this.pump();
  }
  snapshot() { return { ...this.counts, active: this.active, queued: this.queue.length, cooldowns: [...this.health].filter(([, h]) => h.until > Date.now()).length }; }
}

function install(options = {}) {
  const context = new AsyncLocalStorage();
  const gate = new EgressGate(options);
  const seen = new WeakSet();
  const originalAdd = http.Agent.prototype.addRequest;
  const addRequest = function (req, ...args) {
    const settings = args[0] || {};
    const hostname = String(settings.hostname || settings.host || '').replace(/:\d+$/, '');
    if (seen.has(req) || /^(localhost|127\.0\.0\.1|::1)$/.test(hostname)) return originalAdd.call(this, req, ...args);
    seen.add(req);
    const scope = scopeOf(hostname), ctx = context.getStore();
    if (ctx && ctx.budget-- <= 0) { queueMicrotask(() => req.onSocket(null, waitError())); return; }
    const controller = new AbortController();
    let admitted = false;
    const originalDestroy = req.destroy;
    req.destroy = function (error) {
      originalDestroy.call(this, error);
      if (!controller.signal.aborted) controller.abort(error || Object.assign(new Error('Request cancelled'), { code: 'ABORT_ERR' }));
      return this;
    };
    const abort = () => controller.abort(Object.assign(new Error('Caller disconnected'), { code: 'ABORT_ERR' }));
    ctx?.signal.addEventListener('abort', abort, { once: true });
    if (ctx?.signal.aborted) abort();
    const closed = () => { if (!req.res?.complete && !controller.signal.aborted) controller.abort(new Error('Request closed')); };
    req.once('close', closed);
    const destroy = () => originalDestroy.call(req, Object.assign(new Error('Music request cancelled'), { code: 'ABORT_ERR' }));
    controller.signal.addEventListener('abort', destroy, { once: true });
    void gate.run(() => new Promise((resolve, reject) => {
      if (req.destroyed || controller.signal.aborted) return reject(Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' }));
      // This hard deadline destroys the real transport, not just the BFF waiter.
      const timer = setTimeout(() => req.destroy(Object.assign(new Error('Music upstream transport timeout'), { code: 'ETIMEDOUT' })), 15000);
      let settled = false;
      let transportError;
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      req.once('error', error => { transportError = error; });
      req.once('close', () => finish(transportError || (req.res?.complete ? undefined : new Error('Transport closed'))));
      req.once('response', res => {
        const retry = res.headers['retry-after'];
        const seconds = retry && /^\d+$/.test(String(retry)) ? Number(retry) : undefined;
        const ms = seconds !== undefined ? Math.max(1000, seconds * 1000) : retry ? Math.max(1000, Date.parse(String(retry)) - Date.now()) : undefined;
        if (res.statusCode === 429) gate.pause(scope, Number.isFinite(ms) ? ms : undefined, true);
        else if (res.statusCode === 503 && Number.isFinite(ms)) gate.pause(scope, ms);
        res.once('end', () => finish(res.statusCode >= 500 ? new Error('Upstream server error') : undefined));
        res.once('error', error => { transportError = error; req.destroy(error); });
      });
      admitted = true;
      if (ctx) context.run(ctx, () => originalAdd.call(this, req, ...args));
      else originalAdd.call(this, req, ...args);
    }), { scope, priority: ctx?.priority ?? 1, owner: ctx?.owner ?? '', signal: controller.signal })
      .catch(error => {
        if (!admitted) req.onSocket(null, error);
        else if (!req.destroyed) originalDestroy.call(req, error);
      })
      .finally(() => { req.destroy = originalDestroy; ctx?.signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', destroy); req.removeListener('close', closed); });
  };
  http.Agent.prototype.addRequest = addRequest;
  // HTTPS Agent inherits addRequest, as do the keep-alive agents used by ncm-api.
  if (Object.hasOwn(https.Agent.prototype, 'addRequest')) throw Error('Unsupported HTTPS Agent implementation');
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event !== 'request') return originalEmit.call(this, event, ...args);
    const [req, res] = args;
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    const priority = bounded(req.headers['x-echo-priority'], 1, 0, 3);
    const owner = /^[a-f0-9]{16}$/.test(req.headers['x-echo-owner'] || '') ? req.headers['x-echo-owner']
      : crypto.createHash('sha256').update(String(req.socket.remoteAddress || '')).digest('hex').slice(0, 12);
    const writeHead = res.writeHead;
    res.writeHead = function (...headArgs) {
      const netease = gate.state('netease');
      if (Number(headArgs[0]) === 429 && !(netease.limited && netease.until > Date.now())) gate.pause('netease', undefined, true);
      if (Number(headArgs[0]) >= 400 && netease.limited && netease.until > Date.now()) {
        res.setHeader('x-echo-rate-limited', 'netease');
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((netease.until - Date.now()) / 1000))));
      }
      return writeHead.apply(this, headArgs);
    };
    return context.run({ priority, owner, budget: 8, signal: controller.signal }, () => originalEmit.call(this, event, ...args));
  };
  const timer = setInterval(() => console.log(JSON.stringify({ event: 'music_egress', ...gate.snapshot() })), 60000);
  timer.unref();
  console.log(JSON.stringify({ event: 'music_egress_installed', intervalMs: gate.interval, maxConcurrent: gate.maxConcurrent }));
  return gate;
}

module.exports = { EgressGate, scopeOf, install };
if (process.env.ECHO_MUSIC_EGRESS_ENABLED === '1') {
  const key = Symbol.for('echo.music.egress');
  if (!globalThis[key]) globalThis[key] = install({
    interval: bounded(process.env.ECHO_MUSIC_EGRESS_INTERVAL_MS, 1000, 1000, 5000), maxConcurrent: 2,
    stateFile: process.env.ECHO_MUSIC_EGRESS_STATE_FILE || path.join(process.cwd(), '.echo-egress-state.json')
  });
}
