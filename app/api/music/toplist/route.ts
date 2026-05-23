import { getToplist } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

export async function GET() {
  return runApiRoute(() => getToplist());
}

