"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PlaybackMode, Track } from "@/src/types/music";

type PersistTrack = Track;

type PlayerState = {
  queue: PersistTrack[];
  currentIndex: number;
  mode: PlaybackMode;
  isPlaying: boolean;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  favorites: Record<string, PersistTrack>;
  recent: PersistTrack[];
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
  setCurrentTimeMs: (value: number) => void;
  setDurationMs: (value: number) => void;
  setVolume: (value: number) => void;
  toggleFavorite: (track: Track) => void;
  rememberTrack: (track: Track) => void;
};

export type PlayerStore = PlayerState & PlayerActions;

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: -1,
      mode: "sequence",
      isPlaying: false,
      currentTimeMs: 0,
      durationMs: 0,
      volume: 0.8,
      favorites: {},
      recent: [],
      hasHydrated: false,
      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      setQueue: (tracks, startIndex = 0) => {
        const safeIndex = tracks.length ? Math.min(Math.max(startIndex, 0), tracks.length - 1) : -1;
        set({
          queue: tracks,
          currentIndex: safeIndex,
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
          isPlaying: queue.length ? state.isPlaying : false
        });
      },
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaying: (isPlaying) => set({ isPlaying }),
      setPlaybackMode: (mode) => set({ mode }),
      nextMode: () =>
        set((state) => {
          if (state.mode === "sequence") return { mode: "loop-one" as PlaybackMode };
          if (state.mode === "loop-one") return { mode: "shuffle" as PlaybackMode };
          return { mode: "sequence" as PlaybackMode };
        }),
      nextTrack: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "loop-one") return { currentTimeMs: 0, isPlaying: true };
          if (state.mode === "shuffle") {
            if (state.queue.length === 1) return { currentTimeMs: 0, isPlaying: true };
            let randomIndex = state.currentIndex;
            while (randomIndex === state.currentIndex) {
              randomIndex = Math.floor(Math.random() * state.queue.length);
            }
            return { currentIndex: randomIndex, currentTimeMs: 0, isPlaying: true };
          }
          const nextIndex = state.currentIndex + 1;
          if (nextIndex >= state.queue.length) return { currentIndex: 0, currentTimeMs: 0, isPlaying: true };
          return { currentIndex: nextIndex, currentTimeMs: 0, isPlaying: true };
        }),
      previousTrack: () =>
        set((state) => {
          if (!state.queue.length) return { currentIndex: -1, isPlaying: false };
          if (state.mode === "loop-one") return { currentTimeMs: 0, isPlaying: true };
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
        })
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
        recent: state.recent
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
      version: 1
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
