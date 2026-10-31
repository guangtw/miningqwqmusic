import { useEffect, useRef, useState } from 'react';
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
/** 换唱片的整段时长：唱臂退回臂架 → 旧唱片拿走 → 新唱片放上 → 唱臂再摆回来 */
const SWAP_MS = 1100;

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
export function Turntable({ vtName }: { vtName?: string }) {
  const track = useStore(playerStore, (s) => currentTrack(s));
  const playing = useStore(playerStore, (s) => s.playing);
  const position = useStore(playerStore, (s) => s.position);
  const duration = useStore(playerStore, (s) => s.duration);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const armRef = useRef<SVGGElement>(null);
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
  const currentId = useRef(track?.id);
  const swapUntil = useRef(0);
  useEffect(() => {
    if (track?.id === currentId.current) return;
    const hadRecord = currentId.current != null;
    currentId.current = track?.id;
    if (hadRecord) swapUntil.current = performance.now() + SWAP_MS;
    setRecords((prev) => [
      ...prev.filter((r) => !r.leaving).map((r) => ({ ...r, leaving: true, entering: false })),
      ...(track ? [{ key: `r${recordSeq++}`, cover: coverOf(track), entering: hadRecord }] : []),
    ]);
  }, [track]);
  useEffect(() => {
    if (!records.some((r) => r.leaving || r.entering)) return;
    const t = setTimeout(
      () => setRecords((prev) => prev.filter((r) => !r.leaving).map((r) => ({ ...r, entering: false }))),
      motionEnabled() ? SWAP_MS - 150 : 0,
    );
    return () => clearTimeout(t);
  }, [records]);

  useEffect(() => {
    const angle = new Spring(REST, SWING.stiffness, SWING.damping);
    const lift = new Spring(0, 140, 13);
    let travelling = false;
    let sway = 0;
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
      const deg = angle.value + SWAY_DEG * sway * Math.sin((now / REV_MS) * Math.PI * 2);
      // 俯视角：抬得越高离镜头越近，唱臂略放大，影子落得更远更淡
      armRef.current?.setAttribute(
        'transform',
        `rotate(${deg.toFixed(3)} ${PIVOT.x} ${PIVOT.y}) translate(${PIVOT.x} ${PIVOT.y}) scale(${(1 + 0.045 * l).toFixed(4)}) translate(${-PIVOT.x} ${-PIVOT.y})`,
      );
      svgRef.current?.style.setProperty('--lift', l.toFixed(3));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

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
            spinning={!r.leaving && !r.entering && playing && drag == null}
            className={`deck-vinyl ${r.leaving ? 'leaving' : ''} ${r.entering ? 'entering' : ''}`}
            labelPx={400}
            ref={(el) => {
              // 只有当前这张参与「小唱片飞到唱盘」的视图过渡
              if (el) el.style.viewTransitionName = r.leaving ? '' : (vtName ?? '');
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
      <svg className="tonearm" viewBox="0 0 100 100" aria-hidden="true" ref={svgRef}>
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
              <line x1={PIVOT.x - 6.4} y1={PIVOT.y + 64.6} x2={PIVOT.x - 8.6} y2={PIVOT.y + 63.4} className="arm-lift" />
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
