import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Track } from '../api';
import { artistNames, formatTime } from '../lib/format';
import { motionEnabled } from '../lib/settings';
import { Cover } from './Cover';
import { Icon } from './Icon';

/** 把第 from 首挪到第 to 首的位置 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

type Drag = { from: number; over: number; dy: number };
/** 刚松手：被拖的那行从手指的位置滑进新位置 */
type Settle = { index: number; offset: number; phase: 'from' | 'to' };

/** 离屏幕上下边多近开始自动滚，滚多快 */
const EDGE = 84;
const MAX_SPEED = 14;

/**
 * 整理顺序：按住右边的把手上下拖（鼠标、手指都行），别的行让开位置；松手那一行滑进空位。
 * 把手聚焦时也能用上下方向键一格一格挪。顺序只在这里改，「完成」时由外面统一提交
 */
export function ReorderList({ tracks, onChange }: { tracks: Track[]; onChange: (next: Track[]) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settle, setSettle] = useState<Settle | null>(null);
  const boxRef = useRef<HTMLOListElement>(null);
  const g = useRef({ startY: 0, startScroll: 0, pointerY: 0, rowH: 56, raf: 0, pointer: -1 });

  const main = () => document.querySelector<HTMLElement>('.main');

  // 松手后的两拍：先摆在手指的位置（不带过渡），下一帧去掉偏移，让它滑过去
  useLayoutEffect(() => {
    if (settle?.phase !== 'from') return;
    const id = requestAnimationFrame(() => setSettle((s) => (s ? { ...s, phase: 'to' } : s)));
    return () => cancelAnimationFrame(id);
  }, [settle]);
  useEffect(() => {
    if (settle?.phase !== 'to') return;
    const t = setTimeout(() => setSettle(null), 420);
    return () => clearTimeout(t);
  }, [settle]);
  useEffect(() => () => cancelAnimationFrame(g.current.raf), []);

  const update = (from: number) => {
    const s = g.current;
    const m = main();
    const dy = s.pointerY - s.startY + ((m?.scrollTop ?? 0) - s.startScroll);
    const over = Math.max(0, Math.min(tracks.length - 1, from + Math.round(dy / s.rowH)));
    setDrag({ from, over, dy });
  };

  // 拖到屏幕边上：主区域跟着滚
  const autoscroll = (from: number) => {
    const s = g.current;
    const m = main();
    if (!m) return;
    const rect = m.getBoundingClientRect();
    const top = s.pointerY - rect.top;
    const bottom = rect.bottom - s.pointerY;
    const speed = top < EDGE ? -MAX_SPEED * (1 - top / EDGE) : bottom < EDGE + 90 ? MAX_SPEED * (1 - Math.max(0, bottom - 90) / EDGE) : 0;
    if (speed) {
      m.scrollTop += speed;
      update(from);
    }
    s.raf = requestAnimationFrame(() => autoscroll(from));
  };

  const down = (i: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || settle) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest('li')!;
    const s = g.current;
    s.rowH = row.offsetHeight;
    s.startY = s.pointerY = e.clientY;
    s.startScroll = main()?.scrollTop ?? 0;
    s.pointer = e.pointerId;
    setDrag({ from: i, over: i, dy: 0 });
    navigator.vibrate?.(8);
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(() => autoscroll(i));
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== g.current.pointer) return;
    g.current.pointerY = e.clientY;
    update(drag.from);
  };
  const up = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== g.current.pointer) return;
    cancelAnimationFrame(g.current.raf);
    g.current.pointer = -1;
    const { from, over, dy } = drag;
    setDrag(null);
    if (over !== from) onChange(moveItem(tracks, from, over));
    if (motionEnabled()) setSettle({ index: over, offset: dy - (over - from) * g.current.rowH, phase: 'from' });
  };

  const key = (i: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (to < 0 || to >= tracks.length) return;
    e.preventDefault();
    onChange(moveItem(tracks, i, to));
    // 焦点跟着这一行走
    requestAnimationFrame(() => boxRef.current?.querySelectorAll<HTMLButtonElement>('.arrange-grip')[to]?.focus());
  };

  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -g.current.rowH;
    if (drag.from > drag.over && i < drag.from && i >= drag.over) return g.current.rowH;
    return 0;
  };

  return (
    <ol className={`arrange ${drag ? 'dragging' : ''} ${settle?.phase === 'from' ? 'settling' : ''}`} ref={boxRef} aria-label="整理曲目顺序">
      {tracks.map((t, i) => {
        const lifted = drag?.from === i;
        const landing = settle?.index === i;
        const y = lifted ? drag.dy : landing && settle.phase === 'from' ? settle.offset : shift(i);
        return (
          <li
            key={t.id}
            className={`arrange-row ${lifted ? 'lifted' : ''} ${landing ? 'landing' : ''}`}
            style={y ? { transform: `translate3d(0, ${y}px, 0)` } : undefined}
          >
            <span className="arrange-no mono">{String((lifted ? drag.over : i) + 1).padStart(2, '0')}</span>
            <Cover src={t.coverUrl ?? t.album?.coverUrl} alt="" size={96} className="arrange-cover" />
            <span className="arrange-text">
              <b>{t.name}</b>
              <small>{artistNames(t.artists)}</small>
            </span>
            <span className="arrange-dur mono">{formatTime(t.durationMs)}</span>
            <button
              className="arrange-grip"
              aria-label={`拖动《${t.name}》调整顺序，也可以用上下方向键`}
              onPointerDown={(e) => down(i, e)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={(e) => key(i, e)}
            >
              <Icon name="grip" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
