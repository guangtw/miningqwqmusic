import type { MetadataRoute } from "next";

const baseUrl = "https://echo.miningqwq.cn";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date("2026-06-03"),
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: `${baseUrl}/offline`,
      lastModified: new Date("2026-06-03"),
      changeFrequency: "yearly",
      priority: 0.2
    }
  ];
}
