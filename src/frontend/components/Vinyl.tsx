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
export function useSpin(ref: React.RefObject<HTMLElement>, spinning: boolean) {
  const anim = useRef<Animation | null>(null);
  const spring = useRef(new Spring(0, 14, 7));
  const raf = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !el.animate) return;
    anim.current = el.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], {
      duration: REV_MS,
      iterations: Infinity,
    });
    anim.current.playbackRate = 0;
    return () => {
      cancelAnimationFrame(raf.current);
      anim.current?.cancel();
    };
  }, [ref]);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    const s = spring.current;
    s.target = spinning ? 1 : 0;
    if (!motionEnabled()) {
      s.snap(s.target);
      a.playbackRate = s.value;
      return;
    }
    cancelAnimationFrame(raf.current);
    let last = performance.now();
    const tick = (now: number) => {
      const moving = s.step((now - last) / 1000);
      last = now;
      a.playbackRate = Math.max(0, s.value);
      if (moving) raf.current = requestAnimationFrame(tick);
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
  { cover, spinning = false, className = '', labelPx = 160 },
  outerRef,
) {
  const discRef = useRef<HTMLDivElement>(null);
  useSpin(discRef, spinning);
  const label = sized(cover, labelPx);
  return (
    <div ref={outerRef} className={`vinyl ${className}`}>
      <div ref={discRef} className="vinyl-disc">
        <div className="vinyl-label">{label && <img src={label} alt="" decoding="async" />}</div>
      </div>
      <div className="vinyl-sheen" aria-hidden="true" />
      <div className="vinyl-hole" aria-hidden="true" />
    </div>
  );
});
