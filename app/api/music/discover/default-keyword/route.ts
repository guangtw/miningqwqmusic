import { runMusicRequest } from "@/src/lib/music/request-context";
import { getSearchAssist } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

async function handleGET() {
  return runApiRoute(async () => {
    const assist = await getSearchAssist("");
    return {
      keyword: assist.defaultKeyword ?? ""
    };
  });
}

export function GET(request?: Request) {
  return runMusicRequest(request ?? new Request("http://local/api/music/discover/default-keyword"), () => handleGET());
}
