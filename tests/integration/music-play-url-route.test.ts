import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackQualityAvailability } from "@/src/types/music";

const mocks = vi.hoisted(() => ({
  getCachedTrackQualityAvailability: vi.fn((trackId: string): TrackQualityAvailability | undefined => ({
    trackId,
    availableLevels: ["standard", "higher", "exhigh", "lossless", "hires", "sky", "dolby"],
    fallbackMap: {
      standard: "standard",
      higher: "higher",
      exhigh: "exhigh",
      lossless: "lossless",
      hires: "hires",
      jyeffect: "hires",
      sky: "sky",
      dolby: "dolby",
      jymaster: "dolby"
    }
  })),
  getPlaySource: vi.fn(async (trackId: string) => ({
    trackId,
    url: `https://music.example/${trackId}.mp3`,
    preview: false,
    resolvedVia: "primary" as const
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  getCachedTrackQualityAvailability: mocks.getCachedTrackQualityAvailability,
  getPlaySource: mocks.getPlaySource
}));

import { GET } from "@/app/api/music/track/[id]/play-url/route";
import { AppError } from "@/src/lib/errors";

function context(trackId: string) {
  return {
    params: Promise.resolve({ id: trackId })
  };
}

describe("GET /api/music/track/:id/play-url", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("ACCOUNT_SERVICE_BASE_URL", "http://127.0.0.1:3002");
    mocks.getCachedTrackQualityAvailability.mockClear();
    mocks.getPlaySource.mockClear();
  });

  it("starts cold playback without fetching optional quality metadata", async () => {
    mocks.getCachedTrackQualityAvailability.mockReturnValueOnce(undefined);
    const response = await GET(new Request("http://localhost/api/music/track/1001/play-url?level=exhigh"), context("1001"));
    expect(response.status).toBe(200);
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1001", { level: "exhigh", unblockMode: "force_off" });
  });

  it("preserves Retry-After from a real playback rate limit", async () => {
    mocks.getPlaySource.mockRejectedValueOnce(new AppError("cooling", { code: 2002, status: 503, retryable: true, retryAfterSeconds: 120 }));
    const response = await GET(new Request("http://localhost/api/music/track/1001/play-url"), context("1001"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("120");
    expect((await response.json()).retryAfterSeconds).toBe(120);
  });

  it("forces unblock off when request has no account token", async () => {
    const response = await GET(new Request("http://localhost:3000/api/music/track/1001/play-url?unblockMode=force_on"), context("1001"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1001", {
      level: undefined,
      unblockMode: "force_off"
    });
  });

  it("preserves requested unblock mode when entitlement is enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              playbackAuthorization: {
                enabled: true,
                version: 7
              }
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              playbackAuthorization: {
                enabled: true,
                version: 7
              }
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    const response = await GET(
      new Request("http://localhost:3000/api/music/track/1002/play-url?level=lossless&unblockMode=force_on", {
        headers: {
          authorization: "Bearer token"
        }
      }),
      context("1002")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedTrackQualityAvailability).toHaveBeenCalledWith("1002");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:3002/api/account/auth/me", expect.objectContaining({
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    }));
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1002", {
      level: "lossless",
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(7);
  });

  it("falls back to the best available level for the current track without overwriting the requested preference", async () => {
    mocks.getCachedTrackQualityAvailability.mockReturnValueOnce({
      trackId: "2001",
      availableLevels: ["standard", "higher", "exhigh", "lossless", "hires", "sky"],
      fallbackMap: {
        standard: "standard",
        higher: "higher",
        exhigh: "exhigh",
        lossless: "lossless",
        hires: "hires",
        jyeffect: "hires",
        sky: "sky",
        dolby: "sky",
        jymaster: "sky"
      }
    });

    const response = await GET(new Request("http://localhost:3000/api/music/track/2001/play-url?level=dolby"), context("2001"));

    expect(response.status).toBe(200);
    expect(mocks.getCachedTrackQualityAvailability).toHaveBeenCalledWith("2001");
    expect(mocks.getPlaySource).toHaveBeenCalledWith("2001", {
      level: "sky",
      unblockMode: "force_off"
    });
  });

  it("restores the originally requested level when the next track supports it again", async () => {
    mocks.getCachedTrackQualityAvailability.mockReturnValueOnce({
      trackId: "2002",
      availableLevels: ["standard", "higher", "exhigh", "lossless", "hires", "sky", "dolby"],
      fallbackMap: {
        standard: "standard",
        higher: "higher",
        exhigh: "exhigh",
        lossless: "lossless",
        hires: "hires",
        jyeffect: "hires",
        sky: "sky",
        dolby: "dolby",
        jymaster: "dolby"
      }
    });

    const response = await GET(new Request("http://localhost:3000/api/music/track/2002/play-url?level=dolby"), context("2002"));

    expect(response.status).toBe(200);
    expect(mocks.getCachedTrackQualityAvailability).toHaveBeenCalledWith("2002");
    expect(mocks.getPlaySource).toHaveBeenCalledWith("2002", {
      level: "dolby",
      unblockMode: "force_off"
    });
  });

  it("defaults to force_on when entitlement is enabled and request omits unblock mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              playbackAuthorization: {
                enabled: true,
                version: 3
              }
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              playbackAuthorization: {
                enabled: true,
                version: 3
              }
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    const response = await GET(
      new Request("http://localhost:3000/api/music/track/1004/play-url", {
        headers: {
          authorization: "Bearer token"
        }
      }),
      context("1004")
    );

    expect(response.status).toBe(200);
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1004", {
      level: undefined,
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(3);
  });

  it("checks a cookie without rotating it during playback", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: 5204 }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { playbackAuthorization: { enabled: true, version: 5 } } }));
    const response = await GET(new Request("http://localhost/api/music/track/1005/play-url", { headers: { cookie: "mqm_refresh_token=current" } }), context("1005"));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:3002/api/account/auth/session", expect.objectContaining({ method: "GET", headers: { cookie: "mqm_refresh_token=current" } }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(false);
    expect((await response.json()).data).toMatchObject({ authorizationScope: "authorized", authorizationVersion: 5 });
  });

  it("falls back to normal source when entitlement service fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 5403, message: "Bad gateway", traceId: "trace", retryable: true }), {
        status: 502,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await GET(
      new Request("http://localhost:3000/api/music/track/1003/play-url?unblockMode=force_on", {
        headers: {
          authorization: "Bearer token"
        }
      }),
      context("1003")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1003", {
      level: undefined,
      unblockMode: "force_off"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("guest");
    expect(payload.data.authorizationVersion).toBe(0);
  });

  it("falls back to the dedicated entitlement endpoint when auth/me no longer includes playback authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              id: "u1",
              email: "vip@example.com"
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              enabled: true,
              version: 12,
              source: "manual"
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              id: "u1",
              email: "vip@example.com"
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              enabled: true,
              version: 12,
              source: "manual"
            },
            message: "ok",
            traceId: "trace"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    const response = await GET(
      new Request("http://localhost:3000/api/music/track/1006/play-url?unblockMode=force_on", {
        headers: {
          authorization: "Bearer token"
        }
      }),
      context("1006")
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:3002/api/account/auth/me", expect.objectContaining({
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:3002/api/account/music/unblock/entitlement", expect.objectContaining({
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    }));
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1006", {
      level: undefined,
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(12);
  });

  it("asks the browser to refresh an expired bearer without consuming its cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ code: 5204 }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/music/track/1007/play-url", { headers: { authorization: "Bearer expired", cookie: "mqm_refresh_token=current" } }), context("1007"));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe(5204);
    expect(mocks.getPlaySource).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(false);
  });

  it("keeps account outages distinct from an expired session", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("temporarily offline"));
    const response = await GET(new Request("http://localhost/api/music/track/1008/play-url", { headers: { authorization: "Bearer existing" } }), context("1008"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.authorizationScope).toBe("guest");
  });

});

afterEach(() => vi.unstubAllEnvs());
