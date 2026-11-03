import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/src/lib/errors";
import { MusicRequestCoordinator } from "@/src/lib/music/request-coordinator";
import { fetchWithRetry } from "@/src/lib/http";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("music upstream admission", () => {
  it("merges ten cold same-key requests and expires metadata without retaining URLs", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 500 });
    const task = vi.fn(async () => ({ songs: [1] }));
    const requests = Array.from({ length: 10 }, () => gate.share("detail:1", task, 120000));
    await expect(Promise.all(requests)).resolves.toHaveLength(10);
    await gate.share("detail:1", task, 120000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120001);
    await gate.share("detail:1", task, 120000);
    expect(task).toHaveBeenCalledTimes(2);
    await gate.share("url:1", task);
    await gate.share("url:1", task);
    expect(task).toHaveBeenCalledTimes(4);
  });

  it("bounds concurrency to two and spaces all ten different requests", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 500 });
    let active = 0, peak = 0;
    const starts: number[] = [];
    const requests = Array.from({ length: 10 }, () => gate.run(async () => {
      starts.push(Date.now()); active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1200));
      active -= 1;
    }));
    await vi.runAllTimersAsync();
    await Promise.all(requests);
    expect(peak).toBe(2);
    expect(starts).toHaveLength(10);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
  });

  it("rejects an overflowing queue and expires waiting jobs without running them", async () => {
    const gate = new MusicRequestCoordinator({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 1000 });
    let release!: () => void;
    const first = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(0);
    const task = vi.fn(async () => 1);
    const queued = expect(gate.run(task)).rejects.toMatchObject({ code: 2008 });
    await expect(gate.run(task)).rejects.toMatchObject({ code: 2008 });
    await vi.advanceTimersByTimeAsync(1001);
    await queued;
    release(); await first;
    expect(task).not.toHaveBeenCalled();
  });

  it("drops queued work on 429, honors Retry-After and permits only one recovery probe", async () => {
    const gate = new MusicRequestCoordinator({ maxConcurrent: 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 429, headers: { "Retry-After": "120" } }));
    const results = Promise.allSettled(Array.from({ length: 10 }, (_, i) => gate.share(`song:${i}`, () => fetchWithRetry("https://stub.test", {}, {
      timeoutMs: 8000, retries: 2, execute: task => gate.run(task), onBackpressure: ms => gate.rateLimit(ms)
    }))));
    await vi.advanceTimersByTimeAsync(0);
    expect((await results).every(result => result.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(119999);
    await expect(gate.run(async () => 1)).rejects.toMatchObject({ code: 2002 });
    await vi.advanceTimersByTimeAsync(1);
    let release!: () => void;
    const probe = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    const next = vi.fn(async () => 1);
    const queued = gate.run(next);
    await vi.advanceTimersByTimeAsync(1000);
    expect(next).not.toHaveBeenCalled();
    release(); await probe;
    await vi.runAllTimersAsync(); await queued;
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("caches missing songs briefly while releasing rejected in-flight entries", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 500 });
    const task = vi.fn(async () => { throw new AppError("missing", { code: 3002, status: 404 }); });
    await expect(gate.share("song", task, 0, 5000)).rejects.toMatchObject({ code: 3002 });
    await expect(gate.share("song", task, 0, 5000)).rejects.toMatchObject({ code: 3002 });
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    await expect(gate.share("song", task, 0, 5000)).rejects.toMatchObject({ code: 3002 });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not start the fetch timeout while waiting for a slot", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 2000 });
    await gate.run(async () => 1);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    const request = fetchWithRetry("https://stub.test", {}, { timeoutMs: 100, retries: 0, execute: task => gate.run(task) });
    await vi.advanceTimersByTimeAsync(2001);
    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not immediately retry a timeout or disable unrelated metadata", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 0 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    }));
    const request = expect(fetchWithRetry("https://stub.test", {}, {
      timeoutMs: 100, retries: 2, execute: task => gate.run(task), onBackpressure: ms => gate.rateLimit(ms)
    })).rejects.toMatchObject({ code: 2004 });
    await vi.advanceTimersByTimeAsync(101);
    await request;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(gate.run(async () => 1, "metadata")).resolves.toBe(1);
  });
});
