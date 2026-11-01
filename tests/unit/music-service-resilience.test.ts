import { beforeEach, afterEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ play: vi.fn(), search: vi.fn() }));
vi.mock("@/src/lib/music/providers/netease-like", () => ({
  createNeteaseLikeAdapterFromEnv: () => ({ getPlaySource: f.play, searchTracks: f.search })
}));
beforeEach(() => {
  vi.resetModules(); f.play.mockReset(); f.search.mockReset();
  vi.stubEnv("MUSIC_SOURCE_BASE_URL", "https://stub.test");
  vi.stubEnv("MUSIC_SOURCE_MOCK_ENABLED", "false"); vi.stubEnv("MUSIC_SOURCE_MOCK_FALLBACK", "false");
});
afterEach(() => vi.unstubAllEnvs());

it("does not let failed playback trip the search circuit", async () => {
  const { AppError } = await import("@/src/lib/errors");
  f.play.mockRejectedValue(new AppError("provider unavailable", { code: 2001, status: 503 }));
  f.search.mockResolvedValue({ items: [], total: 0 });
  const service = await import("@/src/lib/music/service");
  for (let i = 0; i < 3; i++) await expect(service.getPlaySource(String(i))).rejects.toMatchObject({ code: 2001 });
  await expect(service.searchTracks({ keyword: "x", page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 0 });
  expect(f.search).toHaveBeenCalledTimes(1);
});

it("allows another song after timeouts without opening a playback-wide circuit", async () => {
  const { AppError } = await import("@/src/lib/errors");
  f.play.mockRejectedValue(new AppError("slow song", { code: 2004, status: 504 }));
  const service = await import("@/src/lib/music/service");
  for (let i = 0; i < 3; i++) await expect(service.getPlaySource(String(i))).rejects.toMatchObject({ code: 2004 });
  f.play.mockResolvedValue({ url: "https://cdn.test/good.mp3", preview: false });
  await expect(service.getPlaySource("healthy")).resolves.toMatchObject({ preview: false });
  expect(f.play).toHaveBeenCalledTimes(4);
});
