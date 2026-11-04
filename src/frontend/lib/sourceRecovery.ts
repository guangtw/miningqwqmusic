import { currentTrack, playerStore, switchToStableSource } from '../player/player';
import { createStore, useStore } from './store';

/**
 * 「放的歌不对？」入口的状态。播放器只给能不能切（canSwitchToStableSource）和切的动作；
 * 这里补上两件事：
 * 1. 歌名附近什么时候冒出来（nudge）：放错集中在免费歌 + 超清母带，这个档位每首开头露 10 秒；
 *    别的档位一次打开网页只露一回。其余时候只在音质面板里。
 * 2. 点了之后那一小段：切换中 → 切好了（带 Q&A 入口，停一会儿）→ 收起。几处入口共用同一份，点了哪个都一起变。
 */
interface Recovery {
  trackId: string | null;
  /** 换源请求落定的时刻；0 = 还在换 */
  settledAt: number;
  ok: boolean;
  /** 正在歌名附近露面的那首 */
  nudge: string | null;
}

/** 切好之后那行字（带 Q&A）停多久 */
const DONE_MS = 12_000;
const NUDGE_MASTER_MS = 10_000;
const NUDGE_OTHER_MS = 6_000;
const idle = { trackId: null, settledAt: 0, ok: false };
export const recoveryStore = createStore<Recovery>({ ...idle, nudge: null });

let clearTimer: ReturnType<typeof setTimeout> | undefined;
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
/** 已经轮过露面的那首：续签、换源后重新可切时不再露第二次 */
let nudgedFor: string | null = null;
/** 超清母带以外的档位，这次打开网页露过了 */
let nudgedOther = false;

function check() {
  const s = playerStore.get();
  const id = currentTrack(s)?.id ?? null;
  const r = recoveryStore.get();

  if (r.nudge && r.nudge !== id) {
    clearTimeout(nudgeTimer);
    recoveryStore.set({ nudge: null });
  }
  if (s.canSwitchToStableSource && id && nudgedFor !== id) {
    nudgedFor = id;
    const master = s.level === 'jymaster';
    if (master || !nudgedOther) {
      if (!master) nudgedOther = true;
      clearTimeout(nudgeTimer);
      recoveryStore.set({ nudge: id });
      nudgeTimer = setTimeout(() => {
        if (recoveryStore.get().nudge === id) recoveryStore.set({ nudge: null });
      }, master ? NUDGE_MASTER_MS : NUDGE_OTHER_MS);
    }
  }

  if (!r.trackId) return;
  // 切歌、清队列：这条状态跟着那首歌走
  if (id !== r.trackId) {
    clearTimeout(clearTimer);
    return recoveryStore.set(idle);
  }
  if (r.settledAt || s.loading) return;
  // 真的走上官方才算切好；限流、出错时播放器自己会提示，这里安静收起
  const ok = s.unblockMode === 'force_off' && s.resolvedVia === 'primary';
  recoveryStore.set({ settledAt: Date.now(), ok });
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => recoveryStore.set(idle), ok ? DONE_MS : 0);
}
playerStore.subscribe(check);

/** 点入口：读这一刻的当前歌曲，别让旧闭包里的歌影响已经换上的新歌 */
export function recoverSource() {
  const id = currentTrack(playerStore.get())?.id;
  if (!id || !switchToStableSource(id)) return false;
  clearTimeout(clearTimer);
  recoveryStore.set({ trackId: id, settledAt: 0, ok: false });
  // 被限流时播放器当场就收手了，不会再有状态变化
  check();
  return true;
}

export type RecoveryPhase = 'offer' | 'switching' | 'done' | null;

/**
 * where：
 * - near：歌名附近（正在播放页、播放台），只在露面期间或刚点过时出现；
 * - panel：音质面板，能切就一直在，这首切回之后一直写着「已切回」。
 */
export function useRecoveryPhase(where: 'near' | 'panel'): RecoveryPhase {
  const can = useStore(playerStore, (s) => s.canSwitchToStableSource);
  const id = useStore(playerStore, (s) => currentTrack(s)?.id);
  const stable = useStore(playerStore, (s) => s.unblockMode === 'force_off' && s.resolvedVia === 'primary' && !s.loading);
  const r = useStore(recoveryStore, (s) => s);
  if (r.trackId && r.trackId === id) return !r.settledAt ? 'switching' : r.ok ? 'done' : null;
  if (where === 'panel') return can ? 'offer' : stable ? 'done' : null;
  return can && r.nudge === id ? 'offer' : null;
}
