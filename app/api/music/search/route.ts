import { boundedInteger } from "@/src/lib/api-pagination";
import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { searchTracks } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";

export async function GET(request: Request) {
  const traceId = createTraceId();
  try {
    const { searchParams } = new URL(request.url);
    const keyword = (searchParams.get("q") ?? "").trim();
    const page = boundedInteger(searchParams.get("page"), 1, 10000);
    const pageSize = boundedInteger(searchParams.get("pageSize"), 20, 50);

    if (!keyword) {
      return failure({
        code: 4001,
        message: "Query parameter q is required",
        traceId,
        status: 400,
        retryable: false
      });
    }

    const data = await searchTracks({
      keyword,
      page,
      pageSize
    });
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
