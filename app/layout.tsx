import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/src/components/sw-register";

export const metadata: Metadata = {
  title: "MiningQwQ Music",
  description: "Private Netease-like source music player",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#1c6df2"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
