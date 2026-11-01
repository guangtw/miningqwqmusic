export class AppError extends Error {
  readonly code: number;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options?: { code?: number; status?: number; retryable?: boolean; retryAfterSeconds?: number }) {
    super(message);
    this.name = "AppError";
    this.code = options?.code ?? 1000;
    this.status = options?.status ?? 500;
    this.retryable = options?.retryable ?? false;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function isUpstreamBackpressure(error: unknown): error is AppError {
  return error instanceof AppError && [2002, 2004, 2005, 2008].includes(error.code);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(error.message, { code: 1000, status: 500, retryable: false });
  }
  return new AppError("Unexpected unknown error", { code: 1000, status: 500, retryable: false });
}
