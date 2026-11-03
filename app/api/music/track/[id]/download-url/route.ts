import { runMusicRequest } from "@/src/lib/music/request-context";
import { getDownloadSource } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(request: Request, context: Context) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") ?? "").trim() || undefined;
  return runApiRoute(() => getDownloadSource(id, level));
}

export function GET(request: Request, context: Context) {
  return runMusicRequest(request, () => handleGET(request, context));
}
