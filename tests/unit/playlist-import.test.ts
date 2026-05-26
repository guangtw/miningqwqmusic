import { describe, expect, it } from "vitest";
import { extractFirstHttpUrl, extractPlaylistId } from "@/src/lib/playlist-import";

describe("extractPlaylistId", () => {
  it("extracts playlist id from common netease share inputs", () => {
    expect(extractPlaylistId("https://music.163.com/playlist?id=123456789")).toBe("123456789");
    expect(extractPlaylistId("https://music.163.com/#/playlist?id=987654321")).toBe("987654321");
    expect(extractPlaylistId("https://music.163.com/playlist/456789123")).toBe("456789123");
    expect(extractPlaylistId("复制这条信息，打开网易云音乐查看歌单 135792468")).toBe("135792468");
  });

  it("returns null for invalid inputs", () => {
    expect(extractPlaylistId("")).toBeNull();
    expect(extractPlaylistId("https://music.163.com/song?id=12345")).toBeNull();
    expect(extractPlaylistId("this is not a playlist link")).toBeNull();
  });

  it("extracts first http url from text", () => {
    expect(extractFirstHttpUrl("短链：https://163cn.tv/abcXYZ")).toBe("https://163cn.tv/abcXYZ");
    expect(extractFirstHttpUrl("打开链接 https://music.163.com/#/playlist?id=123456789。")).toBe(
      "https://music.163.com/#/playlist?id=123456789"
    );
    expect(extractFirstHttpUrl("no url here")).toBeNull();
  });
});
