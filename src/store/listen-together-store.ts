"use client";

import { create } from "zustand";
import type { ListenRoomSummary } from "@/src/types/account";

type ListenConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

type ListenTogetherState = {
  room: ListenRoomSummary | null;
  connectionState: ListenConnectionState;
  message: string | null;
  applyingRemote: boolean;
};

type ListenTogetherActions = {
  setRoom: (room: ListenRoomSummary | null) => void;
  setConnectionState: (connectionState: ListenConnectionState) => void;
  setMessage: (message: string | null) => void;
  setApplyingRemote: (applyingRemote: boolean) => void;
  leaveLocal: () => void;
};

export type ListenTogetherStore = ListenTogetherState & ListenTogetherActions;

export const useListenTogetherStore = create<ListenTogetherStore>()((set) => ({
  room: null,
  connectionState: "idle",
  message: null,
  applyingRemote: false,
  setRoom: (room) => set({ room, message: null }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setMessage: (message) => set({ message }),
  setApplyingRemote: (applyingRemote) => set({ applyingRemote }),
  leaveLocal: () =>
    set({
      room: null,
      connectionState: "idle",
      message: null,
      applyingRemote: false
    })
}));
