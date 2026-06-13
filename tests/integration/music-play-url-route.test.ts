import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlaySource: vi.fn(async (trackId: string) => ({
    trackId,
    url: `https://music.example/${trackId}.mp3`
  }))
}));

vi.mock("@/src/lib/music/service", () => ({
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { enabled: true }, message: "ok", traceId: "trace" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
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
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/account/music/unblock/entitlement", {
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
  });

  it("defaults to force_on when entitlement is enabled and request omits unblock mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { enabled: true }, message: "ok", traceId: "trace" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
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
  });

  it("uses entitlement cookie during page reload playback rebuilds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { enabled: true }, message: "ok", traceId: "trace" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
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
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/account/music/unblock/entitlement", {
      method: "GET",
      headers: {
        cookie: "mqm_refresh=refresh-token"
      },
      cache: "no-store"
    });
    expect(mocks.getPlaySource).toHaveBeenCalledWith("1005", {
      level: undefined,
      unblockMode: "force_on"
    });
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
  });
});
