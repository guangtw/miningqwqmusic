import { expect, test } from "@playwright/test";

test("PWA manifest, offline page and application icons are available", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toContain("MiningQwQ");
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  expect((await request.get("/offline")).ok()).toBe(true);
  expect((await request.get("/icon.png")).ok()).toBe(true);
});
