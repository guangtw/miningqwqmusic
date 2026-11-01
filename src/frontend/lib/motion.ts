import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { tintOf } from './palette';
import { motionEnabled } from './settings';
import { createStore } from './store';

// ================= 视图过渡 =================

type TransitionKind = 'page' | 'np-open' | 'np-close' | 'theme';

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> };
};

let running = false;
let finished: Promise<void> = Promise.resolve();

/**
 * 用 View Transitions API 包住一次界面更新，让封面在页面之间「飞」过去。
 * 浏览器不支持或用户关了动画时，直接更新，组件自己的 CSS 入场动画兜底。
 */
export function transition(update: () => void, kind: TransitionKind = 'page') {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || !motionEnabled() || running) {
    update();
    return;
  }
  running = true;
  const root = document.documentElement;
  root.dataset.vt = kind;
  const vt = doc.startViewTransition(() => flushSync(update));
  // 页面在后台、或被别的过渡打断时浏览器会跳过动画（更新照常生效），ready 会 reject，不算错误
  vt.ready.catch(() => undefined);
  finished = vt.finished.catch(() => undefined).finally(() => {
    running = false;
    delete root.dataset.vt;
  });
}

/** 正在播视图过渡时返回它播完的 Promise，没在播返回 null */
export const transitionSettled = () => (running ? finished : null);

/** 不带任何过渡地立刻更新（系统返回手势已经演过动画时用），面板自己的 CSS 过渡也先关掉 */
export function snap(update: () => void) {
  const root = document.documentElement;
  root.dataset.snap = '';
  flushSync(update);
  requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.snap));
}

export const supportsViewTransition = () => !!(document as ViewTransitionDoc).startViewTransition;

// ================= 共享封面（hero） =================

/**
 * 记住最近一次点开的卡片（如 'playlist:123'）。
 * 卡片和详情页头图在 key 相同时都带上 view-transition-name: hero，
 * 前进时封面从卡片飞到头图，返回时再飞回来。
 */
export const heroStore = createStore<{ key: string | null }>({ key: null });

export function markHero(el: HTMLElement | null, key: string) {
  document.querySelectorAll('.hero-active').forEach((n) => n.classList.remove('hero-active'));
  el?.classList.add('hero-active');
  heroStore.set({ key });
}

/** 从卡片带到详情页的预览数据：详情还没加载完时先用它画头部 */
export interface Preview {
  title: string;
  coverUrl?: string;
  subtitle?: string;
}
const previews = new Map<string, Preview>();
export function setPreview(key: string, p: Preview) {
  previews.set(key, p);
  // 顺手开始取色：过渡播完时多半已经算好，详情页的色带直接是对的颜色
  void tintOf(p.coverUrl);
}
export const getPreview = (key: string) => previews.get(key);

// ================= 帧循环 =================

/** 每帧回调（只在 active 时跑），用来直接改 DOM，不触发 React 重渲染 */
export function useFrame(cb: (now: number) => void, active: boolean) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) {
      ref.current(performance.now());
      return;
    }
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** 订阅一条媒体查询（例如窄屏） */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
  );
}

// ================= 退场动画 =================

/**
 * 让组件在关闭时先播完退场动画再卸载。
 * 返回 mounted（是否渲染）和 state（'open' | 'closing'，用作 data-state）。
 */
export function usePresence(open: boolean, exitMs = 260) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closing'>('open');
  useEffect(() => {
    if (open) {
      setMounted(true);
      setState('open');
      return;
    }
    if (!mounted) return;
    if (!motionEnabled()) {
      setMounted(false);
      return;
    }
    setState('closing');
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { mounted, state };
}

// ================= 弹簧 =================

/**
 * 一维弹簧：设定目标值后每帧逼近，带一点惯性和回弹。
 * 唱臂、唱片转速这类「有重量」的东西用它，比固定时长的缓动更自然。
 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(
    initial: number,
    public stiffness = 120,
    public damping = 18,
  ) {
    this.value = this.target = initial;
  }
  /** dt 单位秒；返回是否仍在运动 */
  step(dt: number): boolean {
    const dtc = Math.min(dt, 1 / 30);
    const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += force * dtc;
    this.value += this.velocity * dtc;
    if (Math.abs(this.velocity) < 0.001 && Math.abs(this.target - this.value) < 0.001) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
  snap(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}

// ================= 缓动工具 =================

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 平滑滚动到指定位置（比原生 smooth 更可控，可被打断） */
export function tweenScroll(el: HTMLElement, to: number, ms = 650): () => void {
  const from = el.scrollTop;
  const delta = to - from;
  if (Math.abs(delta) < 1 || !motionEnabled()) {
    el.scrollTop = to;
    return () => undefined;
  }
  const start = performance.now();
  let id = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / ms);
    el.scrollTop = from + delta * easeInOutCubic(t);
    if (t < 1) id = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(id);
}
