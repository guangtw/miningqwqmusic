import { Fragment, useState } from 'react';
import { hasId, type Track } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { formatTime, sideLabel } from '../lib/format';
import { href } from '../lib/router';
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

export function TrackList({ tracks, sides = false, showAlbum = true, playlistId, covers = false, highlight, start = 0 }: Props) {
  const current = useStore(playerStore, (s) => currentTrack(s)?.id);
  const playing = useStore(playerStore, (s) => s.playing);
  const favorites = useStore(libraryStore, (s) => s.favorites);
  const half = Math.ceil(tracks.length / 2);
  // 拖动排序：拖起的行和当前要插到哪一行前面
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const menuFor = (i: number) => (e: React.MouseEvent) =>
    openTrackMenu(e, [tracks[i]], playlistId ? { from: { playlistId, index: i } } : {});

  const onRow = (i: number) => {
    if (tracks[i].id === current) toggle();
    else playList(tracks, i);
  };

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
      {tracks.map((t, i) => {
        const isCur = t.id === current;
        const liked = t.id in favorites;
        return (
          <Fragment key={playlistId ? t.id : `${t.id}-${i}`}>
            {sides && tracks.length > 3 && (i === 0 || i === half) && (
              <div className="side-divider reveal" style={{ '--i': Math.min(i, STAGGER_ROWS) } as React.CSSProperties}>
                {i === 0 ? 'A 面' : 'B 面'}
              </div>
            )}
            <div
              role="listitem"
              className={`track ${i < STAGGER_ROWS ? 'reveal' : ''} ${isCur ? 'current' : ''} ${drag?.from === i ? 'dragging' : ''} ${
                drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'drop-after' : 'drop-before') : ''
              }`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => onRow(i)}
              onContextMenu={menuFor(i)}
              draggable={!!playlistId}
              onDragStart={
                playlistId
                  ? (e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', t.name);
                      setDrag({ from: i, over: i });
                    }
                  : undefined
              }
              onDragOver={
                drag
                  ? (e) => {
                      e.preventDefault();
                      if (drag.over !== i) setDrag({ ...drag, over: i });
                    }
                  : undefined
              }
              onDrop={
                drag && playlistId
                  ? (e) => {
                      e.preventDefault();
                      movePlaylistTrack(playlistId, drag.from, i);
                      setDrag(null);
                    }
                  : undefined
              }
              onDragEnd={() => setDrag(null)}
            >
              <span className="no">
                {isCur ? (
                  <Equalizer playing={playing} />
                ) : (
                  <>
                    <span className="label">{sides ? sideLabel(i, tracks.length) : String(start + i + 1).padStart(2, '0')}</span>
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
                <button className="icon-btn more" aria-label="更多操作" aria-haspopup="menu" title="下一首播放、加到歌单…" onClick={menuFor(i)}>
                  <Icon name="more" />
                </button>
                <span className="hide-on-hover">{formatTime(t.durationMs)}</span>
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

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
