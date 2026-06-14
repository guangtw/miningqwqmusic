import crypto from "node:crypto";

type MusicUnblockGracePayload = {
  sub: string;
  exp: number;
};

function getGraceCookieName(): string {
  return process.env.MUSIC_UNBLOCK_GRACE_COOKIE_NAME?.trim() || "mqm_music_unblock_grace";
}

function getGraceSecret(): string | null {
  return process.env.MUSIC_UNBLOCK_GRACE_SECRET?.trim() || process.env.AUTH_JWT_SECRET?.trim() || null;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, item) => {
      const index = item.indexOf("=");
      if (index <= 0) return acc;
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function toTimingSafeBuffer(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

export function createMusicUnblockGraceToken(userId: string, expiresAt: Date): string {
  const secret = getGraceSecret();
  if (!secret) {
    throw new Error("MUSIC_UNBLOCK_GRACE_SECRET is not configured");
  }
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(expiresAt.getTime() / 1000)
    } satisfies MusicUnblockGracePayload),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function hasValidMusicUnblockGraceCookie(request: Request): boolean {
  const secret = getGraceSecret();
  if (!secret) return false;

  const cookies = parseCookies(request.headers.get("cookie"));
  const raw = cookies[getGraceCookieName()];
  if (!raw) return false;

  const [payloadPart, signaturePart] = raw.split(".", 2);
  if (!payloadPart || !signaturePart) return false;

  const expectedSignature = signPayload(payloadPart, secret);
  const actualBuffer = toTimingSafeBuffer(signaturePart);
  const expectedBuffer = toTimingSafeBuffer(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as MusicUnblockGracePayload;
    if (!payload.sub || !Number.isFinite(payload.exp)) {
      return false;
    }
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
