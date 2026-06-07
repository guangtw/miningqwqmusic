"use client";

import { create } from "zustand";
import type { FriendRequestsResult, FriendSearchResult, FriendSummary, ListenRoomInviteSummary } from "@/src/types/account";

type FriendPanelState = {
  friends: FriendSummary[];
  requests: FriendRequestsResult;
  invites: ListenRoomInviteSummary[];
  searchResults: FriendSearchResult[];
  loading: boolean;
  message: string | null;
};

type FriendPanelActions = {
  setFriends: (friends: FriendSummary[]) => void;
  setRequests: (requests: FriendRequestsResult) => void;
  setInvites: (invites: ListenRoomInviteSummary[]) => void;
  setSearchResults: (searchResults: FriendSearchResult[]) => void;
  setLoading: (loading: boolean) => void;
  setMessage: (message: string | null) => void;
  reset: () => void;
};

const emptyRequests: FriendRequestsResult = {
  incoming: [],
  outgoing: []
};

export type FriendStore = FriendPanelState & FriendPanelActions;

export const useFriendStore = create<FriendStore>()((set) => ({
  friends: [],
  requests: emptyRequests,
  invites: [],
  searchResults: [],
  loading: false,
  message: null,
  setFriends: (friends) => set({ friends }),
  setRequests: (requests) => set({ requests }),
  setInvites: (invites) => set({ invites }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setLoading: (loading) => set({ loading }),
  setMessage: (message) => set({ message }),
  reset: () =>
    set({
      friends: [],
      requests: emptyRequests,
      invites: [],
      searchResults: [],
      loading: false,
      message: null
    })
}));
