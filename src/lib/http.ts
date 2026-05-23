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

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

export async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions
): Promise<T> {
  const retries = Math.max(0, options.retries);
  const retryOnStatus = options.retryOnStatus ?? DEFAULT_RETRY_STATUS;
  const retryDelayMs = options.retryDelayMs ?? 200;
  let latestError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, dispose } = createTimeoutSignal(options.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        if (retryOnStatus.includes(response.status) && attempt < retries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new AppError(`Upstream responded with status ${response.status}`, {
          code: response.status === 429 ? 2002 : 2001,
          status: response.status >= 500 ? 503 : 502,
          retryable: response.status >= 500 || response.status === 429
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new AppError("Upstream response is not JSON", { code: 2006, status: 502, retryable: false });
      }
      return (await response.json()) as T;
    } catch (error) {
      latestError = error;
      if (attempt >= retries) {
        break;
      }
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      dispose();
    }
  }

  if (latestError instanceof AppError) {
    throw latestError;
  }
  if (latestError instanceof Error && latestError.name === "AbortError") {
    throw new AppError("Upstream timeout", { code: 2004, status: 504, retryable: true });
  }
  throw new AppError("Network request failed", { code: 2005, status: 503, retryable: true });
}
