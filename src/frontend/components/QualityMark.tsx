import type { QualityOption } from '../config/site';

/** 声场：三道由近及远的弧线 */
function SpatialIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="qm-icon">
      <circle cx="4" cy="8" r="1.6" fill="currentColor" />
      <path d="M7 4.6a4.6 4.6 0 0 1 0 6.8M9.6 2.6a7.4 7.4 0 0 1 0 10.8M12.2 0.9a9.8 9.8 0 0 1 0 14.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 母带：一张小唱片 */
function MasterIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="qm-icon">
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

/**
 * 高音质标识。每一类一种视觉：
 * SQ 金色描边、Hi-Res 金色实心、环绕声彩虹渐变 + 声场图形、母带香槟金箔 + 流光。
 * withLabel：在标识后面再跟上中文名（播放台上的小标签用）。
 */
export function QualityMark({ option, withLabel = false, size = 'sm' }: { option: QualityOption; withLabel?: boolean; size?: 'sm' | 'md' }) {
  const mark = option.mark;
  if (!mark) return <span className={`qm qm-plain qm-${size}`}>{option.label}</span>;
  return (
    <span className={`qm qm-${mark.kind} qm-${size}`}>
      {mark.kind === 'spatial' && <SpatialIcon />}
      {mark.kind === 'master' && <MasterIcon />}
      <span className="qm-text">{mark.text}</span>
      {withLabel && <span className="qm-label">{option.label}</span>}
    </span>
  );
}
