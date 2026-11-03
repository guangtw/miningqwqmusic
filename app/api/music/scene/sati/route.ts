import { runMusicRequest } from "@/src/lib/music/request-context";
import { getSatiScene } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = (searchParams.get("tag") ?? "").trim() || undefined;
  return runApiRoute(() => getSatiScene(tag));
}

export function GET(request: Request) {
  return runMusicRequest(request, () => handleGET(request));
}
