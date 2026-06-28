import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";
import type { PlayQualityLevel, PlayUnblockMode } from "@/src/types/music";

type Context = {
  params: Promise<{ id: string }>;
};

const PLAY_QUALITY_LEVELS: PlayQualityLevel[] = [
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "dolby",
  "jymaster"
];
const PLAY_UNBLOCK_MODES: PlayUnblockMode[] = ["auto", "force_on", "force_off"];

async function hasMusicUnblockEntitlement(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (!authorization && !cookie) return false;

  try {
    const entitlementUrl = new URL("/api/account/auth/me", request.url);
    const headers: Record<string, string> = {};
    if (authorization) {
      headers.authorization = authorization;
    }
    if (cookie) {
      headers.cookie = cookie;
    }
    const response = await fetch(entitlementUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store"
    });
    if (!response.ok) return false;

    const payload = (await response.json()) as {
      code?: number;
      data?: {
        playbackAuthorization?: {
          enabled?: boolean;
          version?: number;
        };
      };
    };
    return payload.code === 0 && payload.data?.playbackAuthorization?.enabled === true;
  } catch {
    return false;
  }
}

async function getAuthorizationVersion(request: Request): Promise<number> {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (!authorization && !cookie) return 0;

  try {
    const authUrl = new URL("/api/account/auth/me", request.url);
    const headers: Record<string, string> = {};
    if (authorization) headers.authorization = authorization;
    if (cookie) headers.cookie = cookie;
    const response = await fetch(authUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store"
    });
    if (!response.ok) return 0;
    const payload = (await response.json()) as {
      code?: number;
      data?: {
        playbackAuthorization?: {
          version?: number;
        };
      };
    };
    return payload.code === 0 ? Math.max(0, payload.data?.playbackAuthorization?.version ?? 0) : 0;
  } catch {
    return 0;
  }
}

function toPlayQualityLevel(input: string | null): PlayQualityLevel | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_QUALITY_LEVELS.includes(normalized as PlayQualityLevel) ? (normalized as PlayQualityLevel) : undefined;
}

function toPlayUnblockMode(input: string | null): PlayUnblockMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_UNBLOCK_MODES.includes(normalized as PlayUnblockMode) ? (normalized as PlayUnblockMode) : undefined;
}

export async function GET(request: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const requestedUnblockMode = toPlayUnblockMode(searchParams.get("unblockMode"));
    const canUseUnblock = requestedUnblockMode === "force_off" ? false : await hasMusicUnblockEntitlement(request);
    const authorizationVersion = canUseUnblock ? await getAuthorizationVersion(request) : 0;
    const effectiveUnblockMode =
      requestedUnblockMode === "force_off"
        ? "force_off"
        : canUseUnblock
          ? (requestedUnblockMode ?? "force_on")
          : "force_off";
    const data = await getPlaySource(id, {
      level: toPlayQualityLevel(searchParams.get("level")),
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
