import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  detectAccountServiceEnabled,
  loadCurrentAccountUser,
  tryRefreshAccessToken
} from "@/src/lib/account-client";
import { useAuthStore } from "@/src/store/auth-store";

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
});