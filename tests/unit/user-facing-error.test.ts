import { describe, expect, it } from "vitest";
import { AccountApiError } from "@/src/lib/account-client";
import { ClientApiError } from "@/src/lib/client-api";
import { toUserFacingMessage } from "@/src/lib/user-facing-error";

describe("toUserFacingMessage", () => {
  it("maps failed fetch to a friendly network message", () => {
    expect(toUserFacingMessage(new TypeError("Failed to fetch"), "默认提示")).toBe("网络连接异常，请稍后重试");
  });

  it("maps abort and timeout errors to a timeout message", () => {
    expect(toUserFacingMessage(new DOMException("The operation was aborted", "AbortError"), "默认提示")).toBe("请求超时，请稍后重试");
    expect(toUserFacingMessage(new Error("Request timed out"), "默认提示")).toBe("请求超时，请稍后重试");
  });

  it("maps account api status codes to stable Chinese messages", () => {
    expect(
      toUserFacingMessage(
        new AccountApiError("Unauthorized", {
          code: 5204,
          status: 401
        }),
        "默认提示"
      )
    ).toBe("登录状态已失效，请重新登录");

    expect(
      toUserFacingMessage(
        new AccountApiError("Conflict", {
          code: 5301,
          status: 409
        }),
        "默认提示"
      )
    ).toBe("当前状态已变化，请刷新后重试");
  });

  it("maps generic client api server failures to a service message", () => {
    expect(
      toUserFacingMessage(
        new ClientApiError("Internal Server Error", {
          code: 5000,
          status: 503
        }),
        "默认提示"
      )
    ).toBe("服务暂时不可用，请稍后重试");
  });

  it("preserves friendly Chinese business messages", () => {
    expect(toUserFacingMessage(new Error("兑换码无效、已禁用或已过期。"), "默认提示")).toBe("兑换码无效、已禁用或已过期。");
    expect(toUserFacingMessage({}, "默认提示")).toBe("默认提示");
  });
});
