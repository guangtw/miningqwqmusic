import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerController } from "@/src/hooks/use-player-controller";
import { usePlayerStore } from "@/src/store/player-store";
import type { PlaySource, Track } from "@/src/types/music";

const getTrackDetailMock = vi.fn();
const getTrackInsightMock = vi.fn();
const getTrackLyricMock = vi.fn();
const getTrackPlaySourceMock = vi.fn();

vi.mock("@/src/lib/client-api", () => ({
  getTrackDetail: (...args: unknown[]) => getTrackDetailMock(...args),
  getTrackInsight: (...args: unknown[]) => getTrackInsightMock(...args),
  getTrackLyric: (...args: unknown[]) => getTrackLyricMock(...args),
  getTrackPlaySource: (...args: unknown[]) => getTrackPlaySourceMock(...args)
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type TransitionPhase = "idle" | "fadingOut" | "switching" | "fadingIn";

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createTrack(id: string): Track {
  return {
    id,
    name: `track-${id}`,
    artists: [{ id: `artist-${id}`, name: `artist-${id}` }],
    durationMs: 180000,
    coverUrl: `https://cdn.example/cover-${id}.jpg`
  };
}

function ControllerHarness({
  onState
}: {
  onState: (state: { source: PlaySource | null; transitionPhase: TransitionPhase }) => void;
}) {
  const controller = usePlayerController();
  onState({
    source: controller.currentSource,
    transitionPhase: controller.transitionPhase
  });
  return <audio data-testid="player-audio" ref={controller.audioRef} />;
}

function callCountForTrack(trackId: string): number {
  return getTrackPlaySourceMock.mock.calls.filter(([calledTrackId]) => calledTrackId === trackId).length;
}

describe("player controller regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      queue: [],
      currentIndex: -1,
      mode: "sequence",
      shuffleHistoryTrackIds: [],
      isPlaying: false,
      currentTimeMs: 0,
      durationMs: 0,
      volume: 0.8,
      favorites: {},
      recent: [],
      importedPlaylists: {},
      playQualityLevel: "standard",
      hasHydrated: true
    });

    getTrackDetailMock.mockResolvedValue(null);
    getTrackInsightMock.mockResolvedValue({ alternatives: [] });
    getTrackLyricMock.mockResolvedValue({
      trackId: "",
      lines: [],
      translatedLines: [],
      karaokeLines: []
    });

    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the last selected track when previous play-source request resolves later", async () => {
    const trackA = createTrack("A");
    const trackB = createTrack("B");
    const deferredA = createDeferred<PlaySource>();
    const deferredB = createDeferred<PlaySource>();
    const sharedUrl = "https://cdn.example/shared.mp3";

    getTrackPlaySourceMock.mockImplementation((trackId: string) => {
      if (trackId === trackA.id) return deferredA.promise;
      if (trackId === trackB.id) return deferredB.promise;
      throw new Error(`unexpected track id: ${trackId}`);
    });

    usePlayerStore.getState().setQueue([trackA, trackB], 0);
    usePlayerStore.getState().setPlaying(false);

    let latestSource: PlaySource | null = null;
    const { unmount } = render(
      <ControllerHarness
        onState={({ source }) => {
          latestSource = source;
        }}
      />
    );

    await waitFor(() => {
      expect(getTrackPlaySourceMock).toHaveBeenCalledWith(trackA.id);
    });

    act(() => {
      usePlayerStore.getState().playTrackNow(trackB);
      usePlayerStore.getState().setPlaying(false);
    });

    await waitFor(() => {
      expect(getTrackPlaySourceMock).toHaveBeenCalledWith(trackB.id);
    });

    await act(async () => {
      deferredB.resolve({ trackId: trackB.id, url: sharedUrl });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackB.id);
      expect(latestSource?.url).toBe(sharedUrl);
    });

    await act(async () => {
      deferredA.resolve({ trackId: trackA.id, url: sharedUrl });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackB.id);
      expect(latestSource?.url).toBe(sharedUrl);
    });

    unmount();
  });

  it("blocks waiting/stalled recovery while switching tracks", async () => {
    const trackA = createTrack("A");
    const trackB = createTrack("B");
    const deferredB = createDeferred<PlaySource>();

    getTrackPlaySourceMock.mockImplementation((trackId: string) => {
      if (trackId === trackA.id) {
        return Promise.resolve({ trackId: trackA.id, url: "https://cdn.example/a.mp3" });
      }
      if (trackId === trackB.id) {
        return deferredB.promise;
      }
      throw new Error(`unexpected track id: ${trackId}`);
    });

    usePlayerStore.getState().setQueue([trackA, trackB], 0);
    usePlayerStore.getState().setPlaying(true);

    let latestSource: PlaySource | null = null;
    let latestTransition: TransitionPhase = "idle";
    const { getByTestId, unmount } = render(
      <ControllerHarness
        onState={({ source, transitionPhase }) => {
          latestSource = source;
          latestTransition = transitionPhase;
        }}
      />
    );

    await waitFor(() => {
      expect(callCountForTrack(trackA.id)).toBe(1);
      expect(latestSource?.trackId).toBe(trackA.id);
    });

    act(() => {
      usePlayerStore.getState().playTrackNow(trackB);
      usePlayerStore.getState().setPlaying(true);
    });

    await waitFor(() => {
      expect(callCountForTrack(trackB.id)).toBeGreaterThanOrEqual(1);
      expect(latestTransition).not.toBe("idle");
    });
    const recoverCountBaseline = callCountForTrack(trackB.id);

    const audio = getByTestId("player-audio") as HTMLAudioElement;
    act(() => {
      audio.dispatchEvent(new Event("waiting"));
      audio.dispatchEvent(new Event("stalled"));
    });

    await waitFor(() => {
      expect(callCountForTrack(trackB.id)).toBe(recoverCountBaseline);
    });

    await act(async () => {
      deferredB.resolve({ trackId: trackB.id, url: "https://cdn.example/b.mp3" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackB.id);
    });
    await waitFor(() => {
      expect(latestTransition).toBe("idle");
    });

    unmount();
  });

  it("ignores stale recovery response from previous track after switching to B", async () => {
    const trackA = createTrack("A");
    const trackB = createTrack("B");
    const deferredRecoveryA = createDeferred<PlaySource>();
    let aRequestCount = 0;

    getTrackPlaySourceMock.mockImplementation((trackId: string) => {
      if (trackId === trackA.id) {
        aRequestCount += 1;
        if (aRequestCount === 1) {
          return Promise.resolve({ trackId: trackA.id, url: "https://cdn.example/a-main.mp3" });
        }
        if (aRequestCount === 2) {
          return deferredRecoveryA.promise;
        }
        return Promise.resolve({ trackId: trackA.id, url: "https://cdn.example/a-new.mp3" });
      }
      if (trackId === trackB.id) {
        return Promise.resolve({ trackId: trackB.id, url: "https://cdn.example/b-main.mp3" });
      }
      throw new Error(`unexpected track id: ${trackId}`);
    });

    usePlayerStore.getState().setQueue([trackA, trackB], 0);
    usePlayerStore.getState().setPlaying(true);

    let latestSource: PlaySource | null = null;
    let latestTransition: TransitionPhase = "idle";
    const { getByTestId, unmount } = render(
      <ControllerHarness
        onState={({ source, transitionPhase }) => {
          latestSource = source;
          latestTransition = transitionPhase;
        }}
      />
    );

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackA.id);
      expect(latestTransition).toBe("idle");
    });

    const audio = getByTestId("player-audio") as HTMLAudioElement;
    act(() => {
      audio.dispatchEvent(new Event("error"));
    });

    await waitFor(() => {
      expect(aRequestCount).toBe(2);
    });

    act(() => {
      usePlayerStore.getState().playTrackNow(trackB);
      usePlayerStore.getState().setPlaying(true);
    });

    await waitFor(() => {
      expect(callCountForTrack(trackB.id)).toBe(1);
    });

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackB.id);
    });

    await act(async () => {
      deferredRecoveryA.resolve({ trackId: trackA.id, url: "https://cdn.example/a-recovery.mp3" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(trackB.id);
    });
    await waitFor(() => {
      expect(latestTransition).toBe("idle");
    });

    unmount();
  });

  it("does not trigger recovery on error during fadingIn transition", async () => {
    const trackA = createTrack("A");
    const trackB = createTrack("B");

    getTrackPlaySourceMock.mockImplementation((trackId: string) => {
      if (trackId === trackA.id) {
        return Promise.resolve({ trackId: trackA.id, url: "https://cdn.example/a.mp3" });
      }
      if (trackId === trackB.id) {
        return Promise.resolve({ trackId: trackB.id, url: "https://cdn.example/b.mp3" });
      }
      throw new Error(`unexpected track id: ${trackId}`);
    });

    usePlayerStore.getState().setQueue([trackA, trackB], 0);
    usePlayerStore.getState().setPlaying(true);

    let latestTransition: TransitionPhase = "idle";
    const { getByTestId, unmount } = render(
      <ControllerHarness
        onState={({ transitionPhase }) => {
          latestTransition = transitionPhase;
        }}
      />
    );

    await waitFor(() => {
      expect(callCountForTrack(trackA.id)).toBe(1);
      expect(latestTransition).toBe("idle");
    });

    act(() => {
      usePlayerStore.getState().playTrackNow(trackB);
      usePlayerStore.getState().setPlaying(true);
    });

    await waitFor(() => {
      expect(callCountForTrack(trackB.id)).toBeGreaterThanOrEqual(1);
      expect(latestTransition).toBe("fadingIn");
    });
    const recoverCountBaseline = callCountForTrack(trackB.id);

    const audio = getByTestId("player-audio") as HTMLAudioElement;
    act(() => {
      audio.dispatchEvent(new Event("error"));
    });

    await waitFor(() => {
      expect(callCountForTrack(trackB.id)).toBe(recoverCountBaseline);
    });

    await waitFor(() => {
      expect(latestTransition).toBe("idle");
    });

    unmount();
  });

  it("refreshes current play source after playback quality changes", async () => {
    const trackA = createTrack("A");
    let requestCount = 0;

    getTrackPlaySourceMock.mockImplementation((trackId: string, options?: { level?: string }) => {
      requestCount += 1;
      return Promise.resolve({
        trackId,
        url: requestCount === 1 ? "https://cdn.example/a-standard.mp3" : "https://cdn.example/a-lossless.mp3",
        bitrate: options?.level === "lossless" ? 999000 : 320000
      });
    });

    usePlayerStore.getState().setQueue([trackA], 0);
    usePlayerStore.getState().setPlaying(false);

    let latestSource: PlaySource | null = null;
    const { unmount } = render(
      <ControllerHarness
        onState={({ source }) => {
          latestSource = source;
        }}
      />
    );

    await waitFor(() => {
      expect(latestSource?.url).toBe("https://cdn.example/a-standard.mp3");
      expect(requestCount).toBeGreaterThanOrEqual(1);
    });
    const baselineCount = requestCount;

    act(() => {
      usePlayerStore.getState().setPlayQualityLevel("lossless");
    });

    await waitFor(() => {
      expect(requestCount).toBeGreaterThan(baselineCount);
      expect(latestSource?.url).toBe("https://cdn.example/a-lossless.mp3");
    });

    unmount();
  });

  it("refreshes playlist-backed playback when playback quality changes", async () => {
    const playlistTracks = [createTrack("playlist-A"), createTrack("playlist-B")];
    let requestCount = 0;

    getTrackPlaySourceMock.mockImplementation((trackId: string, options?: { level?: string }) => {
      requestCount += 1;
      return Promise.resolve({
        trackId,
        url: requestCount === 1 ? "https://cdn.example/playlist-standard.mp3" : "https://cdn.example/playlist-lossless.mp3",
        bitrate: options?.level === "lossless" ? 999000 : 320000
      });
    });

    usePlayerStore.getState().setQueue(playlistTracks, 0);
    usePlayerStore.getState().setPlaying(false);

    let latestSource: PlaySource | null = null;
    const { unmount } = render(
      <ControllerHarness
        onState={({ source }) => {
          latestSource = source;
        }}
      />
    );

    await waitFor(() => {
      expect(latestSource?.trackId).toBe(playlistTracks[0].id);
      expect(latestSource?.url).toBe("https://cdn.example/playlist-standard.mp3");
    });
    const baselineCount = requestCount;

    act(() => {
      usePlayerStore.getState().setPlayQualityLevel("lossless");
    });

    await waitFor(() => {
      expect(requestCount).toBeGreaterThan(baselineCount);
      expect(latestSource?.url).toBe("https://cdn.example/playlist-lossless.mp3");
    });

    unmount();
  });
});
