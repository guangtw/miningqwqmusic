// 安卓手机上在主内容区左右滑动，切到相邻的一级页面（#13）。
//
// - 顺序就是手机底部导航里实际露出来的那一排（读 DOM，导航改了这里不用跟着改）；当前页不在其中（详情页、
//   个人中心、私信……）就不响应，横滑留给页面自己。
// - 手指往左划 = 去右边那一项，往右划 = 回左边那一项；首尾页拉不动，只会轻轻弹回。
// - 起手点落在输入框、滑块、能横向滚动的列表（卡片轨道等）、或屏幕左右边缘（系统返回手势）上时不接管。
// - 切页和点导航一样写一条历史记录，安卓返回键按来时的顺序一页页退回去。
// - 只换路由，不碰播放器：歌曲、进度、队列都不受影响。
import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { isAndroid } from './device';
import { navigate } from './router';
import { motionEnabled } from './settings';

/** 屏幕左右各留这么宽给系统的边缘返回手势 */
const EDGE = 24;
/** 先动多少像素才判断方向 */
const SLOP = 10;
/** 横向位移超过它（或者甩得够快）就切页 */
const COMMIT = 72;
const FLING = 0.45; // px/ms
const NARROW = '(max-width: 860px)';

const BLOCK = 'input, textarea, select, [role="slider"], [contenteditable], [data-no-swipe]';

/** 起手点往上到主内容区之间，有没有自己会横向滚动、或者自己处理触摸的东西 */
function ownsHorizontal(target: Element, root: HTMLElement): boolean {
  if (target.closest(BLOCK)) return true;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.touchAction === 'none' || cs.touchAction.includes('pan-x')) return true;
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/** 手机上露出来的一级导航（底部那一排，按显示顺序） */
function visibleTabs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('[data-swipe-tabs] a')]
    .filter((a) => a.getClientRects().length > 0)
    .map((a) => a.getAttribute('href') ?? '');
}

const currentHash = () => location.hash || '#/';

let swipeTimer = 0;
/** 告诉视图过渡这次是往哪边划的，新旧两页横着进出 */
function markDirection(dir: 'next' | 'prev') {
  const root = document.documentElement;
  root.dataset.swipe = dir;
  clearTimeout(swipeTimer);
  swipeTimer = window.setTimeout(() => delete root.dataset.swipe, 900);
}

export function useSwipeNav(mainRef: RefObject<HTMLElement>, path: string) {
  // 被拖动过的那一页：换页后如果还是同一个元素（没重新挂载），把位移清掉
  useLayoutEffect(() => {
    const page = mainRef.current?.firstElementChild as HTMLElement | null;
    if (page?.style.transform) {
      page.style.transition = '';
      page.style.transform = '';
      page.style.opacity = '';
    }
  }, [path, mainRef]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !isAndroid()) return;
    const narrow = window.matchMedia(NARROW);
    main.classList.add('swipe-nav');

    let g: {
      x: number;
      y: number;
      t: number;
      lastX: number;
      lastT: number;
      v: number;
      mode: 'pending' | 'swipe' | 'off';
      prev?: string;
      next?: string;
      page: HTMLElement | null;
      animate: boolean;
    } | null = null;

    const offset = (dx: number) => {
      const target = dx < 0 ? g?.next : g?.prev;
      // 有下一页：跟手但略重；首尾页：橡皮筋，拉不远
      return target ? dx * 0.6 : Math.sign(dx) * Math.min(Math.abs(dx) * 0.18, 36);
    };

    const settle = (page: HTMLElement) => {
      page.style.transition = 'transform 0.38s var(--ease-spring), opacity 0.3s';
      page.style.transform = '';
      page.style.opacity = '';
      page.addEventListener('transitionend', () => (page.style.transition = ''), { once: true });
    };

    const onStart = (e: TouchEvent) => {
      g = null;
      if (e.touches.length !== 1 || !narrow.matches) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
      const target = e.target as Element;
      if (main.contains(target)) {
        if (ownsHorizontal(target, main)) return;
      } else {
        // 上一次切页的过渡还在播（连着划的时候）：整页盖着过渡层，触摸落在根元素上，按坐标判断是不是在主内容区
        if (!document.documentElement.dataset.vt || target !== document.documentElement) return;
        const inside = (r?: DOMRect) => !!r && t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
        if (!inside(main.getBoundingClientRect()) || inside(document.querySelector('.player')?.getBoundingClientRect())) return;
      }
      const tabs = visibleTabs();
      const at = tabs.indexOf(currentHash());
      if (at < 0) return;
      const now = performance.now();
      g = {
        x: t.clientX,
        y: t.clientY,
        t: now,
        lastX: t.clientX,
        lastT: now,
        v: 0,
        mode: 'pending',
        prev: tabs[at - 1],
        next: tabs[at + 1],
        page: main.firstElementChild as HTMLElement | null,
        animate: motionEnabled(),
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!g || g.mode === 'off') return;
      if (e.touches.length !== 1) {
        if (g.mode === 'swipe' && g.page) settle(g.page);
        g.mode = 'off';
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (g.mode === 'pending') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // 偏竖直就是在滚动，这一下不再管
        if (Math.abs(dx) < Math.abs(dy) * 1.3) {
          g.mode = 'off';
          return;
        }
        g.mode = 'swipe';
      }
      const now = performance.now();
      if (now > g.lastT) g.v = (t.clientX - g.lastX) / (now - g.lastT);
      g.lastX = t.clientX;
      g.lastT = now;
      if (g.animate && g.page) {
        const o = offset(dx);
        g.page.style.transition = 'none';
        g.page.style.transform = `translate3d(${o}px, 0, 0)`;
        g.page.style.opacity = String(1 - Math.min(Math.abs(o) / window.innerWidth, 0.4));
      }
    };

    const onEnd = () => {
      const s = g;
      g = null;
      if (!s || s.mode !== 'swipe') return;
      const dx = s.lastX - s.x;
      const target = dx < 0 ? s.next : s.prev;
      const go = !!target && (Math.abs(dx) > COMMIT || (Math.abs(dx) > 32 && Math.abs(s.v) > FLING && Math.sign(s.v) === Math.sign(dx)));
      if (!go) {
        if (s.page && s.animate) settle(s.page);
        return;
      }
      if (s.animate) markDirection(dx < 0 ? 'next' : 'prev');
      navigate(target!.replace(/^#/, ''));
    };

    const onCancel = () => {
      if (g?.mode === 'swipe' && g.page) settle(g.page);
      g = null;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      main.classList.remove('swipe-nav');
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [mainRef]);
}
