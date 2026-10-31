import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// 首页的横排和网格：横排给左右翻页和「展开」，网格只露整行。

/**
 * 横排的滚动状态。滚到头尾时对应的箭头变灰，边缘渐隐也跟着去掉。
 * expanded 时横排改成换行网格（CSS 里 .expanded），箭头收起来。
 * expandable 为 false 时不给「展开」（旁边已经有去完整列表的入口）。
 */
export function useRail({ expandable = true } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, expanded]);

  /** 翻一屏：按可见宽度的 85% 走，留一点上一屏的尾巴当参照 */
  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  const scrollable = !(edge.start && edge.end);
  return {
    ref,
    expanded,
    scrollable,
    className: `rail ${expanded ? 'expanded' : ''} ${edge.start ? '' : 'fade-l'} ${edge.end ? '' : 'fade-r'}`,
    controls: (
      <RailControls
        expanded={expanded}
        canPrev={!edge.start}
        canNext={!edge.end}
        showArrows={scrollable && !expanded}
        showToggle={expandable && (scrollable || expanded)}
        onPage={page}
        onToggle={() => {
          setExpanded((x) => !x);
          ref.current?.scrollTo({ left: 0 });
        }}
      />
    ),
  };
}

function RailControls(p: {
  expanded: boolean;
  canPrev: boolean;
  canNext: boolean;
  showArrows: boolean;
  showToggle: boolean;
  onPage: (dir: -1 | 1) => void;
  onToggle: () => void;
}) {
  if (!p.showToggle && !p.showArrows) return null;
  return (
    <div className="rail-ctrl">
      {p.showArrows && (
        <>
          <button className="icon-btn rail-arrow" onClick={() => p.onPage(-1)} disabled={!p.canPrev} aria-label="往前翻">
            <Icon name="left" />
          </button>
          <button className="icon-btn rail-arrow" onClick={() => p.onPage(1)} disabled={!p.canNext} aria-label="往后翻">
            <Icon name="right" />
          </button>
        </>
      )}
      {p.showToggle && (
        <button className="text-btn rail-toggle" onClick={p.onToggle} aria-expanded={p.expanded}>
          {p.expanded ? '收起' : '展开全部'}
        </button>
      )}
    </div>
  );
}

/** 网格实际排了几列（auto-fill 的列数随宽度变），跟着容器尺寸更新 */
export function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setCols(getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, cols };
}

/**
 * 网格只露整行：按容器实际排得下几列，把条目数截到列数的整数倍，
 * 最多 maxRows 行，剩下的用「展开全部」看。窄屏两列时多给一行。
 */
export function useFullRows(count: number, maxRows = 2) {
  const { ref, cols } = useColumns();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [count]);

  const rows = cols <= 2 ? maxRows + 1 : maxRows;
  const fit = cols && count > cols ? Math.min(count - (count % cols), cols * rows) : count;
  const visible = expanded ? count : fit;
  const hidden = count - fit;
  return {
    ref,
    visible,
    controls:
      hidden > 0 ? (
        <div className="rail-ctrl">
          <button className="text-btn rail-toggle" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            {expanded ? '收起' : `展开全部 ${count}`}
          </button>
        </div>
      ) : null,
  };
}
