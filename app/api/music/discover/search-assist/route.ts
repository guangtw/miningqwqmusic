import { runMusicRequest } from "@/src/lib/music/request-context";
import { runApiRoute } from "@/src/lib/api-route";
import { getSearchAssist } from "@/src/lib/music/service";

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get("q") ?? "").trim();
  return runApiRoute(() => getSearchAssist(keyword));
}

export function GET(request: Request) {
  return runMusicRequest(request, () => handleGET(request));
}
