import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { EgressGate, scopeOf } = createRequire(import.meta.url)("../../ops/scripts/music-egress.cjs");
afterEach(() => vi.useRealTimers());

it("limits fifteen nested transport requests, including retries and redirects", async () => {
  vi.useFakeTimers();
  const gate = new EgressGate(); const starts: number[] = [];
  const work = Array.from({ length: 15 }, () => gate.run(async () => { starts.push(Date.now()); await new Promise(resolve => setTimeout(resolve, 1500)); }));
  await vi.runAllTimersAsync(); await Promise.all(work);
  expect(starts.slice(1).every((at, i) => at - starts[i] >= 1000)).toBe(true);
  expect(gate.snapshot().maxActive).toBe(2);
});

it("applies rate limits to the affected destination and admits one recovery probe", async () => {
  vi.useFakeTimers(); const gate = new EgressGate();
  gate.pause("netease", 5000, true);
  await expect(gate.run(async () => 1)).rejects.toMatchObject({ code: "ECHO_ADMISSION" });
  await expect(gate.run(async () => 1, { scope: scopeOf("another.example.test") })).resolves.toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  let release!: () => void; const next = vi.fn();
  const probe = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
  const queued = gate.run(next); await vi.advanceTimersByTimeAsync(3000);
  expect(next).not.toHaveBeenCalled(); release(); await probe; await vi.runAllTimersAsync(); await queued;
  expect(next).toHaveBeenCalledOnce();
});

it("enforces admission on actual HTTP sockets and drops cancelled queued transports", async () => {
  const result = await promisify(execFile)(process.execPath, ["tests/fixtures/music-egress-smoke.cjs"], { cwd: process.cwd(), timeout: 15000 });
  expect(result.stdout).toContain("EGRESS_SOCKET_SMOKE_PASSED");
});

it("retains rate-limit deadlines across process restarts without retaining credentials", async () => {
  vi.useFakeTimers();
  const directory = mkdtempSync(join(tmpdir(), "echo-egress-test-"));
  const stateFile = join(directory, "state.json");
  try {
    const gate = new EgressGate({ stateFile }); gate.pause("netease", 120000, true);
    const restored = new EgressGate({ stateFile });
    await expect(restored.run(async () => "unexpected")).rejects.toMatchObject({ code: "ECHO_ADMISSION" });
    expect(JSON.parse(readFileSync(stateFile, "utf8")).cooldowns[0]).toEqual(["netease", Date.now() + 120000, 1, true]);
    await vi.advanceTimersByTimeAsync(120000);
    await expect(restored.run(async () => "healthy")).resolves.toBe("healthy");
  } finally { unlinkSync(stateFile); rmdirSync(directory); }
});
