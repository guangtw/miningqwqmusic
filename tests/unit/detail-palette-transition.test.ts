import { describe, expect, it } from "vitest";
import { beginPaletteTransition, computeRelativeLuminance, deriveDetailForegroundTone, finishPaletteTransition } from "@/src/lib/detail-palette-transition";

const paletteA = {
  bgA: "rgb(10, 20, 30)",
  bgB: "rgb(4, 8, 12)",
  glow: "rgba(10, 20, 30, 0.3)"
};

const paletteB = {
  bgA: "rgb(30, 20, 10)",
  bgB: "rgb(12, 8, 4)",
  glow: "rgba(30, 20, 10, 0.3)"
};

const paletteC = {
  bgA: "rgb(12, 36, 58)",
  bgB: "rgb(8, 18, 30)",
  glow: "rgba(12, 36, 58, 0.35)"
};

describe("detail palette transition", () => {
  it("creates previous/current transition state when palette changes", () => {
    const state = beginPaletteTransition(paletteA, paletteB);
    expect(state.currentPalette).toEqual(paletteB);
    expect(state.previousPalette).toEqual(paletteA);
    expect(state.isTransitioning).toBe(true);
  });

  it("returns stable state when palette is unchanged", () => {
    const state = beginPaletteTransition(paletteA, paletteA);
    expect(state.currentPalette).toEqual(paletteA);
    expect(state.previousPalette).toBeNull();
    expect(state.isTransitioning).toBe(false);
  });

  it("clears previous palette after transition finishes", () => {
    const started = beginPaletteTransition(paletteA, paletteB);
    const finished = finishPaletteTransition(started);
    expect(finished.currentPalette).toEqual(paletteB);
    expect(finished.previousPalette).toBeNull();
    expect(finished.isTransitioning).toBe(false);
  });

  it("keeps transition reentrant on rapid consecutive changes", () => {
    const first = beginPaletteTransition(paletteA, paletteB);
    const second = beginPaletteTransition(first.currentPalette, paletteC);
    expect(second.previousPalette).toEqual(paletteB);
    expect(second.currentPalette).toEqual(paletteC);
    expect(second.isTransitioning).toBe(true);
  });

  it("uses bright foreground tokens on dark backgrounds", () => {
    const tone = deriveDetailForegroundTone({ red: 18, green: 24, blue: 36 });
    expect(tone.isDarkBackground).toBe(true);
    expect(tone.main).toContain("248, 251, 255");
    expect(tone.controlBorder).toContain("255, 255, 255");
  });

  it("uses dark foreground tokens on bright backgrounds", () => {
    const tone = deriveDetailForegroundTone({ red: 220, green: 232, blue: 244 });
    expect(tone.isDarkBackground).toBe(false);
    expect(tone.main).toContain("13, 21, 33");
    expect(tone.controlBorder).toContain("21, 37, 56");
  });

  it("computes relative luminance with higher value for bright colors", () => {
    const darkLuminance = computeRelativeLuminance({ red: 22, green: 30, blue: 42 });
    const brightLuminance = computeRelativeLuminance({ red: 236, green: 242, blue: 248 });
    expect(brightLuminance).toBeGreaterThan(darkLuminance);
  });
});
