import { useEffect, useRef } from 'react';
import { useMedia, usePresence } from '../lib/motion';
import { noteIntroShown, recoverSource, useRecoveryCompact, useRecoveryPhase, type RecoveryPhase } from '../lib/sourceRecovery';
import { useStore } from '../lib/store';
import { currentTrack, playerStore } from '../player/player';
import { uiStore } from '../player/ui';
import { Icon } from './Icon';

type Phase = Exclude<RecoveryPhase, null>;
type Variant = 'line' | 'tag' | 'bar' | 'dot' | 'panel';

const FULL = '放的歌不对？点我暂时切换回稳定音源';
const TEXT: Record<'line' | 'bar' | 'panel' | 'tag', Record<Phase, string>> = {
  line: { offer: FULL, switching: '正在切回稳定音源…', done: '本曲已切回稳定音源，下一首照常' },
  panel: { offer: FULL, switching: '正在切回稳定音源…', done: '本曲已切回稳定音源，下一首照常' },
  bar: { offer: '放的歌不对？换回稳定音源', switching: '正在切回稳定音源…', done: '本曲已切回稳定音源' },
  tag: { offer: '歌不对？', switching: '切换中…', done: '已切回稳定音源' },
};
const HINT = '这首放的是其他音源的完整版。不对的话点一下，本曲先换回原平台音源，下一首照常';

/** 整句说明停够这么久，就算看过了 */
const INTRO_MS = 3000;

/**
 * 「放的歌不对？」入口：只在这首是免费歌、走了完整音源时出现，不弹窗、不提醒。
 * 这台设备上第一次是一整句（line：正在播放页歌手下面；bar：播放台歌手名下面），
 * 看过之后换成小的：tag 跟在歌手名后面，dot 是播放台心形旁边一枚小圆钮。音质面板里（panel）一直是整句。
 * 点了之后原地变成「切换中」「已切回」，几秒后收起。
 */
export function SourceRecovery({ variant }: { variant: Variant }) {
  const phase = useRecoveryPhase();
  const compact = useRecoveryCompact();
  const mine = variant === 'panel' || (variant === 'tag' || variant === 'dot' ? compact : !compact);
  const show = !!phase && mine;
  const { mounted, state } = usePresence(show, 320);
  // 收起动画那一下 phase 已经是 null，沿用最后一个状态的样子
  const last = useRef<Phase>('offer');
  if (phase) last.current = phase;
  const p = phase ?? last.current;

  // 整句真的露在屏幕上才算看过：正在播放页要开着，播放台那行只在电脑上有
  const npOpen = useStore(uiStore, (s) => s.nowPlaying);
  const wide = useMedia('(min-width: 861px)');
  const trackId = useStore(playerStore, (s) => currentTrack(s)?.id);
  const visible = (variant === 'line' && npOpen) || (variant === 'bar' && wide);
  useEffect(() => {
    if (!show || p !== 'offer' || !visible || !trackId) return;
    const t = setTimeout(() => noteIntroShown(trackId), INTRO_MS);
    return () => clearTimeout(t);
  }, [show, p, visible, trackId]);

  if (!mounted) return null;
  const act = (e: React.MouseEvent) => {
    // 播放台上的入口在「点开正在播放」的区域里
    e.stopPropagation();
    recoverSource();
  };
  const icon = <Icon name={p === 'done' ? 'check' : 'undo'} size={variant === 'bar' || variant === 'dot' ? 12 : 14} />;

  if (variant === 'dot') {
    const label = p === 'offer' ? FULL : TEXT.bar[p];
    return (
      <button
        type="button"
        className={`src-dot is-${p}`}
        data-state={state}
        disabled={p !== 'offer'}
        onClick={act}
        aria-label={label}
        title={p === 'offer' ? `放的歌不对？${HINT}` : label}
      >
        {icon}
      </button>
    );
  }

  return (
    <span className={`src-fix src-${variant} is-${p}`} data-state={state} aria-live="polite">
      <button
        type="button"
        className="src-fix-btn"
        disabled={p !== 'offer'}
        aria-label={variant === 'tag' && p === 'offer' ? FULL : undefined}
        title={p === 'offer' ? HINT : undefined}
        onClick={act}
      >
        <span className="src-fix-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="src-fix-text" key={p}>
          {TEXT[variant][p]}
        </span>
      </button>
    </span>
  );
}
