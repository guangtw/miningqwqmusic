import { getSearchAssist } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

export async function GET() {
  return runApiRoute(async () => {
    const assist = await getSearchAssist("");
    return {
      items: assist.hotKeywords
    };
  });
}

