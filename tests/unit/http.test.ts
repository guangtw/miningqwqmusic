import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/src/lib/http";

const options = { timeoutMs: 1000, retries: 2, retryDelayMs: 0 };
afterEach(() => vi.restoreAllMocks());

describe("upstream retry policy", () => {
  it("does not retry a permanent HTTP error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(fetchWithRetry("http://upstream.test", {}, options)).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient status and returns the successful payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(fetchWithRetry("http://upstream.test", {}, options)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry malformed JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{", { headers: { "content-type": "application/json" } }));
    await expect(fetchWithRetry("http://upstream.test", {}, options)).rejects.toMatchObject({ code: 2007 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a caller cancellation without another attempt", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchWithRetry("http://upstream.test", { signal: controller.signal }, options)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds malformed retry configuration", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(fetchWithRetry("http://upstream.test", {}, { ...options, retries: Infinity })).rejects.toMatchObject({ code: 2005 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])("does not retry HTTP %s and preserves the requested cooldown", async status => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status, headers: { "Retry-After": "120" } }));
    const onBackpressure = vi.fn();
    await expect(fetchWithRetry("https://stub.test", {}, { ...options, onBackpressure })).rejects.toMatchObject({ code: 2002, retryAfterSeconds: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onBackpressure).toHaveBeenCalledWith(120000);
  });

  it("recognizes business-level rate limits inside HTTP 200", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 429, message: "busy" }));
    await expect(fetchWithRetry("https://stub.test", {}, options)).rejects.toMatchObject({ code: 2002, retryAfterSeconds: 60 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries ordinary 503 outages without marking the whole service rate limited", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const onBackpressure = vi.fn();
    await expect(fetchWithRetry("https://stub.test", {}, { ...options, onBackpressure })).resolves.toEqual({ ok: true });
    expect(onBackpressure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses HTTP-date Retry-After values", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 429, headers: { "Retry-After": new Date(now + 180000).toUTCString() } }));
    await expect(fetchWithRetry("https://stub.test", {}, options)).rejects.toMatchObject({ code: 2002, retryAfterSeconds: 180 });
  });

  it("still recognizes an explicit Netease high-frequency message with code 503", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 503, msg: "请求太频繁，请稍后再试" }));
    const onBackpressure = vi.fn();
    await expect(fetchWithRetry("https://stub.test", {}, { ...options, onBackpressure })).rejects.toMatchObject({ code: 2002 });
    expect(onBackpressure).toHaveBeenCalledWith(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
