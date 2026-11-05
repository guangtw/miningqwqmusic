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
    vi.stubEnv("ACCOUNT_TRUST_PROXY_HEADERS", "0");
  });

  afterEach(() => {
    process.env.ACCOUNT_SERVICE_BASE_URL = originalEnv;
    vi.unstubAllEnvs();
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
          "set-cookie": "mqm_refresh_token=abc; HttpOnly; Path=/",
          "x-accel-buffering": "no"
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
    expect(response.headers.get("x-accel-buffering")).toBe("no");
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
  it("rejects cross-site email-login requests before forwarding or sending mail", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(new NextRequest("http://localhost/api/account/auth/email/request", {
      method: "POST", headers: {"content-type": "application/json", origin: "https://other.example.test"},
      body: JSON.stringify({email: "user@example.test"})
    }), createContext(["auth", "email", "request"]));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves account event resumption and message rate-limit hints", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: 5805, retryable: true, retryAfterSeconds: 12
    }), { status: 429, headers: { "retry-after": "12", "content-type": "application/json" } }));
    const response = await GET(new NextRequest("http://localhost/api/account/events/stream", {
      headers: { authorization: "Bearer token", "last-event-id": "42" }
    }), createContext(["events", "stream"]));
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("last-event-id")).toBe("42");
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards familiar verification with canonical identity and preserves its cooldown without caching", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    vi.stubEnv("ACCOUNT_TRUST_PROXY_HEADERS", "1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({code: 5910, retryAfterSeconds: 120},
      {status: 429, headers: {"retry-after": "120"}}));
    const body = JSON.stringify({challengeId: "synthetic-challenge", answers: ["synthetic answer", ""]});
    const response = await POST(new NextRequest("http://localhost/api/account/membership/familiar/verify", {
      method: "POST", headers: {authorization: "Bearer account-token", "content-type": "application/json",
        "x-real-ip": "192.0.2.1", "x-forwarded-for": "203.0.113.99"}, body
    }), createContext(["membership", "familiar", "verify"]));
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://127.0.0.1:3002/api/account/membership/familiar/verify");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
    expect((init?.headers as Headers).get("authorization")).toBe("Bearer account-token");
    expect((init?.headers as Headers).get("x-forwarded-for")).toBe("192.0.2.1");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the SSE abort signal alive after headers and cancels upstream on reader cancellation", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const cancel = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(': ready\n\n')); }, cancel
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const abort = new AbortController();
    const response = await GET(new NextRequest('http://localhost/api/account/listen/rooms/r/stream', { signal: abort.signal }), createContext(['listen', 'rooms', 'r', 'stream']));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    expect(signal?.aborted).toBe(true);
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([["..", "..", "admin"], ["auth/me"], ["auth\\me"]])("rejects path traversal segments %s", async (...segments) => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await GET(new NextRequest("http://localhost/api/account/test"), createContext(segments));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not trust client-supplied forwarding identity and prevents token caching", async () => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 0 }, { headers: { "cache-control": "public, max-age=600" } }));
    const response = await GET(new NextRequest("http://localhost/api/account/auth/me", { headers: { "x-forwarded-for": "127.0.0.1" } }), createContext(["auth", "me"]));
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).has("x-forwarded-for")).toBe(false);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["192.0.2.1", "192.0.2.1"], ["2001:db8::1", "2001:db8::1"], ["invalid", null]])("rebuilds a canonical proxy address only in the protected topology: %s", async (realIp, expected) => {
    process.env.ACCOUNT_SERVICE_BASE_URL = "http://127.0.0.1:3002";
    vi.stubEnv("ACCOUNT_TRUST_PROXY_HEADERS", "1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 0 }));
    await POST(new NextRequest("http://localhost/api/account/auth/login", {
      method: "POST", headers: { "x-real-ip": realIp, "x-forwarded-for": "203.0.113.9, 127.0.0.1" }, body: "{}"
    }), createContext(["auth", "login"]));
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("x-real-ip")).toBe(expected);
    expect(headers.get("x-forwarded-for")).toBe(expected);
  });
});
