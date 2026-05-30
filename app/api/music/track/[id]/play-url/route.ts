import { failure, success } from "@/src/lib/api-response";
import { toAppError } from "@/src/lib/errors";
import { getPlaySource } from "@/src/lib/music/service";
import { createTraceId } from "@/src/lib/trace";
import type { PlayQualityLevel, PlayUnblockMode } from "@/src/types/music";

type Context = {
  params: Promise<{ id: string }>;
};

const PLAY_QUALITY_LEVELS: PlayQualityLevel[] = [
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "dolby",
  "jymaster"
];
const PLAY_UNBLOCK_MODES: PlayUnblockMode[] = ["auto", "force_on", "force_off"];

function toPlayQualityLevel(input: string | null): PlayQualityLevel | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_QUALITY_LEVELS.includes(normalized as PlayQualityLevel) ? (normalized as PlayQualityLevel) : undefined;
}

function toPlayUnblockMode(input: string | null): PlayUnblockMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return PLAY_UNBLOCK_MODES.includes(normalized as PlayUnblockMode) ? (normalized as PlayUnblockMode) : undefined;
}

export async function GET(request: Request, context: Context) {
  const traceId = createTraceId();
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const data = await getPlaySource(id, {
      level: toPlayQualityLevel(searchParams.get("level")),
      unblockMode: toPlayUnblockMode(searchParams.get("unblockMode"))
    });
    return success(data, traceId);
  } catch (error) {
    const appError = toAppError(error);
    return failure({
      code: appError.code,
      message: appError.message,
      traceId,
      status: appError.status,
      retryable: appError.retryable
    });
  }
}
