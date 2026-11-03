import { AppError } from "@/src/lib/errors";
import { musicContext, requestContext, type MusicRequestContext } from "./request-context";

type Options = { maxConcurrent?: number; minIntervalMs?: number; maxQueue?: number; queueTimeoutMs?: number };
type Job = { start: () => void; reject: (error: unknown) => void; context?: MusicRequestContext; enqueuedAt: number;
  scope: string; cleanup: () => void };
type CacheEntry = { value: unknown; error: boolean; expiresAt: number; staleUntil: number; refreshAfter: number };
type Pending = { promise: Promise<unknown>; controller: AbortController; subscribers: number; background: boolean; context: MusicRequestContext };
type Health = { until: number; failures: number[]; recovering: boolean; probe: number; strikes: number; epoch: number };

/** One process-wide budget. Every attempt, including retries, acquires a slot. */
export class MusicRequestCoordinator {
  private active = 0;
  private nextStartAt = 0;
  private wake?: ReturnType<typeof setTimeout>;
  private lastOwner = "";
  private sequence = 0;
  private readonly queue: Job[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly health = new Map<string, Health>();
  private readonly counts = { started: 0, succeeded: 0, failed: 0, cancelled: 0, rejected: 0, cacheHits: 0, staleHits: 0, merged: 0 };
  private readonly options: Required<Options>;

  constructor(options: Options = {}) {
    this.options = { maxConcurrent: 2, minIntervalMs: 1000, maxQueue: 64, queueTimeoutMs: 30000, ...options };
  }
  snapshot() { return { ...this.counts, active: this.active, queued: this.queue.length, pending: this.pending.size }; }
  private state(scope: string) {
    let health = this.health.get(scope);
    if (!health) { health = { until: 0, failures: [], recovering: false, probe: 0, strikes: 0, epoch: 0 }; this.health.set(scope, health); }
    return health;
  }
  private busyError() {
    this.counts.rejected++;
    return new AppError("音乐请求正在排队，请稍后再试。", { code: 2008, status: 503, retryable: true, retryAfterSeconds: 3 });
  }
  private coolingError(scope: string) {
    return new AppError(scope === "*" ? "音乐上游限制了请求频率，请稍后再试。" : "当前音乐接口暂时不可用，请稍后重试。", {
      code: scope === "*" ? 2002 : 2010, status: 503, retryable: true,
      retryAfterSeconds: Math.max(1, Math.ceil((this.state(scope).until - Date.now()) / 1000))
    });
  }
  coolDown(ms: number, scope = "*") {
    const health = this.state(scope);
    health.until = Math.max(health.until, Date.now() + Math.max(1000, ms));
    health.recovering = true;
    health.epoch++;
    for (const job of [...this.queue]) {
      if (scope === "*" || job.scope === scope) this.remove(job, this.coolingError(scope), false);
    }
    this.reschedule();
  }
  rateLimit(ms?: number) {
    const health = this.state("*");
    if (Date.now() - health.until > 600000) health.strikes = 0;
    health.strikes = Math.min(health.strikes + 1, 4);
    const delay = ms ?? Math.min(300000, 30000 * 2 ** (health.strikes - 1));
    this.coolDown(delay);
    return Math.max(1, Math.ceil(delay / 1000));
  }
  peek<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    return hit && !hit.error && hit.staleUntil > Date.now() ? hit.value as T : undefined;
  }

  async share<T>(key: string, task: () => Promise<T>, ttlMs = 0, errorTtlMs = 0, staleMs = 0): Promise<T> {
    const signal = requestContext()?.signal;
    signal?.throwIfAborted();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      this.counts.cacheHits++;
      if (hit.error) throw hit.value;
      return hit.value as T;
    }
    const stale = hit && !hit.error && hit.staleUntil > Date.now();
    if (!stale) this.cache.delete(key);
    let pending = this.pending.get(key);
    if (pending?.controller.signal.aborted) pending = undefined;
    if (stale && hit.refreshAfter > Date.now()) { this.counts.staleHits++; return hit.value as T; }
    if (pending) this.counts.merged++;
    else {
      if (this.pending.size >= 256) {
        if (stale) return hit.value as T;
        throw this.busyError();
      }
      const controller = new AbortController();
      const original = requestContext();
      const context: MusicRequestContext = { priority: original?.priority ?? 1, owner: original?.owner ?? "anonymous",
        budget: original?.budget ?? { remaining: 8 }, signal: controller.signal };
      if (stale) { context.priority = 3; context.budget = { remaining: 8 }; }
      const entry: Pending = { controller, subscribers: 0, background: !!stale, context, promise: Promise.resolve() };
      entry.promise = Promise.resolve().then(() => musicContext.run(context, task)).then(value => {
        const code = (value as { code?: number } | null)?.code;
        if (!controller.signal.aborted && ttlMs > 0 && (code === undefined || code === 0 || code === 200)) this.remember(key, value, false, ttlMs, staleMs);
        return value;
      }, error => {
        if (stale) hit.refreshAfter = Date.now() + Math.max(10000, error instanceof AppError ? (error.retryAfterSeconds ?? 0) * 1000 : 0);
        if (!controller.signal.aborted && errorTtlMs > 0 && error instanceof AppError && error.code === 3002) this.remember(key, error, true, errorTtlMs, 0);
        throw error;
      }).finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
      void entry.promise.catch(() => {});
      pending = entry;
      this.pending.set(key, pending);
    }
    if (stale) { this.counts.staleHits++; return hit.value as T; }
    const context = requestContext();
    if (context) pending.context.priority = Math.min(pending.context.priority, context.priority);
    return this.subscribe<T>(pending, signal);
  }

  private subscribe<T>(entry: Pending, signal?: AbortSignal): Promise<T> {
    entry.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal?.removeEventListener("abort", abort);
        entry.subscribers--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (!entry.subscribers && !entry.background) entry.controller.abort();
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      entry.promise.then(value => { if (finish()) resolve(value as T); }, error => { if (finish()) reject(error); });
    });
  }
  private remember(key: string, value: unknown, error: boolean, ttlMs: number, staleMs: number) {
    if (this.cache.size >= 2048) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { value, error, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + ttlMs + staleMs, refreshAfter: 0 });
  }

  run<T>(task: () => Promise<T>, scope = "default"): Promise<T> {
    const context = requestContext();
    context?.signal?.throwIfAborted();
    for (const key of ["*", scope]) if (Date.now() < this.state(key).until) return Promise.reject(this.coolingError(key));
    if (this.queue.length >= this.options.maxQueue) return Promise.reject(this.busyError());
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.remove(job, context?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => this.remove(job, this.busyError()), this.options.queueTimeoutMs);
      const job: Job = { reject, scope, context, enqueuedAt: Date.now(),
        cleanup: () => { clearTimeout(timer); context?.signal?.removeEventListener("abort", abort); },
        start: () => {
          this.active++;
          this.counts.started++;
          const states = [this.state("*"), this.state(scope)];
          const epochs = states.map(state => state.epoch);
          const ticket = ++this.sequence;
          for (const state of states) if (state.recovering) state.probe = ticket;
          Promise.resolve().then(() => context ? musicContext.run(context, task) : task()).then(value => {
            this.counts.succeeded++;
            states.forEach((state, index) => {
              if (state.epoch === epochs[index] && Date.now() >= state.until) { state.recovering = false; state.failures = []; }
            });
            resolve(value);
          }, error => {
            if (context?.signal?.aborted) this.counts.cancelled++; else this.counts.failed++;
            if (!context?.signal?.aborted && error instanceof AppError && [2001, 2004, 2005, 2006, 2007, 2010].includes(error.code)) {
              const state = this.state(scope);
              state.failures = state.failures.filter(at => Date.now() - at < 30000);
              state.failures.push(Date.now());
              if (state.failures.length >= 3 || state.recovering) this.coolDown(5000, scope);
            }
            reject(error);
          }).finally(() => { for (const state of states) if (state.probe === ticket) state.probe = 0; this.active--; this.pump(); });
        }
      };
      context?.signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  private remove(job: Job, error: unknown, pump = true) {
    const index = this.queue.indexOf(job);
    if (index < 0) return;
    this.queue.splice(index, 1);
    job.cleanup();
    if (job.context?.signal?.aborted) this.counts.cancelled++;
    job.reject(error);
    if (pump) this.reschedule();
  }
  private reschedule() { if (this.wake) clearTimeout(this.wake); this.wake = undefined; this.pump(); }
  private pump() {
    if (this.wake || !this.queue.length || this.active >= this.options.maxConcurrent) return;
    const global = this.state("*");
    if (Date.now() < global.until || (global.recovering && (global.probe || this.active > 0))) return;
    const eligible = this.queue.filter(job => {
      const state = this.state(job.scope);
      return Date.now() >= state.until && (!state.recovering || !state.probe);
    });
    if (!eligible.length) return;
    const delay = this.nextStartAt - Date.now();
    if (delay > 0) { this.wake = setTimeout(() => { this.wake = undefined; this.pump(); }, delay); return; }
    const rank = (job: Job) => Math.max(0, (job.context?.priority ?? 1) - Math.floor((Date.now() - job.enqueuedAt) / 10000));
    eligible.sort((a, b) => rank(a) - rank(b) || Number(a.context?.owner === this.lastOwner) - Number(b.context?.owner === this.lastOwner) || a.enqueuedAt - b.enqueuedAt);
    const job = eligible[0];
    this.queue.splice(this.queue.indexOf(job), 1);
    job.cleanup();
    this.lastOwner = job.context?.owner ?? "";
    this.nextStartAt = Date.now() + this.options.minIntervalMs * (global.recovering ? 2 : 1);
    job.start();
    this.pump();
  }
}

function setting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}
export function getMusicRequestCoordinator(baseUrl: string, apiKey = "") {
  const state = globalThis as typeof globalThis & { __musicRequestCoordinators?: Map<string, MusicRequestCoordinator> };
  const coordinators = state.__musicRequestCoordinators ??= new Map();
  const key = JSON.stringify([baseUrl.replace(/\/$/, ""), apiKey]);
  let coordinator = coordinators.get(key);
  if (!coordinator) {
    coordinator = new MusicRequestCoordinator({ maxConcurrent: setting("MUSIC_SOURCE_MAX_CONCURRENT", 2, 1, 2),
      minIntervalMs: setting("MUSIC_SOURCE_MIN_INTERVAL_MS", 1000, 1000, 5000), maxQueue: setting("MUSIC_SOURCE_MAX_QUEUE", 64, 1, 128),
      queueTimeoutMs: setting("MUSIC_SOURCE_QUEUE_TIMEOUT_MS", 30000, 1000, 60000) });
    coordinators.set(key, coordinator);
    if (process.env.NODE_ENV === "production") {
      const timer = setInterval(() => console.log(JSON.stringify({ event: "music_requests", ...coordinator.snapshot() })), 60000);
      timer.unref();
    }
  }
  return coordinator;
}
