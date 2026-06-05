import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/offline"],
      disallow: ["/api/"]
    },
    sitemap: "https://echo.miningqwq.cn/sitemap.xml"
  };
}
