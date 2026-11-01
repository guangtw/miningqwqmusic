import type { Metadata, Viewport } from "next";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/great-vibes/400.css";
import "@fontsource/bodoni-moda/600.css";
import "@/src/frontend/styles/tokens.css";
import "@/src/frontend/styles/app.css";
import "@/src/frontend/styles/motion.css";
import { ServiceWorkerRegister } from "@/src/components/sw-register";

const siteUrl = "https://echo.miningqwq.cn";
const siteTitle = process.env.NEXT_PUBLIC_SITE_NAME || `${process.env.NEXT_PUBLIC_BRAND_BIG || "Mining"}${process.env.NEXT_PUBLIC_BRAND_SMALL || "唱片行"}`;
const siteDescription = "MiningQwQ Music 是一个面向私人网易云风格音源的现代网页音乐播放器，支持发现、搜索、播放队列、歌词与音乐库同步。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteTitle,
  title: {
    default: siteTitle,
    template: `%s | ${siteTitle}`
  },
  description: siteDescription,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "QwQ Music",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: [
      { url: "/record-store-icon.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }]
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: siteTitle,
    title: siteTitle,
    description: siteDescription,
    locale: "zh_CN",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 1200,
        alt: siteTitle
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/opengraph-image.png"]
  }
};

export const viewport: Viewport = {
  themeColor: "#f3eee4"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=JSON.parse(localStorage.getItem('cph.settings.v2')||'{}');if(s.theme==='paper'||s.theme==='night')document.documentElement.dataset.theme=s.theme;if(s.motion)document.documentElement.dataset.motion=s.motion}catch(e){}})()` }} />
        {/* 唱片行的全屏浮层（正在播放、全屏歌词）各压一条自己的历史记录。Next.js 的路由见到不是它写的记录会整页刷新，
            它的 popstate 监听又比前端代码先挂上，所以在这里最先接住：先交给前端处理，是浮层记录就不再往下传 */}
        <script dangerouslySetInnerHTML={{ __html: `window.__qwqPopstate=null;addEventListener('popstate',function(e){var h=window.__qwqPopstate;if(h)h(e);var s=e.state;if(s&&s.layer!=null&&!s.__NA)e.stopImmediatePropagation()})` }} />
      </head>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
