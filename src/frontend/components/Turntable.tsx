import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { coverOf } from '../api';
import { formatTime } from '../lib/format';
import { Spring } from '../lib/motion';
import { motionEnabled } from '../lib/settings';
import { useStore } from '../lib/store';
import { audioDuration, audioTime, currentTrack, playerStore, seek } from '../player/player';
import { sized } from './Cover';
import { Vinyl } from './Vinyl';

// 唱机俯视图，坐标都在 100×100 的盒子里。
// 唱臂绕支点旋转：0° = 竖直向下（搁在臂架上），
// OUTER° 时唱针落在最外圈，INNER° 时到达最内圈。
const PIVOT = { x: 88, y: 14 };
const REST = 2;
const OUTER = 17.5;
const INNER = 37;

const angleFor = (progress: number) => OUTER + (INNER - OUTER) * Math.min(1, Math.max(0, progress));

// 唱臂的两根弹簧：角度偏「重」，摆过去略带一点过冲；抬落偏「轻」，落针时会在唱片上弹一下
const SWING = { stiffness: 24, damping: 7.5 };
const SWING_DRAG = { stiffness: 180, damping: 24 };
/** 角度差超过这么多度就算「要挪位置」：先抬臂、再摆、再落针 */
const TRAVEL_START = 1;
const TRAVEL_END = 0.2;
/** 33⅓ 转一圈约 1.8 秒；唱片有一点偏心，唱针每圈跟着左右摆一下 */
const REV_MS = 1800;
const SWAY_DEG = 0.28;
/**
 * 换唱片的节奏（毫秒）：唱臂先抬起退回臂架；旧唱片被托起、往下甩出去，快出屏幕时淡掉；
 * 它掉到一半时新唱片从下方淡入、升上来，稍稍悬在唱盘上方再放平；最后唱臂摆回来落针。
 */
const LIFT_AT = 380;
const LIFT_MS = 260;
const FALL_MS = 620;
const ENTER_AT = LIFT_AT + LIFT_MS + 220;
const ENTER_MS = 640;
const SETTLE_MS = 380;
const SWAP_MS = ENTER_AT + ENTER_MS + SETTLE_MS + 60;
const SHADOW_FLAT = '0 0 0 0 rgba(0, 0, 0, 0)';
const SHADOW_UP = '0 30px 46px -16px rgba(0, 0, 0, 0.55)';

interface DeckRecord {
  key: string;
  cover?: string;
  /** 正在被拿走的旧唱片 */
  leaving?: boolean;
  /** 刚放上来、还没落稳的新唱片（落稳前不转） */
  entering?: boolean;
}

let recordSeq = 0;

/**
 * 正在播放页的唱机。唱臂的位置就是播放进度，动作按真唱机来：
 * 还没开始放时搁在臂架上；按下播放先抬臂、摆到外圈、再落针；
 * 暂停时抬起悬停；换歌、跳转时抬起摆过去再落下；播放中随唱片偏心轻轻摆动。
 * 拖动唱臂可以跳转。
 */
export function Turntable({ vtName, active = true }: { vtName?: string; active?: boolean }) {
  const track = useStore(playerStore, (s) => currentTrack(s));
  const playing = useStore(playerStore, (s) => s.playing);
  const position = useStore(playerStore, (s) => s.position);
  const duration = useStore(playerStore, (s) => s.duration);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const armRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // 帧循环只建一次，每帧从这里读最新状态
  const live = useRef({ track, playing, position, duration, drag });
  live.current = { track, playing, position, duration, drag };

  // 唱盘上的唱片。换歌时旧的那张留一会儿播退场，新的一张播入场
  const [records, setRecords] = useState<DeckRecord[]>(() =>
    track ? [{ key: `r${recordSeq++}`, cover: coverOf(track) }] : [],
  );
  // 预先加载下一首的唱片标签，换唱片时新唱片落下来就带着封面，不会先露出空白标签
  const upcoming = useStore(playerStore, (s) => (s.queue.length > 1 ? s.queue[(s.index + 1) % s.queue.length] : null));
  useEffect(() => {
    const url = upcoming && sized(coverOf(upcoming), 400);
    if (url) new Image().src = url;
  }, [upcoming]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const currentId = useRef(track?.id);
  const swapUntil = useRef(0);
  useEffect(() => {
    if (track?.id === currentId.current) return;
    const hadRecord = currentId.current != null;
    currentId.current = track?.id;
    if (hadRecord && activeRef.current) swapUntil.current = performance.now() + SWAP_MS;
    setRecords((prev) => [
      ...prev.filter((r) => !r.leaving).map((r) => ({ ...r, leaving: true, entering: false })),
      ...(track ? [{ key: `r${recordSeq++}`, cover: coverOf(track), entering: hadRecord }] : []),
    ]);
  }, [track]);
  // 换唱片用 Web Animations 直接驱动：位移要按屏幕算（掉到快出屏幕），CSS 关键帧写不出来
  const els = useRef(new Map<string, HTMLDivElement>());
  const animated = useRef(new Set<string>());
  useLayoutEffect(() => {
    // 面板收起时换歌：直接换，不演
    if (!motionEnabled() || !activeRef.current) return;
    for (const r of records) {
      const el = els.current.get(r.key);
      const tag = `${r.key}:${r.leaving ? 'out' : r.entering ? 'in' : ''}`;
      if (!el || (!r.leaving && !r.entering) || animated.current.has(tag)) continue;
      animated.current.add(tag);
      if (r.leaving) leave(el);
      else enter(el);
    }
  }, [records]);

  useEffect(() => {
    if (!records.some((r) => r.leaving || r.entering)) return;
    const t = setTimeout(
      () => setRecords((prev) => prev.filter((r) => !r.leaving).map((r) => ({ ...r, entering: false }))),
      motionEnabled() && activeRef.current ? SWAP_MS : 0,
    );
    return () => clearTimeout(t);
  }, [records]);

  // 唱臂的状态跨过「面板收起」保留下来，重新打开时接着动，不会从臂架上重新摆一遍
  const arm = useRef({ angle: new Spring(REST, SWING.stiffness, SWING.damping), lift: new Spring(0, 140, 13), travelling: false, sway: 0 });
  useEffect(() => {
    // 面板收起时不跑帧循环：看不见的唱臂每帧改属性，在 iPhone 上照样吃掉主线程
    if (!active) return;
    const { angle, lift } = arm.current;
    let { travelling, sway } = arm.current;
    let last = performance.now();
    let id = 0;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const { track, playing, position, duration, drag } = live.current;
      const dur = audioDuration() || duration;
      const t = playing ? audioTime() : position;
      const dragging = drag != null;
      const swapping = now < swapUntil.current;

      let goal: number;
      if (dragging) goal = angleFor(drag / (dur || 1));
      else if (swapping || !track || (!playing && t <= 0)) goal = REST;
      else goal = angleFor(t / (dur || 1));

      const gap = Math.abs(goal - angle.value);
      if (!travelling && gap > TRAVEL_START) travelling = true;
      else if (travelling && gap < TRAVEL_END && Math.abs(angle.velocity) < 1.5) travelling = false;

      const onRest = goal === REST && !travelling;
      const raised = dragging || travelling || (swapping && !dragging) || (!playing && !onRest);
      // 暂停悬停时极轻地上下浮一点，像手扶着的唱臂
      lift.target = raised ? 1 + (dragging || travelling ? 0 : 0.05 * Math.sin(now / 650)) : 0;

      // 先抬起来再摆：抬到一大半之前角度不动
      angle.target = travelling && !dragging && lift.value < 0.75 ? angle.value : goal;
      const k = dragging ? SWING_DRAG : SWING;
      angle.stiffness = k.stiffness;
      angle.damping = k.damping;

      const animate = motionEnabled();
      if (animate) {
        angle.step(dt);
        lift.step(dt);
        // 落到唱片上：反弹一小下
        if (lift.value < 0) {
          lift.value = 0;
          lift.velocity = -lift.velocity * 0.3;
        }
      } else {
        angle.snap(goal);
        lift.snap(raised ? 1 : 0);
        travelling = false;
      }

      const l = Math.max(0, lift.value);
      const swayTarget = animate && playing && !travelling && !dragging ? 1 - Math.min(1, l) : 0;
      sway += (swayTarget - sway) * Math.min(1, dt * 2.5);
      arm.current.travelling = travelling;
      arm.current.sway = sway;
      const deg = angle.value + SWAY_DEG * sway * Math.sin((now / REV_MS) * Math.PI * 2);
      // 俯视角：抬得越高离镜头越近，唱臂略放大，影子落得更远更淡。
      // 影子是同一根唱臂的半透明副本，按抬起高度往右下错开；不用 CSS 滤镜，滤镜每帧重绘在 Safari 上很贵
      const rot = `rotate(${deg.toFixed(3)} ${PIVOT.x} ${PIVOT.y})`;
      armRef.current?.setAttribute('transform', `${rot} translate(${PIVOT.x} ${PIVOT.y}) scale(${(1 + 0.045 * l).toFixed(4)}) translate(${-PIVOT.x} ${-PIVOT.y})`);
      shadowRef.current?.setAttribute('transform', `translate(${(0.4 + 1.6 * l).toFixed(3)} ${(0.9 + 3.2 * l).toFixed(3)}) ${rot}`);
      shadowRef.current?.setAttribute('opacity', (0.22 - 0.1 * l).toFixed(3));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);

  const progressFromPointer = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100 - PIVOT.x;
    const y = ((e.clientY - r.top) / r.height) * 100 - PIVOT.y;
    // 从竖直向下顺时针量角度
    const deg = (Math.atan2(-x, y) * 180) / Math.PI;
    const p = (deg - OUTER) / (INNER - OUTER);
    return Math.min(1, Math.max(0, p)) * (audioDuration() || duration);
  };

  return (
    <div className={`deck ${playing ? 'is-playing' : ''} ${drag != null ? 'is-cueing' : ''}`} ref={boxRef}>
      <div className="deck-platter">
        {records.map((r) => (
          <Vinyl
            key={r.key}
            cover={r.cover}
            // 面板收起时唱盘也不转，省下一层一直在合成的动画
            spinning={!r.leaving && !r.entering && playing && drag == null && active}
            className={`deck-vinyl ${r.leaving ? 'leaving' : ''} ${r.entering ? 'entering' : ''}`}
            labelPx={400}
            ref={(el) => {
              if (el) {
                els.current.set(r.key, el);
                // 只有当前这张参与「小唱片飞到唱盘」的视图过渡
                el.style.viewTransitionName = r.leaving ? '' : (vtName ?? '');
              } else els.current.delete(r.key);
            }}
          />
        ))}
      </div>
      <div className="deck-led" aria-hidden="true" />
      <div className="deck-rpm mono" aria-hidden="true">
        33⅓
      </div>

      <svg className="tonearm-base" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx={PIVOT.x} cy={PIVOT.y} r="6.2" className="arm-base" />
      </svg>
      <svg
        className="tonearm"
        viewBox="0 0 100 100"
        aria-hidden="true"
        ref={svgRef}
        // 打开唱机的过渡里唱臂单独成一层、压在飞来的唱片之上，否则过渡结束时唱臂会从唱片下面「跳」上来
        style={{ viewTransitionName: vtName ? 'np-arm' : undefined } as React.CSSProperties}
      >
        <g ref={shadowRef} className="arm-shadow" opacity="0.22">
          <rect x={PIVOT.x - 2.4} y={PIVOT.y - 11} width="4.8" height="7" rx="1.2" />
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + 58} />
          <line x1={PIVOT.x} y1={PIVOT.y + 58} x2={PIVOT.x - 3.2} y2={PIVOT.y + 66} />
          <rect x={PIVOT.x - 6.6} y={PIVOT.y + 63} width="7" height="10" rx="1.6" transform={`rotate(28 ${PIVOT.x - 3.2} ${PIVOT.y + 68})`} />
        </g>
        <g ref={armRef}>
          <rect x={PIVOT.x - 2.4} y={PIVOT.y - 11} width="4.8" height="7" rx="1.2" className="arm-weight" />
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + 58} className="arm-tube" />
          <line x1={PIVOT.x} y1={PIVOT.y + 58} x2={PIVOT.x - 3.2} y2={PIVOT.y + 66} className="arm-tube" />
          <g
            className="arm-head"
            role="slider"
            aria-label="唱臂（拖动跳转）"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(position)}
            onPointerDown={(e) => {
              if (!track) return;
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              setDrag(progressFromPointer(e));
            }}
            onPointerMove={(e) => drag != null && setDrag(progressFromPointer(e))}
            onPointerUp={(e) => {
              if (drag == null) return;
              seek(progressFromPointer(e));
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {/* 唱头：浅色金属壳 + 强调色的唱头芯，压在黑胶上也看得清 */}
            <g transform={`rotate(28 ${PIVOT.x - 3.2} ${PIVOT.y + 68})`}>
              <rect x={PIVOT.x - 6.6} y={PIVOT.y + 63} width="7" height="10" rx="1.6" className="arm-shell" />
              <rect x={PIVOT.x - 5.3} y={PIVOT.y + 67.6} width="4.4" height="4.2" rx="0.8" className="arm-cartridge" />
            </g>
            <circle cx={PIVOT.x - 3.2} cy={PIVOT.y + 68} r="9" className="arm-grab" />
          </g>
        </g>
        <circle cx={PIVOT.x} cy={PIVOT.y} r="2.4" className="arm-cap" />
      </svg>

      {drag != null && <div className="deck-cue mono">{formatTime(drag)}</div>}
    </div>
  );
}

/** 元素此刻的变换（可能正在入场半路被换走），作为下一段动画的起点 */
function currentTransform(el: HTMLElement) {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? t : 'translate(0px, 0px) scale(1)';
}

/** 旧唱片：托起来 → 往下（朝观众）甩出去，越掉越快，快到屏幕边上时淡掉 */
function leave(el: HTMLElement) {
  const from = currentTransform(el);
  const opacity = Number(getComputedStyle(el).opacity) || 1;
  el.getAnimations().forEach((a) => a.cancel());
  const r = el.getBoundingClientRect();
  // 掉到唱片顶边接近屏幕底部为止
  const fall = Math.max(r.height * 0.9, window.innerHeight - r.top - r.height * 0.18);
  const lifted = 'translate(0px, -1.5%) scale(1.05)';
  el.animate(
    [
      { transform: from, opacity, boxShadow: SHADOW_FLAT, offset: 0 },
      { transform: from, opacity, boxShadow: SHADOW_FLAT, offset: LIFT_AT / (LIFT_AT + LIFT_MS + FALL_MS), easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
      { transform: lifted, opacity, boxShadow: SHADOW_UP, offset: (LIFT_AT + LIFT_MS) / (LIFT_AT + LIFT_MS + FALL_MS), easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
      { transform: `translate(-3%, ${fall * 0.62}px) scale(1.05) rotate(-4deg)`, opacity: opacity * 0.9, boxShadow: SHADOW_UP, offset: 0.85 },
      { transform: `translate(-4%, ${fall}px) scale(1.04) rotate(-6deg)`, opacity: 0, boxShadow: SHADOW_UP, offset: 1 },
    ],
    { duration: LIFT_AT + LIFT_MS + FALL_MS, fill: 'forwards' },
  );
}

/** 新唱片：从下方淡入升上来，悬在唱盘上方一点，再放平、轻轻一沉 */
function enter(el: HTMLElement) {
  const total = ENTER_AT + ENTER_MS + SETTLE_MS;
  const r = el.getBoundingClientRect();
  const rise = Math.min(r.height * 0.75, Math.max(80, window.innerHeight - r.bottom + r.height * 0.4));
  const below = `translate(3%, ${rise}px) scale(1.05) rotate(5deg)`;
  el.animate(
    [
      { transform: below, opacity: 0, boxShadow: SHADOW_UP, offset: 0 },
      { transform: below, opacity: 0, boxShadow: SHADOW_UP, offset: ENTER_AT / total, easing: 'cubic-bezier(0.16, 0.8, 0.3, 1)' },
      { opacity: 1, offset: (ENTER_AT + ENTER_MS * 0.45) / total },
      { transform: 'translate(0px, -1.5%) scale(1.05) rotate(0deg)', boxShadow: SHADOW_UP, offset: (ENTER_AT + ENTER_MS) / total, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
      { transform: 'translate(0px, 0px) scale(0.995) rotate(0deg)', boxShadow: '0 3px 5px -2px rgba(0, 0, 0, 0.4)', offset: (ENTER_AT + ENTER_MS + SETTLE_MS * 0.75) / total },
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, boxShadow: SHADOW_FLAT, offset: 1 },
    ],
    { duration: total, fill: 'backwards' },
  );
}
