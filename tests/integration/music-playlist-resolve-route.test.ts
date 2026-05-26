import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET as resolvePlaylist } from "@/app/api/music/playlist/resolve/route";

describe("playlist resolve route", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns playlist id directly when input already contains id", async () => {
    const response = await resolvePlaylist(
      new Request("http://localhost:3000/api/music/playlist/resolve?input=https%3A%2F%2Fmusic.163.com%2Fplaylist%3Fid%3D123456789")
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(payload.data.playlistId).toBe("123456789");
  });

  it("resolves short link by following redirect", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://music.163.com/playlist?id=987654321" }
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;

    const response = await resolvePlaylist(
      new Request("http://localhost:3000/api/music/playlist/resolve?input=https%3A%2F%2F163cn.tv%2FabcXYZ")
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    expect(payload.data.playlistId).toBe("987654321");
  });

  it("returns error when short link cannot resolve playlist id", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://163cn.tv/next-hop" }
        })
      ) as typeof fetch;

    const response = await resolvePlaylist(
      new Request("http://localhost:3000/api/music/playlist/resolve?input=https%3A%2F%2F163cn.tv%2Fnever-end")
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe(1001);
  });
});
