/** 下载页和设置入口用的平台小标：四格窗、机器人脑袋。没见过的平台画一张空唱片 */
export function PlatformGlyph({ platform, size = 20 }: { platform: string; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {platform === 'windows' ? (
        <path d="M3 5.6 10.4 4.6v6.9H3zM11.4 4.4 21 3v8.5h-9.6zM3 12.5h7.4v6.9L3 18.4zM11.4 12.5H21V21l-9.6-1.4z" />
      ) : platform === 'android' ? (
        <path d="M6.9 6.4 5.6 4.2a.5.5 0 0 1 .9-.5l1.3 2.3A9.3 9.3 0 0 1 12 5c1.5 0 2.9.4 4.2 1l1.3-2.3a.5.5 0 0 1 .9.5l-1.3 2.2A8.4 8.4 0 0 1 21 13.5H3a8.4 8.4 0 0 1 3.9-7.1zM8 10.6a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2zm8 0a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2zM3 15h18v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
      ) : (
        <path fillRule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
      )}
    </svg>
  );
}
