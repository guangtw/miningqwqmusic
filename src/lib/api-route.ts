import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { createTraceId } from "@/src/lib/trace";

export async function runApiRoute<T>(runner: () => Promise<T>) {
  const traceId = createTraceId();
  try {
    const data = await runner();
    return success(data, traceId);
  } catch (error) {
    const appError = toAppError(error);
    return failure({
      code: appError.code,
      message: appError.message,
      traceId,
      status: appError.status,
      retryable: appError.retryable
    });
  }
}
