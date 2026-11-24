import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format';
import { useStore } from '../lib/store';
import { audioDuration, audioTime, playerStore, seek } from '../player/player';

/** 进度动画和真实播放时间差出这么多就重新对齐（毫秒） */
const DRIFT_MS = 150;
const CHECK_MS = 500;

/**
 * 播放进度条。播放时交给合成器：填充条和拖动点各挂一条从当前位置匀速走到结尾的动画，
 * 连续滑动、不占主线程。以前是每帧在 requestAnimationFrame 里读 audio.currentTime 改 DOM，
 * 只要在放歌主线程就每帧被叫醒一次（手机上这条进度条多半还看不见），
 * 页面上所有在转的唱片也因此每帧在主线程上重算样式，滑动和底栏收展时一起掉帧。
 * 现在只每半秒用定时器对一次真实时间：差太多（拖动、缓冲、切歌）就从真实位置重新起步；
 * 缓冲卡住时停在原地。时间文字在走到整秒时才改。
 */
export function SeekBar({ compact = false }: { compact?: boolean }) {
  const playing = useStore(playerStore, (s) => s.playing);
  const loading = useStore(playerStore, (s) => s.loading);
  const duration = useStore(playerStore, (s) => s.duration);
  const position = useStore(playerStore, (s) => s.position);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const painted = useRef({ text: '' });

  const anims = useRef<Animation[]>([]);
  /** 正在跑的进度动画是从哪个时刻、哪个位置起步的 */
  const run = useRef<{ at: number; from: number } | null>(null);

  const stop = () => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    run.current = null;
  };

  const writeText = (ms: number) => {
    const text = formatTime(ms);
    if (curRef.current && text !== painted.current.text) {
      painted.current.text = text;
      curRef.current.textContent = text;
    }
  };

  // 停着（暂停、拖动、缓冲）时直接写位置
  const paint = (ms: number, total: number) => {
    stop();
    const pct = total > 0 ? Math.min(100, (ms / total) * 100) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct / 100})`;
    if (railRef.current) railRef.current.style.transform = `translateX(${pct}%)`;
    writeText(ms);
  };

  // 放着时：从当前位置匀速走到结尾，合成器上跑
  const start = (ms: number, total: number) => {
    stop();
    const p = total > 0 ? Math.min(1, ms / total) : 0;
    const left = Math.max(0, total - ms);
    const timing: KeyframeAnimationOptions = { duration: left, easing: 'linear', fill: 'forwards' };
    if (fillRef.current?.animate && left > 0) {
      anims.current.push(fillRef.current.animate([{ transform: `scaleX(${p})` }, { transform: 'scaleX(1)' }], timing));
      if (railRef.current) anims.current.push(railRef.current.animate([{ transform: `translateX(${p * 100}%)` }, { transform: 'translateX(100%)' }], timing));
      run.current = { at: performance.now(), from: ms };
    } else paint(ms, total);
    writeText(ms);
  };

  // 只在进度条真的显示在屏幕上时才跑动画：挂在 display:none 的元素上的动画合成器接不了，
  // 会退回主线程每帧更新（手机上底栏缩成圆时迷你进度条是隐藏的，完整进度条平时也不显示）
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setShown(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const advancing = playing && !loading && drag == null && shown;

  useEffect(() => {
    if (drag != null) return paint(drag, duration);
    if (!advancing) return paint(playing && !shown ? audioTime() : position, duration);
    start(audioTime(), audioDuration());
    // 定时对一次：差出太多就从真实位置重新起步；顺手在走到整秒时改时间文字
    const check = window.setInterval(() => {
      const now = audioTime();
      const r = run.current;
      const expected = r ? r.from + (performance.now() - r.at) : -Infinity;
      if (Math.abs(expected - now) > DRIFT_MS) start(now, audioDuration());
      else writeText(now);
    }, CHECK_MS);
    return () => {
      clearInterval(check);
      stop();
    };
  }, [advancing, drag, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // 暂停时拖动、切歌：位置变了也要跟上。放着歌但进度条隐藏时不用写：重新显示时会从真实位置起步
  useEffect(() => {
    if (!playing && drag == null) paint(position, duration);
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueAt = (x: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * duration;
  };

  if (compact) {
    return (
      <div ref={rootRef} className="mini-progress" aria-hidden="true">
        <div ref={fillRef} className="mini-progress-fill" />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="progress-row">
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
        {/* 拖动点挂在一条和进度条等宽的轨道上，平移轨道（transform）而不是改 left，才能交给合成器 */}
        <div ref={railRef} className="bar-rail" aria-hidden="true">
          <div className="bar-thumb" />
        </div>
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
