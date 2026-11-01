import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { coverOf } from '../api';
import { formatTime } from '../lib/format';
import { Spring } from '../lib/motion';
import { motionEnabled } from '../lib/settings';
import { useStore } from '../lib/store';
import { audioDuration, audioTime, currentTrack, playerStore, seek, swapDirection } from '../player/player';
import { sized } from './Cover';
import { Vinyl } from './Vinyl';

// 唱机俯视图，坐标都在 100×100 的盒子里。
// 唱臂绕支点旋转：0° = 竖直向下（搁在臂架上），
// OUTER° 时唱针落在最外圈，INNER° 时到达最内圈。
const PIVOT = { x: 88, y: 14 };
const REST = 2;
const OUTER = 17.5;
const INNER = 37;
/** 唱针尖相对支点的位置（唱臂竖直时），落针的涟漪从这里漾开 */
const TIP = { x: -4.6, y: 70.5 };

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
 * 换唱片的节奏（毫秒）。俯视镜头：离唱盘越高，唱片越大、影子离得越远。
 * 下一首：唱臂抬起回臂架；旧唱片被托起、往左边抽走，唱盘空出来露一下中心轴；
 *        新唱片从上方落下来，悬停一下再「咚」地落稳，唱盘边漾开一圈光，指示灯眨一下，
 *        全站的颜色在这一刻换成新封面的色。
 * 上一首：反过来——旧唱片被拿起来朝镜头离开，上一张从左边滑回来落下。
 * 旧唱片基本走远了新唱片才出现：两张半透明的黑胶叠在一起会糊成一团灰。
 * 全程只动 transform / opacity（影子是单独一层），不碰 box-shadow，不触发重绘。
 */
const LIFT_AT = 120;
const OUT_AT = 300;
const OUT_MS = 440;
const IN_AT = 640;
export const RECORD_LAND_MS = 1080;
const SETTLE_MS = 220;
const SWAP_MS = RECORD_LAND_MS + SETTLE_MS;
/** 唱臂等唱片落稳再摆回来 */
const ARM_HOLD_MS = RECORD_LAND_MS + 40;
/** 打开唱机时唱臂先在臂架上等小唱片飞到唱盘，再摆过去落针 */
const PARK_MS = 720;

interface DeckRecord {
  key: string;
  cover?: string;
  /** 正在被拿走的旧唱片 */
  leaving?: boolean;
  /** 刚放上来、还没落稳的新唱片（落稳前不转） */
  entering?: boolean;
  /** 1 = 下一首，-1 = 上一首 */
  dir: 1 | -1;
}

let recordSeq = 0;

/**
 * 正在播放页的唱机。唱臂的位置就是播放进度，动作按真唱机来：
 * 还没开始放时搁在臂架上；按下播放先抬臂、摆到外圈、再落针；
 * 暂停时抬起悬停；换歌、跳转时抬起摆过去再落下；播放中随唱片偏心轻轻摆动。
 * 拖动唱臂可以跳转。
 */
export function Turntable({ vtName, active = true, open = active }: { vtName?: string; active?: boolean; open?: boolean }) {
  const track = useStore(playerStore, (s) => currentTrack(s));
  const playing = useStore(playerStore, (s) => s.playing);
  const position = useStore(playerStore, (s) => s.position);
  const duration = useStore(playerStore, (s) => s.duration);
  const boxRef = useRef<HTMLDivElement>(null);
  const armRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const ledRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // 帧循环只建一次，每帧从这里读最新状态
  const live = useRef({ track, playing, position, duration, drag });
  live.current = { track, playing, position, duration, drag };

  // 唱盘上的唱片。换歌时旧的那张留一会儿播退场，新的一张播入场
  const [records, setRecords] = useState<DeckRecord[]>(() =>
    track ? [{ key: `r${recordSeq++}`, cover: coverOf(track), dir: 1 }] : [],
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
  const holdUntil = useRef(0);
  useEffect(() => {
    if (track?.id === currentId.current) return;
    const hadRecord = currentId.current != null;
    currentId.current = track?.id;
    const dir = swapDirection();
    if (hadRecord && activeRef.current) holdUntil.current = performance.now() + ARM_HOLD_MS;
    setRecords((prev) => [
      ...prev.filter((r) => !r.leaving).map((r) => ({ ...r, leaving: true, entering: false, dir })),
      ...(track ? [{ key: `r${recordSeq++}`, cover: coverOf(track), entering: hadRecord, dir }] : []),
    ]);
  }, [track]);
  // 换唱片用 Web Animations 直接驱动：每张唱片的托盘和影子各一条动画，落稳那一刻再补唱盘的光圈和指示灯
  const slots = useRef(new Map<string, HTMLDivElement>());
  const animated = useRef(new Set<string>());
  useLayoutEffect(() => {
    // 面板收起时换歌：直接换，不演
    if (!motionEnabled() || !activeRef.current) return;
    for (const r of records) {
      const el = slots.current.get(r.key);
      const tag = `${r.key}:${r.leaving ? 'out' : r.entering ? 'in' : ''}`;
      if (!el || (!r.leaving && !r.entering) || animated.current.has(tag)) continue;
      animated.current.add(tag);
      if (r.leaving) leave(el, r.dir);
      else {
        enter(el, r.dir);
        land(ringRef.current, ledRef.current);
      }
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

  // 唱臂的状态跨过「面板收起」保留下来（手机上切全屏歌词再回来时接着动）
  const arm = useRef({ angle: new Spring(REST, SWING.stiffness, SWING.damping), lift: new Spring(0, 140, 13), travelling: false, sway: 0, airborne: false });

  /** 把唱臂画到某个角度、某个抬起高度。只改两层的 transform，不重绘；和上一帧一样就不碰 DOM */
  const drawn = useRef('');
  const draw = (deg: number, l: number) => {
    const key = `${deg.toFixed(3)}:${l.toFixed(4)}`;
    if (key === drawn.current) return;
    drawn.current = key;
    // 俯视角：抬得越高离镜头越近，唱臂略放大，影子落得更远更淡
    if (armRef.current) armRef.current.style.transform = `rotate(${deg.toFixed(3)}deg) scale(${(1 + 0.045 * l).toFixed(4)})`;
    const shadow = shadowRef.current;
    if (shadow) {
      shadow.style.transform = `translate(${(0.4 + 1.6 * l).toFixed(3)}%, ${(0.9 + 3.2 * l).toFixed(3)}%) rotate(${deg.toFixed(3)}deg)`;
      shadow.style.opacity = (0.22 - 0.1 * l).toFixed(3);
    }
  };

  // 打开唱机：唱臂先回到臂架上等着，小唱片飞上唱盘后再摆过去落针。
  // 臂架上的唱臂不压在唱片上，飞来的唱片不会在过渡结束时从唱臂上面「跳」到下面
  const parkUntil = useRef(0);
  const wasOpen = useRef(open);
  // 停臂这段时间唱片也不转：一来像真唱机（放稳了、落针了才转起来），
  // 二来打开过渡里唱片是「活」的一层，一直在转的话 iPhone 上每帧都得重画它
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => setSettling(false), PARK_MS);
    return () => clearTimeout(t);
  }, [settling]);
  useLayoutEffect(() => {
    if (open && !wasOpen.current && motionEnabled()) {
      setSettling(true);
      const a = arm.current;
      a.angle.snap(REST);
      a.lift.snap(0);
      a.travelling = false;
      a.airborne = false;
      a.sway = 0;
      parkUntil.current = performance.now() + PARK_MS;
      draw(REST, 0);
    }
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 面板收起时不跑帧循环：看不见的唱臂每帧改样式，在 iPhone 上照样吃掉主线程
    if (!active) return;
    const a = arm.current;
    const { angle, lift } = a;
    let last = performance.now();
    let id = 0;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const { track, playing, position, duration, drag } = live.current;
      const dur = audioDuration() || duration;
      const t = playing ? audioTime() : position;
      const dragging = drag != null;
      const holding = now < holdUntil.current || now < parkUntil.current;

      let goal: number;
      if (dragging) goal = angleFor(drag / (dur || 1));
      else if (holding || !track || (!playing && t <= 0)) goal = REST;
      else goal = angleFor(t / (dur || 1));

      const gap = Math.abs(goal - angle.value);
      if (!a.travelling && gap > TRAVEL_START) a.travelling = true;
      else if (a.travelling && gap < TRAVEL_END && Math.abs(angle.velocity) < 1.5) a.travelling = false;

      const onRest = goal === REST && !a.travelling;
      const raised = dragging || a.travelling || (holding && !onRest) || (!playing && !onRest);
      // 暂停悬停时极轻地上下浮一点，像手扶着的唱臂
      lift.target = raised ? 1 + (dragging || a.travelling ? 0 : 0.05 * Math.sin(now / 650)) : 0;

      // 先抬起来再摆：抬到一大半之前角度不动
      angle.target = a.travelling && !dragging && lift.value < 0.75 ? angle.value : goal;
      const k = dragging ? SWING_DRAG : SWING;
      angle.stiffness = k.stiffness;
      angle.damping = k.damping;

      const animate = motionEnabled();
      if (animate) {
        angle.step(dt);
        lift.step(dt);
        if (lift.value > 0.5) a.airborne = true;
        // 落到唱片上：反弹一小下；落在唱片上（不是臂架上）时，针尖处漾开一圈细纹
        if (lift.value < 0) {
          if (a.airborne && goal !== REST && !dragging) needleDrop(touchRef.current, angle.value);
          a.airborne = false;
          lift.value = 0;
          lift.velocity = -lift.velocity * 0.3;
        }
      } else {
        angle.snap(goal);
        lift.snap(raised ? 1 : 0);
        a.travelling = false;
        a.airborne = false;
      }

      const l = Math.max(0, lift.value);
      // 只有针落在唱片上才跟着偏心摆；搁在臂架上的唱臂纹丝不动
      const swayTarget = animate && playing && !a.travelling && !dragging && goal !== REST ? 1 - Math.min(1, l) : 0;
      a.sway += (swayTarget - a.sway) * Math.min(1, dt * 2.5);
      draw(angle.value + SWAY_DEG * a.sway * Math.sin((now / REV_MS) * Math.PI * 2), l);
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
        <div className="deck-ring" ref={ringRef} aria-hidden="true" />
        {records.map((r) => (
          <div
            key={r.key}
            className={`deck-slot ${r.leaving ? 'leaving' : ''} ${r.entering ? 'entering' : ''}`}
            data-dir={r.dir}
            ref={(el) => {
              if (el) slots.current.set(r.key, el);
              else slots.current.delete(r.key);
            }}
          >
            <div className="deck-drop" aria-hidden="true" />
            <Vinyl
              cover={r.cover}
              // 面板收起时唱盘也不转，省下一层一直在合成的动画
              spinning={!r.leaving && !r.entering && playing && drag == null && active && !settling}
              className="deck-vinyl"
              labelPx={400}
              ref={(el) => {
                // 只有当前这张参与「小唱片飞到唱盘」的视图过渡
                if (el) el.style.viewTransitionName = r.leaving ? '' : (vtName ?? '');
              }}
            />
          </div>
        ))}
      </div>
      <div className="deck-led" ref={ledRef} aria-hidden="true" />
      <div className="deck-rpm mono" aria-hidden="true">
        33⅓
      </div>

      {/* 唱臂整套（臂座、影子、臂、轴帽）压在所有唱片上面；收起唱机时整套单独成一层（见 motion.css 的 np-arm） */}
      <div className="tonearm">
        <svg className="arm-base-layer" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx={PIVOT.x} cy={PIVOT.y} r="6.2" className="arm-base" />
        </svg>
        {/* 影子是同一根唱臂的半透明副本，按抬起高度往右下错开；不用 CSS 滤镜，滤镜每帧重绘在 Safari 上很贵 */}
        <div className="arm-shadow" ref={shadowRef} aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <rect x={PIVOT.x - 2.4} y={PIVOT.y - 11} width="4.8" height="7" rx="1.2" />
            <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + 58} />
            <line x1={PIVOT.x} y1={PIVOT.y + 58} x2={PIVOT.x - 3.2} y2={PIVOT.y + 66} />
            <rect x={PIVOT.x - 6.6} y={PIVOT.y + 63} width="7" height="10" rx="1.6" transform={`rotate(28 ${PIVOT.x - 3.2} ${PIVOT.y + 68})`} />
          </svg>
        </div>
        <div className="arm-swing" ref={armRef}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
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
          </svg>
        </div>
        <svg className="arm-cap-layer" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx={PIVOT.x} cy={PIVOT.y} r="2.4" className="arm-cap" />
        </svg>
      </div>
      <div className="deck-touch" ref={touchRef} aria-hidden="true" />

      {drag != null && <div className="deck-cue mono">{formatTime(drag)}</div>}
    </div>
  );
}

/** 元素此刻的变换（可能正在入场半路被换走），作为下一段动画的起点 */
function currentTransform(el: HTMLElement) {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? t : 'translate(0px, 0px) scale(1)';
}

const FLAT = 'translate(0%, 0%) scale(1) rotate(0deg)';
const HOVER = 'translate(-1%, -2%) scale(1.06) rotate(0deg)';
/** 影子：贴着唱片时看不见，抬得越高离得越远 */
const SHADOW_FLAT = { opacity: 0, transform: 'translate(0%, 0%) scale(1)' };
const SHADOW_HOVER = { opacity: 1, transform: 'translate(2.5%, 4.5%) scale(1.02)' };
const SHADOW_HIGH = { opacity: 0.55, transform: 'translate(6%, 10%) scale(1.06)' };

/** 旧唱片：托起来 → 下一首往左抽走 / 上一首朝镜头拿走，边走边淡掉 */
function leave(slot: HTMLElement, dir: 1 | -1) {
  const from = currentTransform(slot);
  const opacity = Number(getComputedStyle(slot).opacity) || 1;
  const shadow = slot.querySelector<HTMLElement>('.deck-drop');
  slot.getAnimations().forEach((a) => a.cancel());
  shadow?.getAnimations().forEach((a) => a.cancel());
  const total = OUT_AT + OUT_MS;
  const lift = LIFT_AT / total;
  const up = OUT_AT / total;
  // 半透明的黑胶叠在别的东西上会发灰，所以先不淡，快走远了才一下子淡掉
  const away = dir === 1 ? 'translate(-104%, 8%) scale(1.06) rotate(-18deg)' : 'translate(5%, -14%) scale(1.24) rotate(10deg)';
  slot.animate(
    [
      { transform: from, opacity, offset: 0 },
      { transform: from, offset: lift, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
      { transform: HOVER, offset: up, easing: dir === 1 ? 'cubic-bezier(0.55, 0, 0.8, 0.4)' : 'cubic-bezier(0.4, 0, 0.6, 1)' },
      { opacity, offset: up + (1 - up) * (dir === 1 ? 0.55 : 0.2) },
      { transform: away, opacity: 0, offset: 1 },
    ],
    { duration: total, fill: 'forwards' },
  );
  shadow?.animate(
    [
      { ...SHADOW_FLAT, offset: 0 },
      { ...SHADOW_FLAT, offset: lift, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
      { ...SHADOW_HOVER, offset: up },
      dir === 1 ? { ...SHADOW_HOVER, offset: 1 } : { ...SHADOW_HIGH, opacity: 0, offset: 1 },
    ],
    { duration: total, fill: 'forwards' },
  );
}

/** 新唱片：下一首从上方落下 / 上一首从左边滑回，悬在唱盘上方一下，再咚地落稳 */
function enter(slot: HTMLElement, dir: 1 | -1) {
  const shadow = slot.querySelector<HTMLElement>('.deck-drop');
  const total = RECORD_LAND_MS + SETTLE_MS;
  const start = IN_AT / total;
  const seen = (IN_AT + 130) / total;
  const hover = (RECORD_LAND_MS - 130) / total;
  const down = RECORD_LAND_MS / total;
  const from = dir === 1 ? 'translate(-5%, -12%) scale(1.26) rotate(16deg)' : 'translate(-86%, 6%) scale(1.06) rotate(-16deg)';
  slot.animate(
    [
      { transform: from, opacity: 0, offset: 0 },
      { transform: from, opacity: 0, offset: start, easing: 'cubic-bezier(0.2, 0.75, 0.35, 1)' },
      { opacity: 1, offset: seen },
      { transform: HOVER, offset: hover, easing: 'cubic-bezier(0.6, 0, 0.9, 0.45)' },
      { transform: 'translate(0%, 0%) scale(0.986) rotate(0deg)', offset: down, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
      { transform: 'translate(0%, 0%) scale(1.006) rotate(0deg)', offset: down + (1 - down) * 0.5, easing: 'ease-in-out' },
      { transform: FLAT, opacity: 1, offset: 1 },
    ],
    { duration: total, fill: 'backwards' },
  );
  shadow?.animate(
    [
      { ...SHADOW_HIGH, opacity: 0, offset: 0 },
      { ...SHADOW_HIGH, opacity: 0, offset: start, easing: 'cubic-bezier(0.2, 0.75, 0.35, 1)' },
      { ...(dir === 1 ? SHADOW_HIGH : SHADOW_HOVER), offset: seen },
      { ...SHADOW_HOVER, offset: hover, easing: 'cubic-bezier(0.6, 0, 0.9, 0.45)' },
      { ...SHADOW_FLAT, offset: down },
      { ...SHADOW_FLAT, offset: 1 },
    ],
    { duration: total, fill: 'backwards' },
  );
}

/** 唱片落稳的那一刻：唱盘边漾开一圈光，指示灯眨一下 */
function land(ring: HTMLElement | null, led: HTMLElement | null) {
  ring?.animate(
    [
      { opacity: 0.7, transform: 'scale(0.98)' },
      { opacity: 0, transform: 'scale(1.18)' },
    ],
    { duration: 760, delay: RECORD_LAND_MS - 30, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' },
  );
  led?.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(2)', opacity: 0.4, offset: 0.35 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 420, delay: RECORD_LAND_MS - 10, easing: 'ease-out' },
  );
}

/** 唱针落在唱片上：针尖处一圈细纹漾开 */
function needleDrop(el: HTMLElement | null, deg: number) {
  if (!el) return;
  const r = (deg * Math.PI) / 180;
  // 唱臂绕支点顺时针转 deg 度后，针尖的位置
  el.style.left = `${PIVOT.x + TIP.x * Math.cos(r) - TIP.y * Math.sin(r)}%`;
  el.style.top = `${PIVOT.y + TIP.x * Math.sin(r) + TIP.y * Math.cos(r)}%`;
  el.animate(
    [
      { opacity: 0.85, transform: 'translate(-50%, -50%) scale(0.2)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
    ],
    { duration: 620, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' },
  );
}
