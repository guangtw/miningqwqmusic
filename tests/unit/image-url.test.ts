import { describe, expect, it } from "vitest";
import { getSizedImageUrl } from "@/src/lib/image-url";

describe("image url helpers", () => {
  it("adds netease thumbnail params for supported cover hosts", () => {
    expect(getSizedImageUrl("https://p1.music.126.net/example.jpg", { width: 160, height: 160 })).toBe(
      "https://p1.music.126.net/example.jpg?param=160y160"
    );
  });

  it("replaces existing netease thumbnail params while keeping other query params", () => {
    expect(getSizedImageUrl("https://p2.music.126.net/example.jpg?foo=1&param=320y320", { width: 96, height: 96 })).toBe(
      "https://p2.music.126.net/example.jpg?foo=1&param=96y96"
    );
  });

  it("keeps unknown or local urls unchanged", () => {
    expect(getSizedImageUrl("https://picsum.photos/seed/demo/300/300", { width: 120, height: 120 })).toBe(
      "https://picsum.photos/seed/demo/300/300"
    );
    expect(getSizedImageUrl("/api/account/profile/avatar/avatar.webp", { width: 64, height: 64 })).toBe(
      "/api/account/profile/avatar/avatar.webp"
    );
  });
});
