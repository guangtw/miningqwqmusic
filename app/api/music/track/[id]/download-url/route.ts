import { runMusicRequest } from "@/src/lib/music/request-context";
import { getDownloadSource } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";
import { AppError } from "@/src/lib/errors";
import { offlineAudioSource } from "@/src/lib/music/offline-audio";
import { toPlayQualityLevel } from "@/src/lib/music-playback-auth";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(request: Request, context: Context) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") ?? "").trim() || undefined;
  if (searchParams.get("offline") === "android") {
    const response = await runApiRoute(async () => {
      const quality = toPlayQualityLevel(level);
      if (!quality || !/^[0-9]{1,24}$/.test(id)) throw new AppError("歌曲或音质参数无效。", { code: 4001, status: 400 });
      const source = await getDownloadSource(id, quality, true);
      const offline = source.trackId === id ? offlineAudioSource(source) : undefined;
      if (!offline) throw new AppError("此音源不支持保存到 App。", { code: 3011, status: 404 });
      return { ...source, offline };
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return runApiRoute(() => getDownloadSource(id, level));
}

export function GET(request: Request, context: Context) {
  return runMusicRequest(request, () => handleGET(request, context));
}
