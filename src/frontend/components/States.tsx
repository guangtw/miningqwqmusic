export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="加载中" className="loading">
      <div className="skeleton" style={{ height: 40, width: '38%', marginBottom: 26 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 16, margin: '16px 0', width: `${92 - ((i * 13) % 35)}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state">
      <div className="state-disc" aria-hidden="true" />
      <h3>唱针跳了一下</h3>
      <p>{error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry} style={{ marginTop: 18 }}>
          重试
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="state">
      <div className="state-disc" aria-hidden="true" />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
