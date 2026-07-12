import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("player app focus playback behavior", () => {
  it("does not refresh the audio source just because the window regains focus", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/player-app.tsx"), "utf8");

    expect(source).toContain('void triggerCloudPull("window-focus")');
    expect(source).toContain('void triggerCloudPull("tab-visible")');
    expect(source).not.toContain("setPlaybackResumeToken");
    expect(source).not.toContain("resumePlaybackToken:");
  });
});
