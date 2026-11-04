import {afterEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import {emailRequestOriginAllowed} from "@/src/lib/email-request-origin";
afterEach(() => vi.unstubAllEnvs());
describe("email BFF origin guard", () => {
  it("uses configured public origin behind the reverse proxy", () => {
    vi.stubEnv("ACCOUNT_PUBLIC_ORIGIN", "https://echo.miningqwq.cn");
    vi.stubEnv("NODE_ENV", "production");
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3001/api/account/auth/email/verify",
      {headers: {origin: "https://echo.miningqwq.cn"}}))).toBe(true);
  });
  it("never trusts a spoofed Host or forwarding header to authorize another site", () => {
    vi.stubEnv("ACCOUNT_PUBLIC_ORIGIN", "https://echo.miningqwq.cn");
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3001/api/account/auth/email/verify",
      {headers: {origin: "https://other.example.test", host: "other.example.test",
        "x-forwarded-host": "other.example.test", "x-forwarded-proto": "https"}}))).toBe(false);
  });
  it.each(["https://echo.miningqwq.cn.evil.test", "http://echo.miningqwq.cn", "null", "https://name:pass@echo.miningqwq.cn"])("rejects %s", origin => {
    vi.stubEnv("ACCOUNT_PUBLIC_ORIGIN", "https://echo.miningqwq.cn");
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3001", {headers: {origin}}))).toBe(false);
  });
  it("supports development loopback aliases at the same HTTP port", () => {
    vi.stubEnv("ACCOUNT_PUBLIC_ORIGIN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3010", {headers: {origin: "http://127.0.0.1:3010"}}))).toBe(true);
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3010", {headers: {origin: "http://127.0.0.1:3011"}}))).toBe(false);
  });
  it("does not enable loopback alias exceptions in production", () => {
    vi.stubEnv("ACCOUNT_PUBLIC_ORIGIN", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(emailRequestOriginAllowed(new NextRequest("http://localhost:3010", {headers: {origin: "http://127.0.0.1:3010"}}))).toBe(false);
  });
});
