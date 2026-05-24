import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { searchArtists } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";

export async function GET(request: Request) {
  const traceId = createTraceId();
  try {
    const { searchParams } = new URL(request.url);
    const keyword = (searchParams.get("q") ?? "").trim();
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    if (!keyword) {
      return failure({
        code: 4001,
        message: "Query parameter q is required",
        traceId,
        status: 400,
        retryable: false
      });
    }

    const data = await searchArtists({
      keyword,
      page: Number.isNaN(page) ? 1 : Math.max(1, page),
      pageSize: Number.isNaN(pageSize) ? 20 : Math.min(50, Math.max(1, pageSize))
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
