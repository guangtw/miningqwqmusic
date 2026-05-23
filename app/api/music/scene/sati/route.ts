import { getSatiScene } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = (searchParams.get("tag") ?? "").trim() || undefined;
  return runApiRoute(() => getSatiScene(tag));
}

