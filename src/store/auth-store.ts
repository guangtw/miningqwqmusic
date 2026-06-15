"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AccountUser, AuthStatus, SyncState } from "@/src/types/account";

type AuthState = {
  status: AuthStatus;
  user: AccountUser | null;
  accessToken: string | null;
  lastSyncState: SyncState;
  errorMessage: string | null;
};

type AuthActions = {
  setAuthenticating: () => void;
  setAuthenticated: (user: AccountUser, accessToken: string) => void;
  updateUser: (user: AccountUser) => void;
  updateAccessToken: (accessToken: string) => void;
  setGuest: () => void;
  setError: (message: string) => void;
  setSyncState: (state: SyncState) => void;
};

export type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  status: "guest",
  user: null,
  accessToken: null,
  lastSyncState: "idle",
  errorMessage: null
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...initialState,
      setAuthenticating: () =>
        set((state) => ({
          ...state,
          status: "authenticating",
          errorMessage: null
        })),
      setAuthenticated: (user, accessToken) =>
        set({
          status: "authenticated",
          user,
          accessToken,
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
        accessToken: state.accessToken
      })
    }
  )
);
