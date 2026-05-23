import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/music/service", () => ({
  getDiscoverData: vi.fn(async () => ({
    blocks: [],
    searchAssist: {
      defaultKeyword: "晴天",
      hotKeywords: ["晴天", "夜曲"],
      suggestions: ["周杰伦", "晴天"]
    }
  })),
  getSearchAssist: vi.fn(async (keyword: string) => ({
    defaultKeyword: "晴天",
    hotKeywords: ["晴天", "夜曲"],
    suggestions: keyword ? [keyword, "晴天"] : ["周杰伦", "晴天"]
  }))
}));

import { GET as getDiscoverHome } from "@/app/api/music/discover/home/route";
import { GET as getDiscoverAssist } from "@/app/api/music/discover/search-assist/route";

describe("discover routes", () => {
  it("returns discover home payload", async () => {
    const response = await getDiscoverHome();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(payload.data.searchAssist.defaultKeyword).toBe("晴天");
  });

  it("returns search assist payload", async () => {
    const response = await getDiscoverAssist(
      new Request("http://localhost:3000/api/music/discover/search-assist?q=周杰伦")
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(Array.isArray(payload.data.suggestions)).toBe(true);
  });
});

