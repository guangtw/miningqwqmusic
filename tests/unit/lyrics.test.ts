import { describe, expect, it } from "vitest";
import { locateCurrentLyricIndex, parseLyric } from "@/src/lib/lyrics";

describe("lyrics parser", () => {
  it("parses lrc lines into sorted timeline", () => {
    const raw = "[00:12.32]first line\n[00:03.11]intro\n[00:25.00]ending";
    const lines = parseLyric(raw);
    expect(lines).toHaveLength(3);
    expect(lines[0].text).toBe("intro");
    expect(lines[0].timeMs).toBe(3110);
    expect(lines[2].text).toBe("ending");
  });

  it("finds current line by current time", () => {
    const lines = parseLyric("[00:01.00]a\n[00:04.00]b\n[00:08.00]c");
    expect(locateCurrentLyricIndex(lines, 500)).toBe(0);
    expect(locateCurrentLyricIndex(lines, 4500)).toBe(1);
    expect(locateCurrentLyricIndex(lines, 9000)).toBe(2);
  });
});
