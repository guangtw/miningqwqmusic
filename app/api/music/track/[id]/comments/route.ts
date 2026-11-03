import { runApiRoute } from "@/src/lib/api-route";
import { getTrackComments } from "@/src/lib/music/service";
import { decodeCommentCursor, parseTrackCommentQuery } from "@/src/lib/music/comments";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return runApiRoute(async () => {
    const { id } = await context.params;
    const query = parseTrackCommentQuery(new URL(request.url).searchParams);
    decodeCommentCursor(id, query);
    return getTrackComments(id, query);
  });
}
