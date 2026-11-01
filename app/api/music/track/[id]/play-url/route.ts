import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource, getCachedTrackQualityAvailability } from "@/src/lib/music/service";
import { resolvePlaybackAuthorizationState, toPlayQualityLevel, toPlayUnblockMode } from "@/src/lib/music-playback-auth";
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
    const authorizationState =
      requestedUnblockMode === "force_off"
        ? { enabled: false, version: 0 }
        : await resolvePlaybackAuthorizationState(request);
    const canUseUnblock = authorizationState.enabled;
    const authorizationVersion = canUseUnblock ? authorizationState.version : 0;
    const effectiveUnblockMode =
      requestedUnblockMode === "force_off"
        ? "force_off"
        : canUseUnblock
          ? (requestedUnblockMode ?? "auto")
          : "force_off";
    let effectiveLevel: PlayQualityLevel | undefined = requestedLevel;
    if (requestedLevel) {
      // Reuse the quality menu's metadata when present; a cold lookup must not
      // delay or fail playback. The native endpoint can downgrade cold requests.
      const availability = getCachedTrackQualityAvailability(id);
      if (availability) effectiveLevel = resolvePlayableQualityFallback(requestedLevel, availability.availableLevels) ?? requestedLevel;
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
      retryable: appError.retryable,
      retryAfterSeconds: appError.retryAfterSeconds
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
