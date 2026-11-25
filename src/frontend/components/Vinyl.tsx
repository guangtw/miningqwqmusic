import { forwardRef, useEffect, useRef } from 'react';
import { motionEnabled } from '../lib/settings';
import { Spring } from '../lib/motion';
import { sized } from './Cover';

/** 33⅓ 转：一圈 1.8 秒 */
const REV_MS = 1800;

/**
 * 让元素像唱片一样转：转速用弹簧逼近目标，
 * 开始播放时慢慢转起来，暂停时带着惯性慢慢停下。
 */
export function useSpin(ref: React.RefObject<HTMLElement>, spinning?: boolean) {
  const anim = useRef<Animation | null>(null);
  const spring = useRef(new Spring(0, 14, 7));
  const raf = useRef(0);
  // Decorative records never rotate independently of their sleeves.
  const canSpin = spinning !== undefined;

  useEffect(() => {
    const el = ref.current;
    if (!canSpin || !el?.animate) return;
    anim.current = el.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], {
      duration: REV_MS,
      iterations: Infinity,
    });
    // 停着就真的暂停：以 0 倍速「运行」的动画合成器接不了，只能在主线程上每帧更新
    anim.current.pause();
    return () => {
      cancelAnimationFrame(raf.current);
      anim.current?.cancel();
      anim.current = null;
    };
  }, [ref, canSpin]);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    const s = spring.current;
    s.target = spinning ? 1 : 0;
    // 转速归零就暂停，转起来之前先恢复：只有弹簧还在加减速的那一两秒在主线程上逐帧改转速，
    // 匀速转着的时候整段动画交给合成器
    const settle = () => {
      if (s.value === 0) a.pause();
      else a.playbackRate = s.value;
    };
    if (!motionEnabled()) {
      s.snap(s.target);
      if (s.value) a.play();
      settle();
      return;
    }
    cancelAnimationFrame(raf.current);
    if (s.target > 0 && a.playState === 'paused') {
      a.playbackRate = Math.max(0.001, s.value);
      a.play();
    }
    let last = performance.now();
    const tick = (now: number) => {
      const moving = s.step((now - last) / 1000);
      last = now;
      if (moving) {
        a.playbackRate = Math.max(0.001, s.value);
        raf.current = requestAnimationFrame(tick);
      } else settle();
    };
    raf.current = requestAnimationFrame(tick);
  }, [spinning]);
}

interface VinylProps {
  cover?: string;
  spinning?: boolean;
  className?: string;
  /** 标签图的尺寸（像素），决定取多大的缩略图 */
  labelPx?: number;
}

/**
 * 一张黑胶：纹路 + 封面做中心标签。反光层不随唱片转，
 * 所以转起来时能看到光在纹路上「流」。
 */
export const Vinyl = forwardRef<HTMLDivElement, VinylProps>(function Vinyl(
  { cover, spinning, className = '', labelPx = 160 },
  outerRef,
) {
  const discRef = useRef<HTMLDivElement>(null);
  useSpin(discRef, spinning);
  const label = sized(cover, labelPx);
  return (
    <div ref={outerRef} className={`vinyl ${className}`}>
      <div ref={discRef} className="vinyl-disc" data-can-spin={spinning === undefined ? undefined : ''}>
        <div className="vinyl-label">{label && <img src={label} alt="" decoding="async" />}</div>
      </div>
      <div className="vinyl-sheen" aria-hidden="true" />
      <div className="vinyl-hole" aria-hidden="true" />
    </div>
  );
});
