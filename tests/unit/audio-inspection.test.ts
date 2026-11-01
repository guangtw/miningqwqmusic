import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectAudio } from "@/src/lib/music/audio-inspection";

// A valid FLAC header with STREAMINFO duration and Vorbis identity tags.
// No fixture download or real music is needed to exercise the actual parser.
function flac(seconds: number, title = "小胡同", artist = "郑润泽") {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | BigInt(seconds * 44100), 10);
  const comments = [`TITLE=${title}`, `ARTIST=${artist}`].map(value => {
    const text = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(text.length);
    return Buffer.concat([length, text]);
  });
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(comments.length, 4);
  const vorbis = Buffer.concat([prefix, ...comments]);
  const commentHeader = Buffer.from([0x84, 0, 0, 0]);
  commentHeader.writeUIntBE(vorbis.length, 1, 3);
  return Buffer.concat([Buffer.from("fLaC"), Buffer.from([0, 0, 0, 34]), streamInfo, commentHeader, vorbis]);
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("actual audio inspection", () => {
  it("parses real duration and performer tags from a ranged response", async () => {
    const audio = flac(276);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(audio, {
      status: 206, headers: { "content-type": "audio/flac", "content-length": String(audio.length), "content-range": `bytes 0-${audio.length - 1}/9000000` }
    }));
    const result = await inspectAudio("https://cdn.test/song.flac", 3000);
    expect(result).toMatchObject({ ok: true, title: "小胡同", artists: ["郑润泽"], durationMs: 276000, contentLength: 9000000, nativeNetease: false });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/song.flac", expect.objectContaining({ headers: { Range: "bytes=0-524287" } }));
  });

  it("reads the duration of the audio rather than the API's full-track claim", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(flac(30), { headers: { "content-type": "audio/flac" } }));
    expect((await inspectAudio("https://cdn.test/preview.flac", 3000)).durationMs).toBe(30000);
  });

  it("stops after the byte budget even when a server ignores Range", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "content-type": "audio/mpeg" } }));
    await inspectAudio("https://cdn.test/large.mp3", 3000);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not treat HTML or an inaccessible URL as verified audio", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>not audio</html>")).mockRejectedValueOnce(new TypeError("unreachable"));
    expect((await inspectAudio("https://cdn.test/html", 3000)).durationMs).toBeUndefined();
    expect(await inspectAudio("https://cdn.test/offline", 3000)).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled downloads with an abort", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    }));
    const pending = inspectAudio("https://cdn.test/stalled", 500);
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toEqual({ ok: false });
  });
});
