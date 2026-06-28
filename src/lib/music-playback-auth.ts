import type { PlayUnblockMode } from "@/src/types/music";
import { PLAY_QUALITY_LEVELS, toPlayQualityLevel } from "@/src/lib/play-quality";

export const PLAY_UNBLOCK_MODES: PlayUnblockMode[] = ["auto", "force_on", "force_off"];

export async function hasMusicUnblockEntitlement(request: Request): Promise<boolean> {
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

export async function getAuthorizationVersion(request: Request): Promise<number> {
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

export function toPlayUnblockMode(input: string | null): PlayUnblockMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_UNBLOCK_MODES.includes(normalized as PlayUnblockMode) ? (normalized as PlayUnblockMode) : undefined;
}

export { PLAY_QUALITY_LEVELS, toPlayQualityLevel };
