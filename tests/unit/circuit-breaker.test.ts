import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/src/lib/circuit-breaker";
import { AppError } from "@/src/lib/errors";

describe("provider circuit breaker", () => {
  it("does not disable search after unavailable songs", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    const unavailable = () => Promise.reject(new AppError("missing song", { status: 404 }));
    await expect(breaker.execute(unavailable)).rejects.toThrow("missing song");
    await expect(breaker.execute(unavailable)).rejects.toThrow("missing song");
    await expect(breaker.execute(async () => "healthy")).resolves.toBe("healthy");
  });
  it("stops calls during a real upstream outage", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    const upstream = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(breaker.execute(upstream)).rejects.toThrow("offline");
    await expect(breaker.execute(upstream)).rejects.toMatchObject({ code: 2003 });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
