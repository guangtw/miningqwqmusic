import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getAuthorizationVersion, hasMusicUnblockEntitlement, PLAY_QUALITY_LEVELS } from "@/src/lib/music-playback-auth";
import { getPlaySource } from "@/src/lib/music/service";
import { resolvePlayableQualityFallback, sortPlayQualityLevels } from "@/src/lib/play-quality";
import { createTraceId } from "@/src/lib/trace";
import type { PlayQualityLevel, TrackQualityAvailability } from "@/src/types/music";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const canUseUnblock = await hasMusicUnblockEntitlement(request);
    const authorizationVersion = canUseUnblock ? await getAuthorizationVersion(request) : 0;
    const effectiveUnblockMode = canUseUnblock ? "force_on" : "force_off";

    const discoveredLevels: PlayQualityLevel[] = [];

    for (const requestedLevel of PLAY_QUALITY_LEVELS) {
      try {
        const source = await getPlaySource(id, {
          level: requestedLevel,
          unblockMode: effectiveUnblockMode
        });
        const resolvedLevel = source.level ?? requestedLevel;
        discoveredLevels.push(resolvedLevel);
      } catch {
        // 当前档位不可播放时跳过，避免一次失败让整组音质探测失效。
      }
    }

    const availableLevels = sortPlayQualityLevels(discoveredLevels);
    const fallbackMap: Partial<Record<PlayQualityLevel, PlayQualityLevel>> = {};
    for (const requestedLevel of PLAY_QUALITY_LEVELS) {
      const fallbackLevel = resolvePlayableQualityFallback(requestedLevel, availableLevels);
      if (fallbackLevel) {
        fallbackMap[requestedLevel] = fallbackLevel;
      }
    }

    const payload: TrackQualityAvailability = {
      trackId: id,
      availableLevels,
      fallbackMap,
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
      retryable: appError.retryable
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
