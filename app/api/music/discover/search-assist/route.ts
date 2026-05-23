import { runApiRoute } from "@/src/lib/api-route";
import { getSearchAssist } from "@/src/lib/music/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get("q") ?? "").trim();
  return runApiRoute(() => getSearchAssist(keyword));
}
