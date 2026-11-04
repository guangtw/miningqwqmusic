import { runMusicRequest } from "@/src/lib/music/request-context";
import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource } from "@/src/lib/music/service";
import { resolvePlaybackAuthorizationState, toPlayQualityLevel, toPlayUnblockMode } from "@/src/lib/music-playback-auth";
import { createTraceId } from "@/src/lib/trace";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(request: Request, context: Context) {
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
    // Menu metadata must not change playback behavior merely because the menu
    // was opened. The source reports its actual level on this very response.
    const data = await getPlaySource(id, {
      level: requestedLevel,
      unblockMode: effectiveUnblockMode
    });
    const response = success(
      {
        ...data,
        requestedLevel,
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

export function GET(request: Request, context: Context) {
  return runMusicRequest(request, () => handleGET(request, context));
}
