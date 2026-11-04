import { useRef } from 'react';
import { usePresence } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { recoverSource, useRecoveryPhase, type RecoveryPhase } from '../lib/sourceRecovery';
import { uiStore } from '../player/ui';
import { Icon } from './Icon';
import { toggleNowPlaying } from './PlayerBar';

type Phase = Exclude<RecoveryPhase, null>;
type Variant = 'line' | 'bar' | 'panel';

const FULL = '放的歌不对？点我暂时切换回稳定音源';
const TEXT: Record<Variant, Record<Phase, string>> = {
  line: { offer: FULL, switching: '正在切回稳定音源…', done: '本曲已切回稳定音源' },
  panel: { offer: '放的歌不对？点这里切回稳定音源', switching: '正在切回稳定音源…', done: '本曲已切回稳定音源，下一首照常' },
  bar: { offer: '放的歌不对？换回稳定音源', switching: '正在切回稳定音源…', done: '已切回稳定音源' },
};
const HINT = '这首放的是其他音源的完整版。不对的话点一下，本曲先换回原平台音源，下一首照常';

/** 去问答页：正在播放页开着就先收起来再跳 */
export function openSourceQA(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const to = href.help('source');
  if (uiStore.get().nowPlaying) toggleNowPlaying(false, () => navigate(to));
  else navigate(to);
}

/**
 * 「放的歌不对？」入口：只在这首是免费歌、走了完整音源时才有，不弹窗。
 * line：正在播放页歌手下面；bar：播放台歌手名下面（只在电脑上）。这两处只在露面期间出现（超清母带每首开头一会儿，
 * 别的音质一次打开网页一回），点过之后显示「已切回」和 Q&A 入口，停一会儿收起。
 * panel：音质面板里，能切就一直在。
 */
export function SourceRecovery({ variant }: { variant: Variant }) {
  const phase = useRecoveryPhase(variant === 'panel' ? 'panel' : 'near');
  const { mounted, state } = usePresence(!!phase, 320);
  // 收起动画那一下 phase 已经是 null，沿用最后一个状态的样子
  const last = useRef<Phase>('offer');
  if (phase) last.current = phase;
  if (!mounted) return null;
  const p = phase ?? last.current;
  const qa = p === 'done' || (variant === 'panel' && p === 'offer');

  return (
    <span className={`src-fix src-${variant} is-${p}`} data-state={state} aria-live="polite">
      <span className="src-fix-row">
        <button
          type="button"
          className="src-fix-btn"
          disabled={p !== 'offer'}
          title={p === 'offer' ? HINT : undefined}
          onClick={(e) => {
            // 播放台上的入口在「点开正在播放」的区域里
            e.stopPropagation();
            recoverSource();
          }}
        >
          <span className="src-fix-icon" aria-hidden="true">
            <Icon name={p === 'done' ? 'check' : 'undo'} size={variant === 'bar' ? 12 : 14} />
          </span>
          <span className="src-fix-text" key={p}>
            {TEXT[variant][p]}
          </span>
        </button>
        {qa && (
          <a className="src-qa" href={href.help('source')} onClick={openSourceQA} title="为什么会放错？怎么避开？">
            <b className="mono">Q&amp;A</b>
            {variant !== 'bar' && <span>{p === 'done' ? '为什么会放错？' : '为什么'}</span>}
          </a>
        )}
      </span>
    </span>
  );
}
