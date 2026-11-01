import { AppError } from "@/src/lib/errors";

type Options = {
  maxConcurrent?: number;
  minIntervalMs?: number;
  maxQueue?: number;
  queueTimeoutMs?: number;
  burst?: number;
  reservedPlayback?: number;
};
type Admission = { scope?: string; priority?: "playback" | "interactive" | "background" };
type Scope = { until: number; recovering: boolean; active: number };
type Job = { scope: Scope; playback: boolean; rank: number; start: () => void; reject: (error: AppError) => void; timer: ReturnType<typeof setTimeout> };
type CacheEntry = { value: unknown; error: boolean; expiresAt: number };

// One coordinator per upstream in a Node process, shared by Next's route bundles.
// Multiple processes/servers must use a shared limiter before scaling out.
export class MusicRequestCoordinator {
  private active = 0;
  private nonPlaybackActive = 0;
  private tokens: number;
  private lastRefill = Date.now();
  private readonly scopes = new Map<string, Scope>();
  private wake?: ReturnType<typeof setTimeout>;
  private readonly queue: Job[] = [];
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly options: Required<Options>;

  constructor(options: Options = {}) {
    this.options = { maxConcurrent: 4, minIntervalMs: 500, maxQueue: 64, queueTimeoutMs: 15000,
      burst: options.maxConcurrent ?? 4, reservedPlayback: 2, ...options };
    this.tokens = this.options.burst;
  }

  private busyError() {
    return new AppError("音乐服务请求较多，请稍后重试。", { code: 2008, status: 503, retryable: true, retryAfterSeconds: 3 });
  }

  private coolingError(scope: Scope) {
    return new AppError("音乐上游正在冷却，请稍后再试。", {
      code: 2002, status: 503, retryable: true,
      retryAfterSeconds: Math.max(1, Math.ceil((scope.until - Date.now()) / 1000))
    });
  }

  private scope(name: string) {
    let scope = this.scopes.get(name);
    if (!scope) { scope = { until: 0, recovering: false, active: 0 }; this.scopes.set(name, scope); }
    return scope;
  }

  coolDown(ms: number, name = "netease") {
    const scope = this.scope(name);
    scope.until = Math.max(scope.until, Date.now() + ms);
    scope.recovering = true;
    if (this.wake) clearTimeout(this.wake);
    this.wake = undefined;
    for (const job of [...this.queue]) {
      if (job.scope !== scope) continue;
      this.queue.splice(this.queue.indexOf(job), 1);
      clearTimeout(job.timer);
      job.reject(this.coolingError(scope));
    }
    this.pump();
  }

  async share<T>(key: string, task: () => Promise<T>, ttlMs = 0, errorTtlMs = 0): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      if (hit.error) throw hit.value;
      return hit.value as T;
    }
    this.cache.delete(key);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    if (this.pending.size >= 256) throw this.busyError();
    const promise = Promise.resolve().then(task).then(value => {
      // Never persist signed playback URLs; callers use ttl=0 for those paths.
      const code = (value as { code?: number } | null)?.code;
      if (ttlMs > 0 && (code === undefined || code === 0 || code === 200)) this.remember(key, value, false, ttlMs);
      return value;
    }, error => {
      if (errorTtlMs > 0 && error instanceof AppError && error.code === 3002) this.remember(key, error, true, errorTtlMs);
      throw error;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private remember(key: string, value: unknown, error: boolean, ttlMs: number) {
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { value, error, expiresAt: Date.now() + ttlMs });
  }

  peek<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    return hit && !hit.error && hit.expiresAt > Date.now() ? hit.value as T : undefined;
  }

  run<T>(task: () => Promise<T>, admission: Admission = {}): Promise<T> {
    const scope = this.scope(admission.scope ?? "netease");
    if (Date.now() < scope.until) return Promise.reject(this.coolingError(scope));
    if (this.queue.length >= this.options.maxQueue) return Promise.reject(this.busyError());
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        scope, playback: admission.priority === "playback",
        rank: admission.priority === "playback" ? 0 : admission.priority === "background" ? 2 : 1,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(job);
          if (index < 0) return;
          this.queue.splice(index, 1);
          reject(this.busyError());
          this.pump();
        }, this.options.queueTimeoutMs),
        start: () => {
          this.active += 1;
          scope.active += 1;
          if (!job.playback) this.nonPlaybackActive += 1;
          const startedAt = Date.now();
          Promise.resolve().then(task).then(value => {
            if (startedAt >= scope.until) scope.recovering = false;
            resolve(value);
          }, reject).finally(() => {
            this.active -= 1; scope.active -= 1;
            if (!job.playback) this.nonPlaybackActive -= 1;
            this.pump();
          });
        }
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    if (this.wake || !this.queue.length || this.active >= this.options.maxConcurrent) return;
    const nonPlaybackLimit = Math.max(1, this.options.maxConcurrent - this.options.reservedPlayback);
    const job = this.queue.filter(job => Date.now() >= job.scope.until && (!job.scope.recovering || job.scope.active === 0)
      && (job.playback || this.nonPlaybackActive < nonPlaybackLimit)).sort((a, b) => a.rank - b.rank)[0];
    if (!job) return;
    const now = Date.now();
    this.tokens = this.options.minIntervalMs === 0 ? this.options.burst
      : Math.min(this.options.burst, this.tokens + (now - this.lastRefill) / this.options.minIntervalMs);
    this.lastRefill = now;
    const delay = this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) * this.options.minIntervalMs);
    if (delay > 0) {
      this.wake = setTimeout(() => { this.wake = undefined; this.pump(); }, delay);
      return;
    }
    this.queue.splice(this.queue.indexOf(job), 1);
    clearTimeout(job.timer);
    this.tokens -= 1;
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
    coordinator = new MusicRequestCoordinator({
      maxConcurrent: setting("MUSIC_SOURCE_MAX_CONCURRENT", 4, 1, 8),
      minIntervalMs: setting("MUSIC_SOURCE_MIN_INTERVAL_MS", 500, 100, 5000),
      maxQueue: setting("MUSIC_SOURCE_MAX_QUEUE", 64, 1, 256),
      queueTimeoutMs: setting("MUSIC_SOURCE_QUEUE_TIMEOUT_MS", 15000, 1000, 60000),
      burst: setting("MUSIC_SOURCE_BURST", 4, 1, 8)
    });
    coordinators.set(key, coordinator);
  }
  return coordinator;
}
