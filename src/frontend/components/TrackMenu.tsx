import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { libraryStore } from '../lib/account';
import { usePresence } from '../lib/motion';
import { downloadTrack } from '../lib/download';
import { addToPlaylist, isMine, playlistCover, removeFromPlaylist } from '../lib/playlists';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { addNext } from '../player/player';
import { uiStore, type TrackMenu as Menu } from '../player/ui';
import { Cover } from './Cover';
import { Icon } from './Icon';

const W = 272;

/**
 * 曲目菜单：下一首播放、下载、加到歌单（列出自建歌单）、从当前歌单移除。
 * 和音质面板一样是挂到 body 上的磨砂玻璃浮层。
 */
export function TrackMenu() {
  const live = useStore(uiStore, (s) => s.menu);
  // 关闭动画期间还要画上一次的内容
  const last = useRef<Menu | null>(live);
  if (live) last.current = live;
  const menu = last.current;
  const { mounted, state } = usePresence(!!live, 200);
  const all = useStore(libraryStore, (s) => s.importedPlaylists);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const close = () => uiStore.set({ menu: null });

  // 量好自己的高度再摆：默认开在锚点下方/上方，右边对齐锚点，贴边时往里收
  useLayoutEffect(() => {
    if (!live || !ref.current) return;
    const h = ref.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(W, vw - 24);
    const left = Math.max(12, Math.min(vw - width - 12, live.x - width));
    const top = live.below ? Math.min(live.y + 6, vh - h - 12) : Math.max(12, live.y - h - 6);
    setPos({ left, top: Math.max(12, top), width, '--origin': `${live.x - left}px`, transformOrigin: `${live.x - left}px ${live.below ? '0' : '100%'}` } as React.CSSProperties);
  }, [live, mounted]);

  useEffect(() => {
    if (!live) return;
    // 点打开它的那个按钮不在这里关，交给按钮自己切换
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !live.anchor?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    window.addEventListener('resize', close);
    document.querySelector('.main')?.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
      window.removeEventListener('resize', close);
      document.querySelector('.main')?.removeEventListener('scroll', close);
    };
  }, [live]);

  if (!mounted || !menu) return null;
  const { tracks, from, addOnly } = menu;
  const single = tracks.length === 1 ? tracks[0] : null;
  const mine = Object.values(all)
    .filter(isMine)
    .filter((p) => p.id !== from?.playlistId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const add = (id: string, name: string) => {
    const n = addToPlaylist(id, tracks);
    toast(n ? (single ? `加进《${name}》了。` : `${n} 首加进《${name}》了。`) : `都已经在《${name}》里了。`);
    close();
  };

  return createPortal(
    <div ref={ref} className="q-panel t-menu" role="menu" aria-label="曲目操作" data-state={state} style={pos}>
      {!addOnly && (
        <div className="t-menu-group">
          {single && (
            <button
              role="menuitem"
              className="t-menu-item"
              onClick={() => {
                addNext(single);
                close();
              }}
            >
              <Icon name="queue" /> 下一首播放
            </button>
          )}
          {single && (
            <button
              role="menuitem"
              className="t-menu-item"
              onClick={() => {
                void downloadTrack(single);
                close();
              }}
            >
              <Icon name="download" /> 下载
            </button>
          )}
          {from && (
            <button
              role="menuitem"
              className="t-menu-item danger"
              onClick={() => {
                removeFromPlaylist(from.playlistId, from.index);
                close();
              }}
            >
              <Icon name="trash" /> 从这张歌单移除
            </button>
          )}
        </div>
      )}
      <div className="t-menu-label mono">加到歌单{!single && ` · ${tracks.length} 首`}</div>
      <div className="t-menu-list">
        {mine.map((p) => {
          const has = !!single && p.tracks.some((t) => t.id === single.id);
          return (
            <button key={p.id} role="menuitem" className={`t-menu-pl ${has ? 'has' : ''}`} onClick={() => add(p.id, p.name)}>
              <Cover src={playlistCover(p)} alt="" size={80} className="t-menu-cover" />
              <span className="t-menu-name">{p.name}</span>
              <span className="t-menu-count mono">{has ? <Icon name="check" size={15} /> : p.tracks.length}</span>
            </button>
          );
        })}
      </div>
      <button
        role="menuitem"
        className="t-menu-item new"
        onClick={() => {
          uiStore.set({ menu: null, playlist: { mode: 'create', tracks } });
        }}
      >
        <Icon name="plus" /> 新建歌单{tracks.length ? '并加入' : ''}
      </button>
    </div>,
    document.body,
  );
}
