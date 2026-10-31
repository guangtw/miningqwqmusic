import { AppError } from "@/src/lib/errors";

type FetchRetryOptions = {
  timeoutMs: number;
  retries: number;
  retryDelayMs?: number;
  retryOnStatus?: number[];
};

const DEFAULT_RETRY_STATUS = [408, 425, 429, 500, 502, 503, 504];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal | null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  } };
}

export async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions
): Promise<T> {
  const retries = Number.isFinite(options.retries) ? Math.min(5, Math.max(0, Math.floor(options.retries))) : 0;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 6000;
  const retryOnStatus = options.retryOnStatus ?? DEFAULT_RETRY_STATUS;
  const retryDelayMs = options.retryDelayMs ?? 200;
  let latestError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    init.signal?.throwIfAborted();
    const { signal, dispose } = createTimeoutSignal(timeoutMs, init.signal);
    try {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(`Upstream responded with status ${response.status}`, {
          code: response.status === 429 ? 2002 : 2001,
          status: response.status >= 500 ? 503 : 502,
          retryable: retryOnStatus.includes(response.status)
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        await response.body?.cancel();
        throw new AppError("Upstream response is not JSON", { code: 2006, status: 502, retryable: false });
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AppError("Upstream returned invalid JSON", { code: 2007, status: 502, retryable: false });
      }
    } catch (error) {
      latestError = error;
      if (init.signal?.aborted) throw error;
      if (attempt >= retries || (error instanceof AppError && !error.retryable)) {
        break;
      }
    } finally {
      dispose();
    }
    if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
  }

  if (latestError instanceof AppError) {
    throw latestError;
  }
  if (latestError instanceof Error && latestError.name === "AbortError") {
    throw new AppError("Upstream timeout", { code: 2004, status: 504, retryable: true });
  }
  throw new AppError("Network request failed", { code: 2005, status: 503, retryable: true });
}
