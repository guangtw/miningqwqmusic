const ABSOLUTE_URL_PATTERN = /^(?:https?:)?\/\//i;

function isNeteaseThumbnailHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "music.126.net" || normalized.endsWith(".music.126.net");
}

export function getSizedImageUrl(
  url: string | null | undefined,
  options: {
    width: number;
    height?: number;
  }
): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height ?? options.width));
  if (!ABSOLUTE_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const protocolRelative = trimmed.startsWith("//");
    const parsed = new URL(protocolRelative ? `https:${trimmed}` : trimmed);
    if (!isNeteaseThumbnailHost(parsed.hostname)) {
      return trimmed;
    }
    parsed.searchParams.set("param", `${width}y${height}`);
    const nextUrl = parsed.toString();
    return protocolRelative ? nextUrl.replace(/^https:/i, "") : nextUrl;
  } catch {
    return trimmed;
  }
}
