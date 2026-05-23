import { describe, expect, it } from "vitest";
import { heroActionLabel, nextVolumeAfterMuteToggle } from "@/src/lib/player-ui";

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
});
