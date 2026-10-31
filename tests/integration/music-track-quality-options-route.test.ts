import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.stubEnv("ACCOUNT_SERVICE_BASE_URL", "http://127.0.0.1:3002");
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

  it("does not invalidate the refresh cookie when reading quality options", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: 5204 }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { playbackAuthorization: { enabled: true, version: 13 } } }));
    const response = await GET(new Request("http://localhost/api/music/track/2003/quality-options", { headers: { cookie: "mqm_refresh_token=current" } }), context("2003"));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:3002/api/account/auth/session", expect.objectContaining({ method: "GET" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(false);
    expect((await response.json()).data.authorizationVersion).toBe(13);
  });

});

afterEach(() => vi.unstubAllEnvs());
