import type { PlayQualityLevel } from '../api';
import { qualities, qualityTiers, type QualityOption } from '../config/site';
import { QualityMark } from './QualityMark';

interface Props {
  value: PlayQualityLevel;
  onPick: (level: PlayQualityLevel) => void;
  /** 这首歌有哪些音质；null = 不知道（没在放歌或还没查到），全部按可选显示 */
  available?: PlayQualityLevel[] | null;
  /** 选了这首没有的音质时，后端实际会给哪一档 */
  fallback?: Partial<Record<PlayQualityLevel, PlayQualityLevel>> | null;
}

const labelOf = (k: PlayQualityLevel) => qualities.find((q) => q.key === k)?.label ?? k;

/**
 * 九种音质按三档排：常规是一排分段按钮，无损是两行卡片，臻品是 2×2 卡片。
 * 这首歌没有的音质仍可选（作为以后的偏好），但会注明这首实际按哪档放。
 */
export function QualityPicker({ value, onPick, available = null, fallback = null }: Props) {
  const missing = (q: QualityOption) => !!available && !available.includes(q.key);
  const note = (q: QualityOption) => {
    if (!missing(q)) return null;
    const f = fallback?.[q.key];
    return f ? `本曲按「${labelOf(f)}」` : '本曲没有';
  };

  return (
    <div className="qp" role="radiogroup" aria-label="音质">
      {qualityTiers.map((tier, ti) => {
        const items = qualities.filter((q) => q.tier === tier.key);
        return (
          <section key={tier.key} className={`qp-sec qp-${tier.key}`} style={{ '--i': ti } as React.CSSProperties}>
            <div className="qp-tier mono">
              {tier.label}
              <span>{tier.note}</span>
            </div>
            <div className="qp-items">
              {items.map((q) => (
                <button
                  key={q.key}
                  role="radio"
                  aria-checked={q.key === value}
                  className={`qp-item ${q.key === value ? 'on' : ''} ${missing(q) ? 'missing' : ''} ${q.mark ? `kind-${q.mark.kind}` : ''}`}
                  onClick={() => onPick(q.key)}
                  title={note(q) ?? undefined}
                >
                  {tier.key !== 'standard' && <QualityMark option={q} />}
                  <span className="qp-name">{q.label}</span>
                  <span className="qp-spec mono">{note(q) ?? q.spec}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
