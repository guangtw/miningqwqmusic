export class AppError extends Error {
  readonly code: number;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, options?: { code?: number; status?: number; retryable?: boolean }) {
    super(message);
    this.name = "AppError";
    this.code = options?.code ?? 1000;
    this.status = options?.status ?? 500;
    this.retryable = options?.retryable ?? false;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(error.message, { code: 1000, status: 500, retryable: false });
  }
  return new AppError("Unexpected unknown error", { code: 1000, status: 500, retryable: false });
}
