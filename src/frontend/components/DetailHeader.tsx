import { useState } from 'react';
import { heroStore } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { useStore } from '../lib/store';
import { Cover } from './Cover';
import { Vinyl } from './Vinyl';

interface Props {
  heroKey: string;
  kind: string;
  title: string;
  coverUrl?: string;
  byline?: React.ReactNode;
  description?: string;
  meta?: (string | false | undefined)[];
  actions?: React.ReactNode;
  round?: boolean;
  /** 数据还没回来：只画封面和标题（来自卡片的预览） */
  pending?: boolean;
}

/**
 * 详情页头部：左边封套 + 滑出一半的黑胶，右边大标题。
 * 背景色带取封面主色。封面与上一页的卡片共享 view-transition-name，会「飞」过来。
 */
export function DetailHeader({ heroKey, kind, title, coverUrl, byline, description, meta, actions, round, pending }: Props) {
  const hero = useStore(heroStore, (s) => s.key);
  const tint = useTint(coverUrl);
  const [descOpen, setDescOpen] = useState(false);
  const long = (description?.length ?? 0) > 110;

  return (
    <header className={`detail-head ${pending ? 'pending' : ''} ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
      <div className="detail-band" aria-hidden="true" />
      <div className={`detail-art ${round ? 'round' : ''}`}>
        {!round && <Vinyl cover={coverUrl} className="detail-vinyl" labelPx={300} />}
        <Cover src={coverUrl} alt="" size={600} className={`sleeve ${round ? 'round' : ''} ${hero === heroKey ? 'hero-active' : ''}`} />
      </div>
      <div className="detail-text">
        <div className="kicker">{kind}</div>
        <h1 className="detail-title">{title}</h1>
        {byline && <div className="byline">{byline}</div>}
        {!pending && (
          <div className="detail-rest">
            {description && (
              <>
                <p className={`desc ${long && !descOpen ? 'clamped' : ''}`}>{description}</p>
                {long && (
                  <button className="text-btn" onClick={() => setDescOpen(!descOpen)}>
                    {descOpen ? '收起' : '展开全文'}
                  </button>
                )}
              </>
            )}
            {meta && (
              <div className="meta-row mono">
                {meta.filter(Boolean).map((m) => (
                  <span key={m as string}>{m}</span>
                ))}
              </div>
            )}
            {actions && <div className="actions">{actions}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
