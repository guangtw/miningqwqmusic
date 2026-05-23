import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/src/store/player-store";
import type { Track } from "@/src/types/music";

const mockTrack = (id: string): Track => ({
  id,
  name: `track-${id}`,
  artists: [{ id: "a1", name: "artist" }],
  durationMs: 120000
});

describe("player store state machine", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentIndex: -1,
      mode: "sequence",
      isPlaying: false,
      currentTimeMs: 0,
      durationMs: 0,
      volume: 0.8,
      favorites: {},
      recent: [],
      hasHydrated: true
    });
  });

  it("supports queue navigation in sequence mode", () => {
    const tracks = [mockTrack("1"), mockTrack("2"), mockTrack("3")];
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("supports shuffle mode", () => {
    const tracks = [mockTrack("1"), mockTrack("2"), mockTrack("3")];
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().setPlaybackMode("shuffle");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.8);
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    randomSpy.mockRestore();
  });

  it("toggles favorites", () => {
    const track = mockTrack("9");
    usePlayerStore.getState().toggleFavorite(track);
    expect(Boolean(usePlayerStore.getState().favorites[track.id])).toBe(true);
    usePlayerStore.getState().toggleFavorite(track);
    expect(Boolean(usePlayerStore.getState().favorites[track.id])).toBe(false);
  });

  it("cycles playback mode", () => {
    expect(usePlayerStore.getState().mode).toBe("sequence");
    usePlayerStore.getState().nextMode();
    expect(usePlayerStore.getState().mode).toBe("loop-one");
    usePlayerStore.getState().nextMode();
    expect(usePlayerStore.getState().mode).toBe("shuffle");
    usePlayerStore.getState().nextMode();
    expect(usePlayerStore.getState().mode).toBe("sequence");
  });
});
