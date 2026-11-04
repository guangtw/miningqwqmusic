import { currentTrack, playerStore, switchToStableSource } from '../player/player';
import { createStore, useStore } from './store';

/**
 * 「放的歌不对？」入口的状态。播放器只给能不能切（canSwitchToStableSource）和切的动作；
 * 这里补上点了之后那一小段：切换中 → 切好了（停几秒）→ 收起。几处入口共用同一份，点了哪个都一起变。
 */
interface Recovery {
  trackId: string | null;
  /** 换源请求落定的时刻；0 = 还在换 */
  settledAt: number;
  ok: boolean;
}

const DONE_MS = 4200;
const idle: Recovery = { trackId: null, settledAt: 0, ok: false };
export const recoveryStore = createStore<Recovery>(idle);

let clearTimer: ReturnType<typeof setTimeout> | undefined;

function check() {
  const r = recoveryStore.get();
  if (!r.trackId) return;
  const s = playerStore.get();
  // 切歌、清队列：这条状态跟着那首歌走
  if (currentTrack(s)?.id !== r.trackId) {
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

export function useRecoveryPhase(): RecoveryPhase {
  const can = useStore(playerStore, (s) => s.canSwitchToStableSource);
  const id = useStore(playerStore, (s) => currentTrack(s)?.id);
  const r = useStore(recoveryStore, (s) => s);
  if (r.trackId && r.trackId === id) return !r.settledAt ? 'switching' : r.ok ? 'done' : null;
  return can ? 'offer' : null;
}
