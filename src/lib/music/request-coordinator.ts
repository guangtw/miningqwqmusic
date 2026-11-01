import { AppError } from "@/src/lib/errors";

type Options = {
  maxConcurrent?: number;
  minIntervalMs?: number;
  maxQueue?: number;
  queueTimeoutMs?: number;
};
type Job = { start: () => void; reject: (error: AppError) => void; timer: ReturnType<typeof setTimeout> };
type CacheEntry = { value: unknown; error: boolean; expiresAt: number };

// One coordinator per upstream in a Node process, shared by Next's route bundles.
// Multiple processes/servers must use a shared limiter before scaling out.
export class MusicRequestCoordinator {
  private active = 0;
  private nextStartAt = 0;
  private coolDownUntil = 0;
  private recovering = false;
  private wake?: ReturnType<typeof setTimeout>;
  private readonly queue: Job[] = [];
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly options: Required<Options>;

  constructor(options: Options = {}) {
    this.options = { maxConcurrent: 2, minIntervalMs: 500, maxQueue: 64, queueTimeoutMs: 25000, ...options };
  }

  private busyError() {
    return new AppError("音乐服务请求较多，请稍后重试。", { code: 2008, status: 503, retryable: true, retryAfterSeconds: 3 });
  }

  private coolingError() {
    return new AppError("音乐上游正在冷却，请稍后再试。", {
      code: 2002, status: 503, retryable: true,
      retryAfterSeconds: Math.max(1, Math.ceil((this.coolDownUntil - Date.now()) / 1000))
    });
  }

  coolDown(ms: number) {
    this.coolDownUntil = Math.max(this.coolDownUntil, Date.now() + ms);
    this.recovering = true;
    if (this.wake) clearTimeout(this.wake);
    this.wake = undefined;
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(this.coolingError());
    }
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

  run<T>(task: () => Promise<T>): Promise<T> {
    if (Date.now() < this.coolDownUntil) return Promise.reject(this.coolingError());
    if (this.queue.length >= this.options.maxQueue) return Promise.reject(this.busyError());
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(job);
          if (index < 0) return;
          this.queue.splice(index, 1);
          reject(this.busyError());
        }, this.options.queueTimeoutMs),
        start: () => {
          this.active += 1;
          Promise.resolve().then(task).then(value => {
            // A pre-cooldown request finishing must not release the recovery gate.
            if (Date.now() >= this.coolDownUntil) this.recovering = false;
            resolve(value);
          }, reject).finally(() => { this.active -= 1; this.pump(); });
        }
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    if (this.wake || !this.queue.length || this.active >= (this.recovering ? 1 : this.options.maxConcurrent)) return;
    if (Date.now() < this.coolDownUntil) return;
    const delay = this.nextStartAt - Date.now();
    if (delay > 0) {
      this.wake = setTimeout(() => { this.wake = undefined; this.pump(); }, delay);
      return;
    }
    const job = this.queue.shift()!;
    clearTimeout(job.timer);
    this.nextStartAt = Date.now() + this.options.minIntervalMs;
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
      maxConcurrent: setting("MUSIC_SOURCE_MAX_CONCURRENT", 2, 1, 8),
      minIntervalMs: setting("MUSIC_SOURCE_MIN_INTERVAL_MS", 500, 100, 5000),
      maxQueue: setting("MUSIC_SOURCE_MAX_QUEUE", 64, 1, 256),
      queueTimeoutMs: setting("MUSIC_SOURCE_QUEUE_TIMEOUT_MS", 25000, 1000, 60000)
    });
    coordinators.set(key, coordinator);
  }
  return coordinator;
}
