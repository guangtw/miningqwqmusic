import { AppError } from "@/src/lib/errors";

type BreakerState = "closed" | "open";

type CircuitBreakerOptions = {
  failureThreshold?: number;
  coolDownMs?: number;
};

export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = "closed";
  private nextTryAt = 0;
  private readonly failureThreshold: number;
  private readonly coolDownMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.coolDownMs = options?.coolDownMs ?? 7000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() < this.nextTryAt) {
        throw new AppError("Upstream temporarily unavailable", {
          code: 2003,
          status: 503,
          retryable: true
        });
      }
      this.state = "closed";
      this.failures = 0;
    }

    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.state = "open";
        this.nextTryAt = Date.now() + this.coolDownMs;
      }
      throw error;
    }
  }
}
