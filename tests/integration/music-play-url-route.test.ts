import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrackQualityAvailability: vi.fn(async (trackId: string) => ({
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
  getTrackQualityAvailability: mocks.getTrackQualityAvailability,
  getPlaySource: mocks.getPlaySource
}));

import { GET } from "@/app/api/music/track/[id]/play-url/route";

function context(trackId: string) {
  return {
    params: Promise.resolve({ id: trackId })
  };
}

describe("GET /api/music/track/:id/play-url", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getTrackQualityAvailability.mockClear();
    mocks.getPlaySource.mockClear();
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
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledWith("1002");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/account/auth/me", {
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    });
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1002", {
      level: "lossless",
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(7);
  });

  it("falls back to the best available level for the current track without overwriting the requested preference", async () => {
    mocks.getTrackQualityAvailability.mockResolvedValueOnce({
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
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledWith("2001");
    expect(mocks.getPlaySource).toHaveBeenCalledWith("2001", {
      level: "sky",
      unblockMode: "force_off"
    });
  });

  it("restores the originally requested level when the next track supports it again", async () => {
    mocks.getTrackQualityAvailability.mockResolvedValueOnce({
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
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledWith("2002");
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

  it("uses session cookies to restore authorized playback during page reloads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 5204,
            message: "Unauthorized",
            traceId: "trace",
            retryable: false
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              accessToken: "cookie-refresh-token",
              playbackAuthorization: {
                enabled: true,
                version: 5
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
            code: 5204,
            message: "Unauthorized",
            traceId: "trace",
            retryable: false
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              accessToken: "cookie-refresh-token",
              playbackAuthorization: {
                enabled: true,
                version: 5
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
      new Request("http://localhost:3000/api/music/track/1005/play-url", {
        headers: {
          cookie: "mqm_refresh=refresh-token"
        }
      }),
      context("1005")
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/account/auth/me", {
      method: "GET",
      headers: {
        cookie: "mqm_refresh=refresh-token"
      },
      cache: "no-store"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/account/auth/refresh", {
      method: "POST",
      headers: {
        cookie: "mqm_refresh=refresh-token"
      },
      cache: "no-store"
    });
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1005", {
      level: undefined,
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(5);
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
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/account/auth/me", {
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/account/music/unblock/entitlement", {
      method: "GET",
      headers: {
        authorization: "Bearer token"
      },
      cache: "no-store"
    });
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1006", {
      level: undefined,
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(12);
  });

  it("uses refreshed access token to query entitlement when cookie refresh omits playback authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 5204,
            message: "Unauthorized",
            traceId: "trace",
            retryable: false
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              accessToken: "cookie-refresh-token"
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
              version: 9,
              source: "invite"
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
            code: 5204,
            message: "Unauthorized",
            traceId: "trace",
            retryable: false
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              accessToken: "cookie-refresh-token"
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
              version: 9,
              source: "invite"
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
      new Request("http://localhost:3000/api/music/track/1007/play-url", {
        headers: {
          cookie: "mqm_refresh=refresh-token"
        }
      }),
      context("1007")
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://localhost:3000/api/account/music/unblock/entitlement", {
      method: "GET",
      headers: {
        authorization: "Bearer cookie-refresh-token"
      },
      cache: "no-store"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(9);
  });
});
