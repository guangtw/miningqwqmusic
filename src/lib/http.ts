import { AppError } from "@/src/lib/errors";

type FetchRetryOptions = {
  timeoutMs: number;
  retries: number;
  retryDelayMs?: number;
  retryOnStatus?: number[];
  execute?: <R>(task: () => Promise<R>) => Promise<R>;
  onBackpressure?: (ms: number) => void;
  onTimeout?: () => void;
};

const DEFAULT_RETRY_STATUS = [408, 425, 429, 500, 502, 503, 504];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backpressure(status: number, retryAfter: string | null, options: FetchRetryOptions): never {
  const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
  const dateMs = retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
  const requestedMs = Number.isFinite(seconds) ? seconds * 1000 : dateMs;
  // A missing/zero Retry-After must not allow an immediate new burst.
  const ms = Math.max(60000, Number.isFinite(requestedMs) ? requestedMs : 0);
  options.onBackpressure?.(ms);
  throw new AppError(`Upstream requested a cooldown (${status})`, {
    code: 2002, status: 503, retryable: true, retryAfterSeconds: Math.ceil(ms / 1000)
  });
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
    try {
      const attemptFetch = async () => {
        // Start the network deadline after acquiring a queue slot.
        init.signal?.throwIfAborted();
        const { signal, dispose } = createTimeoutSignal(timeoutMs, init.signal);
        try {
          const response = await fetch(url, { ...init, signal });
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 429 || (response.status === 503 && response.headers.has("retry-after"))) backpressure(response.status, response.headers.get("retry-after"), options);
            throw new AppError(`Upstream responded with status ${response.status}`, {
              code: 2001,
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
            const payload = (await response.json()) as T;
            const code = (payload as { code?: number | string } | null)?.code;
            const message = payload as { msg?: string; message?: string } | null;
            const rateLimited = /频繁|高频|风控|rate.?limit|too many/i.test(String(message?.msg ?? message?.message ?? ""));
            if (Number(code) === 429 || (Number(code) === 503 && (response.headers.has("retry-after") || rateLimited))) backpressure(Number(code), response.headers.get("retry-after"), options);
            if (Number(code) === 503) throw new AppError("Upstream temporarily unavailable", { code: 2001, status: 503, retryable: true });
            return payload;
          } catch (error) {
            if (error instanceof AppError || signal.aborted) throw error;
            throw new AppError("Upstream returned invalid JSON", { code: 2007, status: 502, retryable: false });
          }
        } catch (error) {
          if (signal.aborted && !init.signal?.aborted) {
            // A slow provider is not evidence that every music endpoint is rate limited.
            options.onTimeout?.();
            throw new AppError("Upstream timeout", { code: 2004, status: 504, retryable: true });
          }
          throw error;
        } finally { dispose(); }
      };
      return await (options.execute ? options.execute(attemptFetch) : attemptFetch());
    } catch (error) {
      latestError = error;
      if (init.signal?.aborted) throw error;
      if (attempt >= retries || (error instanceof AppError && (!error.retryable || [2002, 2004, 2008].includes(error.code)))) {
        break;
      }
    }
    if (attempt < retries) await sleep(retryDelayMs * 2 ** attempt * (1 + Math.random() * 0.25));
  }

  if (latestError instanceof AppError) {
    throw latestError;
  }
  if (latestError instanceof Error && latestError.name === "AbortError") {
    throw new AppError("Upstream timeout", { code: 2004, status: 504, retryable: true });
  }
  throw new AppError("Network request failed", { code: 2005, status: 503, retryable: true });
}
