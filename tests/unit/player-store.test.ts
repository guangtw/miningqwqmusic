import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/src/store/player-store";
import type { ImportedPlaylist, Track } from "@/src/types/music";

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
      shuffleHistoryTrackIds: [],
      isPlaying: false,
      currentTimeMs: 0,
      durationMs: 0,
      volume: 0.8,
      favorites: {},
      recent: [],
      importedPlaylists: {},
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
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual(["1"]);
    randomSpy.mockRestore();
  });

  it("uses real playback history for previousTrack in shuffle mode", () => {
    const tracks = [mockTrack("1"), mockTrack("2"), mockTrack("3")];
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().setPlaybackMode("shuffle");

    const randomSpy = vi.spyOn(Math, "random").mockReturnValueOnce(0.8).mockReturnValueOnce(0.0);
    usePlayerStore.getState().nextTrack();
    usePlayerStore.getState().nextTrack();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual(["1", "3"]);

    usePlayerStore.getState().previousTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual(["1"]);

    usePlayerStore.getState().previousTrack();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual([]);
    expect(randomSpy).toHaveBeenCalledTimes(2);

    randomSpy.mockRestore();
  });

  it("does not randomize previousTrack in shuffle mode", () => {
    const tracks = [mockTrack("1"), mockTrack("2"), mockTrack("3")];
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().setPlaybackMode("shuffle");

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.8);
    usePlayerStore.getState().nextTrack();
    expect(randomSpy).toHaveBeenCalledTimes(1);

    usePlayerStore.getState().previousTrack();
    expect(randomSpy).toHaveBeenCalledTimes(1);

    randomSpy.mockRestore();
  });

  it("clears shuffle history when queue changes, track removed, or mode changes", () => {
    const tracks = [mockTrack("1"), mockTrack("2"), mockTrack("3")];
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().setPlaybackMode("shuffle");

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.8);
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual(["1"]);

    usePlayerStore.getState().removeFromQueue("1");
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual([]);

    usePlayerStore.getState().setQueue(tracks, 0);
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual([]);

    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual(["1"]);

    usePlayerStore.getState().setPlaybackMode("sequence");
    expect(usePlayerStore.getState().shuffleHistoryTrackIds).toEqual([]);

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

  it("upserts and removes imported playlists", () => {
    const playlistA: ImportedPlaylist = {
      id: "1",
      name: "歌单 A",
      tracks: [mockTrack("11")],
      sourceUrl: "https://music.163.com/playlist?id=1",
      importedAt: 1,
      updatedAt: 1
    };
    const playlistAUpdated: ImportedPlaylist = {
      ...playlistA,
      name: "歌单 A 新版",
      updatedAt: 3
    };
    const playlistB: ImportedPlaylist = {
      id: "2",
      name: "歌单 B",
      tracks: [mockTrack("22")],
      sourceUrl: "https://music.163.com/playlist?id=2",
      importedAt: 2,
      updatedAt: 2
    };

    usePlayerStore.getState().upsertImportedPlaylist(playlistA);
    usePlayerStore.getState().upsertImportedPlaylist(playlistB);
    usePlayerStore.getState().upsertImportedPlaylist(playlistAUpdated);

    const list = usePlayerStore.getState().listImportedPlaylists();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("1");
    expect(list[0].name).toBe("歌单 A 新版");

    usePlayerStore.getState().removeImportedPlaylist("1");
    expect(usePlayerStore.getState().listImportedPlaylists()).toHaveLength(1);
    expect(usePlayerStore.getState().listImportedPlaylists()[0].id).toBe("2");
  });
});
