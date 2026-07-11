import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("shared detail track motion", () => {
  it("transitions title and artist typography with the returning shared layer", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/\.detail-shared-track-copy p[\s\S]*font-size var\(--detail-open-duration\)/);
    expect(css).toMatch(/\.detail-shared-track-copy span[\s\S]*font-size var\(--detail-open-duration\)/);
    expect(css).toMatch(/\.detail-shared-track-meta\.phase-closing \.detail-shared-track-copy p[\s\S]*transition-duration: var\(--detail-close-duration\)/);
    expect(css).toMatch(/\.detail-shared-track-meta\.phase-open \.detail-shared-track-copy p,[\s\S]*left: 50%/);
  });
});
