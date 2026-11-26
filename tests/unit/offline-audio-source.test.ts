import { expect, it } from "vitest";
import { offlineAudioSource, offlineCacheSource } from "@/src/lib/music/offline-audio";
import type { PlaySource } from "@/src/types/music";

const official: PlaySource = {
  trackId: "123", sourceTrackId: "123", url: "http://m1.music.126.net/audio.mp3?token=temporary",
  preview: false, level: "lossless", contentLevel: "exhigh", format: "mp3", size: 5_000_000,
  contentMd5: "0123456789abcdef0123456789abcdef", expectedDurationMs: 180_000,
  access: "free", resolvedVia: "primary"
};

it("offers the actual identified quality and complete official content", () => {
  expect(offlineCacheSource(official)).toEqual({
    url: "https://m1.music.126.net/audio.mp3?token=temporary", mime: "audio/mpeg", bytes: 5_000_000,
    md5: official.contentMd5, level: "exhigh", durationMs: 180_000
  });
  expect(offlineCacheSource({ ...official, resolvedVia: "unblock" })).toBeDefined();
});

it.each([
  { sourceTrackId: "124" }, { contentMd5: undefined }, { expectedDurationMs: undefined },
  { contentLevel: undefined }, { preview: true }, { size: 0 }, { size: 300 * 1024 * 1024 },
  { format: "ncm" }, { url: "https://m1.music.126.net.example.test/file.mp3" },
  { url: "https://user@m1.music.126.net/file.mp3" }
])("rejects unverifiable or unsupported offline audio (%o)", (override) => {
  expect(offlineAudioSource({ ...official, ...override })).toBeUndefined();
});

it("keeps restricted, paid and grace playback out of persistent cache", () => {
  expect(offlineCacheSource({ ...official, access: "vip" })).toBeUndefined();
  expect(offlineCacheSource({ ...official, access: "paid" })).toBeUndefined();
  expect(offlineCacheSource({ ...official, restrictionReason: "trial_restriction" })).toBeUndefined();
  expect(offlineCacheSource({ ...official, resolvedVia: "grace" })).toBeUndefined();
});
