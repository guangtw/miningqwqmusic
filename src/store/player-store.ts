"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ImportedPlaylist, PlaybackMode, PlayQualityLevel, Track } from "@/src/types/music";

type PersistTrack = Track;

type PlayerState = {
  queue: PersistTrack[];
  currentIndex: number;
  mode: PlaybackMode;
  shuffleHistoryTrackIds: string[];
  isPlaying: boolean;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  favorites: Record<string, PersistTrack>;
  recent: PersistTrack[];
  importedPlaylists: Record<string, ImportedPlaylist>;
  playQualityLevel: PlayQualityLevel;
  hasHydrated: boolean;
};

type PlayerActions = {
  setHydrated: (hydrated: boolean) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  addToQueue: (track: Track, asNext?: boolean) => void;
  playTrackNow: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
  togglePlay: () => void;
  setPlaying: (isPlaying: boolean) => void;
  setPlaybackMode: (mode: PlaybackMode) => void;
  nextMode: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  nextTrackByUser: () => void;
  previousTrackByUser: () => void;
  setCurrentTimeMs: (value: number) => void;
  setDurationMs: (value: number) => void;
  setVolume: (value: number) => void;
  toggleFavorite: (track: Track) => void;
  rememberTrack: (track: Track) => void;
  upsertImportedPlaylist: (playlist: ImportedPlaylist) => void;
  removeImportedPlaylist: (playlistId: string) => void;
  replaceLibraryState: (payload: {
    favorites: Record<string, Track>;
    recent: Track[];
    importedPlaylists: Record<string, ImportedPlaylist>;
  }) => void;
  setPlayQualityLevel: (level: PlayQualityLevel) => void;
  listImportedPlaylists: () => ImportedPlaylist[];
};

export type PlayerStore = PlayerState & PlayerActions;

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
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
      hasHydrated: false,
      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      setQueue: (tracks, startIndex = 0) => {
        const safeIndex = tracks.length ? Math.min(Math.max(startIndex, 0), tracks.length - 1) : -1;
        set({
          queue: tracks,
          currentIndex: safeIndex,
          shuffleHistoryTrackIds: [],
          isPlaying: safeIndex >= 0,
          currentTimeMs: 0
        });
      },
      addToQueue: (track, asNext = false) => {
        const state = get();
        const exists = state.queue.some((item) => item.id === track.id);
        if (exists) return;

        if (!asNext || state.currentIndex < 0) {
          set({ queue: [...state.queue, track] });
          return;
        }

        const insertPos = state.currentIndex + 1;
        const queue = [...state.queue.slice(0, insertPos), track, ...state.queue.slice(insertPos)];
        set({ queue });
      },
      playTrackNow: (track) => {
        const state = get();
        const existingIndex = state.queue.findIndex((item) => item.id === track.id);
        if (existingIndex >= 0) {
          set({
            currentIndex: existingIndex,
            isPlaying: true,
            currentTimeMs: 0
          });
          return;
        }
        set({
          queue: [track, ...state.queue],
          currentIndex: 0,
          isPlaying: true,
          currentTimeMs: 0
        });
      },
      removeFromQueue: (trackId) => {
        const state = get();
        const index = state.queue.findIndex((item) => item.id === trackId);
        if (index < 0) return;

        const queue = state.queue.filter((item) => item.id !== trackId);
        let currentIndex = state.currentIndex;
        if (index < state.currentIndex) currentIndex -= 1;
        if (index === state.currentIndex) currentIndex = Math.min(currentIndex, queue.length - 1);

        set({
          queue,
          currentIndex: queue.length ? Math.max(0, currentIndex) : -1,
          shuffleHistoryTrackIds: state.shuffleHistoryTrackIds.filter((id) => id !== trackId),
          isPlaying: queue.length ? state.isPlaying : false
        });
      },
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaying: (isPlaying) => set({ isPlaying }),
      setPlaybackMode: (mode) => set({ mode, shuffleHistoryTrackIds: [] }),
      nextMode: () =>
        set((state) => {
          if (state.mode === "sequence") return { mode: "loop-one" as PlaybackMode, shuffleHistoryTrackIds: [] };
          if (state.mode === "loop-one") return { mode: "shuffle" as PlaybackMode, shuffleHistoryTrackIds: [] };
          return { mode: "sequence" as PlaybackMode, shuffleHistoryTrackIds: [] };
        }),
      nextTrack: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "loop-one") return { currentTimeMs: 0, isPlaying: true };
          if (state.mode === "shuffle") {
            if (state.queue.length === 1) return { currentTimeMs: 0, isPlaying: true };
            const currentTrackId = state.queue[state.currentIndex]?.id;
            let randomIndex = state.currentIndex;
            while (randomIndex === state.currentIndex) {
              randomIndex = Math.floor(Math.random() * state.queue.length);
            }
            const history = currentTrackId
              ? [...state.shuffleHistoryTrackIds, currentTrackId].slice(-200)
              : state.shuffleHistoryTrackIds;
            return {
              currentIndex: randomIndex,
              shuffleHistoryTrackIds: history,
              currentTimeMs: 0,
              isPlaying: true
            };
          }
          const nextIndex = state.currentIndex + 1;
          if (nextIndex >= state.queue.length) return { currentIndex: 0, currentTimeMs: 0, isPlaying: true };
          return { currentIndex: nextIndex, currentTimeMs: 0, isPlaying: true };
        }),
      previousTrack: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "loop-one") return { currentTimeMs: 0, isPlaying: true };
          if (state.mode === "shuffle") {
            const history = [...state.shuffleHistoryTrackIds];
            while (history.length) {
              const previousTrackId = history.pop();
              if (!previousTrackId) continue;
              const previousIndex = state.queue.findIndex((item) => item.id === previousTrackId);
              if (previousIndex >= 0 && previousIndex !== state.currentIndex) {
                return {
                  currentIndex: previousIndex,
                  shuffleHistoryTrackIds: history,
                  currentTimeMs: 0,
                  isPlaying: true
                };
              }
            }
          }
          const previousIndex = state.currentIndex - 1;
          if (previousIndex < 0) return { currentIndex: state.queue.length - 1, currentTimeMs: 0, isPlaying: true };
          return { currentIndex: previousIndex, currentTimeMs: 0, isPlaying: true };
        }),
      nextTrackByUser: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "shuffle") {
            if (state.queue.length === 1) return { currentTimeMs: 0, isPlaying: true };
            const currentTrackId = state.queue[state.currentIndex]?.id;
            let randomIndex = state.currentIndex;
            while (randomIndex === state.currentIndex) {
              randomIndex = Math.floor(Math.random() * state.queue.length);
            }
            const history = currentTrackId
              ? [...state.shuffleHistoryTrackIds, currentTrackId].slice(-200)
              : state.shuffleHistoryTrackIds;
            return {
              currentIndex: randomIndex,
              shuffleHistoryTrackIds: history,
              currentTimeMs: 0,
              isPlaying: true
            };
          }
          const nextIndex = state.currentIndex + 1;
          if (nextIndex >= state.queue.length) return { currentIndex: 0, currentTimeMs: 0, isPlaying: true };
          return { currentIndex: nextIndex, currentTimeMs: 0, isPlaying: true };
        }),
      previousTrackByUser: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "shuffle") {
            const history = [...state.shuffleHistoryTrackIds];
            while (history.length) {
              const previousTrackId = history.pop();
              if (!previousTrackId) continue;
              const previousIndex = state.queue.findIndex((item) => item.id === previousTrackId);
              if (previousIndex >= 0 && previousIndex !== state.currentIndex) {
                return {
                  currentIndex: previousIndex,
                  shuffleHistoryTrackIds: history,
                  currentTimeMs: 0,
                  isPlaying: true
                };
              }
            }
          }
          const previousIndex = state.currentIndex - 1;
          if (previousIndex < 0) return { currentIndex: state.queue.length - 1, currentTimeMs: 0, isPlaying: true };
          return { currentIndex: previousIndex, currentTimeMs: 0, isPlaying: true };
        }),
      setCurrentTimeMs: (value) => set({ currentTimeMs: value }),
      setDurationMs: (value) => set({ durationMs: value }),
      setVolume: (value) => set({ volume: Math.min(1, Math.max(0, value)) }),
      toggleFavorite: (track) =>
        set((state) => {
          const favorites = { ...state.favorites };
          if (favorites[track.id]) {
            delete favorites[track.id];
          } else {
            favorites[track.id] = track;
          }
          return { favorites };
        }),
      rememberTrack: (track) =>
        set((state) => {
          const withoutCurrent = state.recent.filter((item) => item.id !== track.id);
          return { recent: [track, ...withoutCurrent].slice(0, 50) };
        }),
      upsertImportedPlaylist: (playlist) =>
        set((state) => ({
          importedPlaylists: {
            ...state.importedPlaylists,
            [playlist.id]: playlist
          }
        })),
      removeImportedPlaylist: (playlistId) =>
        set((state) => {
          const next = { ...state.importedPlaylists };
          delete next[playlistId];
          return { importedPlaylists: next };
        }),
      replaceLibraryState: ({ favorites, recent, importedPlaylists }) =>
        set({
          favorites: { ...favorites },
          recent: [...recent].slice(0, 50),
          importedPlaylists: { ...importedPlaylists }
        }),
      setPlayQualityLevel: (playQualityLevel) => set({ playQualityLevel }),
      listImportedPlaylists: () => {
        const state = get();
        return Object.values(state.importedPlaylists).sort((a, b) => b.updatedAt - a.updatedAt);
      }
    }),
    {
      name: "qwq-music-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        mode: state.mode,
        volume: state.volume,
        favorites: state.favorites,
        recent: state.recent,
        importedPlaylists: state.importedPlaylists,
        playQualityLevel: state.playQualityLevel
      }),
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState as PlayerStore;
        const state = persistedState as Partial<PlayerStore> & {
          playSourceGeneration?: number;
          playUnblockMode?: unknown;
        };
        const normalizedState =
          version < 2
            ? {
                ...state,
                importedPlaylists: {}
              }
            : state;
        const { playSourceGeneration: _legacyPlaySourceGeneration, playUnblockMode: _legacyPlayUnblockMode, ...nextState } =
          normalizedState;
        return {
          ...nextState,
          importedPlaylists: normalizedState.importedPlaylists ?? {},
          playQualityLevel: normalizedState.playQualityLevel ?? "standard"
        } as PlayerStore;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
      version: 5
    }
  )
);

export function getCurrentTrack(state: PlayerStore): Track | null {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return null;
  return state.queue[state.currentIndex];
}

export function pickCurrentTrack(queue: Track[], currentIndex: number): Track | null {
  if (currentIndex < 0 || currentIndex >= queue.length) return null;
  return queue[currentIndex];
}
