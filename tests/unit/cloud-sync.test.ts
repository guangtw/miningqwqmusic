import { describe, expect, it } from "vitest";
import { resolveCloudPullMode, shouldShowCloudSyncing, shouldSkipRecentCloudPull } from "@/src/lib/cloud-sync";

describe("cloud sync helpers", () => {
  it("defaults background pulls to silent mode", () => {
    expect(resolveCloudPullMode()).toBe("silent");
    expect(shouldShowCloudSyncing()).toBe(false);
  });

  it("marks only visible pulls as syncing", () => {
    expect(resolveCloudPullMode({ mode: "visible" })).toBe("visible");
    expect(shouldShowCloudSyncing({ mode: "visible" })).toBe(true);
    expect(shouldShowCloudSyncing({ mode: "silent" })).toBe(false);
  });

  it("skips redundant library pulls right after a successful sync", () => {
    expect(shouldSkipRecentCloudPull(1000, 2500, 4000)).toBe(true);
    expect(shouldSkipRecentCloudPull(1000, 5500, 4000)).toBe(false);
    expect(shouldSkipRecentCloudPull(0, 5500, 4000)).toBe(false);
  });
});
