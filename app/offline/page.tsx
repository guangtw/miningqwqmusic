export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(145deg, #0b1020, #0f223f)",
        color: "#e7eeff",
        padding: "2rem"
      }}
    >
      <div style={{ maxWidth: 540, textAlign: "center" }}>
        <h1>当前离线</h1>
        <p>网络已断开。你仍可以访问已缓存页面，恢复网络后可继续搜索和播放在线音乐。</p>
      </div>
    </main>
  );
}
