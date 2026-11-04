import type {NextRequest} from "next/server";

/** The public origin is deployment configuration, never a client forwarding header. */
export function emailRequestOriginAllowed(request: NextRequest): boolean {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return true;
  try {
    const actual = new URL(source);
    const configured = process.env.ACCOUNT_PUBLIC_ORIGIN?.trim();
    const expected = new URL(configured || request.nextUrl.origin);
    if (!["http:", "https:"].includes(actual.protocol) || actual.username || actual.password) return false;
    if (configured && (expected.username || expected.password || expected.search || expected.hash || expected.pathname !== "/")) return false;
    if (actual.origin === expected.origin) return true;
    // Next normalizes 127.0.0.1 to localhost in development. Permit only
    // loopback aliases at the same HTTP port; production uses the fixed origin.
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return !configured && process.env.NODE_ENV !== "production" &&
      actual.protocol === "http:" && expected.protocol === "http:" && actual.port === expected.port &&
      loopback.has(actual.hostname) && loopback.has(expected.hostname);
  } catch { return false; }
}
