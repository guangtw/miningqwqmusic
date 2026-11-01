import { parseBuffer } from "music-metadata";

export type AudioInspection = {
  ok: boolean;
  contentLength?: number;
  contentType?: string;
  durationMs?: number;
  title?: string;
  artists?: string[];
  nativeNetease?: boolean;
};

const MAX_HEADER_BYTES = 512 * 1024;

/** Inspect actual audio, not the duration/identity echoed by a matching API. */
export async function inspectAudio(url: string, timeoutMs: number): Promise<AudioInspection> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${MAX_HEADER_BYTES - 1}` },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok || !response.body) return { ok: false };
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (length < MAX_HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, MAX_HEADER_BYTES - length);
      chunks.push(chunk);
      length += chunk.length;
    }
    await reader.cancel();
    reader = undefined;
    const contentType = response.headers.get("content-type") ?? undefined;
    const total = response.status === 206
      ? response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]
      : response.headers.get("content-length");
    const contentLength = total && Number(total) > 0 ? Number(total) : undefined;
    const hostname = new URL(response.url || url).hostname;
    const inspection: AudioInspection = {
      ok: true, contentType, contentLength,
      nativeNetease: hostname.endsWith(".music.126.net") || hostname === "music.126.net"
    };
    try {
      const metadata = await parseBuffer(Buffer.concat(chunks), { mimeType: contentType, size: contentLength }, {
        skipCovers: true, skipPostHeaders: true, duration: false
      });
      inspection.durationMs = metadata.format.duration ? metadata.format.duration * 1000 : undefined;
      inspection.title = metadata.common.title;
      inspection.artists = metadata.common.artists ?? (metadata.common.artist ? [metadata.common.artist] : undefined);
    } catch { /* Some CDNs omit tags. Do not invent identity from the request ID. */ }
    return inspection;
  } catch {
    return { ok: false };
  } finally {
    controller.abort();
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => undefined);
  }
}
