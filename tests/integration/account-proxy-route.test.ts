import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/account/[...path]/route";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

function createContext(path: string[]): RouteContext {
  return {
    params: Promise.resolve({ path })
  };
}

describe("account proxy route", () => {
  const originalEnv = process.env.ACCOUNT_SERVICE_BASE_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.ACCOUNT_SERVICE_BASE_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns 503 when account service url is missing", async () => {
    delete process.env.ACCOUNT_SERVICE_BASE_URL;
    const request = new NextRequest("http://localhost:3000/api/account/auth/me", {
      method: "GET"
    });
    const response = await GET(request, createContext(["auth", "me"]));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe(5401);
  });

  it("forwards request method, query, body and set-cookie", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { accessToken: "ok" }, message: "ok", traceId: "trace" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "mqm_refresh_token=abc; HttpOnly; Path=/"
        }
      })
    );

    const request = new NextRequest("http://localhost:3000/api/account/auth/login?from=music", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "mqm_refresh_token=old",
        authorization: "Bearer old-token"
      },
      body: JSON.stringify({ email: "user@example.com", password: "12345678" })
    });

    const response = await POST(request, createContext(["auth", "login"]));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://127.0.0.1:3002/api/account/auth/login?from=music");
    expect(init?.method).toBe("POST");

    const forwardedHeaders = init?.headers as Headers;
    expect(forwardedHeaders.get("cookie")).toContain("mqm_refresh_token=old");
    expect(forwardedHeaders.get("authorization")).toBe("Bearer old-token");

    expect(response.headers.get("set-cookie")).toContain("mqm_refresh_token=abc");
    const payload = await response.json();
    expect(payload.code).toBe(0);
  });

  it("returns 502 when upstream is unreachable", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const request = new NextRequest("http://localhost:3000/api/account/auth/refresh", {
      method: "POST"
    });

    const response = await POST(request, createContext(["auth", "refresh"]));
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.code).toBe(5403);
    expect(payload.retryable).toBe(true);
  });
});