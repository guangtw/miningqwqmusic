import { describe, expect, it } from "vitest";
import { resolveDiscoverAction } from "@/src/lib/discover-action";
import type { DiscoverItem } from "@/src/types/music";

function createItem(partial: Partial<DiscoverItem>): DiscoverItem {
  return {
    id: "id-1",
    title: "title",
    type: "banner",
    ...partial
  };
}

describe("resolveDiscoverAction", () => {
  it("routes supported discover types to executable actions", () => {
    expect(resolveDiscoverAction(createItem({ type: "track", targetId: "1001" }))).toEqual({
      type: "play-track",
      targetId: "1001"
    });
    expect(resolveDiscoverAction(createItem({ type: "scene", targetId: "1002" }))).toEqual({
      type: "play-track",
      targetId: "1002"
    });
    expect(resolveDiscoverAction(createItem({ type: "playlist", targetId: "2001" }))).toEqual({
      type: "open-playlist",
      targetId: "2001",
      sourceType: "playlist"
    });
    expect(resolveDiscoverAction(createItem({ type: "toplist", targetId: "2002" }))).toEqual({
      type: "open-playlist",
      targetId: "2002",
      sourceType: "toplist"
    });
    expect(resolveDiscoverAction(createItem({ type: "album", targetId: "3001" }))).toEqual({
      type: "open-album",
      targetId: "3001"
    });
    expect(resolveDiscoverAction(createItem({ type: "artist", targetId: "4001" }))).toEqual({
      type: "open-artist",
      targetId: "4001"
    });
  });

  it("routes banner link to external open and rejects unsupported items", () => {
    expect(resolveDiscoverAction(createItem({ type: "banner", linkUrl: "https://example.com" }))).toEqual({
      type: "open-external",
      url: "https://example.com"
    });
    expect(resolveDiscoverAction(createItem({ type: "banner" }))).toEqual({
      type: "unsupported"
    });
    expect(resolveDiscoverAction(createItem({ type: "track" }))).toEqual({
      type: "unsupported"
    });
  });
});
