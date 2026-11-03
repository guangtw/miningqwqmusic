import { runMusicRequest } from "@/src/lib/music/request-context";
import { runApiRoute } from "@/src/lib/api-route";
import { getTrackComments } from "@/src/lib/music/service";
import { decodeCommentCursor, parseTrackCommentQuery } from "@/src/lib/music/comments";

type Context = { params: Promise<{ id: string }> };
async function handleGET(request: Request, context: Context) {
  return runApiRoute(async () => {
    const { id } = await context.params;
    const query = parseTrackCommentQuery(new URL(request.url).searchParams);
    decodeCommentCursor(id, query);
    return getTrackComments(id, query);
  });
}

export function GET(request: Request, context: Context) {
  return runMusicRequest(request, () => handleGET(request, context));
}
