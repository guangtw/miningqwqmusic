import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const data = await getPlaySource(id);
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
