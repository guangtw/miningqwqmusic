import { describe, expect, it } from "vitest";
import { breakDisplayTitle, formatDisplayTitle, measureTitleWidth } from "@/src/lib/title-line-break";

describe("breakDisplayTitle", () => {
  it("breaks the stage hero title on phrase boundaries", () => {
    const lines = breakDisplayTitle("民谣太安静 摇滚太喧嚣 赵雷梁博刚刚好");
    expect(lines).toEqual(["民谣太安静 摇滚太喧嚣", "赵雷梁博刚刚好"]);
  });

  it("does not leave a dangling clause like 摇滚太 / 喧嚣", () => {
    const formatted = formatDisplayTitle("民谣太安静 摇滚太喧嚣 赵雷梁博刚刚好");
    expect(formatted).not.toContain("摇滚太\n喧嚣");
    expect(formatted.split("\n")).toHaveLength(2);
  });

  it("keeps short titles on one line", () => {
    expect(breakDisplayTitle("今日推荐")).toEqual(["今日推荐"]);
  });

  it("balances two space-separated phrases", () => {
    expect(breakDisplayTitle("深夜回声 城市氛围")).toEqual(["深夜回声", "城市氛围"]);
  });

  it("character-breaks long continuous Chinese without orphan tails", () => {
    const lines = breakDisplayTitle("这是一段没有空格的超长中文标题用来测试换行", {
      maxLines: 2,
      targetCharsPerLine: 10,
      maxCharsPerLine: 12
    });
    expect(lines.length).toBe(2);
    expect(lines[0]!.length).toBeGreaterThan(4);
    expect(lines[1]!.length).toBeGreaterThan(4);
    // Lines should be reasonably balanced
    const delta = Math.abs(measureTitleWidth(lines[0]!) - measureTitleWidth(lines[1]!));
    expect(delta).toBeLessThanOrEqual(6);
  });

  it("preserves Latin words as units when mixed", () => {
    const lines = breakDisplayTitle("Chill Time 静心沉淀 慢叙");
    expect(lines.some((line) => line.includes("Chill Time") || line.startsWith("Chill") || line.includes("Chill"))).toBe(
      true
    );
    expect(lines.join(" ")).toContain("Chill");
    expect(lines.join("")).not.toMatch(/Chi\nll/);
  });

  it("handles empty and whitespace-only input", () => {
    expect(breakDisplayTitle("")).toEqual([]);
    expect(breakDisplayTitle("   ")).toEqual([]);
  });

  it("respects maxLines = 1", () => {
    expect(breakDisplayTitle("民谣太安静 摇滚太喧嚣 赵雷梁博刚刚好", { maxLines: 1 })).toEqual([
      "民谣太安静 摇滚太喧嚣 赵雷梁博刚刚好"
    ]);
  });
});
