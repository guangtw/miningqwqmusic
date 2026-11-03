import { runMusicRequest } from "@/src/lib/music/request-context";
import { getSportScene } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bpmRaw = Number(searchParams.get("bpm") ?? "130");
  const bpm = Number.isNaN(bpmRaw) ? 130 : Math.max(30, Math.min(220, bpmRaw));
  return runApiRoute(() => getSportScene(bpm));
}

export function GET(request: Request) {
  return runMusicRequest(request, () => handleGET(request));
}
