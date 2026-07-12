import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("shared detail track motion", () => {
  it("transitions title and artist typography with the returning shared layer", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/\.detail-shared-track-copy p,[\s\S]*font-size var\(--detail-shared-duration, var\(--detail-open-duration\)\)/);
    expect(css).toMatch(/\.detail-shared-track-copy p,[\s\S]*line-height var\(--detail-shared-duration, var\(--detail-open-duration\)\)/);
    expect(css).toMatch(/\.detail-shared-track-meta\.phase-closing[\s\S]*--detail-shared-duration: var\(--detail-close-duration\)/);
    expect(css).toMatch(/\.detail-shared-track-copy p[\s\S]*left: var\(--detail-origin-title-left\)/);
    expect(css).toMatch(/\.detail-shared-track-copy span[\s\S]*left: var\(--detail-origin-subtitle-left\)/);
    expect(css).toMatch(
      /\.detail-shared-track-meta\.phase-open \.detail-shared-track-copy p,[\s\S]*left: calc\(var\(--detail-art-left\) \+ \(var\(--detail-art-size\) \/ 2\)\)/
    );
    expect(css).toMatch(/\.detail-shared-track-meta\.phase-open \.detail-shared-track-copy p,[\s\S]*transform: translate3d\(-50%, 0, 0\)/);
  });
});
