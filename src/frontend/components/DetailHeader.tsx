import { useLayoutEffect, useRef, useState } from 'react';
import { heroStore, transitionSettled } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { motionEnabled } from '../lib/settings';
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
export function DetailHeader({ heroKey, kind, title, coverUrl, byline, description, meta, actions, round, pending: loading }: Props) {
  const hero = useStore(heroStore, (s) => s.key);
  const tint = useTint(coverUrl);
  const [descOpen, setDescOpen] = useState(false);
  const long = (description?.length ?? 0) > 110;

  // 详情在换页过渡途中到了：先别补内容，等封面落地再补。
  // 宽屏下简介、按钮一出来，标题会被顶上去、封面会被压下来；过渡途中挪动，封面落地那一下会瞬移
  const [pending, setPending] = useState(loading);
  useLayoutEffect(() => {
    if (loading) return setPending(true);
    const wait = transitionSettled();
    if (!wait) return setPending(false);
    let alive = true;
    void wait.then(() => alive && setPending(false));
    return () => {
      alive = false;
    };
  }, [loading]);

  // 补上内容后封面和标题滑到新位置，不是一下跳过去（窄屏是上下排的，位置不变，不会触发）
  const artRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const before = useRef<number[] | null>(null);
  useLayoutEffect(() => {
    const els = [artRef.current, ...Array.from(textRef.current?.children ?? []).slice(0, 3)] as HTMLElement[];
    const tops = els.map((e) => e?.offsetTop ?? 0);
    if (pending) {
      before.current = tops;
      return;
    }
    const from = before.current;
    before.current = null;
    if (!from || !motionEnabled()) return;
    els.forEach((el, i) => {
      const dy = from[i] - tops[i];
      if (el && Math.abs(dy) > 1)
        // add：标题自己还在播入场动画，叠加上去而不是把它顶掉
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: 640,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          composite: 'add',
        });
    });
  }, [pending]);

  return (
    <header className={`detail-head ${pending ? 'pending' : ''} ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
      <div className="detail-band" aria-hidden="true" />
      <div ref={artRef} className={`detail-art ${round ? 'round' : ''}`}>
        {!round && <Vinyl cover={coverUrl} className="detail-vinyl" labelPx={300} />}
        <Cover src={coverUrl} alt="" size={600} className={`sleeve ${round ? 'round' : ''} ${hero === heroKey ? 'hero-active' : ''}`} />
      </div>
      <div ref={textRef} className="detail-text">
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
