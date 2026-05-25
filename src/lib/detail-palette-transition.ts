export type PaletteLike = {
  bgA: string;
  bgB: string;
  glow: string;
};

export type PaletteRgbSource = {
  red: number;
  green: number;
  blue: number;
};

export type PaletteTransitionState<TPalette extends PaletteLike> = {
  currentPalette: TPalette;
  previousPalette: TPalette | null;
  isTransitioning: boolean;
};

export type DetailForegroundTone = {
  isDarkBackground: boolean;
  main: string;
  sub: string;
  soft: string;
  controlBg: string;
  controlBorder: string;
  controlHover: string;
  controlActive: string;
  overlay: string;
  dockBg: string;
  rangeInactive: string;
};

function isSamePalette(a: PaletteLike, b: PaletteLike): boolean {
  return a.bgA === b.bgA && a.bgB === b.bgB && a.glow === b.glow;
}

function normalizeColorChannel(channel: number): number {
  if (!Number.isFinite(channel)) return 0;
  return Math.min(255, Math.max(0, channel)) / 255;
}

function srgbToLinear(channel: number): number {
  if (channel <= 0.04045) return channel / 12.92;
  return ((channel + 0.055) / 1.055) ** 2.4;
}

export function computeRelativeLuminance(source: PaletteRgbSource): number {
  const red = srgbToLinear(normalizeColorChannel(source.red));
  const green = srgbToLinear(normalizeColorChannel(source.green));
  const blue = srgbToLinear(normalizeColorChannel(source.blue));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function deriveDetailForegroundTone(source: PaletteRgbSource): DetailForegroundTone {
  const luminance = computeRelativeLuminance(source);
  const isDarkBackground = luminance < 0.42;

  if (isDarkBackground) {
    return {
      isDarkBackground: true,
      main: "rgba(248, 251, 255, 0.98)",
      sub: "rgba(227, 235, 247, 0.86)",
      soft: "rgba(210, 220, 235, 0.7)",
      controlBg: "rgba(255, 255, 255, 0.1)",
      controlBorder: "rgba(255, 255, 255, 0.24)",
      controlHover: "rgba(255, 255, 255, 0.2)",
      controlActive: "rgba(255, 255, 255, 0.2)",
      overlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(0, 0, 0, 0.32))",
      dockBg: "linear-gradient(180deg, rgba(10, 16, 24, 0.22), rgba(6, 10, 15, 0.78))",
      rangeInactive: "rgba(255, 255, 255, 0.26)"
    };
  }

  return {
    isDarkBackground: false,
    main: "rgba(13, 21, 33, 0.96)",
    sub: "rgba(27, 39, 56, 0.84)",
    soft: "rgba(45, 60, 80, 0.72)",
    controlBg: "rgba(15, 25, 36, 0.11)",
    controlBorder: "rgba(21, 37, 56, 0.24)",
    controlHover: "rgba(20, 33, 48, 0.18)",
    controlActive: "rgba(20, 33, 48, 0.2)",
    overlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(7, 14, 24, 0.2))",
    dockBg: "linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(220, 232, 245, 0.82))",
    rangeInactive: "rgba(17, 28, 42, 0.2)"
  };
}

export function beginPaletteTransition<TPalette extends PaletteLike>(
  currentPalette: TPalette,
  nextPalette: TPalette
): PaletteTransitionState<TPalette> {
  if (isSamePalette(currentPalette, nextPalette)) {
    return {
      currentPalette,
      previousPalette: null,
      isTransitioning: false
    };
  }
  return {
    currentPalette: nextPalette,
    previousPalette: currentPalette,
    isTransitioning: true
  };
}

export function finishPaletteTransition<TPalette extends PaletteLike>(
  state: PaletteTransitionState<TPalette>
): PaletteTransitionState<TPalette> {
  return {
    currentPalette: state.currentPalette,
    previousPalette: null,
    isTransitioning: false
  };
}
