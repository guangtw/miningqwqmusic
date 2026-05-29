"use client";

import { create } from "zustand";
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

export const useAuthStore = create<AuthStore>()((set) => ({
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
      lastSyncState: "success",
      errorMessage: null
    }),
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
}));