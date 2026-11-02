// 系统返回（安卓返回键、iOS 侧滑、浏览器后退）和浮层的配合。
//
// 1. 正在播放页、全屏歌词这类全屏浮层各占一条历史记录（URL 不变），系统返回先关浮层，不会直接退出网站。
// 2. iOS / 安卓的侧滑返回自带一段「上一页滑进来」的动画，浏览器已经把旧页面画出来了，
//    这时再播自己的切页过渡就会先跳回首页、再从头演一遍。能判断出是系统手势时就不播。
import { isIOS } from './device';

interface Layer {
  id: number;
  close: (instant: boolean) => void;
}

const layers: Layer[] = [];
// 编号随时间递增：刷新页面后历史里还留着旧记录的编号，新开的浮层编号要比它们大
let seq = Date.now();
/** 自己调 history.back() 关浮层时，关完要接着做的事（例如跳到别的页面） */
let after: (() => void) | null = null;
let uaTransitionAt = -Infinity;
let edgeTouchAt = -Infinity;

// 旧版 Safari 没有 hasUAVisualTransition：从屏幕边缘起手的触摸之后紧跟着的返回，按侧滑算
window.addEventListener(
  'touchstart',
  (e) => {
    const x = e.touches[0]?.clientX ?? 100;
    if (x < 20 || x > window.innerWidth - 20) edgeTouchAt = performance.now();
  },
  { passive: true, capture: true },
);

function onPopState(e: PopStateEvent) {
  const ua = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
  const instant = !!ua || (isIOS() && performance.now() - edgeTouchAt < 1200);
  if (instant) uaTransitionAt = performance.now();
  const depth = (history.state as { layer?: number } | null)?.layer ?? 0;
  while (layers.length && layers[layers.length - 1].id > depth) layers.pop()!.close(instant);
  const next = after;
  after = null;
  next?.();
}

// 外层 Next.js 的路由见到不是它写的历史记录（没有 __NA）会整页刷新，而它的监听比这里先挂上。
// 所以由页面 <head> 里的一小段脚本最先接住 popstate、转给这里，并把浮层的记录拦下（见 app/layout.tsx）。
// 单独跑前端（没有那段脚本）时自己监听
type HookedWindow = Window & { __qwqPopstate?: (e: PopStateEvent) => void };
if ('__qwqPopstate' in window) (window as HookedWindow).__qwqPopstate = onPopState;
else window.addEventListener('popstate', onPopState);

/** 刚才这次后退 / 前进是不是系统手势自带了动画（hashchange 紧跟在 popstate 后面，用它决定要不要播切页过渡） */
export const browserAnimatedNav = () => performance.now() - uaTransitionAt < 400;

/** 打开一个全屏浮层：压一条历史记录，系统返回时调用 close */
export function pushLayer(close: (instant: boolean) => void): number {
  const id = ++seq;
  layers.push({ id, close });
  history.pushState({ ...(history.state as object | null), layer: id }, '');
  return id;
}

/** 界面里点了「收起」：退回那条历史记录，由 popstate 真正关闭；之后再执行 then */
export function popLayer(id: number, then?: () => void) {
  const at = layers.findIndex((l) => l.id === id);
  if (at < 0) {
    then?.();
    return;
  }
  // 只能退最上面的；它上面还压着别的浮层就一起退掉
  const steps = layers.length - at;
  after = then ?? null;
  history.go(-steps);
}

/** 浮层被别的途径关掉了（换页），这条记录作废：不再响应返回 */
export function dropLayer(id: number) {
  const at = layers.findIndex((l) => l.id === id);
  if (at >= 0) layers.splice(at);
}

export const hasLayer = (id: number) => layers.some((l) => l.id === id);
