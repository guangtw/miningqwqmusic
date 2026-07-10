import { describe, expect, it } from "vitest";
import {
  easeOutExpo,
  overlayVariants,
  sheetVariants,
  springSoft,
  springSnappy,
  withReducedMotion
} from "@/src/lib/motion-presets";

describe("motion-presets", () => {
  it("exports production spring recipes", () => {
    expect(springSnappy.type).toBe("spring");
    expect(springSoft.type).toBe("spring");
    expect(easeOutExpo).toHaveLength(4);
  });

  it("defines enter/exit sheet variants", () => {
    expect(sheetVariants.hidden).toBeTruthy();
    expect(sheetVariants.visible).toBeTruthy();
    expect(sheetVariants.exit).toBeTruthy();
    expect(overlayVariants.visible).toBeTruthy();
  });

  it("collapses to reduced-motion opacity variants", () => {
    const reduced = withReducedMotion(sheetVariants, true);
    expect(reduced.visible).toEqual({ opacity: 1, transition: { duration: 0.01 } });
    expect(withReducedMotion(sheetVariants, false)).toBe(sheetVariants);
  });
});
