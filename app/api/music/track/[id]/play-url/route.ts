import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource, getTrackQualityAvailability } from "@/src/lib/music/service";
import { getAuthorizationVersion, hasMusicUnblockEntitlement, toPlayQualityLevel, toPlayUnblockMode } from "@/src/lib/music-playback-auth";
import { resolvePlayableQualityFallback } from "@/src/lib/play-quality";
import { createTraceId } from "@/src/lib/trace";
import type { PlayQualityLevel } from "@/src/types/music";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const requestedLevel = toPlayQualityLevel(searchParams.get("level"));
    const requestedUnblockMode = toPlayUnblockMode(searchParams.get("unblockMode"));
    const canUseUnblock = requestedUnblockMode === "force_off" ? false : await hasMusicUnblockEntitlement(request);
    const authorizationVersion = canUseUnblock ? await getAuthorizationVersion(request) : 0;
    const effectiveUnblockMode =
      requestedUnblockMode === "force_off"
        ? "force_off"
        : canUseUnblock
          ? (requestedUnblockMode ?? "force_on")
          : "force_off";
    let effectiveLevel: PlayQualityLevel | undefined = requestedLevel;
    if (requestedLevel) {
      try {
        const availability = await getTrackQualityAvailability(id);
        effectiveLevel = resolvePlayableQualityFallback(requestedLevel, availability.availableLevels) ?? requestedLevel;
      } catch {
        effectiveLevel = requestedLevel;
      }
    }
    const data = await getPlaySource(id, {
      level: effectiveLevel,
      unblockMode: effectiveUnblockMode
    });
    const response = success(
      {
        ...data,
        authorizationScope: canUseUnblock ? ("authorized" as const) : ("guest" as const),
        authorizationVersion
      },
      traceId
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const appError = toAppError(error);
    const response = failure({
      code: appError.code,
      message: appError.message,
      traceId,
      status: appError.status,
      retryable: appError.retryable
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
