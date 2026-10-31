import { useEffect, useRef } from 'react';
import { coverOf } from '../api';
import { artistNames, formatTime } from '../lib/format';
import { usePresence } from '../lib/motion';
import { useStore } from '../lib/store';
import { clearQueue, jumpTo, playerStore, removeAt, toggle } from '../player/player';
import { uiStore } from '../player/ui';
import { Cover } from './Cover';
import { Equalizer } from './Equalizer';
import { Icon } from './Icon';

export function QueueDrawer() {
  const open = useStore(uiStore, (s) => s.queue);
  const { mounted, state } = usePresence(open, 320);
  const queue = useStore(playerStore, (s) => s.queue);
  const index = useStore(playerStore, (s) => s.index);
  const playing = useStore(playerStore, (s) => s.playing);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => uiStore.set({ queue: false });

  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[index] as HTMLElement | undefined)?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;
  return (
    <>
      <div className="scrim" data-state={state} onClick={close} />
      <aside className="drawer" data-state={state} aria-label="播放队列">
        <div className="drawer-head">
          <h2>接下来</h2>
          <span className="mono faint">{queue.length} 首</span>
          {queue.length > 0 && (
            <button className="btn ghost sm" onClick={clearQueue}>
              清空
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-list" ref={listRef}>
          {queue.length === 0 && <p className="empty-note">队列是空的，去挑几张唱片吧。</p>}
          {queue.map((t, i) => (
            <div
              key={`${t.id}-${i}`}
              className={`q-item reveal ${i === index ? 'current' : ''}`}
              style={{ '--i': Math.min(i, 14) } as React.CSSProperties}
              onClick={() => (i === index ? toggle() : jumpTo(i))}
            >
              <Cover src={coverOf(t)} alt="" size={80} className="q-cover" />
              <span style={{ minWidth: 0 }}>
                <div className="t">{t.name}</div>
                <div className="a">{artistNames(t.artists)}</div>
              </span>
              <span className="mono faint">{i === index ? <Equalizer playing={playing} /> : formatTime(t.durationMs)}</span>
              <button
                className="icon-btn sm"
                aria-label="移出队列"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
