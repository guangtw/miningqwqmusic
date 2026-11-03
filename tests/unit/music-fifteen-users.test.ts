import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MusicRequestCoordinator } from "@/src/lib/music/request-coordinator";
import { musicContext, runMusicRequest, spendRequestBudget } from "@/src/lib/music/request-context";
import { AppError } from "@/src/lib/errors";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const user = <T>(id: string, priority: number, task: () => T, signal?: AbortSignal) =>
  musicContext.run({ owner: id, priority, signal, budget: { remaining: 8 } }, task);

describe("fifteen listeners sharing one upstream", () => {
  it("spaces fifteen different songs without catch-up bursts and bounds in-flight work", async () => {
    const gate = new MusicRequestCoordinator();
    const starts: number[] = []; let active = 0, peak = 0;
    const requests = Array.from({ length: 15 }, (_, i) => user(String(i), 0, () => gate.run(async () => {
      starts.push(Date.now()); peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1500)); active--; return i;
    }, "play")));
    await vi.runAllTimersAsync();
    expect(await Promise.all(requests)).toHaveLength(15);
    expect(peak).toBe(2);
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 1000)).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    const late: number[] = [];
    const next = Array.from({ length: 3 }, () => gate.run(async () => { late.push(Date.now()); }));
    await vi.runAllTimersAsync(); await Promise.all(next);
    expect(late[2] - late[0]).toBeGreaterThanOrEqual(2000);
  });

  it("merges fifteen identical reads and serves stale data during a single refresh", async () => {
    const gate = new MusicRequestCoordinator();
    const task = vi.fn(async () => ({ songs: [1] }));
    const reads = Array.from({ length: 15 }, (_, i) => user(String(i), 1, () => gate.share("detail", task, 1000, 0, 10000)));
    await Promise.all(reads); expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    let release!: (value: { songs: number[] }) => void;
    task.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    expect(await Promise.all(Array.from({ length: 15 }, () => gate.share("detail", task, 1000, 0, 10000))))
      .toEqual(Array.from({ length: 15 }, () => ({ songs: [1] })));
    expect(task).toHaveBeenCalledTimes(2);
    release({ songs: [2] }); await vi.advanceTimersByTimeAsync(0);
    expect(await gate.share("detail", task, 1000, 0, 10000)).toEqual({ songs: [2] });
  });

  it("does not retry a failed background refresh on every stale cache hit", async () => {
    const gate = new MusicRequestCoordinator();
    const task = vi.fn(async () => "old");
    await gate.share("home", task, 1000, 0, 60000);
    await vi.advanceTimersByTimeAsync(1001);
    task.mockRejectedValue(new Error("offline"));
    await gate.share("home", task, 1000, 0, 60000); await vi.advanceTimersByTimeAsync(0);
    await Promise.all(Array.from({ length: 15 }, () => gate.share("home", task, 1000, 0, 60000)));
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keeps shared work for another listener, then cancels after the last subscriber leaves", async () => {
    const gate = new MusicRequestCoordinator({ maxConcurrent: 1 });
    let release!: () => void;
    const blocker = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(0);
    const a = new AbortController(), b = new AbortController();
    const task = vi.fn(() => gate.run(async () => "song"));
    const first = user("a", 0, () => gate.share("same", task), a.signal);
    const firstCheck = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = user("b", 0, () => gate.share("same", task), b.signal);
    await vi.advanceTimersByTimeAsync(0); a.abort(); await firstCheck;
    expect(gate.snapshot().queued).toBe(1);
    release(); await blocker; await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBe("song");
    const c = new AbortController();
    const obsolete = user("c", 0, () => gate.share("obsolete", () => gate.run(async () => "unexpected")), c.signal);
    const cancelled = expect(obsolete).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0); c.abort(); await cancelled;
    await vi.advanceTimersByTimeAsync(1000);
    expect(gate.snapshot().queued).toBe(0);
    expect(gate.snapshot().started).toBe(2);
  });

  it("prioritizes playback while alternating listeners at equal priority", async () => {
    const gate = new MusicRequestCoordinator({ maxConcurrent: 1 }); const order: string[] = [];
    let release!: () => void;
    const blocker = user("a", 0, () => gate.run(() => new Promise<void>(resolve => { release = resolve; })));
    await vi.advanceTimersByTimeAsync(0);
    const queue = [user("background", 3, () => gate.run(async () => { order.push("background"); })),
      user("a", 0, () => gate.run(async () => { order.push("a"); })),
      user("b", 0, () => gate.run(async () => { order.push("b"); }))];
    release(); await blocker; await vi.runAllTimersAsync(); await Promise.all(queue);
    expect(order).toEqual(["b", "a", "background"]);
  });

  it("isolates three endpoint failures while allowing healthy search and playback", async () => {
    const gate = new MusicRequestCoordinator({ minIntervalMs: 0 });
    const fail = () => Promise.reject(new AppError("slow source", { code: 2004, status: 504 }));
    for (let i = 0; i < 3; i++) await expect(gate.run(fail, "unblock:slow")).rejects.toMatchObject({ code: 2004 });
    await expect(gate.run(async () => "blocked", "unblock:slow")).rejects.toMatchObject({ code: 2010 });
    await expect(gate.run(async () => "healthy", "search")).resolves.toBe("healthy");
    await expect(gate.run(async () => "healthy", "unblock:other")).resolves.toBe("healthy");
  });

  it("does not run a burst of recovery probes or reset backoff after one successful request", async () => {
    const gate = new MusicRequestCoordinator();
    expect(gate.rateLimit()).toBe(30); await vi.advanceTimersByTimeAsync(30000);
    let release!: () => void; let started = 0;
    const probe = gate.run(() => { started++; return new Promise<void>(resolve => { release = resolve; }); });
    const queued = gate.run(async () => { started++; });
    await vi.advanceTimersByTimeAsync(5000); expect(started).toBe(1);
    release(); await probe; await vi.runAllTimersAsync(); await queued;
    expect(gate.rateLimit()).toBe(60);
  });

  it("shares a finite attempt budget across nested request work", () => {
    runMusicRequest(new Request("http://local/api/music/track/1/play-url"), () => {
      for (let i = 0; i < 5; i++) spendRequestBudget();
      expect(() => spendRequestBudget()).toThrow("尝试上限");
    });
  });
});
