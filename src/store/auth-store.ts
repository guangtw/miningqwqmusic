"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AccountUser, AuthStatus, PlaybackAuthorization, SyncState } from "@/src/types/account";

type AuthState = {
  status: AuthStatus;
  user: AccountUser | null;
  accessToken: string | null;
  playbackAuthorization: PlaybackAuthorization | null;
  lastSyncState: SyncState;
  errorMessage: string | null;
};

type AuthActions = {
  setRestoring: () => void;
  setAuthenticating: () => void;
  setAuthenticated: (user: AccountUser, accessToken: string, playbackAuthorization?: PlaybackAuthorization | null) => void;
  updateUser: (user: AccountUser) => void;
  updateAccessToken: (accessToken: string) => void;
  updatePlaybackAuthorization: (playbackAuthorization: PlaybackAuthorization | null) => void;
  setDegraded: (message: string) => void;
  setGuest: () => void;
  setError: (message: string) => void;
  setSyncState: (state: SyncState) => void;
};

export type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  status: "guest",
  user: null,
  accessToken: null,
  playbackAuthorization: null,
  lastSyncState: "idle",
  errorMessage: null
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...initialState,
      setRestoring: () =>
        set((state) => ({
          ...state,
          status: "restoring",
          errorMessage: null
        })),
      setAuthenticating: () =>
        set((state) => ({
          ...state,
          status: "authenticating",
          errorMessage: null
        })),
      setAuthenticated: (user, accessToken, playbackAuthorization) =>
        set({
          status: "authenticated",
          user,
          accessToken,
          playbackAuthorization: playbackAuthorization ?? null,
          lastSyncState: "idle",
          errorMessage: null
        }),
      updateUser: (user) =>
        set((state) => ({
          ...state,
          user,
          status: state.accessToken ? "authenticated" : state.status
        })),
      updateAccessToken: (accessToken) =>
        set((state) => ({
          ...state,
          accessToken,
          status: state.user ? "authenticated" : state.status
        })),
      updatePlaybackAuthorization: (playbackAuthorization) =>
        set((state) => ({
          ...state,
          playbackAuthorization
        })),
      setDegraded: (message) =>
        set((state) => ({
          ...state,
          status: state.user || state.accessToken ? "degraded" : "guest",
          errorMessage: message
        })),
      setGuest: () => set({ ...initialState }),
      setError: (message) =>
        set((state) => ({
          ...state,
          status: "error",
          errorMessage: message
        })),
      setSyncState: (lastSyncState) =>
        set((state) => ({
          ...state,
          lastSyncState
        }))
    }),
    {
      name: "qwq-auth-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        status: state.status,
        user: state.user,
        accessToken: state.accessToken,
        playbackAuthorization: state.playbackAuthorization
      })
    }
  )
);
