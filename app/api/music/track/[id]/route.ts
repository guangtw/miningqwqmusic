import { runMusicRequest } from "@/src/lib/music/request-context";
import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getTrack } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(_: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const data = await getTrack(id);
    return success(data, traceId);
  } catch (error) {
    const appError = toAppError(error);
    return failure({
      code: appError.code,
      message: appError.message,
      traceId,
      status: appError.status,
      retryable: appError.retryable,
      retryAfterSeconds: appError.retryAfterSeconds
    });
  }
}

export function GET(_: Request, context: Context) {
  return runMusicRequest(_, () => handleGET(_, context));
}
