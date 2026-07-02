import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrackQualityAvailability: vi.fn(async (trackId: string) => ({
    trackId,
    availableLevels: ["standard", "higher", "exhigh", "lossless", "hires"],
    fallbackMap: {
      standard: "standard",
      higher: "higher",
      exhigh: "exhigh",
      lossless: "lossless",
      hires: "hires",
      jyeffect: "hires",
      sky: "hires",
      dolby: "hires",
      jymaster: "hires"
    }
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  getTrackQualityAvailability: mocks.getTrackQualityAvailability
}));

import { GET } from "@/app/api/music/track/[id]/quality-options/route";

function context(trackId: string) {
  return {
    params: Promise.resolve({ id: trackId })
  };
}

describe("GET /api/music/track/:id/quality-options", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getTrackQualityAvailability.mockClear();
  });

  it("returns quality availability from the provider instead of probing play-url fallbacks", async () => {
    mocks.getTrackQualityAvailability.mockResolvedValueOnce({
      trackId: "2001",
      availableLevels: ["standard", "higher", "exhigh", "lossless", "hires", "jyeffect"],
      fallbackMap: {
        standard: "standard",
        higher: "higher",
        exhigh: "exhigh",
        lossless: "lossless",
        hires: "hires",
        jyeffect: "jyeffect",
        sky: "jyeffect",
        dolby: "jyeffect",
        jymaster: "jyeffect"
      }
    });

    const response = await GET(new Request("http://localhost:3000/api/music/track/2001/quality-options"), context("2001"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledWith("2001");

    const payload = await response.json();
    expect(payload.data.availableLevels).toEqual([
      "standard",
      "higher",
      "exhigh",
      "lossless",
      "hires",
      "jyeffect"
    ]);
    expect(payload.data.fallbackMap.lossless).toBe("lossless");
    expect(payload.data.fallbackMap.hires).toBe("hires");
    expect(payload.data.fallbackMap.sky).toBe("jyeffect");
    expect(payload.data.fallbackMap.dolby).toBe("jyeffect");
    expect(payload.data.fallbackMap.jymaster).toBe("jyeffect");
    expect(payload.data.authorizationScope).toBe("guest");
    expect(payload.data.authorizationVersion).toBe(0);
  });

  it("uses authorized playback mode when entitlement is enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              playbackAuthorization: {
                enabled: true,
                version: 11
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
                version: 11
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
      new Request("http://localhost:3000/api/music/track/2002/quality-options", {
        headers: {
          authorization: "Bearer token"
        }
      }),
      context("2002")
    );

    expect(response.status).toBe(200);
    expect(mocks.getTrackQualityAvailability).toHaveBeenCalledWith("2002");
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(11);
  });

  it("uses session cookie refresh fallback when auth/me only accepts bearer tokens", async () => {
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
                version: 13
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
                version: 13
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
      new Request("http://localhost:3000/api/music/track/2003/quality-options", {
        headers: {
          cookie: "mqm_refresh=refresh-token"
        }
      }),
      context("2003")
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/account/auth/refresh", {
      method: "POST",
      headers: {
        cookie: "mqm_refresh=refresh-token"
      },
      cache: "no-store"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(13);
  });
});
