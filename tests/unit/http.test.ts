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
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
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
});
