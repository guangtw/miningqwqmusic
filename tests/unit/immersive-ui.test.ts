import { describe, expect, it } from "vitest";
import {
  IMMERSIVE_NAV_ITEMS,
  OBSIDIAN_AMBIENT_FALLBACK,
  canUseMagneticInteraction,
  normalizeAmbientRgb
} from "@/src/lib/immersive-ui";

describe("immersive UI rules", () => {
  it("keeps the floating navigation focused on primary destinations", () => {
    expect(IMMERSIVE_NAV_ITEMS.map((item) => item.id)).toEqual(["home", "search", "library", "listen"]);
    expect(IMMERSIVE_NAV_ITEMS.every((item) => item.label.length > 0)).toBe(true);
  });

  it("uses a cool obsidian fallback when artwork color is unavailable", () => {
    expect(normalizeAmbientRgb(null)).toEqual(OBSIDIAN_AMBIENT_FALLBACK);
    expect(normalizeAmbientRgb({ red: Number.NaN, green: 90, blue: 120 })).toEqual(OBSIDIAN_AMBIENT_FALLBACK);
  });

  it("clamps artwork colors before exposing them to CSS", () => {
    expect(normalizeAmbientRgb({ red: 400, green: -20, blue: 128.4 })).toEqual({
      red: 255,
      green: 0,
      blue: 128
    });
  });

  it("only enables magnetic interaction for precise hover pointers without reduced motion", () => {
    expect(canUseMagneticInteraction({ hover: true, finePointer: true, reducedMotion: false })).toBe(true);
    expect(canUseMagneticInteraction({ hover: false, finePointer: true, reducedMotion: false })).toBe(false);
    expect(canUseMagneticInteraction({ hover: true, finePointer: false, reducedMotion: false })).toBe(false);
    expect(canUseMagneticInteraction({ hover: true, finePointer: true, reducedMotion: true })).toBe(false);
  });
});
