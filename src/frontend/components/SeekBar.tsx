import { useRef, useState } from 'react';
import { formatTime } from '../lib/format';
import { useFrame } from '../lib/motion';
import { useStore } from '../lib/store';
import { audioDuration, audioTime, playerStore, seek } from '../player/player';

/**
 * 播放进度条。播放时每帧直接读 audio.currentTime 改 DOM，
 * 不走 React 渲染，所以进度是连续滑动的而不是每 250ms 跳一格。
 */
export function SeekBar({ compact = false }: { compact?: boolean }) {
  const playing = useStore(playerStore, (s) => s.playing);
  const duration = useStore(playerStore, (s) => s.duration);
  const position = useStore(playerStore, (s) => s.position);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const paint = (ms: number, total: number) => {
    const pct = total > 0 ? Math.min(100, (ms / total) * 100) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct / 100})`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
    if (curRef.current) curRef.current.textContent = formatTime(ms);
  };

  useFrame(() => {
    if (drag != null) return paint(drag, duration);
    paint(playing ? audioTime() : position, playing ? audioDuration() : duration);
  }, playing || drag != null);

  const valueAt = (x: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * duration;
  };

  if (compact) {
    return (
      <div className="mini-progress" aria-hidden="true">
        <div ref={fillRef} className="mini-progress-fill" />
      </div>
    );
  }

  return (
    <div className="progress-row">
      <span className="mono" ref={curRef}>
        {formatTime(position)}
      </span>
      <div
        ref={barRef}
        className={`bar ${drag != null ? 'dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={formatTime(position)}
        onPointerDown={(e) => {
          if (duration <= 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(valueAt(e.clientX));
        }}
        onPointerMove={(e) => drag != null && setDrag(valueAt(e.clientX))}
        onPointerUp={(e) => {
          if (drag == null) return;
          seek(valueAt(e.clientX));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') seek(position + 5000);
          else if (e.key === 'ArrowLeft') seek(position - 5000);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="bar-track">
          <div ref={fillRef} className="bar-fill" />
        </div>
        <div ref={thumbRef} className="bar-thumb" />
        {drag != null && (
          <div className="bar-tip mono" style={{ left: `${duration ? (drag / duration) * 100 : 0}%` }}>
            {formatTime(drag)}
          </div>
        )}
      </div>
      <span className="mono">{formatTime(duration)}</span>
    </div>
  );
}
