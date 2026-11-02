import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { hasId, type Track } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { isIPhone } from '../lib/device';
import { formatTime, sideLabel } from '../lib/format';
import { href, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { movePlaylistTrack } from '../lib/playlists';
import { currentTrack, playerStore, playList, toggle } from '../player/player';
import { openTrackMenu } from '../player/ui';
import { Cover } from './Cover';
import { Equalizer } from './Equalizer';
import { Highlight } from './Highlight';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';

interface Props {
  tracks: Track[];
  /** 专辑按 A/B 面编号，歌单按 01、02 编号 */
  sides?: boolean;
  showAlbum?: boolean;
  /** 自建歌单的 id：菜单里多一个「移除」，行可以拖动排序 */
  playlistId?: string;
  /** 每行带小封面，艺人挪到曲名下面（搜索结果这种来自不同专辑的列表用） */
  covers?: boolean;
  /** 标出曲名、艺人里命中的搜索词 */
  highlight?: string;
  /** 序号从几开始（分页时接着上一页编号） */
  start?: number;
}

/** 入场动画只给前若干行，长列表后面的直接出现 */
const STAGGER_ROWS = 24;
/** iPhone 上长列表先画够一屏多的行，剩下的每隔一会儿补一批：一口气挂上几百行，点开歌单那一下会卡住半秒 */
const FIRST_ROWS = 40;
const BATCH_ROWS = 80;
const BATCH_GAP_MS = 60;

type Drag = { from: number; over: number };

interface RowHandlers {
  row: (i: number) => void;
  menu: (i: number, e: React.MouseEvent) => void;
  dragStart: (i: number, e: React.DragEvent) => void;
  dragOver: (i: number, e: React.DragEvent) => void;
  drop: (i: number, e: React.DragEvent) => void;
  dragEnd: () => void;
}

export function TrackList({ tracks, sides = false, showAlbum = true, playlistId, covers = false, highlight, start = 0 }: Props) {
  const current = useStore(playerStore, (s) => currentTrack(s)?.id);
  const playing = useStore(playerStore, (s) => s.playing);
  const favorites = useStore(libraryStore, (s) => s.favorites);
  const half = Math.ceil(tracks.length / 2);
  // 拖动排序：拖起的行和当前要插到哪一行前面
  const [drag, setDrag] = useState<Drag | null>(null);
  const shown = useProgressiveCount(tracks.length);

  // 行组件 memo 住，回调从 ref 里读最新状态、自身保持不变：播放暂停、换歌时只重画相关的那一两行，不是整张歌单
  const live = useRef({ tracks, current, drag, playlistId });
  live.current = { tracks, current, drag, playlistId };
  const on = useMemo<RowHandlers>(
    () => ({
      row: (i) => {
        const { tracks, current } = live.current;
        if (tracks[i].id === current) toggle();
        else playList(tracks, i);
      },
      menu: (i, e) => {
        const { tracks, playlistId } = live.current;
        openTrackMenu(e, [tracks[i]], playlistId ? { from: { playlistId, index: i } } : {});
      },
      dragStart: (i, e) => {
        if (!live.current.playlistId) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', live.current.tracks[i].name);
        setDrag({ from: i, over: i });
      },
      dragOver: (i, e) => {
        const d = live.current.drag;
        if (!d) return;
        e.preventDefault();
        if (d.over !== i) setDrag({ ...d, over: i });
      },
      drop: (i, e) => {
        const { drag: d, playlistId } = live.current;
        if (!d || !playlistId) return;
        e.preventDefault();
        movePlaylistTrack(playlistId, d.from, i);
        setDrag(null);
      },
      dragEnd: () => setDrag(null),
    }),
    [],
  );

  return (
    <div className={`tracks ${showAlbum ? '' : 'no-album'} ${covers ? 'with-covers' : ''}`} role="list">
      <div className="tracks-head mono" aria-hidden="true">
        <span>{sides ? '面' : '序'}</span>
        <span>{covers ? '曲名 / 艺人' : '曲名'}</span>
        {!covers && <span className="col-artist">艺人</span>}
        {showAlbum && <span className="col-album">专辑</span>}
        <span />
        <span style={{ textAlign: 'right' }}>时长</span>
      </div>
      {tracks.slice(0, shown).map((t, i) => {
        const isCur = t.id === current;
        return (
          <Fragment key={playlistId ? t.id : `${t.id}-${i}`}>
            {sides && tracks.length > 3 && (i === 0 || i === half) && (
              <div className="side-divider reveal" style={{ '--i': Math.min(i, STAGGER_ROWS) } as React.CSSProperties}>
                {i === 0 ? 'A 面' : 'B 面'}
              </div>
            )}
            <TrackRow
              t={t}
              i={i}
              label={sides ? sideLabel(i, tracks.length) : String(start + i + 1).padStart(2, '0')}
              isCur={isCur}
              playing={isCur && playing}
              liked={t.id in favorites}
              draggable={!!playlistId}
              dragClass={
                drag?.from === i ? 'dragging' : drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'drop-after' : 'drop-before') : ''
              }
              covers={covers}
              showAlbum={showAlbum}
              highlight={highlight}
              on={on}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

/** 要先画几行：iPhone 上先画一屏多，返回到长列表中间时至少画到离开时的位置（不然滚动位置恢复不了） */
function useProgressiveCount(total: number) {
  const { scrollY } = useRoute();
  const [count, setCount] = useState(() =>
    isIPhone() ? Math.max(FIRST_ROWS, Math.ceil((scrollY + window.innerHeight) / 48) + 10) : Infinity,
  );
  useEffect(() => {
    if (count >= total) return;
    const id = setTimeout(() => setCount((c) => c + BATCH_ROWS), BATCH_GAP_MS);
    return () => clearTimeout(id);
  }, [count, total]);
  return count;
}

interface RowProps {
  t: Track;
  i: number;
  label: string;
  isCur: boolean;
  playing: boolean;
  liked: boolean;
  draggable: boolean;
  dragClass: string;
  covers: boolean;
  showAlbum: boolean;
  highlight?: string;
  on: RowHandlers;
}

const TrackRow = memo(function TrackRow({ t, i, label, isCur, playing, liked, draggable, dragClass, covers, showAlbum, highlight, on }: RowProps) {
  return (
    <div
      role="listitem"
      className={`track ${i < STAGGER_ROWS ? 'reveal' : ''} ${isCur ? 'current' : ''} ${dragClass}`}
      style={{ '--i': i } as React.CSSProperties}
      onClick={() => on.row(i)}
      onContextMenu={(e) => on.menu(i, e)}
      draggable={draggable}
      onDragStart={draggable ? (e) => on.dragStart(i, e) : undefined}
      onDragOver={(e) => on.dragOver(i, e)}
      onDrop={(e) => on.drop(i, e)}
      onDragEnd={on.dragEnd}
    >
      <span className="no">
        {isCur ? (
          <Equalizer playing={playing} />
        ) : (
          <>
            <span className="label">{label}</span>
            <span className="play-hint">
              <Icon name="play" />
            </span>
          </>
        )}
      </span>
      {covers ? (
        <span className="name">
          <Cover src={t.coverUrl ?? t.album?.coverUrl} alt="" size={96} className="track-cover" />
          <span className="name-text">
            <span className="t">
              <Highlight text={t.name} q={highlight} />
            </span>
            <span className="sub">
              <Artists track={t} q={highlight} />
            </span>
          </span>
        </span>
      ) : (
        <>
          <span className="name">
            <span className="t">
              <Highlight text={t.name} q={highlight} />
            </span>
          </span>
          <span className="cell col-artist">
            <Artists track={t} q={highlight} />
          </span>
        </>
      )}
      {showAlbum && (
        <span className="cell col-album">
          {hasId(t.album?.id) ? (
            <a href={href.album(t.album.id)} onClick={(e) => e.stopPropagation()}>
              {t.album.name}
            </a>
          ) : (
            t.album?.name
          )}
        </span>
      )}
      <span className="row-actions">
        <HeartButton liked={liked} onToggle={() => toggleFavorite(t)} />
      </span>
      <span className="dur">
        <button className="icon-btn more" aria-label="更多操作" aria-haspopup="menu" title="下一首播放、加到歌单…" onClick={(e) => on.menu(i, e)}>
          <Icon name="more" />
        </button>
        <span className="hide-on-hover">{formatTime(t.durationMs)}</span>
      </span>
    </div>
  );
});

function Artists({ track, q }: { track: Track; q?: string }) {
  return (
    <>
      {track.artists.map((a, k) => (
        <Fragment key={`${a.id}-${k}`}>
          {k > 0 && ' / '}
          {hasId(a.id) ? (
            <a href={href.artist(a.id)} onClick={(e) => e.stopPropagation()}>
              <Highlight text={a.name} q={q} />
            </a>
          ) : (
            <Highlight text={a.name} q={q} />
          )}
        </Fragment>
      ))}
    </>
  );
}
