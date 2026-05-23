import { getDownloadSource } from "@/src/lib/music/service";
import { runApiRoute } from "@/src/lib/api-route";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") ?? "").trim() || undefined;
  return runApiRoute(() => getDownloadSource(id, level));
}

