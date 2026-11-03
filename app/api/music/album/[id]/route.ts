import { runMusicRequest } from "@/src/lib/music/request-context";
import { getAlbumDetail } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

type Context = {
  params: Promise<{ id: string }>;
};

async function handleGET(_: Request, context: Context) {
  const { id } = await context.params;
  return runApiRoute(() => getAlbumDetail(id));
}

export function GET(_: Request, context: Context) {
  return runMusicRequest(_, () => handleGET(_, context));
}
