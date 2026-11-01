import { parseBuffer } from "music-metadata";
import type { PlayQualityLevel } from "@/src/types/music";

export type AudioInspection = {
  ok: boolean;
  contentLength?: number;
  contentType?: string;
  durationMs?: number;
  bitrate?: number;
  lossless?: boolean;
  sampleRate?: number;
  bitsPerSample?: number;
  title?: string;
  artists?: string[];
  nativeNetease?: boolean;
};

const MAX_HEADER_BYTES = 512 * 1024;

export function inspectedPlayQuality(audio: Pick<AudioInspection, "lossless" | "sampleRate" | "bitsPerSample" | "bitrate">): PlayQualityLevel | undefined {
  if (audio.lossless) {
    return (audio.bitsPerSample ?? 0) > 16 || (audio.sampleRate ?? 0) > 48000 ? "hires" : "lossless";
  }
  if (!audio.bitrate || audio.bitrate <= 0) return undefined;
  if (audio.bitrate <= 128000) return "standard";
  if (audio.bitrate <= 192000) return "higher";
  return "exhigh";
}

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
      // Some NetEase FLAC responses are incorrectly served as audio/mpeg.
      // Detect the container from bytes rather than trusting the CDN MIME label.
      const metadata = await parseBuffer(Buffer.concat(chunks), { size: contentLength }, {
        skipCovers: true, skipPostHeaders: true, duration: false
      });
      inspection.durationMs = metadata.format.duration ? metadata.format.duration * 1000 : undefined;
      inspection.bitrate = metadata.format.lossless && contentLength && inspection.durationMs
        ? contentLength * 8000 / inspection.durationMs : metadata.format.bitrate;
      inspection.lossless = metadata.format.lossless;
      inspection.sampleRate = metadata.format.sampleRate;
      inspection.bitsPerSample = metadata.format.bitsPerSample;
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
