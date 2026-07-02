export type ImmersiveDestination = "home" | "search" | "library" | "listen";

export type AmbientRgb = {
  red: number;
  green: number;
  blue: number;
};

export const IMMERSIVE_NAV_ITEMS: ReadonlyArray<{
  id: ImmersiveDestination;
  label: string;
}> = [
  { id: "home", label: "首页" },
  { id: "search", label: "搜索" },
  { id: "library", label: "音乐库" },
  { id: "listen", label: "一起听" }
];

export const OBSIDIAN_AMBIENT_FALLBACK: AmbientRgb = {
  red: 72,
  green: 84,
  blue: 122
};

function clampChannel(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

export function normalizeAmbientRgb(value: AmbientRgb | null | undefined): AmbientRgb {
  if (!value || !Number.isFinite(value.red) || !Number.isFinite(value.green) || !Number.isFinite(value.blue)) {
    return OBSIDIAN_AMBIENT_FALLBACK;
  }

  return {
    red: clampChannel(value.red),
    green: clampChannel(value.green),
    blue: clampChannel(value.blue)
  };
}

export function canUseMagneticInteraction(input: {
  hover: boolean;
  finePointer: boolean;
  reducedMotion: boolean;
}): boolean {
  return input.hover && input.finePointer && !input.reducedMotion;
}
