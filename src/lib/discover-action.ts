import type { DiscoverItem } from "@/src/types/music";

export type DiscoverAction =
  | { type: "play-track"; targetId: string }
  | { type: "open-playlist"; targetId: string; sourceType: "playlist" | "toplist" }
  | { type: "open-album"; targetId: string }
  | { type: "open-artist"; targetId: string }
  | { type: "open-external"; url: string }
  | { type: "unsupported" };

export function resolveDiscoverAction(item: DiscoverItem): DiscoverAction {
  if (item.type === "banner") {
    if (item.linkUrl) {
      return { type: "open-external", url: item.linkUrl };
    }
    return { type: "unsupported" };
  }

  const targetId = item.targetId;
  if (!targetId) {
    return { type: "unsupported" };
  }

  if (item.type === "track" || item.type === "scene") {
    return { type: "play-track", targetId };
  }

  if (item.type === "playlist" || item.type === "toplist") {
    return {
      type: "open-playlist",
      targetId,
      sourceType: item.type
    };
  }

  if (item.type === "album") {
    return { type: "open-album", targetId };
  }

  if (item.type === "artist") {
    return { type: "open-artist", targetId };
  }

  return { type: "unsupported" };
}
