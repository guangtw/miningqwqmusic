import { AppError } from "@/src/lib/errors";
import type { PlayUnblockMode } from "@/src/types/music";
import { PLAY_QUALITY_LEVELS, toPlayQualityLevel } from "@/src/lib/play-quality";
import { accountServiceUrl } from "@/src/lib/account-service";

function fetchAccountAuthorization(path: string, init: RequestInit): Promise<Response> {
  return fetch(accountServiceUrl(path.split("/")).toString(), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(5000)
  });
}

export const PLAY_UNBLOCK_MODES: PlayUnblockMode[] = ["auto", "force_on", "force_off"];

type PlaybackAuthorizationPayload = {
  enabled?: boolean;
  version?: number;
};

type AuthMeResponse = {
  code?: number;
  data?: {
    playbackAuthorization?: PlaybackAuthorizationPayload;
  };
};

type MusicUnblockEntitlementResponse = {
  code?: number;
  data?: PlaybackAuthorizationPayload;
};

export type PlaybackAuthorizationState = {
  enabled: boolean;
  version: number;
};

function buildForwardHeaders(request: Request): Record<string, string> | null {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (!authorization && !cookie) return null;

  const headers: Record<string, string> = {};
  if (authorization) {
    headers.authorization = authorization;
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

function isPlaybackAuthorizationPayload(
  value: PlaybackAuthorizationPayload | null | undefined
): value is PlaybackAuthorizationPayload & { enabled: boolean } {
  return typeof value?.enabled === "boolean";
}

async function fetchPlaybackAuthorization(request: Request): Promise<PlaybackAuthorizationPayload | null> {
  const forwardedHeaders = buildForwardHeaders(request);
  if (!forwardedHeaders) return null;

  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");

  let accessRejected = false;
  try {
    const authResponse = await fetchAccountAuthorization("auth/me", {
      method: "GET",
      headers: forwardedHeaders,
      cache: "no-store"
    });
    accessRejected = !!authorization && authResponse.status === 401;
    if (authResponse.ok) {
      const authPayload = (await authResponse.json()) as AuthMeResponse;
      const playbackAuthorization = authPayload.code === 0 ? authPayload.data?.playbackAuthorization : undefined;
      if (isPlaybackAuthorizationPayload(playbackAuthorization)) {
        return playbackAuthorization;
      }
    }
  } catch {
    // A transient outage is not an invalid session.
  }

  // A server-side permission probe must never consume a browser refresh token.
  if (cookie) {
    try {
      const sessionResponse = await fetchAccountAuthorization("auth/session", {
        method: "GET", headers: { cookie }, cache: "no-store"
      });
      if (sessionResponse.ok) {
        const payload = (await sessionResponse.json()) as AuthMeResponse;
        const snapshot = payload.code === 0 ? payload.data?.playbackAuthorization : undefined;
        if (isPlaybackAuthorizationPayload(snapshot)) return snapshot;
      }
    } catch {
      // Keep permission checks fail-closed without rotating or deleting cookies.
    }
  }
  if (accessRejected) {
    // The browser owns refresh and can actually receive the new Set-Cookie.
    throw new AppError("Session refresh required", { code: 5204, status: 401, retryable: false });
  }

  try {
    const entitlementHeaders: Record<string, string> = {};
    if (authorization) {
      entitlementHeaders.authorization = authorization;

    } else if (cookie) {
      return null;
    }
    const entitlementResponse = await fetchAccountAuthorization("music/unblock/entitlement", {
      method: "GET",
      headers: entitlementHeaders,
      cache: "no-store"
    });
    if (!entitlementResponse.ok) return null;

    const entitlementPayload = (await entitlementResponse.json()) as MusicUnblockEntitlementResponse;
    const entitlement = entitlementPayload.code === 0 ? entitlementPayload.data : undefined;
    return isPlaybackAuthorizationPayload(entitlement) ? entitlement : null;
  } catch {
    return null;
  }
}

export async function resolvePlaybackAuthorizationState(request: Request): Promise<PlaybackAuthorizationState> {
  const authorization = await fetchPlaybackAuthorization(request);
  return {
    enabled: authorization?.enabled === true,
    version: Math.max(0, authorization?.version ?? 0)
  };
}

export async function hasMusicUnblockEntitlement(request: Request): Promise<boolean> {
  return (await resolvePlaybackAuthorizationState(request)).enabled;
}

export async function getAuthorizationVersion(request: Request): Promise<number> {
  return (await resolvePlaybackAuthorizationState(request)).version;
}

export function toPlayUnblockMode(input: string | null): PlayUnblockMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_UNBLOCK_MODES.includes(normalized as PlayUnblockMode) ? (normalized as PlayUnblockMode) : undefined;
}

export { PLAY_QUALITY_LEVELS, toPlayQualityLevel };
