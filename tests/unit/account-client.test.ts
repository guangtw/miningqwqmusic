import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  acceptFriendRequest,
  acceptListenInvite,
  cancelFriendRequest,
  createListenRoom,
  deleteFriend,
  detectAccountServiceEnabled,
  getMusicUnblockEntitlement,
  inviteFriendToListenRoom,
  joinListenRoom,
  listFriendRequests,
  listFriends,
  listListenInvites,
  loadCurrentAccountUser,
  rejectFriendRequest,
  rejectListenInvite,
  redeemMusicUnblockInvite,
  searchFriends,
  sendFriendRequest,
  sendListenRoomState,
  tryRefreshAccessToken,
  updateAccountProfile,
  uploadAccountAvatar
} from "@/src/lib/account-client";
import { useAuthStore } from "@/src/store/auth-store";
import type { ListenPlaybackState, ListenRoomSummary } from "@/src/types/account";

function successPayload<T>(data: T) {
  return {
    code: 0,
    data,
    message: "ok",
    traceId: "trace-id"
  };
}

function failurePayload(code: number, message: string) {
  return {
    code,
    message,
    traceId: "trace-id",
    retryable: false
  };
}

function samplePlaybackState(): ListenPlaybackState {
  return {
    queue: [
      {
        id: "track-1",
        name: "Sample Track",
        artists: [{ id: "artist-1", name: "Artist" }],
        durationMs: 180000
      }
    ],
    currentIndex: 0,
    currentTimeMs: 1200,
    isPlaying: true,
    mode: "sequence",
    updatedAt: "2026-06-07T00:00:00.000Z"
  };
}

function sampleListenRoom(overrides: Partial<ListenRoomSummary> = {}): ListenRoomSummary {
  return {
    id: "room-1",
    inviteCode: "ABC123",
    hostUserId: "u1",
    status: "open",
    version: 1,
    playbackState: samplePlaybackState(),
    members: [],
    lastActor: null,
    expiresAt: "2026-06-07T06:00:00.000Z",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides
  };
}

describe("account client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.getState().setGuest();
  });

  it("retries once after refresh when api returns 401", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com"
      },
      "old-token"
    );

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(failurePayload(5204, "Unauthorized")), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ accessToken: "new-token" })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            successPayload({
              id: "u1",
              email: "user@example.com",
              nickname: "mqm"
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    const user = await loadCurrentAccountUser();
    expect(user.email).toBe("user@example.com");
    expect(useAuthStore.getState().accessToken).toBe("new-token");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    const thirdHeaders = fetchMock.mock.calls[2][1]?.headers as Headers;
    expect(firstHeaders.get("authorization")).toBe("Bearer old-token");
    expect(thirdHeaders.get("authorization")).toBe("Bearer new-token");
  });

  it("falls back to guest when refresh fails", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com"
      },
      "old-token"
    );

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(failurePayload(5204, "Unauthorized")), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(failurePayload(5203, "Refresh token invalid or expired")), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      );

    await expect(loadCurrentAccountUser()).rejects.toBeInstanceOf(AccountApiError);
    expect(useAuthStore.getState().status).toBe("guest");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("returns false for service detection when proxy reports not configured", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(failurePayload(5401, "Account service is not configured")), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    );

    const enabled = await detectAccountServiceEnabled();
    expect(enabled).toBe(false);
  });

  it("updates token when refresh succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(successPayload({ accessToken: "fresh-token" })), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const refreshed = await tryRefreshAccessToken();
    expect(refreshed).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
  });

  it("uploads avatar with FormData and updates current user", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com",
        avatarFallbackText: "U",
        avatarFallbackBg: "#2563eb"
      },
      "token-1"
    );
    const updatedUser = {
      id: "u1",
      email: "user@example.com",
      avatarUrl: "/api/account/profile/avatar/avatar.webp",
      avatarFallbackText: "U",
      avatarFallbackBg: "#2563eb"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(successPayload(updatedUser)), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });
    const user = await uploadAccountAvatar(file);

    expect(user.avatarUrl).toBe("/api/account/profile/avatar/avatar.webp");
    expect(useAuthStore.getState().user?.avatarUrl).toBe(user.avatarUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile/avatar",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.has("content-type")).toBe(false);
  });

  it("sends listen-together room requests with playback snapshots", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com"
      },
      "listen-token"
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(sampleListenRoom({ id: "created-room", version: 1 }))), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(sampleListenRoom({ id: "joined-room", version: 1 }))), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(sampleListenRoom({ id: "created-room", version: 2 }))), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(sampleListenRoom({ id: "created-room", version: 3 }))), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const playbackState = samplePlaybackState();
    await createListenRoom(playbackState);
    await joinListenRoom("abc123");
    await sendListenRoomState("created-room", "seek", playbackState);
    await sendListenRoomState("created-room", "progress", playbackState);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/account/listen/rooms");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ playbackState });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/account/listen/rooms/join");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ inviteCode: "abc123" });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/account/listen/rooms/created-room/state");
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({
      type: "seek",
      playbackState
    });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/account/listen/rooms/created-room/state");
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toEqual({
      type: "progress",
      playbackState
    });
  });

  it("gets and redeems music unblock entitlement with auth headers", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com"
      },
      "unblock-token"
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ enabled: false })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(successPayload({ enabled: true, redeemedAt: "2026-06-10T00:00:00.000Z", inviteLabel: "alpha" })),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    const entitlement = await getMusicUnblockEntitlement();
    const redeemed = await redeemMusicUnblockInvite("ABC123");

    expect(entitlement.enabled).toBe(false);
    expect(redeemed.enabled).toBe(true);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/music/unblock/entitlement",
      "/api/account/music/unblock/redeem"
    ]);
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("authorization")).toBe("Bearer unblock-token");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ inviteCode: "ABC123" });
  });

  it("updates account profile and stores the returned user", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com",
        nickname: "Old"
      },
      "profile-token"
    );
    const updatedUser = {
      id: "u1",
      email: "user@example.com",
      nickname: "New",
      avatarFallbackText: "N",
      avatarFallbackBg: "#22c55e"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(successPayload(updatedUser)), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const user = await updateAccountProfile({ nickname: "New" });

    expect(user.nickname).toBe("New");
    expect(useAuthStore.getState().user?.nickname).toBe("New");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ nickname: "New" })
      })
    );
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("authorization")).toBe("Bearer profile-token");
  });

  it("sends friend and listen invite requests with auth headers", async () => {
    useAuthStore.getState().setAuthenticated(
      {
        id: "u1",
        email: "user@example.com"
      },
      "friend-token"
    );
    const user = {
      id: "u2",
      email: "friend@example.com",
      nickname: "Friend"
    };
    const request = {
      id: "request-1",
      requester: { id: "u1", email: "user@example.com" },
      addressee: user,
      status: "pending",
      direction: "outgoing",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      respondedAt: null
    };
    const invite = {
      id: "invite-1",
      roomId: "room-1",
      inviteCode: "ABC123",
      status: "pending",
      inviter: { id: "u1", email: "user@example.com" },
      invitee: user,
      roomStatus: "open",
      memberCount: 2,
      expiresAt: "2026-06-07T06:00:00.000Z",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      respondedAt: null
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload([{ user, relationStatus: "none" }])), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload([{ user, since: "2026-06-07T00:00:00.000Z" }])), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ incoming: [], outgoing: [request] })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(request)), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ ...request, status: "accepted" })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ ...request, status: "rejected" })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ ...request, status: "canceled" })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ ok: true })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload([invite])), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload(invite)), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ invite: { ...invite, status: "accepted" }, room: sampleListenRoom() })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successPayload({ ...invite, status: "rejected" })), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    await searchFriends(" Friend ");
    await listFriends();
    await listFriendRequests();
    await sendFriendRequest("u2");
    await acceptFriendRequest("request-1");
    await rejectFriendRequest("request-1");
    await cancelFriendRequest("request-1");
    await deleteFriend("u2");
    await listListenInvites();
    await inviteFriendToListenRoom("room-1", "u2");
    await acceptListenInvite("invite-1");
    await rejectListenInvite("invite-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/friends/search?q=Friend",
      "/api/account/friends",
      "/api/account/friends/requests",
      "/api/account/friends/requests",
      "/api/account/friends/requests/request-1/accept",
      "/api/account/friends/requests/request-1/reject",
      "/api/account/friends/requests/request-1/cancel",
      "/api/account/friends/u2",
      "/api/account/listen/invites",
      "/api/account/listen/rooms/room-1/invites",
      "/api/account/listen/invites/invite-1/accept",
      "/api/account/listen/invites/invite-1/reject"
    ]);
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("authorization")).toBe("Bearer friend-token");
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toEqual({ userId: "u2" });
    expect((fetchMock.mock.calls[7][1] as RequestInit).method).toBe("DELETE");
    expect(JSON.parse(String((fetchMock.mock.calls[9][1] as RequestInit).body))).toEqual({ friendUserId: "u2" });
  });
});
