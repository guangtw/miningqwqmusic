import { failure } from "@/src/lib/api-response";
import { runApiRoute } from "@/src/lib/api-route";
import { getSearchAssist } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get("q") ?? "").trim();
  if (!keyword) {
    return failure({
      code: 4001,
      message: "Query parameter q is required",
      traceId: createTraceId(),
      status: 400,
      retryable: false
    });
  }
  return runApiRoute(async () => {
    const assist = await getSearchAssist(keyword);
    return {
      items: assist.suggestions
    };
  });
}

