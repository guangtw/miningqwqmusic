import { runMusicRequest } from "@/src/lib/music/request-context";
import { getToplist } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

async function handleGET() {
  return runApiRoute(() => getToplist());
}

export function GET(request?: Request) {
  return runMusicRequest(request ?? new Request("http://local/api/music/toplist"), () => handleGET());
}
