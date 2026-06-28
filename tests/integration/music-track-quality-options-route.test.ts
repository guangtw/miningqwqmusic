import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlaySource: vi.fn(async (trackId: string, options?: { level?: string; unblockMode?: string }) => ({
    trackId,
    url: `https://music.example/${trackId}-${options?.level ?? "standard"}.mp3`,
    preview: false,
    level: options?.level ?? "standard",
    resolvedVia: "primary" as const
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
  getPlaySource: mocks.getPlaySource
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
    mocks.getPlaySource.mockClear();
  });

  it("falls back to the highest currently available quality not above the requested level", async () => {
    mocks.getPlaySource.mockImplementation(async (trackId: string, options?: { level?: string; unblockMode?: string }) => {
      const requestedLevel = options?.level ?? "standard";
      const resolvedLevel =
        requestedLevel === "dolby" || requestedLevel === "jymaster"
          ? "exhigh"
          : requestedLevel === "sky"
            ? "lossless"
            : requestedLevel;
      return {
        trackId,
        url: `https://music.example/${trackId}-${resolvedLevel}.mp3`,
        preview: false,
        level: resolvedLevel,
        resolvedVia: "primary" as const
      };
    });

    const response = await GET(new Request("http://localhost:3000/api/music/track/2001/quality-options"), context("2001"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getPlaySource).toHaveBeenCalledTimes(9);
    expect(mocks.getPlaySource).toHaveBeenNthCalledWith(8, "2001", {
      level: "dolby",
      unblockMode: "force_off"
    });

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
    expect(mocks.getPlaySource).toHaveBeenCalledWith("2002", {
      level: "standard",
      unblockMode: "force_on"
    });
    const payload = await response.json();
    expect(payload.data.authorizationScope).toBe("authorized");
    expect(payload.data.authorizationVersion).toBe(11);
  });
});
