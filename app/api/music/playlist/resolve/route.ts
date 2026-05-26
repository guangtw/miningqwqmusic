import { AppError } from "@/src/lib/errors";
import { runApiRoute } from "@/src/lib/api-route";
import { extractFirstHttpUrl, extractPlaylistId } from "@/src/lib/playlist-import";

const MAX_REDIRECTS = 5;
const ALLOWED_HOSTS = new Set(["music.163.com", "y.music.163.com", "163cn.tv"]);

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

function assertAllowedUrl(target: URL): void {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new AppError("仅支持 http/https 链接。", { code: 1001, status: 400, retryable: false });
  }
  if (!isAllowedHost(target.hostname)) {
    throw new AppError("链接域名不在支持范围内。", { code: 1001, status: 400, retryable: false });
  }
}

async function resolvePlaylistIdByRedirect(urlText: string): Promise<{ playlistId: string; resolvedUrl?: string }> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(urlText);
  } catch {
    throw new AppError("链接格式无效，请检查后重试。", { code: 1001, status: 400, retryable: false });
  }

  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    assertAllowedUrl(currentUrl);
    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError("短链接跳转失败，请稍后再试。", { code: 1002, status: 502, retryable: true });
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    const resolvedUrl = response.url || currentUrl.toString();
    const playlistId = extractPlaylistId(`${resolvedUrl}\n${currentUrl.toString()}`);
    if (playlistId) {
      return { playlistId, resolvedUrl };
    }
    break;
  }

  throw new AppError("未识别到歌单 ID，请检查链接格式。", { code: 1001, status: 400, retryable: false });
}

export async function GET(request: Request) {
  return runApiRoute(async () => {
    const { searchParams } = new URL(request.url);
    const input = (searchParams.get("input") ?? "").trim();
    if (!input) {
      throw new AppError("请输入网易云歌单链接或歌单 ID。", { code: 1001, status: 400, retryable: false });
    }

    const directPlaylistId = extractPlaylistId(input);
    if (directPlaylistId) {
      return { playlistId: directPlaylistId };
    }

    const firstUrl = extractFirstHttpUrl(input);
    if (!firstUrl) {
      throw new AppError("未识别到歌单 ID，请检查链接格式。", { code: 1001, status: 400, retryable: false });
    }

    return resolvePlaylistIdByRedirect(firstUrl);
  });
}
