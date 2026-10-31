import { useRef, useState } from 'react';

interface Props {
  value: number;
  max: number;
  onCommit: (v: number) => void;
  /** 拖动过程中实时回调（音量需要，进度条不需要） */
  onInput?: (v: number) => void;
  label: string;
  className?: string;
  format?: (v: number) => string;
}

/** 细线滑块：点击跳转、拖动、键盘方向键都支持 */
export function Slider({ value, max, onCommit, onInput, label, className = '', format }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0;

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * max;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (max <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valueAt(e.clientX);
    setDrag(v);
    onInput?.(v);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag == null) return;
    const v = valueAt(e.clientX);
    setDrag(v);
    onInput?.(v);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag == null) return;
    onCommit(valueAt(e.clientX));
    setDrag(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = max / 20;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onCommit(Math.min(max, value + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onCommit(Math.max(0, value - step));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className={`bar ${drag != null ? 'dragging' : ''} ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={format?.(shown)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={onKeyDown}
    >
      <div className="bar-track">
        <div className="bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <div className="bar-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}
