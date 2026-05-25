import { describe, expect, it, vi } from "vitest";
import { nextTheme, readThemePreference, resolveInitialTheme, writeThemePreference } from "@/src/lib/theme-preference";

function createStorageMock(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_: string, next: string) => {
      value = next;
    })
  };
}

describe("theme preference", () => {
  it("defaults to dark when local storage has no valid preference", () => {
    const storage = createStorageMock("unknown-theme");
    const stored = readThemePreference(storage);
    expect(resolveInitialTheme(stored, "dark")).toBe("dark");
  });

  it("persists and restores theme preference", () => {
    const storage = createStorageMock();
    writeThemePreference("light", storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const restored = readThemePreference({
      getItem: () => "light"
    });
    expect(restored).toBe("light");
  });

  it("toggles theme to the opposite mode", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
});
