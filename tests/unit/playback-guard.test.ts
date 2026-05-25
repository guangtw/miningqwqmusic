import { describe, expect, it } from "vitest";
import { canStartRecovery, isSessionValid, shouldReloadTrack, shouldStartPlayback } from "@/src/lib/playback-guard";

describe("playback guard helpers", () => {
  it("does not reload when queue changes but current track id is unchanged", () => {
    expect(shouldReloadTrack("track-1", "track-1")).toBe(false);
    expect(shouldReloadTrack("track-1", "track-2")).toBe(true);
  });

  it("drops stale async results from older playback sessions", () => {
    const snapshot = {
      sessionId: 11,
      trackId: "track-9",
      token: 4
    };
    expect(isSessionValid(snapshot, 11, "track-9", 4)).toBe(true);
    expect(isSessionValid(snapshot, 12, "track-9", 4)).toBe(false);
    expect(isSessionValid(snapshot, 11, "track-8", 4)).toBe(false);
    expect(isSessionValid(snapshot, 11, "track-9", 5)).toBe(false);
  });

  it("does not restart playback for ttl or volume-only updates", () => {
    expect(shouldStartPlayback({ isPlaying: true, sourceChanged: false, audioPaused: false })).toBe(false);
    expect(shouldStartPlayback({ isPlaying: true, sourceChanged: true, audioPaused: false })).toBe(true);
    expect(shouldStartPlayback({ isPlaying: true, sourceChanged: false, audioPaused: true })).toBe(true);
  });

  it("prevents repeated recover attempts during cooldown or while request is in flight", () => {
    const now = 10_000;
    expect(canStartRecovery({ inFlight: true, now, lastRecoverAt: 9_000, cooldownMs: 1200 })).toBe(false);
    expect(canStartRecovery({ inFlight: false, now, lastRecoverAt: 9_100, cooldownMs: 1200 })).toBe(false);
    expect(canStartRecovery({ inFlight: false, now, lastRecoverAt: 8_000, cooldownMs: 1200 })).toBe(true);
  });
});
