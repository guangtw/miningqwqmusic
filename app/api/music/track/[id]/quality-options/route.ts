import { runMusicRequest } from "@/src/lib/music/request-context";
import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { resolvePlaybackAuthorizationState } from "@/src/lib/music-playback-auth";
import { getTrackQualityAvailability } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";
import type { TrackQualityAvailability } from "@/src/types/music";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(request: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const authorizationState = await resolvePlaybackAuthorizationState(request);
    const canUseUnblock = authorizationState.enabled;
    const authorizationVersion = canUseUnblock ? authorizationState.version : 0;
    const availability = await getTrackQualityAvailability(id);

    const payload: TrackQualityAvailability = {
      ...availability,
      authorizationScope: canUseUnblock ? "authorized" : "guest",
      authorizationVersion
    };
    const response = success(payload, traceId);
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

export function GET(request: Request, context: Context) {
  return runMusicRequest(request, () => handleGET(request, context));
}
