import type { PlayUnblockMode } from "@/src/types/music";
import { PLAY_QUALITY_LEVELS, toPlayQualityLevel } from "@/src/lib/play-quality";

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

type AuthRefreshResponse = {
  code?: number;
  data?: {
    accessToken?: string;
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

  try {
    const authUrl = new URL("/api/account/auth/me", request.url);
    const authResponse = await fetch(authUrl.toString(), {
      method: "GET",
      headers: forwardedHeaders,
      cache: "no-store"
    });
    if (authResponse.ok) {
      const authPayload = (await authResponse.json()) as AuthMeResponse;
      const playbackAuthorization = authPayload.code === 0 ? authPayload.data?.playbackAuthorization : undefined;
      if (isPlaybackAuthorizationPayload(playbackAuthorization)) {
        return playbackAuthorization;
      }
    }
  } catch {
    // Fall through to cookie refresh and entitlement probing.
  }

  let refreshedAccessToken: string | null = null;
  if (cookie) {
    try {
      const refreshHeaders: Record<string, string> = { cookie };
      const refreshUrl = new URL("/api/account/auth/refresh", request.url);
      const refreshResponse = await fetch(refreshUrl.toString(), {
        method: "POST",
        headers: refreshHeaders,
        cache: "no-store"
      });
      if (refreshResponse.ok) {
        const refreshPayload = (await refreshResponse.json()) as AuthRefreshResponse;
        const playbackAuthorization = refreshPayload.code === 0 ? refreshPayload.data?.playbackAuthorization : undefined;
        refreshedAccessToken = refreshPayload.code === 0 ? refreshPayload.data?.accessToken ?? null : null;
        if (isPlaybackAuthorizationPayload(playbackAuthorization)) {
          return playbackAuthorization;
        }
      }
    } catch {
      // Fall through to the dedicated entitlement endpoint.
    }
  }

  try {
    const entitlementUrl = new URL("/api/account/music/unblock/entitlement", request.url);
    const entitlementHeaders: Record<string, string> = {};
    if (authorization) {
      entitlementHeaders.authorization = authorization;
    } else if (refreshedAccessToken) {
      entitlementHeaders.authorization = `Bearer ${refreshedAccessToken}`;
    } else if (cookie) {
      return null;
    }
    const entitlementResponse = await fetch(entitlementUrl.toString(), {
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
