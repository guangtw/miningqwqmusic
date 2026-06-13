/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.music.126.net"
      },
      {
        protocol: "http",
        hostname: "**.music.126.net"
      },
      {
        protocol: "https",
        hostname: "music.126.net"
      },
      {
        protocol: "http",
        hostname: "music.126.net"
      }
    ]
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
