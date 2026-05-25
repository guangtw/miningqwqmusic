import { describe, expect, it } from "vitest";
import {
  countUniqueLibraryTracks,
  heroActionLabel,
  nextVolumeAfterMuteToggle,
  shouldTogglePlaybackBySpace
} from "@/src/lib/player-ui";

describe("player ui helpers", () => {
  it("toggles mute volume with restore", () => {
    const muted = nextVolumeAfterMuteToggle(0.8, 0.8);
    expect(muted.volume).toBe(0);
    expect(muted.previousVolume).toBe(0.8);

    const restored = nextVolumeAfterMuteToggle(muted.volume, muted.previousVolume);
    expect(restored.volume).toBe(0.8);
  });

  it("returns hero action label", () => {
    expect(heroActionLabel(false, false)).toBe("去搜索");
    expect(heroActionLabel(true, false)).toBe("开始播放");
    expect(heroActionLabel(true, true)).toBe("暂停播放");
  });

  it("counts unique tracks across favorites and recent", () => {
    const favorites = {
      a: { id: "a" },
      b: { id: "b" }
    };
    const recent = [{ id: "b" }, { id: "c" }];
    expect(countUniqueLibraryTracks(favorites, recent)).toBe(3);
  });

  it("does not toggle playback by space inside editable inputs", () => {
    const input = document.createElement("input");
    expect(
      shouldTogglePlaybackBySpace({
        key: " ",
        code: "Space",
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: input
      })
    ).toBe(false);
  });

  it("toggles playback by space on non-editable target", () => {
    const target = document.createElement("div");
    expect(
      shouldTogglePlaybackBySpace({
        key: " ",
        code: "Space",
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target
      })
    ).toBe(true);
  });
});
