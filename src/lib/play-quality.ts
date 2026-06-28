import type { PlayQualityLevel } from "@/src/types/music";

export const PLAY_QUALITY_LEVELS: PlayQualityLevel[] = [
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

export const PLAY_QUALITY_LABELS: Record<PlayQualityLevel, string> = {
  standard: "标准",
  higher: "较高",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res",
  jyeffect: "高清环绕声",
  sky: "沉浸环绕声",
  dolby: "杜比全景声",
  jymaster: "超清母带"
};

const PLAY_QUALITY_ORDER = new Map<PlayQualityLevel, number>(PLAY_QUALITY_LEVELS.map((level, index) => [level, index]));

export function isPlayQualityLevel(input: string | null | undefined): input is PlayQualityLevel {
  if (!input) return false;
  return PLAY_QUALITY_ORDER.has(input as PlayQualityLevel);
}

export function toPlayQualityLevel(input: string | null | undefined): PlayQualityLevel | undefined {
  if (!input) return undefined;
  const normalized = input.trim();
  if (!normalized) return undefined;
  return isPlayQualityLevel(normalized) ? normalized : undefined;
}

export function sortPlayQualityLevels(levels: Iterable<PlayQualityLevel>): PlayQualityLevel[] {
  const unique = Array.from(new Set(levels));
  unique.sort((left, right) => (PLAY_QUALITY_ORDER.get(left) ?? 0) - (PLAY_QUALITY_ORDER.get(right) ?? 0));
  return unique;
}

export function resolvePlayableQualityFallback(
  requestedLevel: PlayQualityLevel,
  availableLevels: Iterable<PlayQualityLevel>
): PlayQualityLevel | undefined {
  const sorted = sortPlayQualityLevels(availableLevels);
  if (!sorted.length) return undefined;
  const requestedOrder = PLAY_QUALITY_ORDER.get(requestedLevel) ?? 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const candidate = sorted[index];
    const candidateOrder = PLAY_QUALITY_ORDER.get(candidate) ?? 0;
    if (candidateOrder <= requestedOrder) {
      return candidate;
    }
  }
  return sorted[0];
}

export function getPlayQualityLabel(level: PlayQualityLevel | string | null | undefined): string {
  if (!level) return "";
  return isPlayQualityLevel(level) ? PLAY_QUALITY_LABELS[level] : level;
}
