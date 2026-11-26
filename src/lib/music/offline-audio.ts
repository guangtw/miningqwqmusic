import type { DownloadSource, OfflineAudioSource, PlaySource } from "@/src/types/music";

const MAX_BYTES = 256 * 1024 * 1024;
const formats = new Map([
  ["mp3", "audio/mpeg"], ["flac", "audio/flac"], ["m4a", "audio/mp4"], ["mp4", "audio/mp4"],
  ["aac", "audio/aac"], ["ogg", "audio/ogg"], ["wav", "audio/wav"]
]);

export function offlineAudioSource(source: DownloadSource | PlaySource): OfflineAudioSource | undefined {
  const md5 = source.contentMd5?.toLowerCase();
  if (source.preview || source.sourceTrackId !== source.trackId ||
    !md5 || !/^[a-f0-9]{32}$/.test(md5)) return;
  const mime = formats.get(source.format?.toLowerCase() ?? "");
  const level = source.contentLevel;
  const bytes = source.size ?? 0;
  const durationMs = source.expectedDurationMs ?? 0;
  if (!mime || !level || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES ||
    !Number.isSafeInteger(durationMs) || durationMs <= 0) return;
  let url: URL;
  try { url = new URL(source.url); } catch { return; }
  if (!["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password ||
    !url.hostname.endsWith(".music.126.net")) return;
  url.protocol = "https:";
  return { url: url.href, mime, bytes, level, md5, durationMs };
}

export function offlineCacheSource(source: PlaySource): OfflineAudioSource | undefined {
  // An Android member may request the matching path even for a free song.
  // The same official CDN, track ID and checksum are still mandatory.
  if ((source.resolvedVia !== "primary" && source.resolvedVia !== "unblock") ||
    source.access !== "free" || source.restrictionReason) return;
  return offlineAudioSource(source);
}
