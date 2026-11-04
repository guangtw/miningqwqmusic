import { useRef } from 'react';
import { usePresence } from '../lib/motion';
import { recoverSource, useRecoveryPhase, type RecoveryPhase } from '../lib/sourceRecovery';
import { Icon } from './Icon';

const OFFER = '放的歌不对？点我暂时切换回稳定音源';
const TEXT: Record<Exclude<RecoveryPhase, null>, string> = {
  offer: OFFER,
  switching: '正在切回稳定音源…',
  done: '本曲已切回稳定音源，下一首照常',
};
const SHORT: Record<Exclude<RecoveryPhase, null>, string> = {
  offer: '放的歌不对？换回稳定音源',
  switching: '正在切回稳定音源…',
  done: '本曲已切回稳定音源',
};

/**
 * 「放的歌不对？」入口：只在这首是免费歌、走了完整音源时出现，不弹窗、不提醒，安安静静挂在歌名附近。
 * line：正在播放页歌手那一行下面；bar：播放台歌手名下面一行小字；panel：音质面板底部。
 * 点了之后原地变成「切换中」「已切回」，几秒后收起。
 */
export function SourceRecovery({ variant }: { variant: 'line' | 'bar' | 'panel' }) {
  const phase = useRecoveryPhase();
  const { mounted, state } = usePresence(!!phase, 320);
  // 收起动画那一下 phase 已经是 null，沿用最后一个状态的样子
  const last = useRef<Exclude<RecoveryPhase, null>>('offer');
  if (phase) last.current = phase;
  if (!mounted) return null;
  const p = phase ?? last.current;
  const text = (variant === 'bar' ? SHORT : TEXT)[p];

  return (
    <div className={`src-fix src-${variant} is-${p}`} data-state={state} aria-live="polite">
      <button
        type="button"
        className="src-fix-btn"
        disabled={p !== 'offer'}
        title={p === 'offer' ? '这首放的是其他音源的完整版；不对的话，本曲先换回原平台音源，下一首照常' : undefined}
        onClick={(e) => {
          // 播放台上这一行在「点开正在播放」的区域里
          e.stopPropagation();
          recoverSource();
        }}
      >
        <span className="src-fix-icon" aria-hidden="true">
          <Icon name={p === 'done' ? 'check' : 'undo'} size={variant === 'bar' ? 12 : 14} />
        </span>
        <span className="src-fix-text" key={p}>
          {text}
        </span>
      </button>
    </div>
  );
}
